import type { ModelClient, ModelTurnArgs } from "./client.js";
import type { ModelInputItem } from "./input_item.js";
import type { ResponsesSseEvent } from "./sse.js";
import { parseResponsesSseEvent } from "./sse.js";
import type { ToolSpec } from "../tools/spec.js";

type OpenAIResponsesModelOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  extraHeaders?: Record<string, string>;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  store?: boolean;
  include?: string[];
  promptCacheKey?: string;
  debugRequests?: boolean;
};

type ResponsesInputItem =
  | {
      type: "message";
      role: "user" | "assistant" | "system";
      content: Array<{ type: "input_text" | "output_text"; text: string }>;
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

type ResponsesTool =
  | {
      type: "function";
      name: string;
      description: string;
      parameters: unknown;
    }
  | {
      type: string;
      name?: string;
      description?: string;
      parameters?: unknown;
    };

export function createOpenAIResponsesModel(opts: OpenAIResponsesModelOptions): ModelClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  let requestSeq = 0;

  if (opts.apiKey.trim() === "") {
    throw new Error("createOpenAIResponsesModel: apiKey is empty");
  }
  if (opts.model.trim() === "") {
    throw new Error("createOpenAIResponsesModel: model is empty");
  }

  return {
    async *runTurn(args: ModelTurnArgs): AsyncGenerator<ResponsesSseEvent> {
      const url = `${baseUrl}/responses`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        authorization: `Bearer ${opts.apiKey}`,
        ...opts.extraHeaders,
      };

      const basePayload: Record<string, unknown> = {
        model: opts.model,
        tools: encodeTools(args.tools),
        reasoning: opts.reasoningEffort ? { effort: opts.reasoningEffort } : undefined,
        store: opts.store ?? false,
        include: opts.include && opts.include.length > 0 ? opts.include : undefined,
        tool_choice: "auto",
        parallel_tool_calls: args.parallelToolCalls ?? false,
        prompt_cache_key: opts.promptCacheKey,
        stream: true,
      };

      const instructions =
        typeof args.instructions === "string" && args.instructions.trim() !== ""
          ? args.instructions
          : undefined;

      const send = async (args2: {
        withInstructions: boolean;
        inputMode: "default" | "all_output_text";
      }): Promise<{
        res: Response;
        payloadKeys: string[];
        contentType: string;
      }> => {
        const requestId = `openai-${requestSeq++}`;
        const payload: Record<string, unknown> = {
          ...basePayload,
          input: encodeInput(args.input, args2.inputMode),
          instructions: args2.withInstructions ? instructions : undefined,
        };
        const payloadKeys = Object.keys(payload).filter((k) => payload[k] !== undefined);
        const body = JSON.stringify(payload);

        if (args.debugEmit) {
          const maxChars = 64_000;
          const truncated = body.length > maxChars;
          const bodyText = truncated ? `${body.slice(0, maxChars)}\n[truncated]` : body;
          const safeHeaders: Record<string, string> = {
            "content-type": headers["content-type"],
            ...(opts.extraHeaders ?? {}),
          };
          args.debugEmit({
            type: "http_request",
            requestId,
            url,
            method: "POST",
            headers: safeHeaders,
            bodyText,
            bodyBytes: Buffer.byteLength(body, "utf8"),
            truncated,
            meta: {
              provider: "openai_responses",
              model: opts.model,
              withInstructions: args2.withInstructions,
              inputMode: args2.inputMode,
              parallelToolCalls: args.parallelToolCalls ?? false,
              payloadKeys,
            },
          });
        }

        const res = await fetchImpl(url, {
          method: "POST",
          headers,
          body,
          signal: args.abortSignal,
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (args.debugEmit) {
          args.debugEmit({
            type: "http_response",
            requestId,
            url,
            status: res.status,
            ok: res.ok,
            contentType,
            meta: {
              provider: "openai_responses",
            },
          });
        }
        return { res, payloadKeys, contentType };
      };

      if (opts.debugRequests) {
        const keysWithInstructions = Object.keys({ ...basePayload, instructions }).filter(
          (k) => (basePayload as any)[k] !== undefined || (k === "instructions" && instructions !== undefined),
        );
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify(
            {
              url,
              keys: keysWithInstructions,
              hasPreviousResponseId: keysWithInstructions.includes("previous_response_id"),
              hasInstructions: instructions !== undefined,
              toolCount: args.tools.length,
              inputCount: args.input.length,
              parallelToolCalls: args.parallelToolCalls ?? false,
              store: (basePayload as any).store,
            },
            null,
            2,
          ),
        );
      }

      let withInstructions = true;
      let inputMode: "default" | "all_output_text" = "default";
      let attempt = await send({ withInstructions, inputMode });

      const shouldRetryWithoutInstructions = (detail: string, status: number): boolean => {
        if (instructions === undefined) {
          return false;
        }
        if (detail.includes("Instructions are not valid")) {
          return true;
        }
        // Some providers return generic 400s when instructions are present.
        return status === 400;
      };

      const shouldRetryWithOutputText = (detail: string): boolean => {
        return (
          detail.includes("Invalid value: 'input_text'") &&
          detail.includes("Supported values are: 'output_text'")
        );
      };

      const fail = async (detail: string): Promise<never> => {
        const debug = JSON.stringify(
          {
            url,
            status: attempt.res.status,
            contentType: attempt.contentType,
            keys: attempt.payloadKeys,
            hasPreviousResponseId: attempt.payloadKeys.includes("previous_response_id"),
            hasInstructions: attempt.payloadKeys.includes("instructions"),
            parallelToolCalls: args.parallelToolCalls ?? false,
            store: (basePayload as any).store,
          },
          null,
          2,
        );
        throw new Error(`Responses API error (${attempt.res.status}): ${detail}\n${debug}`);
      };

      if (!attempt.res.ok) {
        const detail = await safeReadText(attempt.res);
        if (shouldRetryWithOutputText(detail)) {
          inputMode = "all_output_text";
          attempt = await send({ withInstructions, inputMode });
        }
        if (!attempt.res.ok) {
          const detail2 = await safeReadText(attempt.res);
          if (shouldRetryWithoutInstructions(detail2, attempt.res.status)) {
            withInstructions = false;
            attempt = await send({ withInstructions, inputMode });
          } else {
            await fail(detail2);
          }
        }
      }

      if (!attempt.res.body) {
        throw new Error("Responses API returned an empty body");
      }

      if (!attempt.contentType.includes("text/event-stream")) {
        const detail = await safeReadText(attempt.res);
        if (shouldRetryWithOutputText(detail)) {
          inputMode = "all_output_text";
          attempt = await send({ withInstructions, inputMode });
        }
        if (!attempt.res.ok) {
          const detail2 = await safeReadText(attempt.res);
          if (shouldRetryWithoutInstructions(detail2, attempt.res.status)) {
            withInstructions = false;
            attempt = await send({ withInstructions, inputMode });
          } else {
            await fail(detail2);
          }
        }
        if (!attempt.res.body) {
          throw new Error("Responses API returned an empty body");
        }
        if (!attempt.contentType.includes("text/event-stream")) {
          const detail3 = await safeReadText(attempt.res);
          await fail(detail3);
        }
      }

      for await (const data of decodeSseData(attempt.res.body, args.abortSignal)) {
        if (data === "[DONE]") {
          break;
        }
        const json = JSON.parse(data) as unknown;
        const ev = parseResponsesSseEvent(json);
        if (ev) {
          yield ev;
        }
      }
    },
  };
}

