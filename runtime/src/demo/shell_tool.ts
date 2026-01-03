import { ToolRouter } from "../tools/router.js";
import { createShellCommandTool } from "../tools/handlers/shell_command.js";

const router = new ToolRouter();
router.register(createShellCommandTool());

const item = {
  type: "function_call" as const,
  callId: "shell-1",
  name: "shell_command",
  argumentsText: JSON.stringify({ command: "echo hello from shell_command", timeoutMs: 1000 }),
};

const call = router.buildToolCall(item);
if (!call) {
  throw new Error("expected tool call");
}

const out = await router.dispatch(call, {
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  abortSignal: new AbortController().signal,
  isCancelled: () => false,
  emit: () => {},
  waitForExecApproval: async () => true,
});
console.log(out.outputText);
