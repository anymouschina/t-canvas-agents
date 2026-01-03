import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { parseFrontMatter } from "./front_matter.js";
import type { SkillMeta } from "./types.js";

export async function discoverSkills(args: {
  roots: string[];
  maxDepth?: number;
  maxFrontMatterBytes?: number;
}): Promise<SkillMeta[]> {
  const maxDepth = args.maxDepth ?? 8;
  const maxFrontMatterBytes = args.maxFrontMatterBytes ?? 8_192;

  const found: SkillMeta[] = [];
  for (const root of args.roots) {
    const absRoot = path.resolve(root);
    const files = await findSkillFiles(absRoot, { maxDepth });
    for (const filePath of files) {
      const meta = await readSkillMeta(filePath, { maxFrontMatterBytes });
      if (!meta) {
        continue;
      }
      found.push(meta);
    }
  }

  const unique = new Map<string, SkillMeta>();
  for (const s of found) {
    unique.set(s.name.toLowerCase(), s);
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function selectSkillsForTurn(args: {
  available: SkillMeta[];
  userText: string;
  forcedNames?: string[];
}): SkillMeta[] {
  const forced = new Set((args.forcedNames ?? []).map((n) => n.toLowerCase()));
  const out = new Map<string, SkillMeta>();

  for (const s of args.available) {
    if (forced.has(s.name.toLowerCase())) {
      out.set(s.name.toLowerCase(), s);
    }
  }

  const text = args.userText;
  for (const s of args.available) {
    if (matchesSkill(text, s)) {
      out.set(s.name.toLowerCase(), s);
    }
  }

  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function matchesSkill(userText: string, skill: SkillMeta): boolean {
  const lower = userText.toLowerCase();
  const nameLower = skill.name.toLowerCase();

  if (lower.includes(`$${nameLower}`)) {
    return true;
  }

  if (hasWordBoundaryMatch(userText, skill.name)) {
    return true;
  }

  // Best-effort heuristic for "task matches description": match any salient phrase.
  for (const phrase of candidatePhrases(skill.description)) {
    if (phrase === "") {
      continue;
    }
    const pLower = phrase.toLowerCase();
    if (pLower.length >= 2 && lower.includes(pLower)) {
      return true;
    }
  }

  return false;
}

function hasWordBoundaryMatch(text: string, needle: string): boolean {
  const hasAsciiWord = /^[A-Za-z0-9_-]+$/.test(needle);
  if (!hasAsciiWord) {
    return text.includes(needle);
  }
  const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i");
  return re.test(text);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function candidatePhrases(description: string): string[] {
  const out = new Set<string>();
  for (const part of description.split(/[；;，,。\n]/g)) {
    const t = part.trim();
    if (t.length >= 2) {
      out.add(t);
    }
  }
  for (const token of description.split(/[^\p{L}\p{N}_-]+/gu)) {
    const t = token.trim();
    if (t.length >= 2) {
      out.add(t);
    }
  }
  return [...out];
}

async function readSkillMeta(
  filePath: string,
  opts: { maxFrontMatterBytes: number },
): Promise<SkillMeta | undefined> {
  try {
    const buf = await fs.readFile(filePath);
    const sliced = buf.byteLength > opts.maxFrontMatterBytes ? buf.subarray(0, opts.maxFrontMatterBytes) : buf;
    const text = sliced.toString("utf8");
    const fm = parseFrontMatter(text);
    const name = (fm.name ?? "").trim();
    const description = (fm.description ?? "").trim();
    if (name === "" || description === "") {
      return;
    }
    return { name, description, filePath };
  } catch {
    return;
  }
}

async function findSkillFiles(
  rootDir: string,
  opts: { maxDepth: number },
): Promise<string[]> {
  const out: string[] = [];
  await walk(rootDir, { depth: 0, maxDepth: opts.maxDepth, out });
  return out;
}

async function walk(
  dir: string,
  args: { depth: number; maxDepth: number; out: string[] },
): Promise<void> {
  if (args.depth > args.maxDepth) {
    return;
  }
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(abs, { ...args, depth: args.depth + 1 });
      continue;
    }
    if (ent.isFile() && ent.name === "SKILL.md") {
      args.out.push(abs);
    }
  }
}
