# codingSchedule：多工具 AI 任务悬浮进度窗开发方案

实施更新（2026-10-26）：阶段三、四主要代码已落地，补充接口、审阅修复和未验收项以[实施报告](../../verification/phase-3-4.md)为准；本方案是要求，不是完成证明。Store已增加原生轮次映射/同事务批次、本地验收/关联、tick/maintenance；FileCursor增加有界fingerprint（SQLite v3），RunSnapshot增加来源完整性/动作来源，内部source.diagnostic不向模型开放。
日期：2026-10-26  
状态：用户已授权实施阶段一至四；阶段二底座完成，阶段三、四主要代码和自动化已实现，真实宿主与原生体验补验未齐。本文描述整体目标，完整V1仍需阶段五验收。实施现状见[阶段报告](../../verification/phase-3-4.md)。
证据：[参考项目源码核查](../../research/2026-10-26-reference-source-review.md)  
实施：[分阶段实施计划](../plans/2026-10-26-coding-schedule.md)

## 1. 目标、边界与验收定义

用户已明确：支持多个 AI 工具、多种采集方式并行、增加 AI 隐式实时汇报；界面只要桌面悬浮框，鼠标放上去才展开当前工作；任务进度和大致剩余时间要可见。

方案默认：Windows 11 x64 首发、简体中文、单用户本地使用、只运行一个悬浮窗；使用中不要求打开浏览器或管理面板。Windows 10、ARM64、macOS、Linux 不在首发验收范围，采集协议保持可移植。首发不控制 AI 执行、不发送任务、不读取屏幕、不上传日志、不做账户/团队/远程云同步。

“实时”分两类：系统检测到事件后及时显示；AI 在自然工具边界主动说明语义。不能保证模型在长工具阻塞或断网时持续发报告。UI 必须显示最后一次实际工作消息的时间，与采集器在线心跳分开。

“隐式”默认指不在聊天正文重复汇报，通过 Hook、MCP 或本地脚本更新悬浮窗。宿主是否展示工具卡片由宿主决定；不承诺隐藏审计记录或免授权。

### 五个实施阶段与交付范围

| 实施阶段 | 内部任务 | 必交付与完成条件 |
| --- | --- | --- |
| 阶段一：技术验证与复用确认 | T01 | 真日志样本、Windows悬浮行为、打包SQLite、helper/MCP连通性与复用边界；通过形成M0里程碑 |
| 阶段二：任务协议与数据底座 | T02 → T03 | 统一协议、任务身份/状态机、计划进度、事务存储与幂等恢复；同目录任务不串写 |
| 阶段三：多工具采集与悬浮窗 | T04 → T05 → T06 → T08 | Codex/Claude日志+Hook接通基础采集到窗口链路；单悬浮框、hover、多任务、动作/计划/过期提示；通过形成M1里程碑 |
| 阶段四：AI后台汇报与估时 | T07 → T09 → T10 → T11 | MCP/CLI/Skill主动报告、来源关联、串行区间ETA、接入配置和完整健康/恢复；形成首发功能候选版 |
| 阶段五：打包、真实验收与交付 | T12 → T13 → T14 | Windows分发、真实会话/性能/安装卸载验收、文档与许可；通过形成V1里程碑 |

M0、M1、V1仅是交付里程碑，不是额外实施阶段。没有依据时ETA显示未知。原生Cursor/OpenCode/Kiro适配、WSL/SSH/云任务桥接、复杂DAG估时及获授权连接的Codex App Server作为后续版本候选，不计入本次五阶段，也不宣称当前已支持。

“多工具支持”首发验收至少 Codex、Claude Code 两个真实宿主；第三个工具（优先 Cursor）的通用 MCP 接入必须实测并记录确切版本。未拿到第三工具环境时可以交付两工具版，但不能声称第三工具兼容已验收。

## 2. 方案比较与复用决策
| 路线 | 收益 | 代价/限制 | 结论 |
| --- | --- | --- | --- |
| 在完整 CCAM 上加窗口 | 现成多来源采集与后端 | 带入不需要的 Web 管理功能及依赖，任务语义仍须改造 | 备选，不作为基线 |
| 薄 Electron 应用 + 精选 MIT 解析模块 | JS/TS 代码与测试可复用，多来源同一运行时，界面可保持极小 | Electron 常驻资源成本；必须实测 | 推荐 |
| WPF / Tauri 原生壳 | 有机会降低体积/常驻成本 | 重写/桥接更多解析和 MCP 代码，增加首版风险 | 若 M0 资源/原生行为门槛失败，再比较，不并行维护两套壳 |

