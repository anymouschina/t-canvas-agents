import fs from "node:fs/promises";
import path from "node:path";

import { CodexMiniRuntime } from "../agent/runtime.js";
import { runCodexLikeTask } from "../agent/turn_runner.js";
import { loadDotEnvFile } from "../config/dotenv.js";
import { ConversationHistory } from "../history/conversation.js";
import { createOpenAIResponsesModel } from "../model/openai_responses_model.js";
import { ToolRouter } from "../tools/router.js";
import { createApplyPatchTool } from "../tools/handlers/apply_patch/tool.js";
import { createShellCommandTool } from "../tools/handlers/shell_command.js";
import { startRuntimeWebVisualizer } from "../web/server.js";

const host = process.env.CODEX_WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.CODEX_WEB_PORT ?? "8787");
const autostart = (process.env.CODEX_WEB_AUTOSTART ?? "1") !== "0";
const enableEventLog = (process.env.CODEX_WEB_EVENT_LOG ?? "1") !== "0";

await loadDotEnvFile(path.join(process.cwd(), ".env"));

const apiKey = process.env.OPENAI_API_KEY ?? "";
const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const modelName = process.env.OPENAI_MODEL ?? "gpt-5.2";

if (apiKey.trim() === "") {
  throw new Error("Missing OPENAI_API_KEY (set it in runtime/.env or env vars)");
}

const router = new ToolRouter();
router.register(createShellCommandTool());
router.register(createApplyPatchTool());

const model = createOpenAIResponsesModel({
  apiKey,
  baseUrl,
  model: modelName,
});

const defaultSessionId = "default";
const sessionHistories = new Map<string, ConversationHistory>();
sessionHistories.set(defaultSessionId, new ConversationHistory());

const tmpDir = path.join(process.cwd(), ".tmp");
await fs.mkdir(tmpDir, { recursive: true });
const defaultEventLogPath = path.join(tmpDir, "web-openai-events.jsonl");
const eventLogPath = enableEventLog ? (process.env.CODEX_WEB_EVENT_LOG_PATH ?? defaultEventLogPath) : undefined;

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  parallelToolCalls: true,
  eventLogPath,
  taskDriver: async function* (submission, ctx) {
    if (submission.op.type !== "user_input") {
      return;
    }

    const userText = submission.op.items
      .filter((it) => it.type === "text")
      .map((it) => it.text)
      .join("\n");

    const sessionId = submission.op.sessionId ?? defaultSessionId;
    const history = sessionHistories.get(sessionId) ?? new ConversationHistory();
    sessionHistories.set(sessionId, history);

    yield* runCodexLikeTask({
      userTurnId: submission.id,
      userText,
      ctx,
      model,
      router,
      history,
      options: { maxTurns: 10 },
    });
  },
});

const { url } = startRuntimeWebVisualizer({
  runtime,
  host,
  port,
  resetSession: (sessionId) => {
    sessionHistories.set(sessionId, new ConversationHistory());
  },
});
console.log(`runtime visualizer: ${url}`);
console.log(`openai: baseUrl=${baseUrl} model=${modelName}`);
if (eventLogPath) {
  console.log(`event log: ${eventLogPath}`);
}

if (autostart) {
  runtime.submit({
    type: "user_input",
    items: [{ type: "text", text: "Use shell_command to print `hello from codex-mini`." }],
  });
}

process.on("SIGINT", () => {
  try {
    runtime.submit({ type: "interrupt" });
    runtime.submit({ type: "shutdown" });
  } catch {
    // ignore
  }
});
