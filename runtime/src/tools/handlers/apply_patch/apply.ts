import fs from "node:fs/promises";
import path from "node:path";

import type { FsGuard } from "../../../sandbox/fs_guard.js";
import type { PatchHunk, PatchOperation } from "./parser.js";

export type ApplyPatchResult = {
  changedFiles: string[];
};

export async function applyPatchOperations(
  ops: PatchOperation[],
  ctx: { fsGuard: FsGuard; cwd: string },
): Promise<ApplyPatchResult> {
  const changedFiles: string[] = [];

  for (const op of ops) {
    if (op.type === "add") {
      ctx.fsGuard.assertWritablePath(op.path);
      const abs = path.resolve(ctx.cwd, op.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, op.content, "utf8");
      changedFiles.push(op.path);
      continue;
    }
    if (op.type === "delete") {
      ctx.fsGuard.assertWritablePath(op.path);
      const abs = path.resolve(ctx.cwd, op.path);
      await fs.rm(abs, { force: true });
      changedFiles.push(op.path);
      continue;
    }
    if (op.type === "update") {
      ctx.fsGuard.assertWritablePath(op.path);
      const abs = path.resolve(ctx.cwd, op.path);
      const oldText = await fs.readFile(abs, "utf8");
      const newText = applyHunks(oldText, op.hunks);
      await fs.writeFile(abs, newText, "utf8");
      changedFiles.push(op.path);
      continue;
    }

    const neverOp: never = op;
    throw new Error(`Unknown op: ${String(neverOp)}`);
  }

  return { changedFiles };
}

function applyHunks(oldText: string, hunks: PatchHunk[]): string {
  let current = oldText.replace(/\r\n/g, "\n");
  for (const hunk of hunks) {
    current = applySingleHunk(current, hunk);
  }
  return current;
}

function applySingleHunk(oldText: string, hunk: PatchHunk): string {
  const oldLines = oldText.split("\n");
  const matchIndex = findHunkMatchIndex(oldLines, hunk);
  if (matchIndex === -1) {
    throw new Error(`Failed to apply hunk (context not found): ${hunk.header}`);
  }

  const out: string[] = [];
  out.push(...oldLines.slice(0, matchIndex));

  let cursor = matchIndex;
  for (const line of hunk.lines) {
    if (line.tag === " ") {
      const actual = oldLines[cursor];
      if (actual !== line.text) {
        throw new Error(
          `Hunk context mismatch at ${hunk.header}: expected '${line.text}', got '${actual}'`,
        );
      }
      out.push(actual);
      cursor += 1;
      continue;
    }
    if (line.tag === "-") {
      const actual = oldLines[cursor];
      if (actual !== line.text) {
        throw new Error(
          `Hunk delete mismatch at ${hunk.header}: expected '${line.text}', got '${actual}'`,
        );
      }
      cursor += 1;
      continue;
    }
    if (line.tag === "+") {
      out.push(line.text);
      continue;
    }
  }

  out.push(...oldLines.slice(cursor));
  return out.join("\n");
}

function findHunkMatchIndex(oldLines: string[], hunk: PatchHunk): number {
  const prefix = hunk.lines.filter((l) => l.tag === " ").map((l) => l.text);
  if (prefix.length === 0) {
    return 0;
  }

  for (let start = 0; start <= oldLines.length - prefix.length; start += 1) {
    let ok = true;
    for (let j = 0; j < prefix.length; j += 1) {
      if (oldLines[start + j] !== prefix[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return start;
    }
  }
  return -1;
}

