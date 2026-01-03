import fs from "node:fs/promises";

export type ReplayEvent = {
  ts: number;
  id: string;
  msg: unknown;
};

export async function readJsonl(path: string): Promise<ReplayEvent[]> {
  const text = await fs.readFile(path, "utf8");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines.map((l) => JSON.parse(l) as ReplayEvent);
}

