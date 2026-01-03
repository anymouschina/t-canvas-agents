import { CodexMiniRuntime, echoTaskDriver } from "../index.js";

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  taskDriver: echoTaskDriver,
});

runtime.submit({ type: "user_input", items: [{ type: "text", text: "hello codex-mini" }] });

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
