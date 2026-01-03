import { CodexMiniRuntime } from "../agent/runtime.js";
import { mvpTaskDriver } from "../agent/mvp_task.js";

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  taskDriver: mvpTaskDriver,
});

runtime.submit({
  type: "user_input",
  items: [{ type: "text", text: "hello, please run a command" }],
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
