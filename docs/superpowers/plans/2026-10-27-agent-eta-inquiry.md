# Agent ETA Inquiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox syntax.

**Goal:** 在后台向原任务 agent 询问剩余时长，更新现有悬浮框。

**Architecture:** SQLite 中保存单个当前请求，十秒 tick 调度；四工具 MCP 取件/答复与 Codex / Claude 异步 Hook 共用请求。任务级活跃时钟驱动区间，原有任务身份与回执防止串任务。

**Tech Stack:** 现有 TypeScript / Electron / SQLite / Zod / MCP SDK / Node CJS Hook，无新增依赖。

**Spec:** [设计](../specs/2026-10-27-agent-eta-inquiry-design.md)

## Global Constraints

- 保持 v4 长测与 release/memory-candidate-v4 不变，新目录包独立验收。
- 120 秒请求有效期和刷新下限，超时退避上限 600 秒；只在 active reporter 任务询问。
- 不追加聊天消息、不唤醒/打断任务、不启动额外模型、不猜任务身份。
- Hook 350ms 网络 / 700ms 进程截止，单行 additionalContext，默认旧模式 stdout 为空。

## Review Focus

- 同宿主多个任务与子 agent，不能把问题投给别的任务。
- 估时往返不能让无工作活动的任务看起来仍在工作。
- 计划变化/重启/暂停后的旧答复不能恢复过期倒计时。
- 用户已有 Hook 与后来修改配置，接入和撤销必须保留。
- 真实模型登录或权限不可用，必须区分集成闭环与真实宿主响应。

### Task 1: 请求、任务估时与持久化

Files: shared contracts/schemas、domain clock/eta/reducer、新 domain/eta-inquiry.ts、storage repository/migrations；tests/domain/eta-inquiry.test.ts、tests/storage/eta-inquiry.test.ts。

Interfaces: ContextResult.etaQuestion；ReporterChange eta.answered；Store.takeEtaQuestion(source,turnId)；snapshot.etaInquiry 仅公开状态。

- [x] RED：请求生成、答复区间、隔离、超时/旧版本/暂停、工作 freshness 测试。
- [x] GREEN：实现单请求调度、活跃时间与答复验证，数据库版本升级。
- [x] 运行相关 domain/storage/schema 测试并提交。

### Task 2: MCP、Hook 与可撤销接入

Files: bridge/mcp、ingestion/hook、integrations/hooks/common.cjs、integration/config-patch、desktop/main、shared/ui-contract、renderer/settings、integrations/skill/SKILL.md；新增 Hook/配置/MCP 闭环测试。

Interfaces: 任务句柄取件与 eta.answered；已明确 source_links 的 PostToolUse 获取一次问题；codex-hooks/claude-hooks 配置拥有项与原回执共用撤销。

- [x] RED：两工具 Hook 子进程真实 HTTP 闭环、任务身份防串、输出过滤、超时、配置保留/撤销。
- [x] GREEN：复用同一 Hook 进程/HTTP 响应，写上下文；MCP 与 Skill 自动处理问题；设置预览合并。
- [x] 运行 integration/ingestion/bridge 测试并提交。

### Task 3: 悬浮反馈与独立构建验收

Files: renderer/widget/app、UI tests、docs/integrations、verification/agent-eta-inquiry.md；诊断 release/eta-candidate-v5、审阅修复后最终 release/eta-candidate-v6。

Interfaces: etaInquiry 状态与 agent basis；现有紧凑/展开视图复用。

- [x] RED/GREEN：等待/未知/答复/暂停/超时文字与渲染测试。
- [x] 运行 typecheck、lint、全套适用回归与 docs/origins 检查。
- [x] 新目录包真实 MCP + Hook + UI 闭环；有条件运行真实宿主询问，记录失败边界。
- [x] 一次全变更新鲜上下文审查，修复重要 findings 并回归；更新验收记录、提交。