function encodeInput(
  items: ModelInputItem[],
  mode: "default" | "all_output_text",
): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = [];
  for (const item of items) {
    if (item.type === "message") {
      const partType =
        mode === "all_output_text"
          ? "output_text"
          : item.role === "assistant"
            ? "output_text"
            : "input_text";
      out.push({
        type: "message",
        role: item.role,
        content: [{ type: partType, text: item.content }],
      });
      continue;
    }
    if (item.type === "function_call") {
      out.push({
        type: "function_call",
        call_id: item.callId,
        name: item.name,
        arguments: item.argumentsText,
      });
      continue;
    }
    out.push({
      type: "function_call_output",
      call_id: item.callId,
      output: item.outputText,
    });
  }
  return out;
}

function encodeTools(tools: ToolSpec[]): ResponsesTool[] {
  return tools.map((t) => {
    return {
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    };
  });
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.trim() !== "" ? t.trim() : "<empty body>";
  } catch {
    return "<failed to read body>";
  }
}

async function* decodeSseData(
  body: ReadableStream<Uint8Array>,
  abortSignal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      if (abortSignal?.aborted) {
        return;
      }
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buf += decoder.decode(value, { stream: true });

      while (true) {
        const split = findSseBlock(buf);
        if (!split) {
          break;
        }
        const [block, rest] = split;
        buf = rest;
        const data = parseSseData(block);
        if (data !== undefined) {
          yield data;
        }
      }
    }

    buf += decoder.decode();
    const tail = parseSseData(buf);
    if (tail !== undefined) {
      yield tail;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseData(block: string): string | undefined {
  const data = block
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice("data:".length).trimStart())
    .join("\n")
    .trim();
  return data !== "" ? data : undefined;
}

function findSseBlock(buf: string): [block: string, rest: string] | undefined {
  const lf = buf.indexOf("\n\n");
  const crlf = buf.indexOf("\r\n\r\n");

  if (lf === -1 && crlf === -1) {
    return;
  }

  if (lf !== -1 && (crlf === -1 || lf < crlf)) {
    const block = buf.slice(0, lf);
    const rest = buf.slice(lf + 2);
    return [block, rest];
  }

  const block = buf.slice(0, crlf);
  const rest = buf.slice(crlf + 4);
  return [block, rest];
}
