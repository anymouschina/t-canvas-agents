import readline from "node:readline";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

import { CodexMiniRuntime } from "../agent/runtime.js";
import { runCodexLikeTask } from "../agent/turn_runner.js";
import type { EventMsg } from "../protocol/event.js";
import { loadDotEnvFile } from "../config/dotenv.js";
import { createOpenAIResponsesModel } from "../model/openai_responses_model.js";
import { ToolRouter } from "../tools/router.js";
import { createApplyPatchTool } from "../tools/handlers/apply_patch/tool.js";
import { createShellCommandTool } from "../tools/handlers/shell_command.js";
import {
  createAppendFileTool,
  createListDirTool,
  createReadFileTool,
  createWriteFileTool,
} from "../tools/handlers/fs_tools.js";
import { createWebSearchTool } from "../tools/handlers/web_search.js";
import { createUpdatePlanTool } from "../tools/handlers/update_plan.js";
import { discoverSkills, selectSkillsForTurn } from "../skills/discovery.js";
import type { SkillMeta } from "../skills/types.js";
import { ConversationHistory } from "../history/conversation.js";

await loadDotEnvFile(path.join(process.cwd(), ".env"));

const apiKey = process.env.OPENAI_API_KEY ?? "";
const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const modelName = process.env.OPENAI_MODEL ?? "gpt-5.2";
const reasoningEffort = parseReasoningEffort(process.env.OPENAI_REASONING_EFFORT);
const disableResponseStorage =
  (process.env.OPENAI_DISABLE_RESPONSE_STORAGE ?? "").toLowerCase() === "true";
const debugRequests = (process.env.CODEX_MINI_DEBUG_REQUEST ?? "").toLowerCase() === "true";

if (apiKey.trim() === "") {
  throw new Error("Missing OPENAI_API_KEY (set it in runtime/.env or env vars)");
}

const skills = await loadSkills();
const skillsByName = new Map(skills.map((s) => [s.name.toLowerCase(), s]));
let nextTurnSkillNames: string[] = [];

const router = new ToolRouter();
router.register(createShellCommandTool());
router.register(createApplyPatchTool());
router.register(createReadFileTool());
router.register(createWriteFileTool());
router.register(createAppendFileTool());
router.register(createListDirTool());
router.register(createWebSearchTool());
router.register(createUpdatePlanTool());

const conversationId = crypto.randomUUID();

const model = createOpenAIResponsesModel({
  apiKey,
  baseUrl,
  model: modelName,
  reasoningEffort,
  store: disableResponseStorage ? false : undefined,
  include: reasoningEffort ? ["reasoning.encrypted_content"] : undefined,
  promptCacheKey: conversationId,
  debugRequests,
  extraHeaders: {
    conversation_id: conversationId,
    session_id: conversationId,
    originator: "codex_cli_rs",
  },
});

const systemPrompt = [
  "You are a coding agent running inside a local repo.",
  "Use the provided tools to inspect and change the workspace.",
  "Prefer list_dir/read_file before asking questions.",
  "Do not overwrite existing files unless explicitly requested.",
  "",
  "Workflow:",
  "- If the task requirements are unclear or missing key info, ask concise questions and stop. Prefix the message with NEED_INPUT:.",
  "- If the task is clear, keep going autonomously: inspect, plan, execute with tools, and verify.",
  "- When you are completely done for this user turn, prefix the final answer with FINAL:.",
  "",
  "Skills:",
  "- You may be given one or more skills for this user turn (loaded into instructions).",
  "- If a user mentions a skill explicitly (e.g. $analyze) or the task clearly matches a skill description, use it for this turn.",
].join("\n");

let active = false;
let pendingApproval: { requestId: string } | undefined;
let sessionHistory = new ConversationHistory();

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  parallelToolCalls: true,
  taskDriver: async function* (submission, ctx) {
    if (submission.op.type !== "user_input") {
      return;
    }

    const userText = submission.op.items
      .filter((it) => it.type === "text")
      .map((it) => it.text)
      .join("\n");

    yield* runCodexLikeTask({
      userTurnId: submission.id,
      userText,
      initialUserInputs: submission.op.items,
      history: sessionHistory,
      systemPrompt,
      summaryRole: "user",
      ctx,
      model,
      router,
      options: { maxTurns: 20, finalAnswerTag: "FINAL:", needUserInputTag: "NEED_INPUT:" },
    });
  },
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

