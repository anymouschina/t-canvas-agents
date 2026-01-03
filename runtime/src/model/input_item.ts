export type ModelInputItem =
  | {
      type: "message";
      role: "user" | "assistant" | "system";
      content: string;
    }
  | {
      type: "function_call";
      callId: string;
      name: string;
      argumentsText: string;
    }
  | {
      type: "function_call_output";
      callId: string;
      outputText: string;
      ok?: boolean;
    };
