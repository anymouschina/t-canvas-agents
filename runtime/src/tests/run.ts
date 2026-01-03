import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { testAdd } from "./add.test.js";
import { ToolRouter } from "../tools/router.js";
import { createApplyPatchTool } from "../tools/handlers/apply_patch/tool.js";
import { runCodexLikeTask } from "../agent/turn_runner.js";
import { createTwoStageScriptedModel } from "../model/scripted_model.js";
import {
  evAssistantMessage,
  evCompleted,
  evFunctionCall,
  evResponseCreated,
  evOutputTextDelta,
} from "../model/sse.js";
import { createOpenAIResponsesModel } from "../model/openai_responses_model.js";
import {
  createAppendFileTool,
  createListDirTool,
  createReadFileTool,
  createWriteFileTool,
} from "../tools/handlers/fs_tools.js";
import { createWebSearchTool } from "../tools/handlers/web_search.js";
import { createUpdatePlanTool } from "../tools/handlers/update_plan.js";
import { ConversationHistory } from "../history/conversation.js";

async function testApplyPatchUpdate(): Promise<void> {
  const tmpDir = path.join(process.cwd(), "ts-perf", "runtime", ".tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const target = path.join(tmpDir, "t.txt");
  await fs.writeFile(target, "a\nb\n", "utf8");

  const patch = `*** Begin Patch
*** Update File: ts-perf/runtime/.tmp/t.txt
@@
 a
-b
+c
*** End Patch`;

  const router = new ToolRouter();
  router.register(createApplyPatchTool());

  const call = router.buildToolCall({
    type: "function_call",
    callId: "t1",
    name: "apply_patch",
    argumentsText: JSON.stringify({ input: patch }),
  });
  assert.ok(call);

  const out = await router.dispatch(call, {
    cwd: process.cwd(),
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    abortSignal: new AbortController().signal,
    isCancelled: () => false,
    emit: () => {},
    waitForExecApproval: async () => false,
  });
  assert.equal(out.ok, true);
  const text = await fs.readFile(target, "utf8");
  assert.equal(text, "a\nc\n");
}

async function testMultiToolCallsInOneTurn(): Promise<void> {
  const router = new ToolRouter();
  router.register({
    spec: {
      name: "t1",
      description: "test tool 1",
      parameters: { type: "object", properties: {} },
      supportsParallelToolCalls: true,
    },
    async handle(call) {
      return { callId: call.callId, toolName: call.toolName, ok: true, outputText: "ok1" };
    },
  });
  router.register({
    spec: {
      name: "t2",
      description: "test tool 2",
      parameters: { type: "object", properties: {} },
      supportsParallelToolCalls: true,
    },
    async handle(call) {
      return { callId: call.callId, toolName: call.toolName, ok: true, outputText: "ok2" };
    },
  });

  const model = createTwoStageScriptedModel({
    first: [
      evResponseCreated("r1"),
      evFunctionCall("c1", "t1", "{}"),
      evFunctionCall("c2", "t2", "{}"),
      evCompleted("r1"),
    ],
    second: [evResponseCreated("r2"), evAssistantMessage("m1", "done"), evCompleted("r2")],
  });

  const events: string[] = [];
  const ctx = {
    cwd: process.cwd(),
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    parallelToolCalls: true,
    emit: () => {},
    waitForExecApproval: async () => false,
    takePendingUserInputs: () => [],
    isCancelled: () => false,
    abortSignal: new AbortController().signal,
  };

  for await (const msg of runCodexLikeTask({
    userTurnId: "t",
    userText: "hi",
    ctx,
    model,
    router,
    options: { maxTurns: 4 },
  })) {
    events.push(msg.type);
  }

  assert.ok(events.includes("tool_call_begin"));
  assert.ok(events.includes("tool_call_end"));
  assert.ok(events.includes("task_complete"));
}

async function testStreamingDeltaIsForwarded(): Promise<void> {
  const router = new ToolRouter();
  router.register({
    spec: {
      name: "noop",
      description: "noop",
      parameters: { type: "object", properties: {} },
      supportsParallelToolCalls: true,
    },
    async handle(call) {
      return { callId: call.callId, toolName: call.toolName, ok: true, outputText: "ok" };
    },
  });

  const model = createTwoStageScriptedModel({
    first: [
      evResponseCreated("r1"),
      evOutputTextDelta("hello "),
      evOutputTextDelta("world"),
      evAssistantMessage("m1", "ignored due to delta"),
      evCompleted("r1"),
    ],
    second: [evResponseCreated("r2"), evCompleted("r2")],
  });

  const deltas: string[] = [];
  const ctx = {
    cwd: process.cwd(),
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    parallelToolCalls: false,
    emit: () => {},
    waitForExecApproval: async () => false,
    takePendingUserInputs: () => [],
    isCancelled: () => false,
    abortSignal: new AbortController().signal,
  };

  for await (const msg of runCodexLikeTask({
    userTurnId: "t",
    userText: "hi",
    ctx,
    model,
    router,
    options: { maxTurns: 2 },
  })) {
    if (msg.type === "agent_message_delta") {
      deltas.push(msg.delta);
    }
  }
  assert.equal(deltas.join(""), "hello world");
}

async function testSkillsAreLoadedIntoInstructions(): Promise<void> {
  const tmpDir = path.join(process.cwd(), "ts-perf", "runtime", ".tmp", "skilltest");
  await fs.mkdir(tmpDir, { recursive: true });
  const skillPath = path.join(tmpDir, "SKILL.md");
  await fs.writeFile(
    skillPath,
    `---
name: demo
description: demo skill for tests
---

SKILL_BODY
`,
    "utf8",
  );

  let sawInstructions = "";
  const model = {
    async *runTurn(turnArgs: any): AsyncGenerator<any> {
      sawInstructions = String(turnArgs.instructions ?? "");
      yield evResponseCreated("r1");
      yield evAssistantMessage("m1", "FINAL: ok");
      yield evCompleted("r1");
    },
  };

  const router = new ToolRouter();
  const ctx = {
    cwd: process.cwd(),
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    parallelToolCalls: false,
    emit: () => {},
    waitForExecApproval: async () => false,
    takePendingUserInputs: () => [],
    isCancelled: () => false,
    abortSignal: new AbortController().signal,
  };

  for await (const _msg of runCodexLikeTask({
    userTurnId: "t",
    userText: "hi",
    initialUserInputs: [{ type: "skill", name: "demo", path: skillPath }],
    ctx,
    model,
    router,
    options: { maxTurns: 2, finalAnswerTag: "FINAL:" },
  })) {
    // drain
  }

  assert.ok(sawInstructions.includes("Skills (loaded for this user turn):"));
  assert.ok(sawInstructions.includes("name: demo"));
  assert.ok(sawInstructions.includes("SKILL_BODY"));
}

async function testUpdatePlanToolEmitsPlanUpdatedEvent(): Promise<void> {
  const router = new ToolRouter();
  router.register(createUpdatePlanTool());

  const model = createTwoStageScriptedModel({
    first: [
      evResponseCreated("r1"),
      evFunctionCall(
        "c1",
        "update_plan",
        JSON.stringify({
          explanation: "test plan",
          plan: [
            { step: "one", status: "in_progress" },
            { step: "two", status: "pending" },
          ],
        }),
      ),
      evCompleted("r1"),
    ],
    second: [evResponseCreated("r2"), evAssistantMessage("m1", "FINAL: ok"), evCompleted("r2")],
  });

  const emitted: any[] = [];
  const ctx = {
    cwd: process.cwd(),
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    parallelToolCalls: false,
    emit: (msg: any) => emitted.push(msg),
    waitForExecApproval: async () => false,
    takePendingUserInputs: () => [],
    isCancelled: () => false,
    abortSignal: new AbortController().signal,
  };

  for await (const _msg of runCodexLikeTask({
    userTurnId: "t",
    userText: "hi",
    ctx,
    model,
    router,
    options: { maxTurns: 3, finalAnswerTag: "FINAL:" },
  })) {
    // drain
  }

  const planEvent = emitted.find((m) => m?.type === "plan_updated");
  assert.ok(planEvent);
  assert.equal(planEvent.explanation, "test plan");
  assert.deepEqual(planEvent.plan, [
    { step: "one", status: "in_progress" },
    { step: "two", status: "pending" },
  ]);
}

async function testSessionHistoryCanBeReusedAcrossTurns(): Promise<void> {
  const router = new ToolRouter();
  const history = new ConversationHistory();

  let calls = 0;
  const model = {
    async *runTurn(turnArgs: any): AsyncGenerator<any> {
      calls += 1;
      const inputs = (turnArgs.input ?? []) as any[];
      const userMessages = inputs
        .filter((it) => it.type === "message" && it.role === "user")
        .map((it) => String(it.content));
      if (calls === 1) {
        assert.deepEqual(userMessages, ["turn1"]);
      } else {
        assert.deepEqual(userMessages, ["turn1", "turn2"]);
      }
      yield evResponseCreated(`r${calls}`);
      yield evAssistantMessage(`m${calls}`, "FINAL: ok");
      yield evCompleted(`r${calls}`);
    },
  };

  const ctx = {
    cwd: process.cwd(),
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    parallelToolCalls: false,
    emit: () => {},
    waitForExecApproval: async () => false,
    takePendingUserInputs: () => [],
    isCancelled: () => false,
    abortSignal: new AbortController().signal,
  };

  for await (const _msg of runCodexLikeTask({
    userTurnId: "t1",
    userText: "turn1",
    ctx,
    model,
    router,
    history,
    options: { maxTurns: 2, finalAnswerTag: "FINAL:" },
  })) {
    // drain
  }

  for await (const _msg of runCodexLikeTask({
    userTurnId: "t2",
    userText: "turn2",
    ctx,
    model,
    router,
    history,
    options: { maxTurns: 2, finalAnswerTag: "FINAL:" },
  })) {
    // drain
  }

  assert.equal(calls, 2);
}

async function testFinalAnswerTagControlsCompletion(): Promise<void> {
  const router = new ToolRouter();
  router.register({
    spec: {
      name: "noop",
      description: "noop",
      parameters: { type: "object", properties: {} },
      supportsParallelToolCalls: true,
    },
    async handle(call) {
      return { callId: call.callId, toolName: call.toolName, ok: true, outputText: "ok" };
    },
  });

  let runTurns = 0;
  const model = {
    async *runTurn(): AsyncGenerator<any> {
      runTurns += 1;
      if (runTurns === 1) {
        yield evResponseCreated("r1");
        yield evAssistantMessage("m1", "working but not final");
        yield evCompleted("r1");
        return;
      }
      yield evResponseCreated("r2");
      yield evAssistantMessage("m2", "FINAL: done");
      yield evCompleted("r2");
    },
  };

  const ctx = {
    cwd: process.cwd(),
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    parallelToolCalls: false,
    emit: () => {},
    waitForExecApproval: async () => false,
    takePendingUserInputs: () => [],
    isCancelled: () => false,
    abortSignal: new AbortController().signal,
  };

  let lastAssistantMessage: string | undefined;
  for await (const msg of runCodexLikeTask({
    userTurnId: "t",
    userText: "hi",
    ctx,
    model,
    router,
    options: { maxTurns: 4, finalAnswerTag: "FINAL:" },
  })) {
    if (msg.type === "task_complete") {
      lastAssistantMessage = msg.lastAssistantMessage;
    }
  }

  assert.equal(runTurns, 2);
  assert.ok(lastAssistantMessage?.includes("FINAL:"));
}

async function testFinalAnswerTagRetriesOnceThenStops(): Promise<void> {
  const router = new ToolRouter();

  let runTurns = 0;
  const model = {
    async *runTurn(): AsyncGenerator<any> {
      runTurns += 1;
      yield evResponseCreated(`r${runTurns}`);
      yield evAssistantMessage(`m${runTurns}`, "still not final");
      yield evCompleted(`r${runTurns}`);
    },
  };

  const ctx = {
    cwd: process.cwd(),
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    parallelToolCalls: false,
    emit: () => {},
    waitForExecApproval: async () => false,
    takePendingUserInputs: () => [],
    isCancelled: () => false,
    abortSignal: new AbortController().signal,
  };

  for await (const _msg of runCodexLikeTask({
    userTurnId: "t",
    userText: "hi",
    ctx,
    model,
    router,
    options: { maxTurns: 10, finalAnswerTag: "FINAL:" },
  })) {
    // drain
  }

  assert.equal(runTurns, 2);
}

async function testNeedUserInputTagShortCircuitsCompletion(): Promise<void> {
  const router = new ToolRouter();
  let runTurns = 0;
  const model = {
    async *runTurn(): AsyncGenerator<any> {
      runTurns += 1;
      yield evResponseCreated("r1");
      yield evAssistantMessage("m1", "NEED_INPUT: what is the file path?");
      yield evCompleted("r1");
    },
  };

  const ctx = {
    cwd: process.cwd(),
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    parallelToolCalls: false,
    emit: () => {},
    waitForExecApproval: async () => false,
    takePendingUserInputs: () => [],
    isCancelled: () => false,
    abortSignal: new AbortController().signal,
  };

  for await (const _msg of runCodexLikeTask({
    userTurnId: "t",
    userText: "hi",
    ctx,
    model,
    router,
    options: { maxTurns: 4, finalAnswerTag: "FINAL:", needUserInputTag: "NEED_INPUT:" },
  })) {
    // drain
  }

  assert.equal(runTurns, 1);
}

await testApplyPatchUpdate();
await testMultiToolCallsInOneTurn();
await testStreamingDeltaIsForwarded();
await testSkillsAreLoadedIntoInstructions();
await testUpdatePlanToolEmitsPlanUpdatedEvent();
await testSessionHistoryCanBeReusedAcrossTurns();
await testFinalAnswerTagControlsCompletion();
await testFinalAnswerTagRetriesOnceThenStops();
await testNeedUserInputTagShortCircuitsCompletion();
await testOpenAIResponsesModelEncodesAndParses();
await testFileTools();
await testWebSearchToolMissingKey();
await testWebSearchToolHappyPath();
await testAdd();
console.log("ok");

async function testOpenAIResponsesModelEncodesAndParses(): Promise<void> {
  let lastBody = "";
  let sawConversationId = "";
  let sawOriginator = "";
  let callCount = 0;

  const model = createOpenAIResponsesModel({
    apiKey: "k",
    baseUrl: "https://example.test/v1",
    model: "gpt-5.2",
    reasoningEffort: "high",
    store: false,
    include: ["reasoning.encrypted_content"],
    promptCacheKey: "cid-1",
    extraHeaders: { conversation_id: "cid-1", originator: "codex_mini_ts" },
    fetchImpl: async (_url, init) => {
      callCount += 1;
      assert.equal(typeof init?.body, "string");
      lastBody = String(init?.body);
      sawConversationId = String((init?.headers as any)?.conversation_id ?? "");
      sawOriginator = String((init?.headers as any)?.originator ?? "");

      if (callCount === 1 && lastBody.includes('"type":"input_text"')) {
        const err = {
          error: {
            message: "Invalid value: 'input_text'. Supported values are: 'output_text' and 'refusal'.",
            type: "invalid_request_error",
            param: "input[1].content[0]",
            code: "invalid_value",
          },
        };
        return new Response(JSON.stringify(err), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }

      const sse = [
        `data: ${JSON.stringify({ type: "response.created", response: { id: "r1" } })}`,
        "",
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "hi" })}`,
        "",
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "r1" } })}`,
        "",
      ].join("\n");
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });

  const events: string[] = [];
  for await (const ev of model.runTurn({
    input: [
      { type: "message", role: "user", content: "hello" },
      { type: "message", role: "assistant", content: "previous assistant" },
      { type: "function_call", callId: "c1", name: "t1", argumentsText: "{}" },
      { type: "function_call_output", callId: "c1", outputText: "ok" },
    ],
    tools: [
      { name: "t1", description: "d", parameters: { type: "object", properties: {} } },
    ],
    instructions: "test instructions",
    parallelToolCalls: true,
  })) {
    events.push(ev.type);
  }
  assert.deepEqual(events, ["response.created", "response.output_text.delta", "response.completed"]);
  assert.equal(callCount, 2);

  const req = JSON.parse(lastBody) as any;
  assert.equal(req.model, "gpt-5.2");
  assert.equal(req.stream, true);
  assert.equal(req.instructions, "test instructions");
  assert.equal(req.reasoning.effort, "high");
  assert.equal(req.store, false);
  assert.equal(req.include[0], "reasoning.encrypted_content");
  assert.equal(req.prompt_cache_key, "cid-1");
  assert.equal(req.tool_choice, "auto");
  assert.equal(req.parallel_tool_calls, true);
  assert.equal(req.input[0].type, "message");
  assert.equal(req.input[0].role, "user");
  assert.equal(req.input[0].content[0].type, "output_text");
  assert.equal(req.input[0].content[0].text, "hello");
  assert.equal(req.input[1].type, "message");
  assert.equal(req.input[1].role, "assistant");
  assert.equal(req.input[1].content[0].type, "output_text");
  assert.equal(req.input[1].content[0].text, "previous assistant");
  assert.equal(req.input[2].type, "function_call");
  assert.equal(req.input[2].call_id, "c1");
  assert.equal(req.input[3].type, "function_call_output");
  assert.equal(req.input[3].call_id, "c1");
  assert.equal(req.tools[0].type, "function");
  assert.equal(req.tools[0].name, "t1");
  assert.equal(sawConversationId, "cid-1");
  assert.equal(sawOriginator, "codex_mini_ts");
}

