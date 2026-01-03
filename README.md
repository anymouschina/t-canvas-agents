# t-canvas-agents

本仓库只保留与「agents」相关的内容：用于运行/调试 agent 的最小 TypeScript runtime，以及配套的知识库文档。

## 可以用它做什么

- 跑一个最小 agent loop：在 REPL 里对话、规划（plan）、调用工具（exec/apply_patch 等）
- 调试工具与沙箱：复现/验证 approvals、sandboxMode（只读/工作区可写等）对文件与命令执行的约束
- Web 可视化调试：用浏览器实时查看 event 流（tool call、stdout/stderr、approval request 等）
- 对接 OpenAI 兼容接口：把任意 OpenAI-compatible `Responses API` 接进来跑 demo/REPL
- 做实现/实验基座：快速加一个新 tool、新 demo task，然后用现有 UI/日志回放验证

## 目录结构

- `runtime/`：最小 “类 Codex” runtime（REPL、tool routing、sandbox、web 可视化等）
- `helloagents/`：知识库（SSOT：架构/API/数据/历史记录等）

## 快速开始（runtime）

```bash
cd runtime
pnpm install
pnpm test
pnpm dev:repl
```

常用 demos：

```bash
cd runtime
pnpm dev:approval   # approvals + sandbox 演示
pnpm dev:shell      # shell tool 演示
pnpm dev:patch      # apply_patch 演示
pnpm dev:stream     # streaming 演示
pnpm dev:web        # Web UI 调试页
```

## OpenAI 兼容接口（可选）

在 `runtime/.env` 配置（参考 `runtime/.env.example`）：

- `OPENAI_API_KEY=...`
- `OPENAI_BASE_URL=https://api.openai.com/v1`
- `OPENAI_MODEL=gpt-5.2`

然后运行：

```bash
cd runtime
pnpm dev:openai
```
