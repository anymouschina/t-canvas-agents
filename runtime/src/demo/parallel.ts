import { CodexMiniRuntime } from "../agent/runtime.js";
import { parallelShellTaskDriver } from "../agent/parallel_task.js";

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  parallelToolCalls: true,
  taskDriver: parallelShellTaskDriver,
});

runtime.submit({
  type: "user_input",
  items: [{ type: "text", text: "run two shell commands in parallel" }],
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
