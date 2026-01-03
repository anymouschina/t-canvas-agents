import { CodexMiniRuntime } from "../agent/runtime.js";
import { createShellCommandTool } from "../tools/handlers/shell_command.js";
import { ToolRouter } from "../tools/router.js";
import type { EventMsg } from "../protocol/event.js";

const router = new ToolRouter();
router.register(createShellCommandTool());

const runtime = new CodexMiniRuntime({
  cwd: process.cwd(),
  sandboxMode: "read-only",
  approvalPolicy: "on-request",
  taskDriver: async function* (submission, ctx) {
    if (submission.op.type !== "user_input") {
      return;
    }

    yield { type: "task_started" };

    const item = {
      type: "function_call" as const,
      callId: "approve-1",
      name: "shell_command",
      argumentsText: JSON.stringify({
        command: "echo approved run",
        timeoutMs: 1000,
        sandboxPermissions: "require_escalated",
        justification: "demo approval flow",
      }),
    };
    const call = router.buildToolCall(item);
    if (!call) {
      throw new Error("expected tool call");
    }

    yield {
      type: "tool_call_begin",
      callId: call.callId,
      toolName: call.toolName,
      kind: call.kind,
      argumentsText: call.kind === "function_call" ? call.argumentsText : undefined,
    };

    const out = await router.dispatch(call, {
      cwd: ctx.cwd,
      sandboxMode: ctx.sandboxMode,
      approvalPolicy: ctx.approvalPolicy,
      abortSignal: ctx.abortSignal,
      isCancelled: ctx.isCancelled,
      emit: ctx.emit,
      waitForExecApproval: ctx.waitForExecApproval,
    });

    yield {
      type: "tool_call_end",
      callId: out.callId,
      toolName: out.toolName,
      ok: out.ok,
      outputText: out.outputText,
    };

    yield { type: "task_complete", lastAssistantMessage: "done" };
  },
});

runtime.submit({ type: "user_input", items: [{ type: "text", text: "run demo" }] });

while (true) {
  const ev = await runtime.nextEvent();
  if (!ev) {
    break;
  }

  console.log(JSON.stringify(ev));

  if (ev.msg.type === "exec_approval_request") {
    const msg = ev.msg satisfies EventMsg & { type: "exec_approval_request" };
    runtime.submit({ type: "exec_approval", id: msg.requestId, decision: "approve" });
  }

  if (ev.msg.type === "task_complete") {
    runtime.submit({ type: "shutdown" });
  }
}
