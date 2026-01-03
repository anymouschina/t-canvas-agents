import type { ModelInputItem } from "./input_item.js";
import type { ModelOutputItem } from "./output_item.js";
import type { ToolSpec } from "../tools/spec.js";

export type MockModelTurnArgs = {
  input: ModelInputItem[];
  tools: ToolSpec[];
};

export type MockModel = {
  runTurn: (args: MockModelTurnArgs) => AsyncGenerator<ModelOutputItem>;
};

export function createMvpMockModel(): MockModel {
  let stage: "need_tool" | "need_final" = "need_tool";

  return {
    async *runTurn(args: MockModelTurnArgs): AsyncGenerator<ModelOutputItem> {
      void args.tools;

      if (stage === "need_tool") {
        stage = "need_final";
        const lastUser = [...args.input].reverse().find((it) => {
          return it.type === "message" && it.role === "user";
        });
        const text =
          lastUser && lastUser.type === "message" && lastUser.role === "user"
            ? lastUser.content
            : "";
        yield {
          type: "function_call",
          callId: "mvp-shell-1",
          name: "shell_command",
          argumentsText: JSON.stringify({
            command: `echo ${JSON.stringify(`mock saw: ${text}`)}`,
            timeoutMs: 1000,
          }),
        };
        return;
      }

      const lastOutput = [...args.input].reverse().find((it) => {
        return it.type === "function_call_output";
      });
      const summary = lastOutput ? lastOutput.outputText : "no tool output";
      yield { type: "message", role: "assistant", content: `MVP done.\n\n${summary}` };
    },
  };
}