直接移植：CCAM 的计划调用定位、消息解析、相关增量读取用例，保留许可。借鉴并重写：Herdr 任务绑定/CAS、task-progress-reporter 叶子计分、how-long 估时校准。禁止照搬：Pulse 时间涨进度、CCAM turn end 当整个任务结束、无许可证项目代码。具体文件和理由见证据附件。

## 3. 悬浮窗交互
一个无边框窗口在普通应用上方显示，初始位于主屏右下角距 workArea 边缘 16 DIP，拖动后保存位置。它不占任务栏，不自动获得输入焦点；托盘仅提供显示/隐藏、设置、退出和接入操作。

示意，所有数值均为说明样例：
~~~text
收起： [◉ Codex · 计划 3/5  60% | 约 4–8 分 | +1]  ━━━━━━━────

悬停：
┌ 修复导出失败                       Codex  1/2 ┐
│ 正在：运行导出回归测试                         │
│ 计划 3/5 · 60%       预计剩余 4–8 分（粗估）    │
│ ✓ 复现问题  ✓ 定位原因  ✓ 修改代码              │
│ ● 验证结果  ○ 整理交付                         │
│ 工作更新：8 秒前 · 日志+主动报告                │
│ [选择任务 ▾]  [固定展开]  [接入/设置]           │
└───────────────────────────────────────────────┘
~~~

默认 320×48 DIP，展开宽 360 DIP、高度按内容且不超过 420 DIP 或当前 workArea 的可用高度；窄屏小于此宽度时收缩到 workArea 内。尺寸是初始设计值，可以在不改变行为的前提下经视觉验收微调。

- 进入 250ms 后展开，离开整个展开区域 400ms 后收起；展开方向按可用屏幕空间决定，保持鼠标下的胶囊位置稳定。
- 固定展开仅是这个悬浮框的状态，仍可关闭固定；不新建任务面板。
- 拖动阈值 4 DIP；拖动期间冻结展开/收起与自动任务切换。动画 120ms，遵从减少动画设置。
- 不因日志更新、完成、错误抢焦点。键盘用户通过托盘“展开并聚焦”进入，Escape 收起并恢复非聚焦；默认不注册全局快捷键。
- 最近手动选中的任务优先；默认只在当前任务结束或首次进入时选择最近活动任务。悬停/固定期间不自动切换；其他任务仅更新数量/等待提示。
- 详情显示当前动作、最多 5 个附近步骤及总数、进度依据、ETA 依据、最后工作更新时间。更多步骤在同一悬浮框内滚动。
- 无任务：“暂无活动任务”；有活动无计划：“进行中 · 进度未知”；没有 ETA：“暂不能估时”；等待用户：“等待你处理”；来源断连：“状态可能过期”。颜色必须配文字/图标，不只靠红绿。
- 第一版不承诺覆盖 UAC 安全桌面或独占全屏；提供托盘一键隐藏。普通窗口覆盖、不同 DPI、多屏拔插必须实测。
- 只保留同窗口的简短设置状态：来源开关/日志路径、位置重置、开机启动（默认关）、数据保留、接入配置导出、诊断。首次没有来源时引导“选择工具→确认本地路径→检测”；不自动改宿主配置。
- 本地文本用 textContent 渲染，不渲染原始 Markdown/HTML。任务名 80 字符、当前动作 120 字符；不把原始 shell 参数、完整路径或堆栈直接显示给普通用户。

## 4. 架构与技术栈
~~~mermaid
flowchart LR
  L[Codex / Claude 日志] --> A[只读适配器]
  H[宿主 Hook] --> I[本地鉴权接收]
  M[MCP / CLI + Skill] --> I
  A --> C[标准化事件与身份映射]
  I --> C
  C --> R[任务 reducer / 进度 / ETA]
  R --> D[(SQLite)]
  R --> P[主进程 IPC]
  P --> W[单个悬浮窗]
~~~

