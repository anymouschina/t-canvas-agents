import fs from "node:fs/promises";
import path from "node:path";

import { ToolRouter } from "../tools/router.js";
import { createApplyPatchTool } from "../tools/handlers/apply_patch/tool.js";

const tmpDir = path.join(process.cwd(), "ts-perf", "runtime", ".tmp");
await fs.mkdir(tmpDir, { recursive: true });
const target = path.join(tmpDir, "hello.txt");
await fs.writeFile(target, "hello\n", "utf8");

const patch = `*** Begin Patch
*** Update File: ts-perf/runtime/.tmp/hello.txt
@@
-hello
+hello world
*** End Patch`;

const router = new ToolRouter();
router.register(createApplyPatchTool());

const call = router.buildToolCall({
  type: "function_call",
  callId: "patch-1",
  name: "apply_patch",
  argumentsText: JSON.stringify({ input: patch }),
});
if (!call) {
  throw new Error("expected tool call");
}

const out = await router.dispatch(call, {
  cwd: process.cwd(),
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  abortSignal: new AbortController().signal,
  isCancelled: () => false,
  emit: () => {},
  waitForExecApproval: async () => false,
});

console.log(out.outputText);
console.log("file:", await fs.readFile(target, "utf8"));
