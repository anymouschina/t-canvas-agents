import fs from "node:fs/promises";
import path from "node:path";

import type { ToolHandler } from "../types.js";

type ReadFileParams = {
  path: string;
  maxBytes?: number;
};

type WriteFileParams = {
  path: string;
  content: string;
  overwrite?: boolean;
};

type AppendFileParams = {
  path: string;
  content: string;
};

type ListDirParams = {
  path: string;
  recursive?: boolean;
  maxEntries?: number;
};

function resolvePathWithinWorkspace(args: {
  cwd: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  targetPath: string;
}): string {
  const abs = path.resolve(args.cwd, args.targetPath);
  if (args.sandboxMode === "danger-full-access") {
    return abs;
  }
  const rel = path.relative(path.resolve(args.cwd), abs);
  const escapes = rel.startsWith("..") || path.isAbsolute(rel);
  if (escapes) {
    throw new Error(
      `SandboxMode is ${args.sandboxMode}; refusing access outside cwd. target=${abs}`,
    );
  }
  return abs;
}

export function createReadFileTool(): ToolHandler {
  return {
    spec: {
      name: "read_file",
      description: "Read a UTF-8 text file from the workspace (sandboxed).",
      supportsParallelToolCalls: true,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to cwd." },
          maxBytes: { type: "number", description: "Max bytes to read (default 65536)." },
        },
      },
    },
    async handle(call, ctx) {
      if (call.kind !== "function_call") {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: "read_file expects function_call",
        };
      }

      const parsed = JSON.parse(call.argumentsText) as ReadFileParams;
      const maxBytes = parsed.maxBytes ?? 65_536;
      const abs = resolvePathWithinWorkspace({
        cwd: ctx.cwd,
        sandboxMode: ctx.sandboxMode,
        targetPath: parsed.path,
      });

      const buf = await fs.readFile(abs);
      const sliced = buf.byteLength > maxBytes ? buf.subarray(0, maxBytes) : buf;
      const truncated = buf.byteLength > maxBytes;

      return {
        callId: call.callId,
        toolName: call.toolName,
        ok: true,
        outputText: JSON.stringify(
          {
            path: parsed.path,
            bytes: sliced.byteLength,
            truncated,
            content: sliced.toString("utf8"),
          },
          null,
          2,
        ),
      };
    },
  };
}

export function createWriteFileTool(): ToolHandler {
  return {
    spec: {
      name: "write_file",
      description: "Write a UTF-8 text file to the workspace (sandboxed).",
      supportsParallelToolCalls: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to cwd." },
          content: { type: "string", description: "File contents to write." },
          overwrite: {
            type: "boolean",
            description: "Overwrite if exists (default false).",
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
          outputText: "write_file expects function_call",
        };
      }

      if (ctx.sandboxMode === "read-only") {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: "SandboxMode is read-only; refusing filesystem writes.",
        };
      }

      const parsed = JSON.parse(call.argumentsText) as WriteFileParams;
      const abs = resolvePathWithinWorkspace({
        cwd: ctx.cwd,
        sandboxMode: ctx.sandboxMode,
        targetPath: parsed.path,
      });

      await fs.mkdir(path.dirname(abs), { recursive: true });

      if (parsed.overwrite !== true) {
        try {
          await fs.stat(abs);
          return {
            callId: call.callId,
            toolName: call.toolName,
            ok: false,
            outputText:
              "Refusing to overwrite existing file (set overwrite=true to allow).",
          };
        } catch {
          // ok: does not exist
        }
      }

      await fs.writeFile(abs, parsed.content, "utf8");
      return {
        callId: call.callId,
        toolName: call.toolName,
        ok: true,
        outputText: `Wrote ${parsed.path}`,
      };
    },
  };
}

export function createAppendFileTool(): ToolHandler {
  return {
    spec: {
      name: "append_file",
      description: "Append UTF-8 text to a file in the workspace (sandboxed).",
      supportsParallelToolCalls: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to cwd." },
          content: { type: "string", description: "Text to append." },
        },
      },
    },
    async handle(call, ctx) {
      if (call.kind !== "function_call") {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: "append_file expects function_call",
        };
      }

      if (ctx.sandboxMode === "read-only") {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: "SandboxMode is read-only; refusing filesystem writes.",
        };
      }

      const parsed = JSON.parse(call.argumentsText) as AppendFileParams;
      const abs = resolvePathWithinWorkspace({
        cwd: ctx.cwd,
        sandboxMode: ctx.sandboxMode,
        targetPath: parsed.path,
      });
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.appendFile(abs, parsed.content, "utf8");
      return {
        callId: call.callId,
        toolName: call.toolName,
        ok: true,
        outputText: `Appended ${parsed.path}`,
      };
    },
  };
}

export function createListDirTool(): ToolHandler {
  return {
    spec: {
      name: "list_dir",
      description: "List directory entries in the workspace (sandboxed).",
      supportsParallelToolCalls: true,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path relative to cwd." },
          recursive: { type: "boolean", description: "Recurse into subdirectories." },
          maxEntries: { type: "number", description: "Max entries to return (default 2000)." },
        },
      },
    },
    async handle(call, ctx) {
      if (call.kind !== "function_call") {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: "list_dir expects function_call",
        };
      }

      const parsed = JSON.parse(call.argumentsText) as ListDirParams;
      const abs = resolvePathWithinWorkspace({
        cwd: ctx.cwd,
        sandboxMode: ctx.sandboxMode,
        targetPath: parsed.path,
      });
      const recursive = parsed.recursive ?? false;
      const maxEntries = parsed.maxEntries ?? 2000;

      const out: string[] = [];
      await walk(abs, abs, { recursive, maxEntries, out });

      return {
        callId: call.callId,
        toolName: call.toolName,
        ok: true,
        outputText: JSON.stringify({ path: parsed.path, entries: out }, null, 2),
      };
    },
  };
}

async function walk(
  absRoot: string,
  absDir: string,
  args: { recursive: boolean; maxEntries: number; out: string[] },
): Promise<void> {
  if (args.out.length >= args.maxEntries) {
    return;
  }

  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const ent of entries) {
    if (args.out.length >= args.maxEntries) {
      return;
    }
    const abs = path.join(absDir, ent.name);
    const rel = path.relative(absRoot, abs);
    args.out.push(rel === "" ? ent.name : rel);

    if (args.recursive && ent.isDirectory()) {
      await walk(absRoot, abs, args);
    }
  }
}