- Electron 45.0.0 + TypeScript strict。版本是 2026-10-26 核查基线；执行 M0 时及发布前刷新支持/安全更新并锁定 lockfile。
- 渲染层原生 HTML/CSS/TypeScript，不引入 React、图表库或 UI 框架。构建由 esbuild 执行；Vite 仅作为 Vitest 的间接依赖。
- 主进程管理窗口、托盘、配置导出、预加载 IPC；collector Worker 线程承担日志监听、接收 HTTP、事件归并及 SQLite，独立 JS isolate/事件循环避免同步 IO 进入窗口主线程。2026-10-27 用户选择此内存优化路线，替代原 utilityProcess 拓扑；没有独立进程的原生崩溃隔离，全局 OOM/原生故障可能退出整个应用。修改与验收见[阶段五内存计划](../plans/2026-10-27-runtime-memory.md)。
- SQLite 使用 node:sqlite DatabaseSync，封装在仓储接口后，单写入者，热路径按连接有界复用预编译语句。该 API 为 RC 等级；M0 历史 utilityProcess 证据保留，当前线程版本须重做实际打包、WAL/事务/终止恢复和退出验证。若 SQLite 技术门槛失败，停下比较 better-sqlite3 的打包成本，不悄悄换实现。
- MCP 使用官方 TypeScript SDK，M0 核验实际导出/API与宿主协商结果后固定精确版本。桥接器和 Hook 共用打包脚本，Windows 分发包携带官方 Node 24.22.x x64 运行时、校验值与许可，不依赖用户 PATH 中的 Node。
- 测试：Vitest（纯逻辑/IO）、官方 MCP client（协议）、Playwright Electron（渲染与 IPC）、Windows 原生手工/系统 API 采样（焦点、窗口层级、DPI、资源）。electron-builder 生成便携包与安装包，具体依赖精确版本在 M0 锁定。
- 运行数据在 app.getPath('userData')，不要写项目目录。不使用宿主 AI 数据库写接口，不改原始 JSONL。

### 模块边界
| 模块 | 输入 | 输出/职责 |
| --- | --- | --- |
| adapters | 被授权读取的日志根/Hook 元信息 | NormalizedEvent；不计算全局百分比 |
| ingestion | 经鉴权的事件或主动报告 | 校验、幂等、持久化 ACK |
| domain | 有序标准事件、明确 now | RunSnapshot；纯函数，不读文件/网络 |
| storage | 事件/快照/游标事务 | 崩溃恢复、去重、保留策略 |
| bridge | stdio MCP 或 CLI stdin | 本地 API 请求，失败不影响宿主工作 |
| desktop | 已脱敏快照 | 悬浮展示、有限用户命令，无日志读取权限 |

## 5. 任务身份：防止串任务和旧消息覆盖
区分四层：provider（工具种类）、nativeSessionId（宿主会话）、runId（用户本次工作）、stepId（计划叶子）。turnId 只是会话内一轮，不等于整项工作。

**主动报告模式：**
1. progress_begin 用调用唯一键创建 run，返回 runId、generation、resumeHandle。一个 MCP 连接可以服务多个 run，禁止用“当前最近任务”隐式路由。
2. 已验证 native session 的 begin 需要 expectedRun:RunRef|null，完整比较runId+generation并执行CAS；null只匹配该session无当前head。新工作总是生成新的runId，generation取仍保留的旧head代次+1（首次为1），绝不复用旧runId。相同期望值的两个并发begin只有一次成功。同一idempotencyKey在24小时有效窗内重试返回同一结果。
3. 没有可信 session 的通用 MCP 以独立 run 开始；model 参数中的 sessionId/cwd 不能成为自动合并依据。显示“未关联原生会话”。
4. progress_report/progress_context 必须提供 runId+generation+resumeHandle；resumeHandle 只留在该任务上下文/本地客户端凭据，不写 UI、普通日志或共享 Skill。
5. 压缩、继续对话、查询进展沿用相同RunRef；明确新增工作或终态后继续开发按上项创建新runId与代次。取消/关闭保留tombstone，迟到事件不能复活。首次新会话无head可用null；有handle时context返回当前head引用供显式新任务CAS。缺失handle且已有head时只返回409及“从当前任务上下文恢复或在悬浮框显式新建”，不得自动读最新head再覆盖。无可信session的通用MCP每次begin只创建独立run，不使用session head。

**被动日志模式：**
- 原生 session+turn 可证明一轮边界，不能证明用户整项工作边界；展示“本轮计划”。
- 可靠 turnId 缺失时用该文件代次+起始记录位置生成轮次标识，标为不完整，不按时间相近/同目录猜测。
- turn end/Stop 只能说明这一轮停止；未完成步骤保留，进入 paused；不能直接 100%。新轮次生成另一被动 run。
- 只有声明的 owner/main 或可信 parent session 标识才能归属子代理；不把同目录其他线程累加为进度。

