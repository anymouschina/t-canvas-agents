import type { JsonSchema } from "./json_schema.js";

export type ToolSpec = {
  name: string;
  description: string;
  parameters: JsonSchema;
  supportsParallelToolCalls?: boolean;
};
