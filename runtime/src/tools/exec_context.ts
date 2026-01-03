import type { EventMsg } from "../protocol/event.js";
import type { ApprovalPolicy, SandboxMode } from "../sandbox/policy.js";

export type ToolExecutionContext = {
  cwd: string;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  abortSignal: AbortSignal;
  isCancelled: () => boolean;
  emit: (msg: EventMsg) => void;
  waitForExecApproval: (requestId: string) => Promise<boolean>;
};