**混合来源关联：**
- 自动合并只在 adapter/宿主 Hook 提供的可信 native session 标识与 run 绑定完全匹配时执行，不能只信模型自填。
- 缺少匹配时，两条来源保持独立；可在悬浮框任务菜单中选“关联本地会话”，展示两个标题/工具/轮次，由本地用户明确选择。首发链接限定run与准确nativeSessionId+turnIds列表，默认仅当前已选轮次，不按收到时间范围绑定，不自动跟随未来轮次。缺可信turnId时不允许关联。可信Hook如能提供run绑定及准确新turnId，可逐轮扩展列表；否则后续轮次保持独立，reporter的跨轮任务仍继续。解除后原生来源恢复独立派生快照，reporter原计划/状态保持；只允许对仍有完整可回放事件的轮次关联，记录不足时说明不可关联。
- 身份绑定不是强安全边界；同一 Windows 用户恶意进程不在隔离承诺内。目标是防误关联、迟到覆盖与网页注入。
- 不因主动报告过期，自动把其计划所有权交给被动日志。可以继续显示原生“当前工具活动”，但标明计划更新时间与来源。
- reporter持有整个run的计划和状态权限。关联后的native activity可以补充动作，但Stop/waiting/active不得改变reporter状态；延迟tool end不能把waiting恢复active，只有reporter明确active可以恢复。未关联的被动run才由自身生命周期事件驱动active/paused等状态。

## 6. 标准事件和工具契约
所有序号是正整数；时间为 UTC 毫秒；持续时长用单调时钟计算。schemaVersion=1。每次调用最大 64 KiB、每份计划最多 100 个叶子。

~~~ts
type ProviderId = 'codex' | 'claude' | 'generic';
type SourceKind = 'transcript' | 'hook' | 'reporter';
type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
type RunStatus = 'active' | 'waiting' | 'blocked' | 'paused' |
  'reported_done' | 'verified_done' | 'failed' | 'cancelled';
type EvidenceKind = 'declared' | 'observed' | 'verified';
type Freshness = 'fresh' | 'aging' | 'stale';
type RunRef = { runId: string; generation: number };
type Estimate = { minSec: number; maxSec: number };
type Step = {
  id: string; title: string; weight: 1 | 2 | 3; status: StepStatus;
  quantity?: { done: number; total: number };
  estimate?: Estimate & { version: number }; evidence: EvidenceKind;
};
type Plan = {
  revision: number; complete: boolean; schedule: 'serial' | 'parallel' | 'unknown';
  steps: Step[]; reason?: string;
};
type NormalizedEvent = {
  schemaVersion: 1; eventId: string; provider: ProviderId;
  sourceKind: SourceKind; sourceInstanceId: string; seq: number; eventIndex: number;
  nativeSessionId?: string; turnId?: string; nativeCallId?: string;
  run: RunRef; occurredAt: number; receivedAt: number; payload: EventPayload;
};
type EventPayload =
  | { type: 'run.started'; title: string; scope: 'task' | 'turn' }
  | { type: 'plan.replaced'; plan: Plan }
  | { type: 'step.updated'; revision: number; step: Step }
  | { type: 'activity.updated'; activity: string }
  | { type: 'run.status'; status: RunStatus; reason?: string }
  | { type: 'completion.reported'; summary: string }
  | { type: 'completion.verified'; summary: string; evidenceRef: string }
  | { type: 'source.heartbeat' };
type RunSnapshot = {
  run: RunRef; provider: ProviderId; title: string; status: RunStatus;
  scope: 'task' | 'turn'; plan: Plan | null; activity: string | null;
  progress: { value: number | null; completed: number; total: number;
    basis: 'plan' | 'quantity' | 'unknown' };
  eta: { range: Estimate | null; basis: 'prior' | 'calibrated' | 'unknown';
    reason?: string };
  freshness: Freshness; lastWorkAt: number | null; lastSeenAt: number;
};
~~~

