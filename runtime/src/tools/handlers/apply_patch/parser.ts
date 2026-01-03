export type PatchOperation =
  | {
      type: "add";
      path: string;
      content: string;
    }
  | {
      type: "delete";
      path: string;
    }
  | {
      type: "update";
      path: string;
      hunks: PatchHunk[];
    };

export type PatchHunkLine = { tag: " " | "+" | "-"; text: string };

export type PatchHunk = {
  header: string;
  lines: PatchHunkLine[];
};

export function parseApplyPatch(input: string): PatchOperation[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  function expectLine(expected: string): void {
    const got = lines[i];
    if (got !== expected) {
      throw new Error(`Expected '${expected}', got '${got ?? "<eof>"}'`);
    }
    i += 1;
  }

  expectLine("*** Begin Patch");

  const ops: PatchOperation[] = [];

  while (i < lines.length) {
    const line = lines[i];
    if (line === "*** End Patch" || line === "*** End Patch\r") {
      break;
    }

    if (line?.startsWith("*** Add File: ")) {
      const filePath = line.slice("*** Add File: ".length).trim();
      i += 1;
      const contentLines: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? "";
        if (l.startsWith("*** ")) {
          break;
        }
        if (!l.startsWith("+")) {
          throw new Error(`Add File content must start with '+', got: '${l}'`);
        }
        contentLines.push(l.slice(1));
        i += 1;
      }
      ops.push({ type: "add", path: filePath, content: contentLines.join("\n") });
      continue;
    }

    if (line?.startsWith("*** Delete File: ")) {
      const filePath = line.slice("*** Delete File: ".length).trim();
      i += 1;
      ops.push({ type: "delete", path: filePath });
      continue;
    }

    if (line?.startsWith("*** Update File: ")) {
      const filePath = line.slice("*** Update File: ".length).trim();
      i += 1;
      const hunks: PatchHunk[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? "";
        if (l.startsWith("*** ")) {
          break;
        }
        if (!l.startsWith("@@")) {
          throw new Error(`Expected hunk header '@@', got: '${l}'`);
        }
        const header = l;
        i += 1;
        const hunkLines: PatchHunkLine[] = [];
        while (i < lines.length) {
          const hl = lines[i] ?? "";
          if (hl.startsWith("@@") || hl.startsWith("*** ")) {
            break;
          }
          if (hl === "\\ No newline at end of file") {
            i += 1;
            continue;
          }
          const tag = hl[0] as " " | "+" | "-";
          if (tag !== " " && tag !== "+" && tag !== "-") {
            throw new Error(`Invalid hunk line: '${hl}'`);
          }
          hunkLines.push({ tag, text: hl.slice(1) });
          i += 1;
        }
        hunks.push({ header, lines: hunkLines });
      }
      ops.push({ type: "update", path: filePath, hunks });
      continue;
    }

    throw new Error(`Unknown patch directive: '${line}'`);
  }

  expectLine("*** End Patch");
  return ops;
}

