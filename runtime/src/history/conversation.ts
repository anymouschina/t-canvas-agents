import type { HistoryItem, Turn } from "./types.js";
import type { ModelInputItem } from "../model/input_item.js";
import { compactTurns, type CompactOptions } from "./compact.js";

export class ConversationHistory {
  private readonly turns: Turn[] = [];

  startTurn(id: string): Turn {
    const turn: Turn = { id, items: [] };
    this.turns.push(turn);
    return turn;
  }

  allTurns(): Turn[] {
    return [...this.turns];
  }

  latestTurn(): Turn | undefined {
    return this.turns.at(-1);
  }

  push(turnId: string, item: HistoryItem): void {
    let turn: Turn | undefined;
    for (let i = this.turns.length - 1; i >= 0; i -= 1) {
      const candidate = this.turns[i];
      if (candidate && candidate.id === turnId) {
        turn = candidate;
        break;
      }
    }
    if (!turn) {
      throw new Error(`turn not found: ${turnId}`);
    }
    turn.items.push(item);
  }

  approximateCharCount(): number {
    let sum = 0;
    for (const turn of this.turns) {
      for (const item of turn.items) {
        sum += this.itemCharCount(item);
      }
    }
    return sum;
  }

  maybeCompact(options: CompactOptions): boolean {
    const current = this.approximateCharCount();
    if (current <= options.maxChars) {
      return false;
    }
    const compacted = compactTurns(this.turns, options);
    if (compacted === this.turns) {
      return false;
    }
    this.turns.length = 0;
    this.turns.push(...compacted);
    return true;
  }

  toModelInput(): ModelInputItem[] {
    const out: ModelInputItem[] = [];
    for (const turn of this.turns) {
      for (const item of turn.items) {
        if (item.type === "message") {
          out.push({ type: "message", role: item.role, content: item.content });
        }
        if (item.type === "summary") {
          out.push({
            type: "message",
            role: "system",
            content: `Summary so far:\n${item.content}`,
          });
        }
        if (item.type === "tool_output") {
          out.push({
            type: "function_call_output",
            callId: item.callId,
            outputText: item.outputText,
            ok: item.ok,
          });
        }
      }
    }
    return out;
  }

  private itemCharCount(item: HistoryItem): number {
    switch (item.type) {
      case "message":
        return item.content.length;
      case "summary":
        return item.content.length;
      case "tool_call":
        return (item.argumentsText ?? "").length + item.toolName.length + item.callId.length;
      case "tool_output":
        return item.outputText.length + item.toolName.length + item.callId.length;
      default: {
        const neverItem: never = item;
        throw new Error(`Unknown item: ${String(neverItem)}`);
      }
    }
  }
}
