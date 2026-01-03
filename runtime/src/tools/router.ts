import type { ModelOutputItem } from "../model/output_item.js";
import type { ToolCall, ToolCallOutput, ToolHandler } from "./types.js";

export class ToolRouter {
  private readonly handlersByName = new Map<string, ToolHandler>();
  private readonly toolSpecs: ToolHandler["spec"][] = [];

  register(handler: ToolHandler): void {
    if (this.handlersByName.has(handler.spec.name)) {
      throw new Error(`duplicate tool: ${handler.spec.name}`);
    }
    this.handlersByName.set(handler.spec.name, handler);
    this.toolSpecs.push(handler.spec);
  }

  specs(): ToolHandler["spec"][] {
    return [...this.toolSpecs];
  }

  toolSupportsParallel(toolName: string): boolean {
    return (
      this.toolSpecs.find((s) => s.name === toolName)?.supportsParallelToolCalls === true
    );
  }

  buildToolCall(item: ModelOutputItem): ToolCall | undefined {
    if (item.type === "function_call") {
      return {
        kind: "function_call",
        callId: item.callId,
        toolName: item.name,
        argumentsText: item.argumentsText,
      };
    }
    if (item.type === "local_shell_call") {
      return {
        kind: "local_shell_call",
        callId: item.callId,
        toolName: "local_shell",
        command: item.command,
      };
    }
    return undefined;
  }

  async dispatch(call: ToolCall, ctx: ToolHandlerContext): Promise<ToolCallOutput> {
    const handler = this.handlersByName.get(call.toolName);
    if (!handler) {
      return {
        callId: call.callId,
        toolName: call.toolName,
        ok: false,
        outputText: `Unknown tool: ${call.toolName}`,
      };
    }

    try {
      return await handler.handle(call, ctx);
    } catch (err) {
      return {
        callId: call.callId,
        toolName: call.toolName,
        ok: false,
        outputText: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

type ToolHandlerContext = import("./exec_context.js").ToolExecutionContext;
