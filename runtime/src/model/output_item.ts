export type ModelOutputItem =
  | {
      type: "message";
      role: "assistant";
      content: string;
    }
  | {
      type: "function_call";
      callId: string;
      name: string;
      argumentsText: string;
    }
  | {
      type: "local_shell_call";
      callId: string;
      command: string[];
    };

