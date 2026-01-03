import path from "node:path";

import { CodexMiniRuntime } from "../agent/runtime.js";
import { mvpTaskDriver } from "../agent/mvp_task.js";
import { readJsonl } from "../logging/replay.js";

const logPath = path.join(process.cwd(), "ts-perf", "runtime", ".tmp", "events.jsonl");

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  eventLogPath: logPath,
  taskDriver: mvpTaskDriver,
});

runtime.submit({
  type: "user_input",
  items: [{ type: "text", text: "record and replay" }],
});

while (true) {
  const ev = await runtime.nextEvent();
  if (!ev) {
    break;
  }
  console.log("live:", JSON.stringify(ev));
  if (ev.msg.type === "task_complete") {
    runtime.submit({ type: "shutdown" });
  }
}

const replayed = await readJsonl(logPath);
console.log(`replay count: ${replayed.length}`);
