# 原任务 agent 后台估时询问

用户在 2026-10-27 确认：按 Codex / Claude 异步 Hook + 通用 MCP 协作取件方案直接实施，后续细节由实现者决定。

## 目标与约束

产品主动生成“本任务预计还需多久”的问题，由正在做该任务的原 agent 回答；答复更新现有紧凑悬浮框。无需聊天正文、独立面板或额外模型。询问不停止工具、不新建会话、不唤醒空闲会话、不使用 turn steer 或 MCP sampling。宿主工具卡和调试审计日志仍由宿主管理，不能承诺完全不可见。

既有 v4 八小时耐久保持运行，包 `release/memory-candidate-v4` 不变。本功能独立构建与验证；v4 长测不能作为新构建验收证据。复用现有 Worker、SQLite、十秒 tick、四个 MCP 工具和 Hook 轻量 HTTP 进程，不引入常驻进程或 SDK。

## 方案比较

1. 选用：任务请求邮箱。Codex / Claude 的异步 PostToolUse Hook 在安全点注入 additionalContext；通用 MCP 在 progress_context 取件。agent 通过现有 progress_report 回答。复用身份、鉴权、去重、事务和失败降级。
2. 不采用独立 LLM / MCP sampling：不是正在执行任务的原 agent，也没有它的完整现场；sampling 已被当前协议标为弃用。
3. 不采用追加用户消息 / steer / 自动唤醒：会干扰主任务和聊天。

## 请求与答复

只对 reporter 整体任务生成请求，原生日志观察任务没有该能力。创建任务立即请求；活跃任务每 120 秒刷新，超时重试退避至 600 秒。只保留一个当前请求，有效期 120 秒；未知答复等 600 秒再询问。暂停、等待、阻塞和终态不生成请求；跨重启、计划 revision 变化、解除关联时取消旧请求。最多保存当前请求和一个最近结果，不积累请求历史。

请求携带随机 requestId、当前 planRevision、有效期；句柄仍只由原 reporter 私有保留。progress_context 返回当前问题；progress_report 新增 eta.answered（requestId、planRevision、range 或 null、reason）。回答只允许当前请求、同任务 generation、同计划版本、未过期；重复 reportId 仍使用原有回执机制。可以明确回答不知道。估时回答不增加进度、不改动作、不刷新 lastWorkAt。

任务级粗估允许没有完整计划；剩余区间按本任务活跃时间递减，等待时冻结。超时、时钟连续性丢失或计划变化后失效。显示来源为 AI 应询粗估，与步骤先验和校准值区分。

## 多工具与身份

MCP：保留四工具。服务 instructions、tool description 和现有报告 Skill 说明在自然边界约 60 秒调用 progress_context，若有问题则仅用 progress_report 回答。无主动后台上下文能力的宿主只承诺协作取件，不能外推为任意客户端自动推送。

Hook：Codex、Claude 共用现有脚本，新增显式 --estimate 开关；只有已明确关联的 provider/session/turn 才取到问题。缺 turn 时仅用已记录的 transcript call 精确解析，未知身份静默忽略，不猜最近任务。子 agent 标识存在时跳过，避免把父任务问题投给子 agent。只发一次同 requestId 的 Hook 上下文；网络丢包由后续请求/通用取件兜底。

Hook 输出单行 JSON，仅含 hookSpecificOutput.hookEventName=PostToolUse 与 additionalContext，无 systemMessage、block、通知或重唤醒。HTTP 350ms / 进程 700ms 硬截止，失败 exit0。异步 Hook 的实际交付时间由宿主安全点决定，长工具期间会等待，空闲会话不自动开新回合。

## 接入体验

现有设置增加后台询问 Hook 的可预览安装。Codex 使用 ~/.codex/hooks.json，Claude 使用 ~/.claude/settings.json；仅合并本工具带唯一标识的异步 PostToolUse handler，保留用户其他 Hook。沿用 hash 检查、备份、回执和撤销；用户改过本工具 handler 时拒绝覆盖撤销。MCP 与 Hook 是独立条目，不自动改变宿主审批策略或全局 Skill。宿主需按自身要求信任/重新连接。

悬浮框尺寸与布局保留：紧凑行显示等待 agent 估时 / AI 粗估范围；悬停依据行说明协作取件或 Hook 已发出，超时为暂未答复。只增加就地文字，无 toast、弹窗或聊天播报。设置关联文案说明关联同时启用向该原 agent 送达估时问题。

## 验证与证据边界

- 真实 Store/MCP：多任务、多 connector 隔离；过期、旧 revision、重启、暂停、终态；重复 ACK；未知答复；活跃倒计时；估时不冒充工作活动。
- 两套 Hook 脚本子进程与真实本地服务闭环：已关联才输出、未知 call/子 agent/递归过滤、超时 fail-open、无聊天消息字段、旧模式 stdout 为空。
- 配置：混合用户 Hook、重复安装、用户后改配置、撤销与卸载；官方 schema 和本机版本区分。
- UI：等待、回答、未知、过期、暂停及深浅色渲染；独立目录包实际 MCP + Hook + 悬浮框闭环。
- 有条件进行真实 Codex / Claude 安全点会话验证。登录、网络或宿主权限失败如实记录，不能拿模拟进程通过替代真实 agent 已回答。

参考：2026-10-27 核对 [Codex Hooks](https://learn.chatgpt.com/docs/hooks)、[Claude Hooks](https://code.claude.com/docs/en/hooks)、[MCP sampling](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling)。本机 CLI 为 Codex 0.154.0、Claude 2.1.278；Claude 输出采用单行 JSON 兼容该版本。
