import type { ToolHandler } from "../types.js";

type WebSearchParams = {
  query: string;
  numResults?: number;
};

type ExaSearchResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    text?: string;
  }>;
};

export function createWebSearchTool(args?: {
  fetchImpl?: typeof fetch;
  apiKeyEnvVar?: string;
  timeoutMs?: number;
}): ToolHandler {
  const fetchImpl = args?.fetchImpl ?? fetch;
  const apiKeyEnvVar = args?.apiKeyEnvVar ?? "EXA_API_KEY";
  const timeoutMs = args?.timeoutMs ?? 20_000;

  return {
    spec: {
      name: "web_search",
      description:
        "Search the web via a configured provider (default: Exa). Returns a short list of results.",
      supportsParallelToolCalls: true,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          numResults: { type: "number", description: "Max results (default 5)." },
        },
      },
    },
    async handle(call, ctx) {
      void ctx;

      if (call.kind !== "function_call") {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: "web_search expects function_call",
        };
      }

      const parsed = JSON.parse(call.argumentsText) as WebSearchParams;
      const apiKey = process.env[apiKeyEnvVar] ?? "";
      if (apiKey.trim() === "") {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: `Missing ${apiKeyEnvVar}. Set it in env vars (not committed).`,
        };
      }

      const numResults = Math.max(1, Math.min(10, parsed.numResults ?? 5));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetchImpl("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query: parsed.query,
            numResults,
            text: true,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const detail = await safeReadText(res);
          return {
            callId: call.callId,
            toolName: call.toolName,
            ok: false,
            outputText: `web_search provider error (${res.status}): ${detail}`,
          };
        }

        const json = (await res.json()) as ExaSearchResponse;
        const results =
          json.results?.map((r) => {
            const snippet = (r.text ?? "").slice(0, 400);
            return { title: r.title ?? "", url: r.url ?? "", snippet };
          }) ?? [];

        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: true,
          outputText: JSON.stringify({ query: parsed.query, results }, null, 2),
        };
      } catch (err) {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          outputText: err instanceof Error ? err.message : String(err),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.trim() !== "" ? t.trim() : "<empty body>";
  } catch {
    return "<failed to read body>";
  }
}