function printHelp(): void {
  process.stdout.write(
    [
      "",
      "codex-mini repl",
      "- Enter text to send a user turn",
      "- /skills: list available skills",
      "- /skill <name>: add a skill for the next turn",
      "- /skill clear: clear pending skills",
      "- /reset: clear session memory",
      "- ~plan <task>: plan first, then execute",
      "- /help: show this help",
      "- /quit: shutdown",
      "",
    ].join("\n"),
  );
}

function prompt(): void {
  if (pendingApproval) {
    rl.setPrompt("approve? (y/n) > ");
  } else {
    rl.setPrompt(active ? "… > " : "> ");
  }
  rl.prompt();
}

process.on("SIGINT", () => {
  try {
    if (active) {
      runtime.submit({ type: "interrupt" });
      return;
    }
    runtime.submit({ type: "shutdown" });
  } catch {
    rl.close();
    process.exit(0);
  }
});

async function pumpEvents(): Promise<void> {
  while (true) {
    const ev = await runtime.nextEvent();
    if (!ev) {
      return;
    }
    handleEvent(ev.msg);
    if (ev.msg.type === "shutdown_complete") {
      rl.close();
      return;
    }
  }
}

function handleEvent(msg: EventMsg): void {
  if (msg.type === "task_started") {
    active = true;
    process.stdout.write("\n[task started]\n");
    prompt();
    return;
  }
  if (msg.type === "agent_message_delta") {
    process.stdout.write(msg.delta);
    return;
  }
  if (msg.type === "exec_command_output_delta") {
    process.stdout.write(`\n[${msg.stream}] ${msg.chunk}`);
    return;
  }
  if (msg.type === "plan_updated") {
    process.stdout.write("\n[plan updated]\n");
    if (msg.explanation && msg.explanation.trim() !== "") {
      process.stdout.write(`${msg.explanation}\n`);
    }
    for (const item of msg.plan) {
      process.stdout.write(`- [${item.status}] ${item.step}\n`);
    }
    prompt();
    return;
  }
  if (msg.type === "tool_call_begin") {
    process.stdout.write(`\n[tool begin] ${msg.toolName} (${msg.kind})\n`);
    if (msg.argumentsText) {
      process.stdout.write(`${msg.argumentsText}\n`);
    }
    return;
  }
  if (msg.type === "tool_call_end") {
    process.stdout.write(`\n[tool end] ${msg.toolName} ok=${msg.ok}\n`);
    process.stdout.write(`${msg.outputText}\n`);
    return;
  }
  if (msg.type === "exec_approval_request") {
    pendingApproval = { requestId: msg.requestId };
    process.stdout.write(`\n[exec approval]\n${msg.command}\n`);
    if (msg.justification) {
      process.stdout.write(`${msg.justification}\n`);
    }
    prompt();
    return;
  }
  if (msg.type === "turn_aborted") {
    active = false;
    pendingApproval = undefined;
    process.stdout.write(`\n[aborted] reason=${msg.reason}\n`);
    prompt();
    return;
  }
  if (msg.type === "task_complete") {
    active = false;
    pendingApproval = undefined;
    if (msg.lastAssistantMessage && msg.lastAssistantMessage.trim() !== "") {
      process.stdout.write(`\n\n[final]\n${msg.lastAssistantMessage}\n`);
    } else {
      process.stdout.write("\n\n[task complete]\n");
    }
    prompt();
    return;
  }
  if (msg.type === "error") {
    process.stdout.write(`\n[error] ${msg.code ?? "unknown"}: ${msg.message}\n`);
    prompt();
    return;
  }
}

printHelp();
prompt();
void pumpEvents();

