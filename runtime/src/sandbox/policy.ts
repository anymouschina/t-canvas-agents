export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type ApprovalPolicy = "never" | "on-request";

export type SandboxPermissions = "use_default" | "require_escalated";

export function isLikelyMutatingShellCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed === "") {
    return false;
  }

  const lowered = trimmed.toLowerCase();

  const definitelyMutating = [
    "rm ",
    "mv ",
    "cp ",
    "chmod ",
    "chown ",
    "mkdir ",
    "rmdir ",
    "touch ",
    "git commit",
    "git add",
    "git checkout",
    "git switch",
    "git merge",
    "pnpm install",
    "npm install",
    "yarn add",
    "cargo install",
  ];
  if (definitelyMutating.some((p) => lowered.startsWith(p))) {
    return true;
  }

  if (trimmed.includes(">") || trimmed.includes(">>")) {
    return true;
  }

  return false;
}

