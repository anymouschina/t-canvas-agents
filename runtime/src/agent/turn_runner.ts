import fs from "node:fs/promises";
import path from "node:path";

import type { EventMsg } from "../protocol/event.js";
import type { UserInput } from "../protocol/items.js";
import { ConversationHistory } from "../history/conversation.js";
import type { ModelClient } from "../model/client.js";
import type { ModelInputItem } from "../model/input_item.js";
import { decodeOutputItem } from "../model/sse.js";
import type { ToolRouter } from "../tools/router.js";
import type { ToolCall } from "../tools/types.js";
import type { TurnContext } from "./runtime.js";

export type RunTaskOptions = {
  maxTurns: number;
  finalAnswerTag?: string;
  needUserInputTag?: string;
};

export async function* runCodexLikeTask(args: {
  userTurnId: string;
  userText: string;
  initialUserInputs?: UserInput[];
  history?: ConversationHistory;
  systemPrompt?: string;
  summaryRole?: "system" | "user";
  ctx: TurnContext;
  model: ModelClient;
  router: ToolRouter;
  options?: Partial<RunTaskOptions>;
}): AsyncGenerator<EventMsg> {
  const options: RunTaskOptions = { maxTurns: 8, ...args.options };

  const history = args.history ?? new ConversationHistory();
  history.startTurn(args.userTurnId);
  history.push(args.userTurnId, {
    type: "message",
    role: "user",
    content: args.userText,
    ts: Date.now(),
  });

  yield { type: "task_started" };

  const activeSkills = new Map<string, { name: string; filePath: string; content: string }>();
  let finalTagRetryUsed = false;

  const resolveSkillPath = (p: string): string => {
    return path.isAbsolute(p) ? p : path.resolve(args.ctx.cwd, p);
  };

  const loadSkill = async (skill: { name: string; path: string }): Promise<void> => {
    const key = `${skill.name.toLowerCase()}::${skill.path}`;
    if (activeSkills.has(key)) {
      return;
    }
    const abs = resolveSkillPath(skill.path);
    try {
      const buf = await fs.readFile(abs);
      const maxBytes = 128 * 1024;
      const sliced = buf.byteLength > maxBytes ? buf.subarray(0, maxBytes) : buf;
      const truncated = buf.byteLength > maxBytes;
      const content = truncated
        ? `${sliced.toString("utf8")}\n\n[truncated at ${maxBytes} bytes]`
        : sliced.toString("utf8");
      activeSkills.set(key, { name: skill.name, filePath: abs, content });
    } catch (err) {
      activeSkills.set(key, {
        name: skill.name,
        filePath: abs,
        content: `Failed to load skill file: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const maybeLoadSkillsFromInputs = async (items: UserInput[]): Promise<void> => {
    for (const item of items) {
      if (item.type !== "skill") {
        continue;
      }
      await loadSkill(item);
    }
  };

  await maybeLoadSkillsFromInputs(args.initialUserInputs ?? []);

  let lastAssistantMessage: string | undefined;

  for (let turnIndex = 0; turnIndex < options.maxTurns; turnIndex += 1) {
    if (args.ctx.isCancelled()) {
      break;
    }

    const pending = args.ctx.takePendingUserInputs();
    await maybeLoadSkillsFromInputs(pending);
    for (const item of pending) {
      if (item.type !== "text") {
        continue;
      }
      history.push(args.userTurnId, {
        type: "message",
        role: "user",
        content: item.text,
        ts: Date.now(),
      });
    }

    history.maybeCompact({ maxChars: 8_000, keepLastTurns: 2, summaryMaxChars: 2_000 });

    const input = buildModelInput(history, {
      summaryRole: args.summaryRole ?? "system",
    });
    const tools = args.router.specs();

    let sawAnyToolCall = false;
    const toolCallsInThisTurn: ToolCall[] = [];
    let assistantDelta = "";

    const skillsText = renderSkills([...activeSkills.values()]);
    const instructions = [args.systemPrompt, skillsText].filter(Boolean).join("\n\n") || undefined;

    for await (const ev of args.model.runTurn({
      input,
      tools,
      abortSignal: args.ctx.abortSignal,
      instructions,
      parallelToolCalls: args.ctx.parallelToolCalls,
      debugEmit: args.ctx.emit,
    })) {
      if (args.ctx.isCancelled()) {
        break;
      }

      if (ev.type === "response.output_text.delta") {
        assistantDelta += ev.delta;
        yield { type: "agent_message_delta", delta: ev.delta };
        continue;
      }
      if (ev.type !== "response.output_item.done") {
        continue;
      }
      const outputItem = decodeOutputItem(ev.item);
      if (!outputItem) {
        continue;
      }

      if (outputItem.type === "message") {
        if (assistantDelta === "" && outputItem.content !== "") {
          yield { type: "agent_message_delta", delta: outputItem.content };
        }
        lastAssistantMessage = assistantDelta !== "" ? assistantDelta : outputItem.content;
        history.push(args.userTurnId, {
          type: "message",
          role: "assistant",
          content: lastAssistantMessage,
          ts: Date.now(),
        });
        break;
      }

      const toolCall = args.router.buildToolCall(outputItem);
      if (!toolCall) {
        continue;
      }

      sawAnyToolCall = true;
      toolCallsInThisTurn.push(toolCall);
    }

    if (toolCallsInThisTurn.length > 0) {
      for (const toolCall of toolCallsInThisTurn) {
        yield {
          type: "tool_call_begin",
          callId: toolCall.callId,
          toolName: toolCall.toolName,
          kind: toolCall.kind,
          argumentsText: toolCall.kind === "function_call" ? toolCall.argumentsText : undefined,
        };
        history.push(args.userTurnId, {
          type: "tool_call",
          kind: toolCall.kind,
          callId: toolCall.callId,
          toolName: toolCall.toolName,
          argumentsText: toolCall.kind === "function_call" ? toolCall.argumentsText : undefined,
          ts: Date.now(),
        });
      }

      const canParallel =
        args.ctx.parallelToolCalls &&
        toolCallsInThisTurn.length > 1 &&
        toolCallsInThisTurn.every((t) => args.router.toolSupportsParallel(t.toolName));

      const dispatchOne = async (toolCall: ToolCall) => {
        return args.router.dispatch(toolCall, {
          cwd: args.ctx.cwd,
          sandboxMode: args.ctx.sandboxMode,
          approvalPolicy: args.ctx.approvalPolicy,
          abortSignal: args.ctx.abortSignal,
          isCancelled: args.ctx.isCancelled,
          emit: args.ctx.emit,
          waitForExecApproval: args.ctx.waitForExecApproval,
        });
      };

      const outputs = canParallel
        ? await Promise.all(toolCallsInThisTurn.map((t) => dispatchOne(t)))
        : await dispatchSequentially(toolCallsInThisTurn, dispatchOne);

      for (const out of outputs) {
        yield {
          type: "tool_call_end",
          callId: out.callId,
          toolName: out.toolName,
          ok: out.ok,
          outputText: out.outputText,
        };
        history.push(args.userTurnId, {
          type: "tool_output",
          callId: out.callId,
          toolName: out.toolName,
          ok: out.ok,
          outputText: out.outputText,
          ts: Date.now(),
        });
      }
    }

    if (!sawAnyToolCall && lastAssistantMessage) {
      if (options.needUserInputTag && lastAssistantMessage.includes(options.needUserInputTag)) {
        break;
      }
      if (!options.finalAnswerTag) {
        break;
      }
      if (lastAssistantMessage.includes(options.finalAnswerTag)) {
        break;
      }

      if (!finalTagRetryUsed) {
        finalTagRetryUsed = true;
        history.push(args.userTurnId, {
          type: "message",
          role: "system",
          content: `Please restate your final answer prefixed with ${options.finalAnswerTag}.`,
          ts: Date.now(),
        });
        continue;
      }

      break;
    }
  }

  yield { type: "task_complete", lastAssistantMessage };
}

function renderSkills(skills: Array<{ name: string; filePath: string; content: string }>): string {
  if (skills.length === 0) {
    return "";
  }
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  return [
    "Skills (loaded for this user turn):",
    ...sorted.flatMap((s) => [`---`, `name: ${s.name}`, `path: ${s.filePath}`, "", s.content]),
    "---",
  ].join("\n");
}

async function dispatchSequentially<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (const item of items) {
    out.push(await fn(item));
  }
  return out;
}

function buildModelInput(
  history: ConversationHistory,
  options: { summaryRole: "system" | "user" },
): ModelInputItem[] {
  const out: ModelInputItem[] = [];
  for (const turn of history.allTurns()) {
    for (const item of turn.items) {
      if (item.type === "message") {
        const role = item.role === "system" ? options.summaryRole : item.role;
        out.push({ type: "message", role, content: item.content });
        continue;
      }
      if (item.type === "summary") {
        out.push({
          type: "message",
          role: options.summaryRole,
          content: `Summary so far:\n${item.content}`,
        });
        continue;
      }
      if (item.type === "tool_call") {
        if (item.kind !== "function_call") {
          continue;
        }
        if (!item.argumentsText) {
          continue;
        }
        out.push({
          type: "function_call",
          callId: item.callId,
          name: item.toolName,
          argumentsText: item.argumentsText,
        });
        continue;
      }
      if (item.type === "tool_output") {
        out.push({
          type: "function_call_output",
          callId: item.callId,
          outputText: item.outputText,
          ok: item.ok,
        });
      }
    }
  }
  return out;
}
