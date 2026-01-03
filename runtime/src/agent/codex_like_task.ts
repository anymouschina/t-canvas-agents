import type { TaskDriver } from "./runtime.js";
import { ToolRouter } from "../tools/router.js";
import { createShellCommandTool } from "../tools/handlers/shell_command.js";
import { createApplyPatchTool } from "../tools/handlers/apply_patch/tool.js";
import { createTwoStageScriptedModel } from "../model/scripted_model.js";
import {
  evAssistantMessage,
  evCompleted,
  evFunctionCall,
  evResponseCreated,
} from "../model/sse.js";
import { runCodexLikeTask } from "./turn_runner.js";

export const codexLikeTaskDriver: TaskDriver = async function* (submission, ctx) {
  if (submission.op.type !== "user_input") {
    return;
  }

  const text = submission.op.items
    .filter((it) => it.type === "text")
    .map((it) => it.text)
    .join("\n");

  const router = new ToolRouter();
  router.register(createShellCommandTool());
  router.register(createApplyPatchTool());

  const patch = `*** Begin Patch
*** Add File: ts-perf/runtime/.tmp/from-model.txt
+created by apply_patch tool
*** End Patch`;

  const model = createTwoStageScriptedModel({
    first: [
      evResponseCreated("resp-1"),
      evFunctionCall("call-apply", "apply_patch", JSON.stringify({ input: patch })),
      evCompleted("resp-1"),
    ],
    second: [
      evResponseCreated("resp-2"),
      evAssistantMessage("msg-1", `done: wrote file, saw user: ${text}`),
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

