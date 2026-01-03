import type { ModelOutputItem } from "./output_item.js";

export type ResponsesSseEvent =
  | { type: "response.created"; response: { id: string } }
  | { type: "response.output_text.delta"; delta: string }
  | { type: "response.completed"; response: { id: string } }
  | { type: "response.output_item.done"; item: ResponsesOutputItem };

export type ResponsesOutputItem =
  | {
      type: "message";
      role: "assistant";
      content: Array<{ type: "output_text"; text: string }>;
    }
  | {
      type: "output_text";
      text: string;
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "local_shell_call";
      call_id: string;
      status: string;
      action: { type: "exec"; command: string[] };
    };

export function evResponseCreated(id: string): ResponsesSseEvent {
  return { type: "response.created", response: { id } };
}

export function evCompleted(id: string): ResponsesSseEvent {
  return { type: "response.completed", response: { id } };
}

export function evAssistantMessage(id: string, text: string): ResponsesSseEvent {
  void id;
  return {
    type: "response.output_item.done",
    item: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  };
}

export function evOutputTextDelta(delta: string): ResponsesSseEvent {
  return { type: "response.output_text.delta", delta };
}

export function evFunctionCall(callId: string, name: string, argumentsText: string): ResponsesSseEvent {
  return {
    type: "response.output_item.done",
    item: {
      type: "function_call",
      call_id: callId,
      name,
      arguments: argumentsText,
    },
  };
}

export function evLocalShellCall(callId: string, command: string[]): ResponsesSseEvent {
  return {
    type: "response.output_item.done",
    item: {
      type: "local_shell_call",
      call_id: callId,
      status: "completed",
      action: { type: "exec", command },
    },
  };
}

export function decodeOutputItem(item: ResponsesOutputItem): ModelOutputItem | undefined {
  if (item.type === "function_call") {
    return {
      type: "function_call",
      callId: item.call_id,
      name: item.name,
      argumentsText: item.arguments,
    };
  }
  if (item.type === "local_shell_call") {
    return {
      type: "local_shell_call",
      callId: item.call_id,
      command: item.action.command,
    };
  }
  if (item.type === "output_text") {
    return { type: "message", role: "assistant", content: item.text };
  }
  if (item.type === "message") {
    const text = item.content
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("");
    return { type: "message", role: "assistant", content: text };
  }
  return;
}

export function parseResponsesSseEvent(json: unknown): ResponsesSseEvent | undefined {
  if (!json || typeof json !== "object") {
    return;
  }

  const type = (json as { type?: unknown }).type;
  if (typeof type !== "string") {
    return;
  }

  if (type === "response.created") {
    const response = (json as { response?: unknown }).response;
    const id = (response as { id?: unknown } | undefined)?.id;
    if (typeof id === "string") {
      return { type, response: { id } };
    }
    return;
  }

  if (type === "response.completed") {
    const response = (json as { response?: unknown }).response;
    const id = (response as { id?: unknown } | undefined)?.id;
    if (typeof id === "string") {
      return { type, response: { id } };
    }
    return;
  }

  if (type === "response.output_text.delta") {
    const delta = (json as { delta?: unknown }).delta;
    if (typeof delta === "string") {
      return { type, delta };
    }
    return;
  }

  if (type === "response.output_item.done") {
    const item = (json as { item?: unknown }).item;
    if (item && typeof item === "object") {
      return { type, item: item as ResponsesOutputItem };
    }
    return;
  }

  return;
}
