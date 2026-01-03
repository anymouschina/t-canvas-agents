import { spawn } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";

import type { ToolHandler } from "../types.js";
import {
  isLikelyMutatingShellCommand,
  type SandboxPermissions,
} from "../../sandbox/policy.js";

type ShellCommandParams = {
  command: string;
  workdir?: string;
  timeoutMs?: number;
  login?: boolean;
  sandboxPermissions?: SandboxPermissions;
  justification?: string;
};

type ExecResult = {
  exitCode: number;
  wallTimeMs: number;
  stdout: string;
  stderr: string;
};

function defaultShellPath(): string {
  return process.env.SHELL && process.env.SHELL.trim() !== ""
    ? process.env.SHELL
    : "/bin/bash";
}

function deriveShellArgs(shellPath: string, command: string, login: boolean): string[] {
  const baseArgs = login ? ["-lc"] : ["-c"];

  if (shellPath.endsWith("bash") || shellPath.endsWith("zsh")) {
    return [...baseArgs, command];
  }

  return ["-lc", command];
}

async function execShellCommand(params: ShellCommandParams): Promise<ExecResult> {
  const start = performance.now();
  const shellPath = defaultShellPath();
  const login = params.login ?? true;
  const shellArgs = deriveShellArgs(shellPath, params.command, login);

  const child = spawn(shellPath, shellArgs, {
    cwd: params.workdir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  let timeout: NodeJS.Timeout | undefined;
  const timeoutMs = params.timeoutMs;
  if (timeoutMs !== undefined) {
    timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
  }

  const exitCode = await new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (timeout) {
    clearTimeout(timeout);
  }

  const wallTimeMs = performance.now() - start;
  return {
    exitCode,
    wallTimeMs,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
  };
}

function formatExecOutput(result: ExecResult): string {
  const wallSeconds = (result.wallTimeMs / 1000).toFixed(2);
  const outLines: string[] = [];
  outLines.push(`Exit code: ${result.exitCode}`);
  outLines.push(`Wall time: ${wallSeconds} seconds`);
  outLines.push("Output:");
  if (result.stdout.trim() !== "") {
    outLines.push(result.stdout.replace(/\s+$/, ""));
  }
  if (result.stderr.trim() !== "") {
    outLines.push("");
    outLines.push("Stderr:");
    outLines.push(result.stderr.replace(/\s+$/, ""));
  }
  return outLines.join("\n");
}

export function createShellCommandTool(): ToolHandler {
  return {
    spec: {
      name: "shell_command",
      description: "Run a shell command using the user's shell (e.g. bash/zsh).",
      supportsParallelToolCalls: true,
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command string to execute." },
          workdir: { type: "string", description: "Optional working directory." },
          timeoutMs: { type: "number", description: "Max runtime in ms." },
          login: {
            type: "boolean",
            description: "Run shell with login semantics (default true).",
          },
        },
      },
    },
    async handle(call, ctx) {
      if (call.kind !== "function_call") {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: "shell_command expects function_call",
        };
      }

      const parsed = JSON.parse(call.argumentsText) as ShellCommandParams;
      const sandboxPermissions = parsed.sandboxPermissions ?? "use_default";
      let effectiveSandboxMode = ctx.sandboxMode;

      if (sandboxPermissions === "require_escalated") {
        if (ctx.approvalPolicy !== "on-request") {
          return {
            callId: call.callId,
            toolName: call.toolName,
            ok: false,
            outputText:
              "Command requested escalated permissions, but approval_policy is not on-request.",
          };
        }

        const requestId = call.callId;
        ctx.emit({
          type: "exec_approval_request",
          requestId,
          command: parsed.command,
          justification: parsed.justification,
        });
        const approved = await ctx.waitForExecApproval(requestId);
        if (!approved) {
          return {
            callId: call.callId,
            toolName: call.toolName,
            ok: false,
            outputText: "User denied exec approval.",
          };
        }
        effectiveSandboxMode = "danger-full-access";
      }

      if (
        effectiveSandboxMode === "read-only" &&
        isLikelyMutatingShellCommand(parsed.command)
      ) {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText:
            "SandboxMode is read-only; refusing a likely-mutating command. Switch to workspace-write or request escalated permissions.",
        };
      }

      if (parsed.workdir && parsed.workdir.trim() !== "") {
        parsed.workdir = path.resolve(ctx.cwd, parsed.workdir);
      } else {
        parsed.workdir = ctx.cwd;
      }
      ctx.emit({
        type: "exec_command_output_delta",
        callId: call.callId,
        stream: "stdout",
        chunk: `> ${parsed.command}\n`,
      });
      const result = await execShellCommandWithStreaming(parsed, {
        onStdout: (chunk) =>
          ctx.emit({
            type: "exec_command_output_delta",
            callId: call.callId,
            stream: "stdout",
            chunk,
          }),
        onStderr: (chunk) =>
          ctx.emit({
            type: "exec_command_output_delta",
            callId: call.callId,
            stream: "stderr",
            chunk,
          }),
        abortSignal: ctx.abortSignal,
      });
      return {
        callId: call.callId,
        toolName: call.toolName,
        ok: result.exitCode === 0,
        outputText: formatExecOutput(result),
      };
    },
  };
}

async function execShellCommandWithStreaming(
  params: ShellCommandParams,
  hooks: {
    onStdout: (chunk: string) => void;
    onStderr: (chunk: string) => void;
    abortSignal: AbortSignal;
  },
): Promise<ExecResult> {
  const start = performance.now();
  const shellPath = defaultShellPath();
  const login = params.login ?? true;
  const shellArgs = deriveShellArgs(shellPath, params.command, login);

  const child = spawn(shellPath, shellArgs, {
    cwd: params.workdir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const abortListener = () => {
    child.kill("SIGKILL");
  };
  if (hooks.abortSignal.aborted) {
    abortListener();
  } else {
    hooks.abortSignal.addEventListener("abort", abortListener, { once: true });
  }

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutChunks.push(chunk);
    hooks.onStdout(chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
    hooks.onStderr(chunk.toString("utf8"));
  });

  let timeout: NodeJS.Timeout | undefined;
  const timeoutMs = params.timeoutMs;
  if (timeoutMs !== undefined) {
    timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
  }

  const exitCode = await new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
  });

  hooks.abortSignal.removeEventListener("abort", abortListener);

  if (timeout) {
    clearTimeout(timeout);
  }

  const wallTimeMs = performance.now() - start;
  return {
    exitCode,
    wallTimeMs,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
  };
}
