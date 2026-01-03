import { AsyncQueue } from "./async_queue.js";
import type { Event, EventMsg } from "../protocol/event.js";
import type { Op } from "../protocol/op.js";
import type { ApprovalPolicy, SandboxMode } from "../sandbox/policy.js";
import { EventLogWriter } from "../logging/event_log.js";
import type { UserInput } from "../protocol/items.js";

export type Submission = {
  id: string;
  op: Op;
};

export type TurnContext = {
  cwd: string;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  parallelToolCalls: boolean;
  abortSignal: AbortSignal;
  emit: (msg: EventMsg) => void;
  waitForExecApproval: (requestId: string) => Promise<boolean>;
  takePendingUserInputs: () => UserInput[];
  isCancelled: () => boolean;
};

export type TaskDriver = (submission: Submission, ctx: TurnContext) => AsyncGenerator<EventMsg>;

export class CodexMiniRuntime {
  private nextId = 0;
  private readonly submissions = new AsyncQueue<Submission>();
  private readonly events = new AsyncQueue<Event>();
  private isShutdown = false;
  private readonly ctx: TurnContext;
  private readonly taskDriver: TaskDriver;
  private readonly execApprovalWaiters = new Map<string, (decision: boolean) => void>();
  private readonly execApprovalDecisions = new Map<string, boolean>();
  private readonly logWriter?: EventLogWriter;
  private activeTask:
    | {
        id: string;
        cancelled: boolean;
        abort: AbortController;
        pendingUserInputs: UserInput[];
        done: Promise<void>;
      }
    | undefined;
  private shutdownRequested: { id: string } | undefined;

  constructor(args: {
    cwd: string;
    sandboxMode?: SandboxMode;
    approvalPolicy?: ApprovalPolicy;
    parallelToolCalls?: boolean;
    eventLogPath?: string;
    taskDriver: TaskDriver;
  }) {
    this.taskDriver = args.taskDriver;
    const sandboxMode = args.sandboxMode ?? "read-only";
    const approvalPolicy = args.approvalPolicy ?? "on-request";
    const parallelToolCalls = args.parallelToolCalls ?? false;
    this.logWriter = args.eventLogPath ? new EventLogWriter(args.eventLogPath) : undefined;
    this.ctx = {
      cwd: args.cwd,
      sandboxMode,
      approvalPolicy,
      parallelToolCalls,
      abortSignal: new AbortController().signal,
      emit: (_msg) => {
        throw new Error("emit() called outside of an active submission");
      },
      waitForExecApproval: async (requestId) => this.waitForExecApproval(requestId),
      takePendingUserInputs: () => [],
      isCancelled: () => false,
    };
    void this.runLoop();
  }

  submit(op: Op): string {
    if (this.isShutdown) {
      throw new Error("runtime is shutdown");
    }
    const id = String(this.nextId++);
    if (op.type === "exec_approval") {
      this.resolveExecApproval(op.id, op.decision === "approve");
      return id;
    }
    this.submissions.push({ id, op });
    return id;
  }

  getMeta(): Pick<TurnContext, "cwd" | "sandboxMode" | "approvalPolicy" | "parallelToolCalls"> {
    const { cwd, sandboxMode, approvalPolicy, parallelToolCalls } = this.ctx;
    return { cwd, sandboxMode, approvalPolicy, parallelToolCalls };
  }

  getState(): {
    isShutdown: boolean;
    shutdownRequested: boolean;
    activeTaskId?: string;
    activeTaskCancelled?: boolean;
    activeTaskPendingUserInputs: number;
    submissionsQueued: number;
    eventsQueued: number;
  } {
    return {
      isShutdown: this.isShutdown,
      shutdownRequested: this.shutdownRequested !== undefined,
      activeTaskId: this.activeTask?.id,
      activeTaskCancelled: this.activeTask?.cancelled,
      activeTaskPendingUserInputs: this.activeTask?.pendingUserInputs.length ?? 0,
      submissionsQueued: this.submissions.size(),
      eventsQueued: this.events.size(),
    };
  }

  async nextEvent(): Promise<Event | undefined> {
    return this.events.shift();
  }

  private emit(id: string, msg: EventMsg): void {
    const event: Event = { id, msg };
    this.events.push(event);
    void this.logWriter?.append(event);
  }

  private resolveExecApproval(requestId: string, decision: boolean): void {
    this.execApprovalDecisions.set(requestId, decision);
    const waiter = this.execApprovalWaiters.get(requestId);
    if (waiter) {
      this.execApprovalWaiters.delete(requestId);
      waiter(decision);
    }
  }

  private async waitForExecApproval(requestId: string): Promise<boolean> {
    const existing = this.execApprovalDecisions.get(requestId);
    if (existing !== undefined) {
      return existing;
    }
    return new Promise<boolean>((resolve) => {
      this.execApprovalWaiters.set(requestId, resolve);
    });
  }

  private async runLoop(): Promise<void> {
    while (true) {
      const sub = await this.submissions.shift();
      if (!sub) {
        break;
      }

      if (sub.op.type === "interrupt") {
        if (this.activeTask) {
          this.activeTask.cancelled = true;
          this.activeTask.abort.abort();
          this.emit(this.activeTask.id, { type: "turn_aborted", reason: "interrupt" });
        }
        continue;
      }

      if (sub.op.type === "shutdown") {
        this.isShutdown = true;
        this.shutdownRequested = { id: sub.id };
        if (!this.activeTask) {
          this.emit(sub.id, { type: "shutdown_complete" });
          this.submissions.close();
          this.events.close();
          break;
        }
        continue;
      }

      if (sub.op.type !== "user_input") {
        this.emit(sub.id, {
          type: "error",
          code: "unsupported_op",
          message: `Unsupported op: ${sub.op.type}`,
        });
        continue;
      }

      if (this.activeTask) {
        this.activeTask.pendingUserInputs.push(...sub.op.items);
        continue;
      }

      const abort = new AbortController();
      const active = {
        id: sub.id,
        cancelled: false,
        abort,
        pendingUserInputs: [] as UserInput[],
        done: Promise.resolve(),
      };
      this.activeTask = active;

      const ctx: TurnContext = {
        ...this.ctx,
        emit: (msg) => this.emit(sub.id, msg),
        takePendingUserInputs: () => {
          const items = active.pendingUserInputs;
          active.pendingUserInputs = [];
          return items;
        },
        isCancelled: () => active.cancelled || abort.signal.aborted,
        abortSignal: abort.signal,
      };

      active.done = (async () => {
        try {
          for await (const msg of this.taskDriver(sub, ctx)) {
            if (ctx.isCancelled()) {
              break;
            }
            this.emit(sub.id, msg);
          }
        } catch (err) {
          this.emit(sub.id, {
            type: "error",
            code: "task_driver_error",
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          if (this.activeTask?.id === sub.id) {
            this.activeTask = undefined;
          }
          if (this.shutdownRequested) {
            const shutdownId = this.shutdownRequested.id;
            this.shutdownRequested = undefined;
            this.emit(shutdownId, { type: "shutdown_complete" });
            this.submissions.close();
            this.events.close();
          }
        }
      })();
    }
  }
}
