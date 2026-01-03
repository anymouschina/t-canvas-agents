import { CodexMiniRuntime } from "../agent/runtime.js";
import { ToolRouter } from "../tools/router.js";
import { createShellCommandTool } from "../tools/handlers/shell_command.js";
import { runCodexLikeTask } from "../agent/turn_runner.js";
import { createTwoStageScriptedModel } from "../model/scripted_model.js";
import {
  evAssistantMessage,
  evCompleted,
  evFunctionCall,
  evOutputTextDelta,
  evResponseCreated,
} from "../model/sse.js";

const router = new ToolRouter();
router.register(createShellCommandTool());

const model = createTwoStageScriptedModel({
  first: [
    evResponseCreated("resp-1"),
    evOutputTextDelta("I will run a command...\n"),
    evFunctionCall(
      "slow-1",
      "shell_command",
      JSON.stringify({
        command: "bash -lc 'for i in 1 2 3; do echo tick-$i; sleep 0.05; done'",
        timeoutMs: 1000,
      }),
    ),
    evCompleted("resp-1"),
  ],
  second: [
    evResponseCreated("resp-2"),
    evOutputTextDelta("All done.\n"),
    evAssistantMessage("msg-1", "final message"),
    evCompleted("resp-2"),
  ],
});

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  parallelToolCalls: false,
  taskDriver: async function* (submission, ctx) {
    if (submission.op.type !== "user_input") {
      return;
    }
    const text = submission.op.items
      .filter((it) => it.type === "text")
      .map((it) => it.text)
      .join("\n");
    yield* runCodexLikeTask({
      userTurnId: submission.id,
      userText: text,
      ctx,
      model,
      router,
    });
  },
});

runtime.submit({ type: "user_input", items: [{ type: "text", text: "show streaming" }] });

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
