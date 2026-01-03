# runtime（codex-mini）

这里是 `ts-perf` 的 TypeScript 运行时实现：一个可工作的“类 Codex”最小回路（不依赖 langgraph/langchain）。

## 快速开始

```bash
cd ts-perf/runtime
pnpm install
pnpm test
```

## 运行 demos

```bash
pnpm dev:mvp
pnpm dev:codexlike
pnpm dev:stream
pnpm dev:interrupt
pnpm dev:repl
pnpm dev:web
pnpm dev:web:openai
```

## Web 可视化（调试 agent）

启动：

```bash
pnpm dev:web
```

真实 OpenAI Responses API：

```bash
pnpm dev:web:openai
```

然后打开输出的 `http://127.0.0.1:8787/`，页面会：

- 实时展示 Event 流（SSE），包含 tool call、plan、stdout/stderr chunk、approval request 等
- 展示 runtime 状态（active submission、队列长度、pending inputs）
- 支持发送 `user_input`、Interrupt/Shutdown，以及在页面里 Approve/Deny exec approval
- Web 端会在本地（localStorage）生成并保存 `sessionId`；`dev:web:openai` 会按 `sessionId` 维护会话记忆（Reset Memory 可清空该 session 的记忆）

可选环境变量：

- `CODEX_WEB_HOST`（默认 `127.0.0.1`）
- `CODEX_WEB_PORT`（默认 `8787`）
- `CODEX_WEB_AUTOSTART=0`（默认会自动提交一条演示 `user_input`）
- `CODEX_WEB_EVENT_LOG=0`（默认会把所有事件写到 jsonl 日志）
- `CODEX_WEB_EVENT_LOG_PATH=/path/to/events.jsonl`（默认 `ts-perf/runtime/.tmp/web-events.jsonl`；`dev:web:openai` 默认 `ts-perf/runtime/.tmp/web-openai-events.jsonl`）

## Skills（Codex 风格）

REPL 会从本机的 skills 目录发现 `SKILL.md`（YAML front matter 需包含 `name` / `description`）：

- 默认：`$CODEX_HOME/Skills`（未设置则为 `~/.codex/Skills`）
- 可覆盖：`CODEX_SKILLS_DIRS`（用系统路径分隔符分隔：macOS/Linux `:`，Windows `;`）

REPL 命令：

- `/skills`：列出可用 skills
- `/skill <name>`：为下一次输入追加该 skill（一次性）
- `/skill clear`：清空待追加 skills

在普通输入中也可显式引用：`$analyze`（会自动注入该 skill）。

## ~plan（计划模式）

在 REPL 中以 `~plan` 开头输入，会启用“计划模式”提示词：模型会优先调用 `update_plan` 记录计划，并在执行过程中持续更新。

- `~plan <task>`：对该 task 先出计划再执行
- `~plan`：等价于“进入计划模式但未给 task”，模型应以 `NEED_INPUT:` 追问

## 会话记忆（Session Memory）

`pnpm dev:repl` 会在同一次 REPL 进程内保留对话历史，并在后续 turn 继续作为模型输入的一部分（直到退出或重置）。

- `/reset`：清空当前 REPL 会话记忆

关于 `FINAL:`：

- REPL 会提示模型在完成时用 `FINAL:` 作为前缀。
- 如果模型没有遵守，运行时会额外重试一次要求补上；若仍未遵守则直接结束本轮（避免无限循环）。

## 连接真实 OpenAI 兼容 Responses API

在 `ts-perf/runtime/.env` 配置：

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.2
OPENAI_REASONING_EFFORT=high # 可选：minimal/low/medium/high
OPENAI_DISABLE_RESPONSE_STORAGE=true # 可选：映射为请求体 store=false
```

然后运行：

```bash
pnpm dev:openai
```

## 网络搜索（可选）

`web_search` 默认使用 Exa（需要 API Key）：

```bash
EXA_API_KEY=...
```
