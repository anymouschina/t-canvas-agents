import type { TaskDriver } from "./runtime.js";
import { ToolRouter } from "../tools/router.js";
import { createShellCommandTool } from "../tools/handlers/shell_command.js";
import { createTwoStageScriptedModel } from "../model/scripted_model.js";
import {
  evAssistantMessage,
  evCompleted,
  evFunctionCall,
  evResponseCreated,
} from "../model/sse.js";
import { runCodexLikeTask } from "./turn_runner.js";

export const parallelShellTaskDriver: TaskDriver = async function* (submission, ctx) {
  if (submission.op.type !== "user_input") {
    return;
  }

  const text = submission.op.items
    .filter((it) => it.type === "text")
    .map((it) => it.text)
    .join("\n");

  const router = new ToolRouter();
  router.register(createShellCommandTool());

  const model = createTwoStageScriptedModel({
    first: [
      evResponseCreated("resp-1"),
      evFunctionCall("call-1", "shell_command", JSON.stringify({ command: "echo one" })),
      evFunctionCall("call-2", "shell_command", JSON.stringify({ command: "echo two" })),
      evCompleted("resp-1"),
    ],
    second: [
      evResponseCreated("resp-2"),
      evAssistantMessage("msg-1", `parallel demo done, user=${text}`),
      evCompleted("resp-2"),
    ],
  });

  yield* runCodexLikeTask({
    userTurnId: submission.id,
    userText: text,
    ctx,
    model,
    router,
  });
};

