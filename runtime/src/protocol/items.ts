export type UserInput =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "skill";
      name: string;
      path: string;
    };

