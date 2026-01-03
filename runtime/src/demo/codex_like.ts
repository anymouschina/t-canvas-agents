import fs from "node:fs/promises";
import path from "node:path";

import { CodexMiniRuntime } from "../agent/runtime.js";
import { codexLikeTaskDriver } from "../agent/codex_like_task.js";

const tmpDir = path.join(process.cwd(), "ts-perf", "runtime", ".tmp");
await fs.mkdir(tmpDir, { recursive: true });

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  taskDriver: codexLikeTaskDriver,
});

runtime.submit({
  type: "user_input",
  items: [{ type: "text", text: "please apply a patch" }],
});

while (true) {
  const ev = await runtime.nextEvent();
  if (!ev) {
    break;
  }
  console.log(JSON.stringify(ev));
  if (ev.msg.type === "task_complete") {
    runtime.submit({ type: "shutdown" });
  }
}
