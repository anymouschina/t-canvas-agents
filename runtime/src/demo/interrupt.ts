import { CodexMiniRuntime } from "../agent/runtime.js";
import { ToolRouter } from "../tools/router.js";
import { createShellCommandTool } from "../tools/handlers/shell_command.js";
import { runCodexLikeTask } from "../agent/turn_runner.js";
import { createTwoStageScriptedModel } from "../model/scripted_model.js";
import { evCompleted, evFunctionCall, evResponseCreated } from "../model/sse.js";

const router = new ToolRouter();
router.register(createShellCommandTool());

const model = createTwoStageScriptedModel({
  first: [
    evResponseCreated("resp-1"),
    evFunctionCall(
      "slow-1",
      "shell_command",
      JSON.stringify({
        command: "bash -lc 'for i in 1 2 3 4 5; do echo working-$i; sleep 0.1; done'",
        timeoutMs: 5000,
      }),
    ),
    evCompleted("resp-1"),
  ],
  second: [evResponseCreated("resp-2"), evCompleted("resp-2")],
});

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  taskDriver: async function* (submission, ctx) {
    if (submission.op.type !== "user_input") {
      return;
    }
    yield* runCodexLikeTask({
      userTurnId: submission.id,
      userText: "interrupt demo",
      ctx,
      model,
      router,
      options: { maxTurns: 10 },
    });
  },
});

runtime.submit({ type: "user_input", items: [{ type: "text", text: "start" }] });

let sawFirstOutput = false;

while (true) {
  const ev = await runtime.nextEvent();
  if (!ev) {
    break;
  }
  console.log(JSON.stringify(ev));

  if (!sawFirstOutput && ev.msg.type === "exec_command_output_delta") {
    sawFirstOutput = true;
    runtime.submit({ type: "interrupt" });
  }

  if (ev.msg.type === "turn_aborted") {
    runtime.submit({ type: "shutdown" });
  }
}
