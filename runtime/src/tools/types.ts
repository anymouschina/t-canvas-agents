export type ToolCall =
  | {
      kind: "function_call";
      callId: string;
      toolName: string;
      argumentsText: string;
    }
  | {
      kind: "local_shell_call";
      callId: string;
      toolName: "local_shell";
      command: string[];
    };

export type ToolCallOutput = {
  callId: string;
  toolName: string;
  ok: boolean;
  outputText: string;
};

export type ToolHandler = {
  spec: ToolSpec;
  handle: (call: ToolCall, ctx: ToolExecutionContext) => Promise<ToolCallOutput>;
};

import type { ToolSpec } from "./spec.js";
import type { ToolExecutionContext } from "./exec_context.js";
