# ts-perf：从零到一实现一个“类 Codex”运行时（文档先行）

这个目录是一个学习型工程：我们先写一套文档站点（“书”），再按章节逐步把代码补齐。目标是当你把整本书写完/跑通后，也就实现了一个可工作的最小 Codex（不使用 langgraph 等编排库）。

约束：

- 不使用 langgraph / langchain 之类的 agent 编排库
- 代码实现与文档章节一一对应
- 单篇文章引用的代码片段尽量控制在 1000 行以内（因此实现会拆小模块）

## 目录结构

- `book/`：VitePress 文档站点（书的内容）
- `runtime/`：TypeScript 实现的 “codex-mini” 运行时（后续逐章补齐）
- `guide-book/`：VitePress 使用手册站点（面向使用者）

## 本地运行文档站点（首次）

```bash
cd ts-perf/book
pnpm install
pnpm dev
```

## 本地运行使用手册（首次）

```bash
cd ts-perf/guide-book
pnpm install
pnpm dev
```

## OpenAI 兼容接口（你自己的 Codex 服务）

如果你已经有一个 OpenAI 兼容的 `Responses API` 服务（例如 `https://www.right.codes/codex/v1/responses`），建议把鉴权与 base url 放到 `ts-perf/runtime/.env` 里（该文件默认被 `.gitignore` 忽略）。

参考模板：`ts-perf/runtime/.env.example`

用 `curl` 快速验证服务可用性：见书中章节 `/guide/17-openai-compatible-api`。