async function testFileTools(): Promise<void> {
  const tmpDir = path.join(process.cwd(), "ts-perf", "runtime", ".tmp", "fs-tools");
  await fs.mkdir(tmpDir, { recursive: true });

  const router = new ToolRouter();
  router.register(createReadFileTool());
  router.register(createWriteFileTool());
  router.register(createAppendFileTool());
  router.register(createListDirTool());

  const ctx = {
    cwd: process.cwd(),
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    abortSignal: new AbortController().signal,
    isCancelled: () => false,
    emit: () => {},
    waitForExecApproval: async () => false,
  };

  const writeCall = router.buildToolCall({
    type: "function_call",
    callId: "w1",
    name: "write_file",
    argumentsText: JSON.stringify({
      path: "ts-perf/runtime/.tmp/fs-tools/a.txt",
      content: "hello\n",
      overwrite: true,
    }),
  });
  assert.ok(writeCall);
  const wrote = await router.dispatch(writeCall, ctx);
  assert.equal(wrote.ok, true);

  const appendCall = router.buildToolCall({
    type: "function_call",
    callId: "a1",
    name: "append_file",
    argumentsText: JSON.stringify({
      path: "ts-perf/runtime/.tmp/fs-tools/a.txt",
      content: "world\n",
    }),
  });
  assert.ok(appendCall);
  const appended = await router.dispatch(appendCall, ctx);
  assert.equal(appended.ok, true);

  const readCall = router.buildToolCall({
    type: "function_call",
    callId: "r1",
    name: "read_file",
    argumentsText: JSON.stringify({ path: "ts-perf/runtime/.tmp/fs-tools/a.txt" }),
  });
  assert.ok(readCall);
  const read = await router.dispatch(readCall, ctx);
  assert.equal(read.ok, true);
  const json = JSON.parse(read.outputText) as any;
  assert.equal(json.content, "hello\nworld\n");

  const listCall = router.buildToolCall({
    type: "function_call",
    callId: "l1",
    name: "list_dir",
    argumentsText: JSON.stringify({
      path: "ts-perf/runtime/.tmp/fs-tools",
      recursive: true,
      maxEntries: 50,
    }),
  });
  assert.ok(listCall);
  const listed = await router.dispatch(listCall, ctx);
  assert.equal(listed.ok, true);
  const listedJson = JSON.parse(listed.outputText) as any;
  assert.ok(Array.isArray(listedJson.entries));
  assert.ok(listedJson.entries.some((e: string) => e.endsWith("a.txt")));

  await fs.rm(tmpDir, { recursive: true, force: true });
}

