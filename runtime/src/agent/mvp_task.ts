import type { EventMsg } from "../protocol/event.js";
import type { ModelOutputItem } from "../model/output_item.js";
import { createMvpMockModel } from "../model/mock_model.js";
import { ToolRouter } from "../tools/router.js";
import { createShellCommandTool } from "../tools/handlers/shell_command.js";
import type { TaskDriver } from "./runtime.js";
import { ConversationHistory } from "../history/conversation.js";

export const mvpTaskDriver: TaskDriver = async function* (submission, ctx) {
  if (submission.op.type !== "user_input") {
    return;
  }

  const router = new ToolRouter();
  router.register(createShellCommandTool());

  const model = createMvpMockModel();

  const history = new ConversationHistory();
  const turn = history.startTurn(submission.id);
  for (const item of submission.op.items) {
    if (item.type !== "text") {
      continue;
    }
    turn.items.push({
      type: "message",
      role: "user",
      content: item.text,
      ts: Date.now(),
    });
  }

  yield { type: "task_started" };

  let lastAssistantMessage: string | undefined;

  for (let turn = 0; turn < 3; turn += 1) {
    history.maybeCompact({ maxChars: 2_000, keepLastTurns: 1, summaryMaxChars: 800 });
    const tools = router.specs();
    const input = history.toModelInput();
    for await (const item of model.runTurn({ input, tools })) {
      if (item.type === "message") {
        lastAssistantMessage = item.content;
        history.push(submission.id, {
          type: "message",
          role: "assistant",
          content: item.content,
          ts: Date.now(),
        });
        break;
      }

      const call = router.buildToolCall(item);
      if (!call) {
        continue;
      }

      const begin = toolCallBeginFrom(item);
      yield begin;
      history.push(submission.id, {
        type: "tool_call",
        kind: begin.kind,
        callId: begin.callId,
        toolName: begin.toolName,
        argumentsText: begin.argumentsText,
        ts: Date.now(),
      });

      const out = await router.dispatch(call, {
        cwd: ctx.cwd,
        sandboxMode: ctx.sandboxMode,
        approvalPolicy: ctx.approvalPolicy,
        abortSignal: ctx.abortSignal,
        isCancelled: ctx.isCancelled,
        emit: ctx.emit,
        waitForExecApproval: ctx.waitForExecApproval,
      });

      const end: EventMsg = {
        type: "tool_call_end",
        callId: out.callId,
        toolName: out.toolName,
        ok: out.ok,
        outputText: out.outputText,
      };
      yield end;
      history.push(submission.id, {
        type: "tool_output",
        callId: out.callId,
        toolName: out.toolName,
        ok: out.ok,
        outputText: out.outputText,
        ts: Date.now(),
      });

      // Tool outputs are included in model input via history.toModelInput().
    }

    if (lastAssistantMessage) {
      break;
    }
  }

  yield { type: "task_complete", lastAssistantMessage };
};

type ToolCallBeginEvent = Extract<EventMsg, { type: "tool_call_begin" }>;

function toolCallBeginFrom(
  item: Exclude<ModelOutputItem, { type: "message" }>,
): ToolCallBeginEvent {
  if (item.type === "function_call") {
    return {
      type: "tool_call_begin",
      callId: item.callId,
      toolName: item.name,
      kind: "function_call",
      argumentsText: item.argumentsText,
    };
  }
  return {
    type: "tool_call_begin",
    callId: item.callId,
    toolName: "local_shell",
    kind: "local_shell_call",
  };
}
