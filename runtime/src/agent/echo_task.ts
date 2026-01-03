import type { EventMsg } from "../protocol/event.js";
import type { Submission, TaskDriver, TurnContext } from "./runtime.js";

export const echoTaskDriver: TaskDriver = async function* (
  submission: Submission,
  _ctx: TurnContext,
): AsyncGenerator<EventMsg> {
  if (submission.op.type !== "user_input") {
    return;
  }

  const texts = submission.op.items
    .filter((it) => it.type === "text")
    .map((it) => it.text);

  yield { type: "task_started" };
  yield {
    type: "task_complete",
    lastAssistantMessage: `Echo: ${texts.join("\n")}`.trim(),
  };
};