rl.on("line", (line) => {
  const text = line.trim();

  if (pendingApproval) {
    const decision = text.toLowerCase().startsWith("y") ? "approve" : "deny";
    runtime.submit({ type: "exec_approval", id: pendingApproval.requestId, decision });
    pendingApproval = undefined;
    prompt();
    return;
  }

  if (text === "/skills") {
    printSkills();
    prompt();
    return;
  }
  if (text === "/skill") {
    process.stdout.write("\nUsage: /skill <name> | /skill clear\n");
    prompt();
    return;
  }
  if (text.startsWith("/skill ")) {
    const arg = text.slice("/skill ".length).trim();
    if (arg === "clear") {
      nextTurnSkillNames = [];
      process.stdout.write("\n[skill] cleared\n");
      prompt();
      return;
    }
    const meta = skillsByName.get(arg.toLowerCase());
    if (!meta) {
      process.stdout.write(`\n[skill] not found: ${arg}\n`);
      prompt();
      return;
    }
    nextTurnSkillNames = addUnique(nextTurnSkillNames, meta.name);
    process.stdout.write(`\n[skill] queued for next turn: ${meta.name}\n`);
    prompt();
    return;
  }

  if (text === "/help") {
    printHelp();
    prompt();
    return;
  }
  if (text === "/reset") {
    sessionHistory = new ConversationHistory();
    nextTurnSkillNames = [];
    process.stdout.write("\n[reset] cleared session memory\n");
    prompt();
    return;
  }
  if (text === "/quit") {
    runtime.submit({ type: "shutdown" });
    return;
  }
  if (text === "") {
    prompt();
    return;
  }

  const planMode = text === "~plan" || text.startsWith("~plan ");
  const planText = planMode ? text.replace(/^~plan\b/i, "").trim() : text;

  const selected = selectSkillsForTurn({
    available: skills,
    userText: planMode ? planText : text,
    forcedNames: nextTurnSkillNames,
  });
  nextTurnSkillNames = [];

  const cleaned = stripExplicitSkillMentions(planMode ? planText : text, selected.map((s) => s.name));
  const finalText = planMode ? wrapPlanMode(cleaned) : cleaned;
  const items = [
    ...selected.map((s) => ({ type: "skill" as const, name: s.name, path: s.filePath })),
    { type: "text" as const, text: finalText },
  ];
  runtime.submit({ type: "user_input", items });
  prompt();
});

function parseReasoningEffort(
  value: string | undefined,
): "minimal" | "low" | "medium" | "high" | undefined {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "") {
    return;
  }
  if (v === "minimal" || v === "low" || v === "medium" || v === "high") {
    return v;
  }
  return;
}

async function loadSkills(): Promise<SkillMeta[]> {
  const roots = getSkillRoots();
  if (roots.length === 0) {
    return [];
  }
  try {
    return await discoverSkills({ roots });
  } catch {
    return [];
  }
}

function getSkillRoots(): string[] {
  const dirsText = (process.env.CODEX_SKILLS_DIRS ?? "").trim();
  if (dirsText !== "") {
    return dirsText
      .split(path.delimiter)
      .map((s) => s.trim())
      .filter((s) => s !== "");
  }
  const codexHome =
    (process.env.CODEX_HOME ?? "").trim() !== ""
      ? String(process.env.CODEX_HOME)
      : path.join(os.homedir(), ".codex");
  return [path.join(codexHome, "Skills")];
}

function printSkills(): void {
  if (skills.length === 0) {
    process.stdout.write("\n(no skills found)\n");
    return;
  }
  process.stdout.write("\n[skills]\n");
  for (const s of skills) {
    process.stdout.write(`- ${s.name}: ${s.description}\n`);
  }
}

function addUnique(list: string[], item: string): string[] {
  const lower = item.toLowerCase();
  if (list.some((x) => x.toLowerCase() === lower)) {
    return list;
  }
  return [...list, item];
}

function stripExplicitSkillMentions(text: string, names: string[]): string {
  let out = text;
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\$${escaped}\\b`, "gi"), "");
  }
  return out.trim();
}

function wrapPlanMode(task: string): string {
  const t = task.trim();
  if (t === "") {
    return [
      "You are in PLAN mode, but no task was provided.",
      "Ask for the missing task as NEED_INPUT: and stop.",
    ].join("\n");
  }
  return [
    "PLAN MODE:",
    "- First call update_plan with a short, ordered plan (3-7 steps).",
    "- Keep the plan updated as you make progress (pending → in_progress → completed).",
    "- If key requirements are missing, ask concise questions and stop with NEED_INPUT:.",
    "- When fully done, respond with FINAL:.",
    "",
    `Task: ${t}`,
  ].join("\n");
}
