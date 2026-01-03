export type ToolCallKind = "function_call" | "custom_tool_call" | "local_shell_call";

export type PlanItemStatus = "pending" | "in_progress" | "completed";

export type PlanItem = {
  step: string;
  status: PlanItemStatus;
};

export type EventMsg =
  | {
      type: "task_started";
      modelContextWindow?: number;
    }
  | {
      type: "http_request";
      requestId: string;
      url: string;
      method: string;
      headers?: Record<string, string>;
      bodyText?: string;
      bodyBytes?: number;
      truncated?: boolean;
      meta?: Record<string, unknown>;
    }
  | {
      type: "http_response";
      requestId: string;
      url: string;
      status: number;
      ok: boolean;
      contentType?: string;
      meta?: Record<string, unknown>;
    }
  | {
      type: "agent_message_delta";
      delta: string;
    }
  | {
      type: "shutdown_complete";
    }
  | {
      type: "turn_aborted";
      reason: "interrupt" | "shutdown";
    }
  | {
      type: "exec_approval_request";
      requestId: string;
      command: string;
      justification?: string;
    }
  | {
      type: "exec_command_output_delta";
      callId: string;
      stream: "stdout" | "stderr";
      chunk: string;
    }
  | {
      type: "plan_updated";
      explanation?: string;
      plan: PlanItem[];
    }
  | {
      type: "tool_call_begin";
      callId: string;
      toolName: string;
      kind: ToolCallKind;
      argumentsText?: string;
    }
  | {
      type: "tool_call_end";
      callId: string;
      toolName: string;
      ok: boolean;
      outputText: string;
    }
  | {
      type: "task_complete";
      lastAssistantMessage?: string;
    }
  | {
      type: "error";
      message: string;
      code?: string;
    };

export type Event = {
  id: string;
  msg: EventMsg;
};
