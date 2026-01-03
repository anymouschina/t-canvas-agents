import type { HistoryItem, Turn } from "./types.js";

export type CompactOptions = {
  maxChars: number;
  keepLastTurns: number;
  summaryMaxChars: number;
};

export function compactTurns(turns: Turn[], options: CompactOptions): Turn[] {
  if (options.keepLastTurns < 1) {
    throw new Error("keepLastTurns must be >= 1");
  }

  const keep = turns.slice(-options.keepLastTurns);
  const drop = turns.slice(0, Math.max(0, turns.length - keep.length));

  const dropText = renderTurnsForSummary(drop, options.summaryMaxChars);
  if (dropText.trim() === "") {
    return turns;
  }

  const summaryTurn: Turn = {
    id: "summary",
    items: [
      {
        type: "summary",
        content: dropText,
        ts: Date.now(),
      },
    ],
  };

  return [summaryTurn, ...keep];
}

function renderTurnsForSummary(turns: Turn[], maxChars: number): string {
  const parts: string[] = [];
  for (const turn of turns) {
    for (const item of turn.items) {
      parts.push(renderItem(item));
      if (parts.join("\n").length >= maxChars) {
        break;
      }
    }
    if (parts.join("\n").length >= maxChars) {
      break;
    }
  }

  const joined = parts.join("\n");
  if (joined.length <= maxChars) {
    return joined;
  }
  return joined.slice(0, maxChars) + "\n...(truncated)";
}

function renderItem(item: HistoryItem): string {
  switch (item.type) {
    case "message":
      return `[${item.role}] ${item.content}`.trim();
    case "tool_call":
      return `[tool_call ${item.toolName} ${item.callId}] ${item.argumentsText ?? ""}`.trim();
    case "tool_output":
      return `[tool_output ${item.toolName} ${item.callId} ok=${item.ok}] ${item.outputText}`.trim();
    case "summary":
      return `[summary] ${item.content}`.trim();
    default: {
      const neverItem: never = item;
      return String(neverItem);
    }
  }
}

