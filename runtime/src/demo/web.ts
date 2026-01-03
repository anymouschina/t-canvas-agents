import fs from "node:fs/promises";
import path from "node:path";

import { CodexMiniRuntime } from "../agent/runtime.js";
import { codexLikeTaskDriver } from "../agent/codex_like_task.js";
import { startRuntimeWebVisualizer } from "../web/server.js";

const host = process.env.CODEX_WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.CODEX_WEB_PORT ?? "8787");
const autostart = (process.env.CODEX_WEB_AUTOSTART ?? "1") !== "0";
const enableEventLog = (process.env.CODEX_WEB_EVENT_LOG ?? "1") !== "0";

const tmpDir = path.join(process.cwd(), ".tmp");
await fs.mkdir(tmpDir, { recursive: true });
const defaultEventLogPath = path.join(tmpDir, "web-events.jsonl");
const eventLogPath = enableEventLog ? (process.env.CODEX_WEB_EVENT_LOG_PATH ?? defaultEventLogPath) : undefined;

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  eventLogPath,
  taskDriver: codexLikeTaskDriver,
});

const { url } = startRuntimeWebVisualizer({ runtime, host, port });
console.log(`runtime visualizer: ${url}`);
console.log("POST /api/op/user-input to submit turns; approvals are shown in the UI.");
if (eventLogPath) {
  console.log(`event log: ${eventLogPath}`);
}

if (autostart) {
  runtime.submit({
    type: "user_input",
    items: [{ type: "text", text: "please apply a patch, then summarize what happened" }],
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
