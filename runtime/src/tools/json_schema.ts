export type JsonSchema =
  | { type: "string"; description?: string }
  | { type: "number"; description?: string }
  | { type: "boolean"; description?: string }
  | {
      type: "object";
      description?: string;
      properties: Record<string, JsonSchema>;
      required?: string[];
      additionalProperties?: boolean;
    }
  | { type: "array"; description?: string; items: JsonSchema };
