import path from "node:path";

import type { SandboxMode } from "./policy.js";

export type FsGuard = {
  sandboxMode: SandboxMode;
  cwd: string;
  assertWritablePath: (targetPath: string) => void;
};

export function createFsGuard(args: { sandboxMode: SandboxMode; cwd: string }): FsGuard {
  return {
    sandboxMode: args.sandboxMode,
    cwd: args.cwd,
    assertWritablePath: (targetPath) => {
      if (args.sandboxMode === "danger-full-access") {
        return;
      }
      if (args.sandboxMode === "read-only") {
        throw new Error("SandboxMode is read-only; refusing filesystem writes.");
      }

      const absTarget = path.resolve(args.cwd, targetPath);
      const absCwd = path.resolve(args.cwd);
      const rel = path.relative(absCwd, absTarget);
      const escapes = rel.startsWith("..") || path.isAbsolute(rel);
      if (escapes) {
        throw new Error(
          `SandboxMode is workspace-write; refusing write outside cwd. target=${absTarget}`,
        );
      }
    },
  };
}

