# 参考项目源码核查与复用决策
核查日期：2026-10-26。范围：公开仓库固定提交的源码、测试代码、许可证与官方接口文档。未安装、未构建、未运行这些项目；“有实现/有测试”不代表本机验收通过。本文是开发方案的证据附件。

## 1. 结论
推荐新建一个薄的 Electron 悬浮窗应用，选择性移植 CCAM 的计划解析及对应测试。任务身份与进度合并需要新实现；估时采用可解释的区间算法。复用的目标是减少已经解决的问题，不是把参考项目的管理界面、账户系统、遥测、任务编排一起引入。

## 2. 固定提交与许可
| 项目 | 核查提交 | 许可依据 | 决策 |
| --- | --- | --- | --- |
| [CCAM](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) | 3cb22ae4a4e2ca31145351e1d73e05d0ff41f2dc | 已读根 LICENSE，MIT | 主要代码与测试复用来源 |
| [claude-how-long](https://github.com/bhu0345/claude-how-long) | a2c85796b8e605aa17761ba098fdd7de9e1d7b20 | 已读 LICENSE，MIT | 借鉴估时校准，不能原样采用进度公式 |
| [task-progress-reporter](https://github.com/fdaniel98/task-progress-reporter) | a326c205f880738aeffd3257a340bae0d32053fc | 已读 LICENSE，MIT | 借鉴叶子权重、报告时机和验收条件 |
| [Codex Pulse](https://github.com/wudongshu2002/codex-pulse) | b8732a4a98081559dd5f8f7ca417a7b7a486d8de | 已读根 LICENSE，MIT | 阅读 Windows 小组件实现；不移植估时器和桌面层挂载 |
| [Herdr agent progress](https://github.com/eliasstravik/herdr-agent-progress) | 7f3a3fe4f197686703749f65d48bc281caca5df8 | 已读根 LICENSE，MIT | 借鉴绑定、任务代次、过期报告保护 |
| [AgentHUD](https://github.com/neochoon/agenthud) | 262d1c540e416b3c8aafa9e61fdec3d6232cd579 | README 声明 MIT，但该提交递归文件树未见 LICENSE | 只借鉴接口分层思路；不直接复制，待明确许可文本 |
| [Agent Island](https://github.com/jibc45453jibc/agent-island) | e00d341a71ba8f0bd6e1f8904150519467746343 | README 明确没有 LICENSE，文件树亦未见 | 只作为交互参考，不复制源码或素材 |

许可判断是本次工程复用筛选，不代表完整法律审查。实施时记录实际移植文件、原作者、提交、改动和许可证全文；不要仅列仓库名。未复制的思想参考与已复制的代码应分别登记。

## 3. CCAM：最有价值的是解析与回归样本

源码入口（均固定提交）：
- [task-progress.js](https://github.com/hoangsonww/Claude-Code-Agent-Monitor/blob/3cb22ae4a4e2ca31145351e1d73e05d0ff41f2dc/server/lib/task-progress.js)
- [codex-plan-call.js](https://github.com/hoangsonww/Claude-Code-Agent-Monitor/blob/3cb22ae4a4e2ca31145351e1d73e05d0ff41f2dc/server/lib/codex-plan-call.js)
- [task-progress.test.js](https://github.com/hoangsonww/Claude-Code-Agent-Monitor/blob/3cb22ae4a4e2ca31145351e1d73e05d0ff41f2dc/server/__tests__/task-progress.test.js)
- [hook-transport.js](https://github.com/hoangsonww/Claude-Code-Agent-Monitor/blob/3cb22ae4a4e2ca31145351e1d73e05d0ff41f2dc/scripts/hook-transport.js)
- [session-liveness.js](https://github.com/hoangsonww/Claude-Code-Agent-Monitor/blob/3cb22ae4a4e2ca31145351e1d73e05d0ff41f2dc/server/lib/session-liveness.js)
- [snapshot-store.js](https://github.com/hoangsonww/Claude-Code-Agent-Monitor/blob/3cb22ae4a4e2ca31145351e1d73e05d0ff41f2dc/server/lib/snapshot-store.js)
- [desktop window.ts](https://github.com/hoangsonww/Claude-Code-Agent-Monitor/blob/3cb22ae4a4e2ca31145351e1d73e05d0ff41f2dc/desktop/src/window.ts)

实际实现与影响：
1. task-progress.js 364–414 行支持 TodoWrite、update_plan、TaskList、TaskCreate、TaskUpdate、TaskGet，并归一成 replace/upsert 观察。433–510 行处理 Codex/Claude 的不同消息格式。适合提取纯解析层。
2. 98–219 行用受限数据字面量解析器解析 exec 内的 update_plan，配合 codex-plan-call.js 跳过字符串与注释，不执行原始脚本。移植时增加深度/长度限制；禁止 eval/Function。
3. 947–1031 行包含业务 reducer：新用户轮次 reset、turn end 删除未完成 tracker。这个语义适用于其“当前轮次”展示，不能直接当作我们的“跨轮任务”状态机。
4. 1034–1053 行用 completed / total 计算百分比，属于计划条目比例；并不是时间预测，也不是交付验收。
5. 顶部常量及增量缓存限制了读取窗口，但文件依赖 snapshot-store 压缩/归档能力。我们只处理原生实时日志，不能因为一个 import 把压缩、复制、清理原始日志引入。
6. 测试文件覆盖：追加字节、调用与返回跨增量、CRLF、无尾换行、超长行、截断/轮转、同 inode 缩小、缓存窗口淘汰、exec 假匹配、子代理归属、不同轮次边界。移植适用的 fixtures/assertions，改写我们的边界期望；没有运行这些上游测试。
7. hook-transport 会做本地端口扇出或可选远端 HTTPS，timeout 为 2 秒，request.end 回调即可能 resolve。我们的协议需要单实例本地地址、鉴权、明确 ACK；不原样复制 transport。
8. session-liveness 明确将 Windows 探测标为 unavailable，不应在 Windows 以“没有探测到进程”推断任务结束。
9. desktop window.ts 是常规窗口管理，并非现成悬停悬浮窗。UI 仍需实现和原生验收。

移植单元：受限计划调用提取、消息格式解析、部分增量读取策略与回归用例。保留原许可头；改造后模块独立于上游 Web 服务、snapshot-store 和 dashboard。

## 4. 其他项目：采用哪些，舍弃哪些

### claude-how-long
已读 [template.html](https://github.com/bhu0345/claude-how-long/blob/a2c85796b8e605aa17761ba098fdd7de9e1d7b20/how-long/template.html) 的 compute 与 render、SKILL.md。
- 270–299 行根据完成步骤与当前步骤速度校准估时；多条 running 取最大剩余时间，再加 pending。可借鉴“用实际耗时修正先验”。
- 290 行没有计数时按时间插值完成比例；失败步骤的处理也不能等同成功交付。我们的完成度不采用这些规则。
- 344–346 行按时间判 stale/stalled；过期不能证明任务实际失败。
- 依赖 Artifact/ArtifactData，不能直接成为 Windows 独立悬浮框。所谓 confidence 是启发式标签，非统计置信区间。

### task-progress-reporter
已读 [tpr.py](https://github.com/fdaniel98/task-progress-reporter/blob/a326c205f880738aeffd3257a340bae0d32053fc/skills/task-progress-reporter/scripts/tpr.py)、SKILL.md 和 [track.py](https://github.com/fdaniel98/task-progress-reporter/blob/a326c205f880738aeffd3257a340bae0d32053fc/hooks/track.py)。
- 叶子任务权重 1/2/3，禁止父子同时计分；计划新增后百分比可下降。这些规则直接进入我们的领域模型与测试。
- track.py 的 20 秒提醒只在 PostToolUse 触发时检查；一个耗时十分钟的工具执行期间不会因此每 20 秒汇报。
- 其正文/提醒输出不适合我们“聊天不刷屏”的要求。新 Skill 只负责调用结构化上报工具，不原样安装上游 Skill。

### Codex Pulse
已读 [MainWindow.cs](https://github.com/wudongshu2002/codex-pulse/blob/b8732a4a98081559dd5f8f7ca417a7b7a486d8de/source/MainWindow.cs)、[DesktopHost.cs](https://github.com/wudongshu2002/codex-pulse/blob/b8732a4a98081559dd5f8f7ca417a7b7a486d8de/source/DesktopHost.cs)、[CodexMonitor.cs](https://github.com/wudongshu2002/codex-pulse/blob/b8732a4a98081559dd5f8f7ca417a7b7a486d8de/source/CodexMonitor.cs)。
- WPF 主窗口、DispatcherTimer 刷新、紧凑任务布局、DPI/位置处理可参考。
- DesktopHost 用 WorkerW/SetParent 挂桌面层，普通应用会盖住它；我们的目标是普通应用上方的悬浮窗。
- CalculateEstimate 423–460 行：有计划时 currentFraction 随 elapsedMinutes 增加；无计划时 score 取活动量平方根和时间对数。该数字不是可靠已完成工作，明确不复用。
- C# 代码无法低成本直接嵌入推荐的 TS 运行时，不额外引入 WPF sidecar。

### Herdr agent progress
已读 [state.rs](https://github.com/eliasstravik/herdr-agent-progress/blob/7f3a3fe4f197686703749f65d48bc281caca5df8/src/state.rs)、[publisher.rs](https://github.com/eliasstravik/herdr-agent-progress/blob/7f3a3fe4f197686703749f65d48bc281caca5df8/src/publisher.rs)、[instructions.md](https://github.com/eliasstravik/herdr-agent-progress/blob/7f3a3fe4f197686703749f65d48bc281caca5df8/instructions.md)。
- state.rs 75–158 行：核对 native session 后才沿用任务，绑定代次、expected task CAS、拒绝旧 task 写入、clear 后保留 tombstone。
- 178–201 行：5 分钟 stale 与持久化递增 sequence。publisher 在事务中重新检查身份及预留发送序号。
- 借鉴身份与并发约束，写 TS 实现与相应竞态测试；不引入 Herdr socket、pane、Rust 守护进程。
- 指令区分“任务”与“新回复/上下文压缩”，值得采用；粗百分比只作为 AI 自估，不能伪装成客观进度。

### AgentHUD / Agent Island
已读 AgentHUD [providers/types.ts](https://github.com/neochoon/agenthud/blob/262d1c540e416b3c8aafa9e61fdec3d6232cd579/src/data/providers/types.ts) 和 [providers/codex.ts](https://github.com/neochoon/agenthud/blob/262d1c540e416b3c8aafa9e61fdec3d6232cd579/src/data/providers/codex.ts)：发现会话和解析已读取行分离；不同 provider 的树不混合；目录不存在应返回不可用而不是让全局崩溃。这是可采用的结构思路，许可未澄清前不复制。
Agent Island 仅核查 README、文件树和接入说明；未完整审计其业务实现。已有悬浮交互不能证明已接通真实任务，更不能在无许可时直接拿代码。

## 5. 官方接口与实施边界
| 来源 | 核查结论 | 对本方案的影响 |
| --- | --- | --- |
| [Codex App Server](https://developers.openai.com/codex/app-server) | 有 turn/plan/updated，包含 turnId 与计划状态 | 仅对我们实际接管/获准订阅的连接有效；不承诺监听全部现有桌面会话 |
| [Codex 插件](https://developers.openai.com/plugins/build/plugins) | 手动安装插件可有 Hook，公共目录限制及信任要求需遵守 | 原生 Hook 是否可用作为 P0 实测项，日志+MCP 为基础路径 |
| [Claude Hooks](https://code.claude.com/docs/en/hooks) | async command hook 可后台运行；suppressOutput 当前不生效 | 成功静默不代表调用不可见；Hook 不绕过宿主授权 |
| [MCP 2025-11-25 progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress) | 请求相关的可选进度通知，task-augmented 可延长生命周期 | 用自有 run/step 工具协议描述跨调用任务，不能依赖 progressToken 自动覆盖整个任务 |
| [MCP 官方 SDK](https://modelcontextprotocol.io/docs/2026-07-28/sdk) | TypeScript SDK 为官方 Tier 1 | 采用官方 SDK，P0 锁定实际兼容版本；不手写 JSON-RPC |
| [Electron release](https://releases.electronjs.org/) / [schedule](https://releases.electronjs.org/schedule) | 当前稳定 45.0.0，内置 Node 24.22.0 | 开发基线 Electron 45.0.0；实施/发布时刷新支持状态 |
| [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) | 有 always-on-top、showInactive、focusable 控制 | 可行 API 不等于 Windows 不抢焦点实测，必须过 P0 |
| [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process) | 独立 Node 子进程及消息通道 | 采集和同步 SQLite 放到此进程，不阻塞 UI |
| [Node 24 SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) | node:sqlite 是 Release candidate 1.2，非完全稳定等级 | 用薄仓储接口隔离；必须测试打包运行时，不能只看开发 Node |
| [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) | 隔离 renderer、限制 IPC、限制导航等 | 本地 UI 不接触原始日志、token、命令执行能力 |

## 6. 可复用边界与追踪办法
每个移植项创建 origin 条目：仓库 + 完整 SHA + 原文件/行范围 + 许可 + 目标文件 + 调整理由 + 回归用例。只按实际移植登记，不声称“复用了整个项目”。上游测试未运行的状态保持到本地移植验证完成。

P0 必须验证：真实日志格式、会话归属、跨工具并行、悬停不抢焦点、打包 node:sqlite、无系统 Node 的 MCP/helper 路径。通过后才能把“候选复用”改为“已验证复用”。

