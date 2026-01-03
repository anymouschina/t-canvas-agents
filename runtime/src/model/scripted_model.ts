import type { ModelClient, ModelTurnArgs } from "./client.js";
import type { ResponsesSseEvent } from "./sse.js";

export type ScriptedModel = {
  runTurn: (args: ModelTurnArgs) => AsyncGenerator<ResponsesSseEvent>;
};

export function createTwoStageScriptedModel(args: {
  first: ResponsesSseEvent[];
  second: ResponsesSseEvent[];
}): ModelClient {
  return {
    async *runTurn(turnArgs: ModelTurnArgs): AsyncGenerator<ResponsesSseEvent> {
      const hasToolOutput = turnArgs.input.some((it) => it.type === "function_call_output");
      const seq = hasToolOutput ? args.second : args.first;
      for (const ev of seq) {
        yield ev;
      }
    },
  };
}
