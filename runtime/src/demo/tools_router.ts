import { ToolRouter } from "../tools/router.js";

const router = new ToolRouter();
router.register({
  spec: {
    name: "test_tool",
    description: "Echo back provided input.",
    parameters: {
      type: "object",
      properties: { input: { type: "string", description: "text" } },
    },
  },
  async handle(call) {
    if (call.kind !== "function_call") {
      return {
        callId: call.callId,
        toolName: call.toolName,
        ok: false,
        outputText: "expected function_call",
      };
    }
    const args = JSON.parse(call.argumentsText) as { input: string };
    return {
      callId: call.callId,
      toolName: call.toolName,
      ok: true,
      outputText: `tool said: ${args.input}`,
    };
  },
});

const item = {
  type: "function_call" as const,
  callId: "call-1",
  name: "test_tool",
  argumentsText: JSON.stringify({ input: "hello" }),
};

const call = router.buildToolCall(item);
if (!call) {
  throw new Error("expected tool call");
}

const out = await router.dispatch(call, {
  cwd: process.cwd(),
  sandboxMode: "read-only",
  approvalPolicy: "on-request",
  abortSignal: new AbortController().signal,
  isCancelled: () => false,
  emit: () => {},
  waitForExecApproval: async () => false,
});
console.log(JSON.stringify({ toolSpecs: router.specs(), call, out }, null, 2));