工具只暴露四个：progress_begin、progress_report、progress_context、progress_finish。协议入参需独立校验，不把整个内部事件任意写入能力交给模型。
- BeginInput：idempotencyKey、title、可选expectedRun:RunRef|null、可选plan。凭据/可信会话由bridge内部补充。返回RunHandle = RunRef + resumeHandle。idempotencyKey与reportId采用UUIDv7；服务按其中时间验证24小时重试窗，允许最多5分钟未来偏差，过期返回410 KEY_EXPIRED（包括过期重复请求），不再次创建。此限制必须写入工具说明。
- ReportInput：handle、reportId、seq、changes 数组（1–20）；仅允许 plan.replaced、step.updated、activity.updated、active/waiting/blocked/paused/failed/cancelled 状态。plan revision 严格递增；step更新引用当前 revision。事务中整包成功或失败。
- 同一 report 的所有事件共享 seq，eventIndex 为0起的数组下标；同源高水位只在整包提交后推进。Hook/日志单条事件的 eventIndex=0。外部报告的 evidence 由接收器固定为 declared；原生解析为 observed，只有本地验收通道可以产生 verified。
- plan.complete标识是否掌握完整当前范围：主动提交全计划为true，只有TaskCreate等局部观察时为false；该字段随事件入库，不能只存在解析器内存。complete=false时百分比/ETA未知，finish返回409 INCOMPLETE_PLAN。
- ContextInput：handle；返回当前快照、nextSeq、sessionHead:RunRef|null，读取不能刷新lastWorkAt。sessionHead只针对该已授权run绑定的可信session，通用未绑定run为null。
- FinishInput：handle、reportId、seq、summary；只产生 completion.reported，不允许模型产生 completion.verified。如果仍有 pending/running/failed 步骤则 409 INCOMPLETE_PLAN；计划缺失允许报告完成，但显示“AI 报告完成，未验证”。
- verified_done 仅接受同机用户在任务菜单“我已验收”或将来受信验收适配器；首发不执行任意模型提供的测试命令。UI验收操作记录 evidenceRef 本地确认记录，禁止 renderer 直接构造已验证事件。
- 重试同 reportId 且正文相同返回原 ACK；同 ID 不同正文 409；旧 seq/revision/generation 返回 409，不能“自动取最新再覆盖”。
- 未知 schema 400、无效凭据 401、越权 run 403、正文超限 413、超频 429、后端不可用 503。ACK 必须在事务成功后返回；不会在 request.end 就假称接收成功。
- CLI 使用打包 node.exe + bridge.cjs 子命令，JSON 从 stdin 读，不拼 shell 字符串；stdout 仅协议输出，诊断写 stderr。

## 7. 来源优先级与幂等
| 数据 | 优先来源 | 退化规则 |
| --- | --- | --- |
| 整体任务计划/完成条件 | 显式绑定的 reporter | 失联保留旧计划并标 stale，不被其他来源自动接管 |
| 被动本轮计划 | adapter 解析的原生计划 | 不完整快照 progress=null，显示已发现步骤 |
| 当前活动 | 最新可信 tool start/end 或 reporter activity | nativeCallId 去重，时间不倒退；只能说明动作，不代表完成量 |
| 任务完成 | 本地验收 > reporter finish | 原生 Stop/idle 不提升到 verified_done |
| 在线/健康 | 接收器/文件监听心跳 | 只刷新 lastSeenAt，不刷新 lastWorkAt |

存储唯一键 eventId；来源有 nativeCallId 时建立 provider/session/call/type 唯一键。日志记录位置+文件代次作为稳定 eventId；Hook 若没有 callId，保留为活动线索，不修改已由日志计算的计划。计划由单一 owner source 写，revision 是该 owner 的版本；不跨来源比较 seq。

reporter的sourceInstanceId是begin时由服务分配并持久化的逻辑写入流ID，不是bridge PID或随机连接ID；owner为connectorId+run。同connector的MCP/CLI和重启后的bridge持有同handle可以继续同一流，context返回它的唯一nextSeq。两写入者抢同seq仅一个成功，失败方不能盲目获取新序号覆盖；重新判断当前工作后才可发新报告。其他connector不能接管，首发不提供owner转移。原生日志sourceInstanceId按文件代次稳定定义，Hook按注册源定义。

每个sourceInstanceId+run独立递增seq，同源乱序旧seq拒绝，先查有效窗内重复reportId再查高水位；不尝试对不同来源时钟全局排序。receivedAt由服务生成，发生时间只用于显示和有边界的本源排序；时间偏差超过5分钟标记诊断，不用于抢占任务。桥接重连不能通过更换sourceInstanceId绕过排序。

## 8. 进度算法：能解释每一个百分比
- 只计算叶子，权重 1/2/3；父步骤仅展示，不计分，第一版数据契约直接只接收叶子。
- completed 分数为 1；running 且有真实数量时为 done/total；pending、failed 为 0。skipped 从分母剔除，必须通过带 reason 的计划 revision 明确改变范围。
- 同一份完整计划内：P = 100 × Σ(weight × fraction) / Σ(weight)，展示四舍五入整数。
- 全部 skipped、无计划、不完整的被动计划都返回 null。不能把未知当 0%，也不能把“日志一直增长”当完成。
- completed 声明来源可能是 AI；标签为“计划完成度”，证据来源在悬停详情可见，不暗示代码已验收。
- 计划 100% 但没有 finish：显示“计划 100% · 待收尾”。finish 后 reported_done：“AI 报告完成”；用户验收后 verified_done：“已验收”。
- 新增范围、重新打开步骤允许百分比下降，展示“计划已调整”，不强制单调或偷偷平滑。数量 done 必须 0≤done≤total 且 total>0；违规拒绝。
- 对无法获得计划的普通聊天/浏览任务，支持 activity 与 status；百分比及 ETA 未知是正确结果。
- 独立任务不合成一个总百分比；子代理只能通过父任务自己的计划或显式数量反映，避免双计。

