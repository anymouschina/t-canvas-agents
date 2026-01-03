import type { PlanItem, PlanItemStatus } from "../../protocol/event.js";
import type { ToolHandler } from "../types.js";

type UpdatePlanArgs = {
  explanation?: string;
  plan: PlanItem[];
};

export function createUpdatePlanTool(): ToolHandler {
  return {
    spec: {
      name: "update_plan",
      description:
        "Updates the task plan. Provide an optional explanation and a list of plan items, each with a step and status. At most one step can be in_progress at a time.",
      supportsParallelToolCalls: true,
      parameters: {
        type: "object",
        properties: {
          explanation: { type: "string" },
          plan: {
            type: "array",
            description: "The list of steps",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                status: {
                  type: "string",
                  description: "One of: pending, in_progress, completed",
                },
              },
              required: ["step", "status"],
              additionalProperties: false,
            },
          },
        },
        required: ["plan"],
        additionalProperties: false,
      },
    },
    async handle(call, ctx) {
      if (call.kind !== "function_call") {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: "update_plan expects function_call",
        };
      }

      let parsed: UpdatePlanArgs;
      try {
        parsed = JSON.parse(call.argumentsText) as UpdatePlanArgs;
      } catch (err) {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: `failed to parse function arguments: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const validationError = validatePlan(parsed.plan);
      if (validationError) {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: validationError,
        };
      }

      ctx.emit({
        type: "plan_updated",
        explanation: parsed.explanation,
        plan: parsed.plan,
      });

      return {
        callId: call.callId,
        toolName: call.toolName,
        ok: true,
        outputText: "Plan updated",
      };
    },
  };
}

function validatePlan(plan: PlanItem[]): string | undefined {
  if (!Array.isArray(plan) || plan.length === 0) {
    return "plan must be a non-empty array";
  }
  let inProgress = 0;
  for (const item of plan) {
    if (!item || typeof item.step !== "string" || item.step.trim() === "") {
      return "plan items must include a non-empty step";
    }
    if (!isPlanStatus(item.status)) {
      return "plan items must have status pending|in_progress|completed";
    }
    if (item.status === "in_progress") {
      inProgress += 1;
    }
  }
  if (inProgress > 1) {
    return "at most one plan item can be in_progress";
  }
  return;
}

function isPlanStatus(value: string): value is PlanItemStatus {
  return value === "pending" || value === "in_progress" || value === "completed";
}

