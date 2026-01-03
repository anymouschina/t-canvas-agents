import type { ToolSpec } from "../tools/spec.js";
import type { ModelInputItem } from "./input_item.js";
import type { ResponsesSseEvent } from "./sse.js";
import type { EventMsg } from "../protocol/event.js";

export type ModelTurnArgs = {
  input: ModelInputItem[];
  tools: ToolSpec[];
  abortSignal?: AbortSignal;
  instructions?: string;
  parallelToolCalls?: boolean;
  debugEmit?: (msg: EventMsg) => void;
};

export type ModelClient = {
  runTurn: (args: ModelTurnArgs) => AsyncGenerator<ResponsesSseEvent>;
};
