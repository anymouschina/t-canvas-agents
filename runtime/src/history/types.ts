import type { ToolCallKind } from "../protocol/event.js";

export type HistoryItem =
  | {
      type: "message";
      role: "user" | "assistant" | "system";
      content: string;
      ts: number;
    }
  | {
      type: "tool_call";
      kind: ToolCallKind;
      callId: string;
      toolName: string;
      argumentsText?: string;
      ts: number;
    }
  | {
      type: "tool_output";
      callId: string;
      toolName: string;
      ok: boolean;
      outputText: string;
      ts: number;
    }
  | {
      type: "summary";
      content: string;
      ts: number;
    };

export type Turn = {
  id: string;
  items: HistoryItem[];
};

