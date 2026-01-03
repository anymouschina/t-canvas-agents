import { createFsGuard } from "../../../sandbox/fs_guard.js";
import type { ToolHandler } from "../../types.js";
import { applyPatchOperations } from "./apply.js";
import { parseApplyPatch } from "./parser.js";

type ApplyPatchParams = {
  input: string;
};

export function createApplyPatchTool(): ToolHandler {
  return {
    spec: {
      name: "apply_patch",
      description:
        "Apply a unified patch to the workspace. Input must use the Begin Patch format.",
      supportsParallelToolCalls: false,
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "Patch text (Begin Patch format)." },
        },
      },
    },
    async handle(call, ctx) {
      if (call.kind !== "function_call") {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: "apply_patch expects function_call",
        };
      }

      const parsed = JSON.parse(call.argumentsText) as ApplyPatchParams;
      const ops = parseApplyPatch(parsed.input);
      const fsGuard = createFsGuard({ sandboxMode: ctx.sandboxMode, cwd: ctx.cwd });
      const res = await applyPatchOperations(ops, { fsGuard, cwd: ctx.cwd });

      return {
        callId: call.callId,
        toolName: call.toolName,
        ok: true,
        outputText: `Applied patch. Changed files: ${res.changedFiles.join(", ")}`,
      };
    },
  };
}
