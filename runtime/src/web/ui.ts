export function renderUiHtml(): string {
  // Intentionally dependency-free: served as a single HTML page + vanilla JS.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>ts-perf runtime visualizer</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; background: #0b0e14; color: #e6eaf2; }
      header { position: sticky; top: 0; z-index: 10; background: #0b0e14cc; backdrop-filter: blur(10px); border-bottom: 1px solid #1b2231; }
      .bar { display: flex; gap: 12px; align-items: center; padding: 10px 12px; flex-wrap: wrap; }
      .pill { border: 1px solid #24314a; padding: 4px 8px; border-radius: 999px; font-size: 12px; color: #c8d1e6; background: #0f1420; }
      .pill strong { color: #e6eaf2; font-weight: 600; }
      .btn { border: 1px solid #2b3957; background: #121a29; color: #e6eaf2; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-size: 12px; }
      .btn:hover { background: #152033; }
      .btn.danger { border-color: #5a2b2b; background: #1b0f10; }
      .btn.danger:hover { background: #271215; }
      .btn.good { border-color: #2b5a3a; background: #0f1b14; }
      .btn.good:hover { background: #13261b; }
      main { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 12px; padding: 12px; height: calc(100vh - 58px); box-sizing: border-box; }
      .card { background: #0f1420; border: 1px solid #1b2231; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
      .card h2 { margin: 0; font-size: 13px; font-weight: 600; padding: 10px 12px; border-bottom: 1px solid #1b2231; color: #c8d1e6; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .grow { flex: 1; }
      input[type="text"], textarea, select { width: 100%; background: #0b0e14; border: 1px solid #24314a; color: #e6eaf2; border-radius: 10px; padding: 8px 10px; box-sizing: border-box; }
      textarea { min-height: 76px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New"; font-size: 12px; line-height: 1.4; }
      .table { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New"; font-size: 12px; line-height: 1.35; }
      .table .head, .table .item { display: grid; grid-template-columns: 105px 70px 170px 1fr; gap: 10px; padding: 8px 12px; align-items: center; }
      .table .head { position: sticky; top: 0; background: #0f1420; border-bottom: 1px solid #1b2231; z-index: 5; color: #9fb0d1; }
      .table .item { border-bottom: 1px solid #151c2a; cursor: pointer; }
      .table .item:hover { background: #101a2b; }
      .muted { color: #9fb0d1; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New"; }
      .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid #24314a; background: #0b0e14; color: #c8d1e6; display: inline-flex; align-items: center; gap: 6px; }
      .badge.ok { border-color: #2b5a3a; color: #bfead0; }
      .badge.err { border-color: #5a2b2b; color: #f2b2b2; }
      .scroll { overflow: auto; min-height: 0; }
      pre { margin: 0; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }
      .split { display: grid; grid-template-rows: 1fr auto; min-height: 0; }
      .kv { display: grid; grid-template-columns: 140px 1fr; gap: 8px 10px; padding: 10px 12px; }
      .kv div:nth-child(odd) { color: #9fb0d1; }
      .kv div:nth-child(even) { color: #e6eaf2; word-break: break-word; }
      .tiny { font-size: 11px; }
      .warn { color: #ffd38a; }
    </style>
  </head>
  <body>
    <div id="vibeKanbanWebCompanionRoot"></div>
    <header>
      <div class="bar">
        <div class="pill"><strong>Visualizer</strong> <span class="muted">ts-perf/runtime</span></div>
        <div class="pill" id="metaPill"><span class="muted">loading…</span></div>
        <div class="pill" id="statePill"><span class="muted">state…</span></div>
        <div class="pill" id="sessionPill"><strong>session</strong> <span class="muted mono" id="sessionId"></span></div>
        <div class="grow"></div>
        <label class="pill" style="display:flex;align-items:center;gap:8px;">
          <span class="muted">Autoscroll</span>
          <input id="autoscroll" type="checkbox" checked />
        </label>
        <button class="btn" id="btnNewSession">New Session</button>
        <button class="btn" id="btnResetSession">Reset Memory</button>
        <button class="btn danger" id="btnInterrupt">Interrupt</button>
        <button class="btn danger" id="btnShutdown">Shutdown</button>
      </div>
    </header>
    <main>
      <section class="card">
        <h2>
          <span>Events</span>
          <span class="row">
            <input id="search" type="text" placeholder="Search (type, id, JSON substring)…" style="width: 360px;" />
            <select id="typeFilter" style="width: 240px;">
              <option value="">All types</option>
            </select>
            <span class="badge" id="countBadge">0</span>
          </span>
        </h2>
        <div class="table scroll" id="eventsTable">
          <div class="head">
            <div>time</div>
            <div>sub</div>
            <div>type</div>
            <div>summary</div>
          </div>
          <div id="eventsRows"></div>
        </div>
      </section>

      <section class="card split">
        <div class="scroll">
          <h2>
            <span>Inspect</span>
            <span class="row">
              <span class="badge" id="selectedBadge">none</span>
              <span class="badge tiny muted" id="wsBadge">SSE: disconnected</span>
            </span>
          </h2>
          <div class="kv" id="inspectKv"></div>
          <h2><span>JSON</span></h2>
          <pre class="mono" id="inspectJson">{}</pre>

          <h2><span>Assistant Stream</span></h2>
          <pre class="mono" id="assistantOut"></pre>

          <h2><span>Exec Approvals</span></h2>
          <div id="approvals" style="padding: 10px 12px; display:flex; flex-direction:column; gap: 8px;"></div>
        </div>

        <div style="border-top: 1px solid #1b2231; padding: 10px 12px; display:flex; flex-direction:column; gap: 10px;">
          <div class="row">
            <div class="pill"><strong>Send</strong> <span class="muted">user_input</span></div>
            <div class="grow"></div>
            <button class="btn" id="btnSend">Send</button>
          </div>
          <textarea id="userText" placeholder="Type user input here…"></textarea>
          <div class="row tiny muted">
            <span>Tip: tool calls & plan updates appear in Events.</span>
            <span class="grow"></span>
            <span id="err" class="warn"></span>
          </div>
        </div>
      </section>
    </main>

	    <script>
	      // vibe-kanban-web-companion's ESM build assumes process.env.NODE_ENV exists (bundler-style).
	      // The runtime visualizer is a plain HTML page, so we provide a minimal shim.
	      window.process ??= { env: {} };
	      window.process.env ??= {};
	      window.process.env.NODE_ENV = ${JSON.stringify(process.env.NODE_ENV ?? "development")};
	    </script>
    <script type="importmap">
      {
        "imports": {
          "vibe-kanban-web-companion": "/vendor/vibe-kanban-web-companion/src/index.js",
          "react": "https://esm.sh/react@19.2.3",
          "react-dom": "https://esm.sh/react-dom@19.2.3",
          "react-dom/client": "https://esm.sh/react-dom@19.2.3/client",
          "@floating-ui/react-dom-interactions": "https://esm.sh/@floating-ui/react-dom-interactions@0.3.1?external=react,react-dom",
          "htm/react": "https://esm.sh/htm@3.1.0/react?external=react",
          "react-merge-refs": "https://esm.sh/react-merge-refs@1.1.0?external=react"
        }
      }
    </script>
    <script type="module">
      import * as React from "react";
      import { createRoot } from "react-dom/client";
      import { VibeKanbanWebCompanion } from "vibe-kanban-web-companion";

      const mount = document.getElementById("vibeKanbanWebCompanionRoot");
      if (mount) {
        createRoot(mount).render(React.createElement(VibeKanbanWebCompanion));
      }
    </script>

    <script>
      const $ = (id) => document.getElementById(id);
      const events = [];
      const approvals = new Map(); // requestId -> {command, justification}
      const typeSet = new Set();
      let selected = null;
      let assistantText = "";
      let sessionId = "";

      function getOrCreateSessionId() {
        const key = "ts-perf.runtime.sessionId";
        const existing = localStorage.getItem(key);
        if (existing && existing.trim()) return existing;
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
        const id = "sess_" + hex;
        localStorage.setItem(key, id);
        return id;
      }

      function setNewSessionId() {
        const key = "ts-perf.runtime.sessionId";
        localStorage.removeItem(key);
        sessionId = getOrCreateSessionId();
        $("sessionId").textContent = sessionId;
      }

      function fmtTime(ts) {
        const d = new Date(ts);
        return d.toISOString().slice(11, 23);
      }

      function safeStr(x) {
        if (x === null || x === undefined) return "";
        return typeof x === "string" ? x : JSON.stringify(x);
      }

      function summarize(ev) {
        const m = ev.event.msg;
        switch (m.type) {
          case "http_request":
            return \`\${m.method} \${m.url}\`.slice(0, 180);
          case "http_response":
            return \`\${m.status} \${m.contentType || ""} \${m.url}\`.slice(0, 180);
          case "agent_message_delta":
            return m.delta.replace(/\\s+/g, " ").slice(0, 140);
          case "tool_call_begin":
            return \`\${m.toolName} (\${m.kind})\`;
          case "tool_call_end":
            return \`\${m.toolName} ok=\${m.ok}\`;
          case "exec_command_output_delta":
            return \`\${m.stream}: \${m.chunk.replace(/\\s+/g, " ").slice(0, 120)}\`;
          case "exec_approval_request":
            return (m.justification ? \`\${m.command} — \${m.justification}\` : m.command).slice(0, 180);
          case "error":
            return (m.code ? \`\${m.code}: \${m.message}\` : m.message).slice(0, 180);
          case "plan_updated":
            return \`\${m.plan.length} steps\`;
          default:
            return "";
        }
      }

      function renderTypeFilter() {
        const sel = $("typeFilter");
        const existing = new Set(Array.from(sel.options).map(o => o.value));
        const types = Array.from(typeSet).sort();
        for (const t of types) {
          if (existing.has(t)) continue;
          const opt = document.createElement("option");
          opt.value = t;
          opt.textContent = t;
          sel.appendChild(opt);
        }
      }

      function passesFilters(e) {
        const q = $("search").value.trim().toLowerCase();
        const type = $("typeFilter").value;
        if (type && e.event.msg.type !== type) return false;
        if (!q) return true;
        const hay = [
          e.event.id,
          e.event.msg.type,
          JSON.stringify(e.event.msg),
        ].join(" ").toLowerCase();
        return hay.includes(q);
      }

      function renderEvents() {
        const rows = $("eventsRows");
        rows.innerHTML = "";
        let count = 0;
        for (const e of events) {
          if (!passesFilters(e)) continue;
          count++;
          const div = document.createElement("div");
          div.className = "item";
          div.dataset.seq = String(e.seq);
          div.innerHTML = \`
            <div class="muted">\${fmtTime(e.ts)}</div>
            <div class="muted">\${e.event.id}</div>
            <div>\${e.event.msg.type}</div>
            <div class="muted">\${escapeHtml(summarize(e))}</div>
          \`;
          div.addEventListener("click", () => selectEvent(e));
          rows.appendChild(div);
        }
        $("countBadge").textContent = String(count);
      }

      function escapeHtml(s) {
        return String(s).replace(/[&<>\"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;" }[c]));
      }

      function renderApprovals() {
        const root = $("approvals");
        root.innerHTML = "";
        for (const [requestId, req] of approvals.entries()) {
          const wrap = document.createElement("div");
          wrap.style.border = "1px solid #24314a";
          wrap.style.borderRadius = "10px";
          wrap.style.padding = "8px 10px";
          wrap.innerHTML = \`
            <div class="mono tiny muted">requestId: \${escapeHtml(requestId)}</div>
            <div class="mono" style="margin-top:6px;">\${escapeHtml(req.command)}</div>
            \${req.justification ? \`<div class="tiny muted" style="margin-top:6px;">\${escapeHtml(req.justification)}</div>\` : ""}
            <div class="row" style="margin-top:8px;">
              <button class="btn good">Approve</button>
              <button class="btn danger">Deny</button>
            </div>
          \`;
          const [approveBtn, denyBtn] = wrap.querySelectorAll("button");
          approveBtn.addEventListener("click", () => submitJson("/api/op/exec-approval", { requestId, decision: "approve" }));
          denyBtn.addEventListener("click", () => submitJson("/api/op/exec-approval", { requestId, decision: "deny" }));
          root.appendChild(wrap);
        }
        if (approvals.size === 0) {
          const empty = document.createElement("div");
          empty.className = "tiny muted";
          empty.textContent = "No pending approvals.";
          root.appendChild(empty);
        }
      }

      function selectEvent(e) {
        selected = e;
        $("selectedBadge").textContent = \`seq=\${e.seq}\`;
        $("inspectJson").textContent = JSON.stringify(e, null, 2);
        const m = e.event.msg;
        const kv = [
          ["seq", e.seq],
          ["ts", new Date(e.ts).toISOString()],
          ["sinceStartMs", e.sinceStartMs],
          ["submissionId", e.event.id],
          ["type", m.type],
        ];
        if (m.type === "tool_call_begin" || m.type === "tool_call_end" || m.type === "exec_command_output_delta") {
          kv.push(["callId", m.callId || ""]);
          kv.push(["toolName", m.toolName || ""]);
        }
        if (m.type === "exec_approval_request") {
          kv.push(["requestId", m.requestId]);
        }
        $("inspectKv").innerHTML = kv.map(([k,v]) => \`<div>\${escapeHtml(k)}</div><div class="mono">\${escapeHtml(String(v))}</div>\`).join("");
      }

      async function submitJson(path, body) {
        $("err").textContent = "";
        try {
          const res = await fetch(path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body ?? {}),
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(\`\${res.status} \${res.statusText}: \${text}\`);
          }
          return await res.json().catch(() => ({}));
        } catch (e) {
          $("err").textContent = String(e && e.message ? e.message : e);
          throw e;
        }
      }

      $("btnSend").addEventListener("click", async () => {
        const text = $("userText").value;
        if (!text.trim()) return;
        $("userText").value = "";
        await submitJson("/api/op/user-input", { text, sessionId });
      });
      $("btnInterrupt").addEventListener("click", async () => submitJson("/api/op/interrupt"));
      $("btnShutdown").addEventListener("click", async () => submitJson("/api/op/shutdown"));
      $("btnNewSession").addEventListener("click", async () => {
        setNewSessionId();
      });
      $("btnResetSession").addEventListener("click", async () => {
        await submitJson("/api/session/reset", { sessionId });
      });
      $("search").addEventListener("input", () => renderEvents());
      $("typeFilter").addEventListener("change", () => renderEvents());

      function handleStreamMessage(payload) {
        if (payload.kind === "meta") {
          const m = payload.runtime;
          $("metaPill").innerHTML = \`<strong>cwd</strong> <span class="muted">\${escapeHtml(m.cwd)}</span>\`;
          return;
        }
        if (payload.kind === "state") {
          const s = payload.state;
          const parts = [];
          parts.push(\`shutdown=\${s.isShutdown}\`);
          parts.push(\`active=\${s.activeTaskId ?? "-"}\`);
          parts.push(\`subQ=\${s.submissionsQueued}\`);
          parts.push(\`evQ=\${s.eventsQueued}\`);
          parts.push(\`pendingInputs=\${s.activeTaskPendingUserInputs}\`);
          $("statePill").innerHTML = \`<strong>state</strong> <span class="muted">\${escapeHtml(parts.join(" · "))}</span>\`;
          return;
        }
        if (payload.kind !== "event") return;

        const e = payload;
        events.push(e);
        typeSet.add(e.event.msg.type);
        renderTypeFilter();

        if (e.event.msg.type === "agent_message_delta") {
          assistantText += e.event.msg.delta;
          $("assistantOut").textContent = assistantText;
          if ($("autoscroll").checked) {
            $("assistantOut").scrollTop = $("assistantOut").scrollHeight;
          }
        }
        if (e.event.msg.type === "exec_approval_request") {
          approvals.set(e.event.msg.requestId, {
            command: e.event.msg.command,
            justification: e.event.msg.justification || "",
          });
          renderApprovals();
        }
        if (e.event.msg.type === "task_started") {
          assistantText = "";
          $("assistantOut").textContent = "";
        }
        if ($("autoscroll").checked) {
          renderEvents();
          const table = $("eventsTable");
          table.scrollTop = table.scrollHeight;
        } else {
          renderEvents();
        }
      }

      async function boot() {
        sessionId = getOrCreateSessionId();
        $("sessionId").textContent = sessionId;

        const snap = await fetch("/api/snapshot").then(r => r.json());
        handleStreamMessage({ kind: "meta", runtime: snap.meta.runtime });
        handleStreamMessage({ kind: "state", state: snap.meta.state });
        for (const e of snap.history) handleStreamMessage(e);
        renderApprovals();

        const es = new EventSource("/events");
        es.addEventListener("open", () => { $("wsBadge").textContent = "SSE: connected"; });
        es.addEventListener("error", () => { $("wsBadge").textContent = "SSE: error"; });
        es.addEventListener("meta", (ev) => handleStreamMessage(JSON.parse(ev.data)));
        es.addEventListener("state", (ev) => handleStreamMessage(JSON.parse(ev.data)));
        es.addEventListener("event", (ev) => handleStreamMessage(JSON.parse(ev.data)));
      }

      boot().catch((e) => { $("err").textContent = String(e && e.message ? e.message : e); });
    </script>
  </body>
</html>`;
}