## 9. ETA：首发只做可解释区间
显示“预计剩余 4–8 分（粗估）”，不显示秒级倒计时、不承诺统计覆盖率。它与计划百分比分开计算。

1. 没有完整串行计划、存在未知时长步骤、并行/unknown schedule、多 running 且无串行依据：ETA=null，显示原因。
2. 每个estimate是“该estimate版本被接受时，当前步骤预计还需要的active时间”，正数minSec≤maxSec、version正整数。首次pending估计以真正开始该步骤时为计时锚点；running中首次/更新估计以接收时的active累计量为锚点，之后只扣锚点后的active增量。未开始步骤区间相加。例：已工作8分钟，更新为4–8分钟，就从当下显示4–8分钟，不能再扣之前8分钟。
3. waiting/blocked/paused 不累计 active 时间，UI 隐藏倒计时，保留恢复时的剩余估计。跨程序关闭、系统休眠时间不算工作时长；没有连续观测的时段标为未知，恢复后需新估计。
4. 有至少3个有效完成步骤样本时，取“实际active时长/开始时原估计中点”中位数作为k，限制0.5–3。仅对未开始步骤的先验区间及从pending沿用的running估计应用k；running中重新提交的剩余时间不再乘k。有应用校准的贡献时标签为“按本次节奏校准”。样本只来自同run/同一尝试，剔除无起止、暂停不明、时钟跳变、运行中修改估计的记录。
5. 当前estimate锚点之后的active增量超过该版本有效上界且仍running：ETA=null，提示“已超原估计，等待更新”。prior版本上界按k校准，remaining版本不乘k；不得拿整个尝试耗时与新剩余区间比较。不自动追加1分钟或随时间涨百分比，AI可用新estimate.version更新估计。
6. 步骤新plan revision重新打开则开始新的尝试，旧完成耗时不混入新样本。同step estimate.version不变表示沿用锚点，数值也必须不变；主动重新估时必须增加estimate.version，不能靠重发相同plan重置时钟。新plan保留step id时必须保留尝试与估计锚点。跨关闭/休眠连续性丢失后，未开始步骤先验可保留，当前步骤ETA等待新estimate版本；该尝试不进入校准样本。
7. 首发不根据 token 量/工具调用次数估交付时间。并行工作后续可增加显式依赖图，当前不把所有 pending 简单相加冒充并行 ETA。

## 10. 采集、后台报告与故障退化
### 日志
- 默认只探测标准目录，实际读取前显示来源与路径；可手动指定 CODEX_HOME/Claude 日志根。不扫描整个磁盘。
- fs.watch 作为提示，活跃文件每 1 秒 stat 兜底；最近 24 小时候选元数据每 30 秒分批发现，最多 200 文件；最多 20 个活跃源。历史总量大时不得全目录全文件周期读取。
- 每次单文件读取最多 1 MiB、初始尾部最多 8 MiB、单行最多 1 MiB；部分 UTF-8/CRLF/半行缓存到下次，不执行内容。截断/轮转重建文件代次。
- 初始尾窗没有完整计划时展示 partial，不读取全文件制造卡顿。超长行跳过并显示“部分记录未解析”，不把跳过行当任务结束。
- cursor及有界parser checkpoint与事件/快照同事务提交后推进；checkpoint保存当前turn、native计划版本和待匹配调用（最多200项、合计256KiB，超限淘汰最旧并标partial），确保重启后能匹配此前tool_use的返回。同一内容重复读取仍幂等。文件短暂独占/无权限按1/2/5/15秒退避，其他源继续运行。
- Codex 原生计划、Claude TodoWrite/Task系列按白名单解析；未识别事件计数到诊断，不保存原文。

### Hook
同一 source 可与日志同时使用，获取开始、等待、工具执行、轮次结束等状态。后台发送总截止 750ms、网络 350ms、不重试风暴；监听器不在时退出0让主任务继续，诊断最多每源每分钟一条。不把 Hook 成功等同任务进度增长。
明确过滤 progress_* 和本工具 helper，防止“上报触发 Hook→再次上报”递归。不得自动安装、覆盖、删除宿主已有 Hook。