async function testWebSearchToolMissingKey(): Promise<void> {
  const router = new ToolRouter();
  router.register(createWebSearchTool({ fetchImpl: async () => new Response("", { status: 500 }) }));

  const call = router.buildToolCall({
    type: "function_call",
    callId: "s1",
    name: "web_search",
    argumentsText: JSON.stringify({ query: "hello", numResults: 3 }),
  });
  assert.ok(call);

  const old = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;

  const out = await router.dispatch(call, {
    cwd: process.cwd(),
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    abortSignal: new AbortController().signal,
    isCancelled: () => false,
    emit: () => {},
    waitForExecApproval: async () => false,
  });
  assert.equal(out.ok, false);

  if (old !== undefined) {
    process.env.EXA_API_KEY = old;
  }
}

async function testWebSearchToolHappyPath(): Promise<void> {
  const old = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "k";

  let sawAuth = "";

  const router = new ToolRouter();
  router.register(
    createWebSearchTool({
      fetchImpl: async (_url, init) => {
        sawAuth = String((init?.headers as any)?.authorization ?? "");
        const body = JSON.stringify({
          results: [{ title: "t", url: "u", text: "snippet" }],
        });
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      },
    }),
  );

  const call = router.buildToolCall({
    type: "function_call",
    callId: "s2",
    name: "web_search",
    argumentsText: JSON.stringify({ query: "hello", numResults: 1 }),
  });
  assert.ok(call);

  const out = await router.dispatch(call, {
    cwd: process.cwd(),
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    abortSignal: new AbortController().signal,
    isCancelled: () => false,
    emit: () => {},
    waitForExecApproval: async () => false,
  });
  assert.equal(out.ok, true);
  assert.equal(sawAuth, "Bearer k");

  const json = JSON.parse(out.outputText) as any;
  assert.equal(json.query, "hello");
  assert.equal(json.results[0].title, "t");

  if (old !== undefined) {
    process.env.EXA_API_KEY = old;
  } else {
    delete process.env.EXA_API_KEY;
  }
}
