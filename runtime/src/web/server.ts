import fs from "node:fs/promises";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

import type { CodexMiniRuntime } from "../agent/runtime.js";
import type { Event } from "../protocol/event.js";
import type { Op } from "../protocol/op.js";
import type { UserInput } from "../protocol/items.js";
import { renderUiHtml } from "./ui.js";

type StreamMeta = {
  kind: "meta";
  server: {
    pid: number;
    node: string;
    platform: string;
    arch: string;
    hostname: string;
    startedAt: string;
  };
  runtime: ReturnType<CodexMiniRuntime["getMeta"]>;
};

type StreamState = {
  kind: "state";
  state: ReturnType<CodexMiniRuntime["getState"]>;
};

export type StreamEvent = {
  kind: "event";
  seq: number;
  ts: number;
  sinceStartMs: number;
  event: Event;
};

type StreamMsg = StreamMeta | StreamState | StreamEvent;

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sseWrite(res: ServerResponse, eventName: StreamMsg["kind"], data: StreamMsg): void {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function contentTypeForPath(filePath: string): string {
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export function startRuntimeWebVisualizer(args: {
  runtime: CodexMiniRuntime;
  host?: string;
  port?: number;
  historyLimit?: number;
  resetSession?: (sessionId: string) => void;
}): {
  url: string;
  close: () => Promise<void>;
} {
  const host = args.host ?? "127.0.0.1";
  const port = args.port ?? 8787;
  const historyLimit = args.historyLimit ?? 5000;

  const runtimeMeta: StreamMeta = {
    kind: "meta",
    server: {
      pid: process.pid,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      startedAt: new Date().toISOString(),
    },
    runtime: args.runtime.getMeta(),
  };

  const startTs = Date.now();
  let seq = 0;
  const history: StreamEvent[] = [];
  const sseClients = new Set<ServerResponse>();

  const broadcast = (msg: StreamMsg): void => {
    for (const res of sseClients) {
      sseWrite(res, msg.kind, msg);
    }
  };

  const pump = async (): Promise<void> => {
    broadcast(runtimeMeta);
    broadcast({ kind: "state", state: args.runtime.getState() });
    while (true) {
      const ev = await args.runtime.nextEvent();
      const state = args.runtime.getState();
      broadcast({ kind: "state", state });
      if (!ev) {
        break;
      }
      const now = Date.now();
      const streamEv: StreamEvent = {
        kind: "event",
        seq: seq++,
        ts: now,
        sinceStartMs: now - startTs,
        event: ev,
      };
      history.push(streamEv);
      if (history.length > historyLimit) {
        history.splice(0, history.length - historyLimit);
      }
      broadcast(streamEv);
    }
  };
  void pump();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);

      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/vendor/vibe-kanban-web-companion/")) {
        const prefix = "/vendor/vibe-kanban-web-companion/";
        const relPath = decodeURIComponent(url.pathname.slice(prefix.length));
        if (relPath.length === 0 || relPath.includes("..")) {
          writeJson(res, 400, { error: "invalid path" });
          return;
        }

        const absPath = path.join(process.cwd(), "node_modules", "vibe-kanban-web-companion", relPath);
        let contents: Buffer;
        try {
          contents = await fs.readFile(absPath);
        } catch (err) {
          if (err instanceof Error && "code" in err && err.code === "ENOENT") {
            writeJson(res, 404, { error: "not found", path: url.pathname });
            return;
          }
          throw err;
        }
        res.statusCode = 200;
        res.setHeader("content-type", contentTypeForPath(absPath));
        res.setHeader("cache-control", "no-cache");
        res.end(contents);
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(renderUiHtml());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/snapshot") {
        writeJson(res, 200, {
          meta: {
            runtime: runtimeMeta.runtime,
            server: runtimeMeta.server,
            state: args.runtime.getState(),
          },
          history,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream; charset=utf-8");
        res.setHeader("cache-control", "no-cache, no-transform");
        res.setHeader("connection", "keep-alive");
        res.setHeader("x-accel-buffering", "no");

        sseClients.add(res);
        sseWrite(res, "meta", runtimeMeta);
        sseWrite(res, "state", { kind: "state", state: args.runtime.getState() });
        for (const e of history) {
          sseWrite(res, "event", e);
        }

        const ping = setInterval(() => {
          res.write(": ping\n\n");
        }, 15000);

        req.on("close", () => {
          clearInterval(ping);
          sseClients.delete(res);
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/op") {
        const body = await readJson(req);
        if (!isRecord(body) || !isRecord(body.op)) {
          writeJson(res, 400, { error: "expected { op: Op }" });
          return;
        }
        const op = body.op as Op;
        const id = args.runtime.submit(op);
        writeJson(res, 200, { ok: true, id });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/op/user-input") {
        const body = await readJson(req);
        if (!isRecord(body)) {
          writeJson(res, 400, { error: "expected JSON object" });
          return;
        }

        let items: UserInput[] | undefined;
        if (Array.isArray(body.items)) {
          items = body.items as UserInput[];
        } else if (typeof body.text === "string") {
          items = [{ type: "text", text: body.text }];
        }

        if (!items || items.length === 0) {
          writeJson(res, 400, { error: "expected { text: string } or { items: UserInput[] }" });
          return;
        }

        const sessionId =
          typeof body.sessionId === "string" && body.sessionId.trim() !== "" ? body.sessionId : undefined;
        const id = args.runtime.submit({ type: "user_input", items, sessionId });
        writeJson(res, 200, { ok: true, id });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/op/interrupt") {
        const id = args.runtime.submit({ type: "interrupt" });
        writeJson(res, 200, { ok: true, id });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/op/shutdown") {
        const id = args.runtime.submit({ type: "shutdown" });
        writeJson(res, 200, { ok: true, id });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/op/exec-approval") {
        const body = await readJson(req);
        if (!isRecord(body) || typeof body.requestId !== "string" || typeof body.decision !== "string") {
          writeJson(res, 400, { error: "expected { requestId: string, decision: 'approve' | 'deny' }" });
          return;
        }
        const decision = body.decision === "approve" ? "approve" : "deny";
        const id = args.runtime.submit({ type: "exec_approval", id: body.requestId, decision });
        writeJson(res, 200, { ok: true, id });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/session/reset") {
        const body = await readJson(req);
        if (!isRecord(body) || typeof body.sessionId !== "string" || body.sessionId.trim() === "") {
          writeJson(res, 400, { error: "expected { sessionId: string }" });
          return;
        }
        args.resetSession?.(body.sessionId);
        writeJson(res, 200, { ok: true });
        return;
      }

      writeJson(res, 404, { error: "not found", path: url.pathname });
    } catch (err) {
      writeJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.listen(port, host);
  return {
    url: `http://${host}:${port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const res of sseClients) {
          try {
            res.end();
          } catch {
            // ignore
          }
        }
        sseClients.clear();
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      }),
  };
}