### MCP/Skill
Skill 自动在新工作、计划/动作变化、等待/阻塞、完成前报告；长任务目标为自然工具边界约每 60 秒一次，同内容最短间隔15秒。状态/计划改变立即上报；同内容保活不刷新工作更新时间。一次工具连续运行十分钟时只能显示“该工具仍未返回，最后工作报告xx前”；宿主 Hook 可提供开始/结束，不能伪造中间语义。
协议失败至多一次诊断、不反复要求权限、不阻塞真实任务、不启动竞争后台报告。Skill 不能自行成为常驻定时器；严格保持主 agent 的 runHandle，子 agent 不共享顶层 handle。

### 健康与恢复
- 最后工作事件距今≤60秒 fresh，>60秒 aging，>180秒 stale。source heartbeat 即使在线也不能清除 stale。
- collector 每10秒健康信号；30秒失联显示采集不可用。Worker 线程异常退出最多自动重启3次（1/2/5秒），之后保留窗口并显示重新连接操作；并发显式重连合并，旧线程退出后才启新线程。该策略不覆盖共享进程的原生崩溃。
- app恢复时已存active run先paused，不能假装关闭期间继续工作；被动run可由新可信原生活动恢复active，reporter run必须收到reporter明确active。迟到native tool end不能恢复reporter状态。
- 数据库写失败不返回成功 ACK；窗口显示“本地记录异常”。不删除旧库；原生日志后续可重放。
- 正常退出停止 watchers、关闭 bridge连接/数据库。唤醒后重新校验路径、display与采集状态。

## 11. 存储、保留与本地安全
SQLite表：events（脱敏标准事件、eventId唯一）、runs、source_bindings、source_sequences、file_cursors、parser_checkpoints、report_receipts、begin_receipts、settings。事务写事件+快照+游标/checkpoint/序号；WAL、synchronous=FULL、foreign_keys=ON、busy_timeout=1000ms，单collector写库。派生字段可重放，报告回执需持久化保证重试幂等。

阶段二接口补充：可信transcript可以提交没有领域事件的cursor/checkpoint事务，不伪造activity或刷新工作时间；全部原生事件被去重时，合法断点仍需落库。文件代次变化必须比较expectedCursor，旧代次/旧offset不能回退新断点。reporter批次需要RunHandle；来源kind与本地验收能力由注册/接收层提供，不接受模型自报。begin占用流seq=1，后续从context获取nextSeq。原生计划owner以来源种类/provider/session保持稳定，摄取序号仍按实际来源代次隔离。

终态事件保留7天、终态快照30天；活跃任务不因时间删除。数据库有效数据预算100MiB，口径为page_size×(page_count−freelist_count)；物理文件/WAL另报，不能删除后因文件未缩小持续误判超限。达到时先清理最旧终态事件并保留终态快照，再清理旧快照；活跃数据超过限制时明确报告存储压力并拒绝新写，不静默删除活动记录。每次清理最多500行、空闲执行；WAL大于8MiB时在空闲checkpoint，V1不自动VACUUM大库。用户可从设置清理终态历史，不改宿主日志。

begin幂等结果与report_receipts至少保留其UUIDv7有效窗24小时再加5分钟时钟容差。run的owner、序号高水位、绑定与tombstone在活动期保留，终态后保留30天；事件7天清理不删这些控制记录。用户清历史只删显示数据，不提前删有效控制记录。30天后删除终态run及控制数据，旧handle一律410 RUN_GONE，report不能创建run；旧begin key因24小时过期不能复活任务。head若指向已清理run则移除，未来新run使用全新ID。控制记录不得为100MiB预算提前驱逐；必要时拒绝新写并显示存储压力，不能破坏已承诺的重试窗口。

接收器只绑定127.0.0.1随机可用端口。endpoint文件在userData且仅当前用户可读，含端口和安装实例 ID；每个 connector 独立256-bit随机 bearer，保存在受Windows ACL保护的凭据文件（当前用户与SYSTEM可读），不放命令行、宿主配置片段或renderer。首发不额外引入原生加密依赖；同用户进程可读的边界必须如实说明。HTTP拒绝非本机Host、所有浏览器Origin、无凭据请求；不开放CORS、WebSocket公网入口、远端命令或任意路径读取。凭据不是针对同用户恶意程序的隔离保证。

renderer启用sandbox/contextIsolation，关闭nodeIntegration，严格CSP，仅本地app协议；preload只暴露subscribeSnapshots、dispatchUiCommand。所有IPC验证窗口来源和命令结构。不存在shell命令执行或任意文件读取IPC。接入导出使用绝对可执行路径+参数数组；中文路径、空格、引号纳入测试。

