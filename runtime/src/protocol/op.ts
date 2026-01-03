import type { UserInput } from "./items.js";

export type Op =
  | {
      type: "user_input";
      items: UserInput[];
      sessionId?: string;
    }
  | {
      type: "interrupt";
    }
  | {
      type: "exec_approval";
      id: string;
      decision: "approve" | "deny";
    }
  | {
      type: "shutdown";
    };
