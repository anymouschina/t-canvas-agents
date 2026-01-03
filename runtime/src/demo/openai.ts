import path from "node:path";

import { CodexMiniRuntime } from "../agent/runtime.js";
import { runCodexLikeTask } from "../agent/turn_runner.js";
import { loadDotEnvFile } from "../config/dotenv.js";
import { createOpenAIResponsesModel } from "../model/openai_responses_model.js";
import { ToolRouter } from "../tools/router.js";
import { createApplyPatchTool } from "../tools/handlers/apply_patch/tool.js";
import { createShellCommandTool } from "../tools/handlers/shell_command.js";

await loadDotEnvFile(path.join(process.cwd(), ".env"));

const apiKey = process.env.OPENAI_API_KEY ?? "";
const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const modelName = process.env.OPENAI_MODEL ?? "gpt-5.2";

if (apiKey.trim() === "") {
  throw new Error("Missing OPENAI_API_KEY (set it in runtime/.env or env vars)");
}

const router = new ToolRouter();
router.register(createShellCommandTool());
router.register(createApplyPatchTool());

const model = createOpenAIResponsesModel({
  apiKey,
  baseUrl,
  model: modelName,
});

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  parallelToolCalls: true,
  taskDriver: async function* (submission, ctx) {
    if (submission.op.type !== "user_input") {
      return;
    }

    const userText = submission.op.items
      .filter((it) => it.type === "text")
      .map((it) => it.text)
      .join("\n");

    yield* runCodexLikeTask({
      userTurnId: submission.id,
      userText,
      ctx,
      model,
      router,
      options: { maxTurns: 10 },
    });
  },
});

runtime.submit({
  type: "user_input",
  items: [{ type: "text", text: "Use shell_command to print `hello from codex-mini`." }],
});

while (true) {
  const ev = await runtime.nextEvent();
  if (!ev) {
    break;
  }
  console.log(JSON.stringify(ev));
}