安装接入流程：生成宿主专用配置片段→预览目标文件差异→用户在本地设置点击“应用”→备份→原子合并→回读确认。检测到宿主修改则不覆盖。卸载只撤销本工具拥有且仍匹配的条目。该交互属于产品设计，当前规划阶段不修改用户配置。

## 12. 性能与原生体验验收目标
以下是工程预算，尚未测得：
| 指标 | 目标与测量口径 |
| --- | --- |
| 正常负载 | 10个活动run、合计20事件/秒；100事件/秒持续10秒突发不丢已ACK事件 |
| 显示延迟 | 采集器收到有效事件→渲染更新 P95≤1秒；日志追加可读→显示 P95≤3秒 |
| 悬停 | 等待250ms后，开始展开到稳定内容≤150ms；不产生焦点切换 |
| CPU | 预热后5分钟空闲采样，进程树平均CPU≤总机器容量1%；10run常态≤3% |
| 内存 | 主进程（含collector Worker）+renderer+GPU+Network Service+常驻bridge的Private Bytes总和≤220 MiB；工作集另报，不混用 |
| 体积/启动 | 含Node sidecar的x64便携压缩包目标≤180 MiB；参考SSD冷启动可见≤3秒 |
| 耐久 | 8小时混合源回放，10个活动run、合计2事件/秒（用户2026-10-27确认），保留100MiB有效数据库预算；无崩溃，最后1小时Private Bytes中位数比第2小时增长≤20 MiB；正常五分钟负载仍为20事件/秒 |
| 数据完整 | ACK后强杀再启不丢该报告；日志重复/截断不双计；不同同目录任务零串写 |

测试记录必须带Windows版本、CPU/RAM、DPI/屏幕、应用/宿主版本、负载与驱动方式；指标不达标不得以脚本exit0宣称通过。资源预算在M0测一次，超预算先定位主因，再决定是否换壳。

## 13. 风险、决策门槛与完成定义
| 风险 | 处理/验收 |
| --- | --- |
| 原生日志格式变化 | 固定版本fixtures+未知格式退化，异常不清空有效状态 |
| MCP拿不到宿主会话ID | 独立run+本地显式关联；绝不按cwd或当前焦点猜 |
| Hook长工具无中间报告 | 展示最近实际事件和stale，不捏造进度 |
| Electron常驻成本 | M0与打包后原生资源门槛，失败才评估替代壳 |
| node:sqlite运行时差异 | M0直接测打包utility；失败先修改设计 |
| AI漏报或过度乐观 | 被动活动补充、进度来源标签、reported_done与验收分离 |
| 第三方许可/后续维护 | 固定SHA、移植清单、保留NOTICE，不使用无明确许可代码 |

交付完成必须同时满足：协议/恢复/解析回归通过；Windows真实悬浮行为通过；至少两个AI宿主真实任务全链路通过；ETA未知/超时/改计划展示诚实；安装升级卸载可回滚；第三方来源清单与用户说明完备。样例回放、DOM测试、截图、上游README各自只能证明自己的范围。

给实现者的裁量：颜色/图标/阴影、文件内部私有辅助函数、测试工具小版本可自行选择并锁定；任务身份、完成定义、百分比/ETA含义、首发范围和安全边界不得静默修改。首次实施顺序固定为阶段一→阶段二→阶段三→阶段四→阶段五；先验证技术和数据底座，阶段三交付可用悬浮框，阶段四完善后台报告/估时，阶段五完成交付验收。

## 14. 规划审阅记录
2026-10-26进行了独立可实施性审阅，提出的5项问题均已形成明确规则并同步实施测试：新工作采用新runId及完整RunRef CAS；reporter流跨进程保持身份/序号；混合关联限定准确turn且native不覆盖reporter状态；幂等24小时与终态控制30天；重新估计表示锚点之后的剩余时间。

复核又发现两处旧规则，已统一：重启后的reporter只接受自身active恢复；超时判断比较estimate锚点后的active增量。文档自检另补充了跨块解析checkpoint、plan.complete持久化、公共接口与SQLite有效页预算。

以上是设计审阅和文档一致性修订，不是产品测试。真实日志格式、原生窗口、资源预算、打包环境和宿主兼容仍按T01/T13实际验证，当前均不应标为已通过。

初版规划已检查5个阶段、14个任务和102个步骤的完整性。五阶段调整保留任务编号，将T08安排在阶段三、T07安排在阶段四，并明确T06先打通基础采集到窗口通路。阶段一、二实施后的验证与勾选以阶段报告和当前计划为准；文档链接数量随新增材料变化，由npm run verify:docs重新检查。此前经验库发现链路检查通过，不能由这些静态检查推断后续产品行为。
