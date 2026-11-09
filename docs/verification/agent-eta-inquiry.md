# 原任务 agent 后台估时验收

2026-10-29更新：以下是27日历史验收。当前已改为保留最近有效倒计时、最多一次初始询问、必要时主动改时，见[新验证记录](eta-countdown.md)；不再沿用下述120/600秒周期询问策略。

日期：2026-10-27，Windows 11 x64。实现代码 `f95d226`；独立最终候选 `release/eta-candidate-v6`。未修改既有 `release/memory-candidate-v4`。其 2 事件/秒八小时耐久于当日16:03因 `fetch failed` 退出，未完成；不将 v4 结果计为新增功能或 v6 耐久通过。

## 已实现行为

- 产品为每个 active reporter 任务生成独立估时问题，原 agent 用私有任务 handle 取件和答复。Codex / Claude 使用异步 PostToolUse Hook 接入，通用 MCP 使用自然工具边界的协作取件。仍为四个 MCP 工具，无额外模型、采集进程、聊天消息注入或会话唤醒。
- 请求绑定 run/generation、随机 requestId、planRevision 和有效期；同一任务只保留一个待答问题。开始即请求，刷新下限 120 秒，超时退避上限 600 秒；暂停/等待/阻塞及终态取消待答问题。回答未知合法，旧问题/跨任务/旧计划拒绝，重复 ACK 沿用原幂等回执。
- 任务级 AI 粗估按活跃时间递减，等待冻结；不编进度、不改当前动作或工作更新时间。新鲜估时与工作活动 freshness 分开。悬停区用可换行状态文字显示等待安全点、暂未答复和无法估时；紧凑窗仍为 320×48。
- 设置可预览、备份、合并、撤销 MCP 与异步 Hook 条目；用户已有 Hook 保留。首次需宿主预先允许本地报告工具、信任 Hook / 重连，程序不改宿主审批策略。工具卡及审计日志由宿主管理。

## 新鲜验证

| 项目 | 结果与范围 |
| --- | --- |
| 全回归 | 48 文件 / 113 测试通过，实际包测试指向 v6；类型、lint、文档链接、复用来源校验通过 |
| MCP | 官方 SDK 实际 stdio 流程覆盖 Codex、Claude、generic：产品问题、应询答复、重复 ACK、无工作活动/进度伪增 |
| Hook | 两套真实 Node 子进程与本地服务闭环；生成命令经 Windows cmd / PowerShell 实际执行；精确关联、未知 call、子 agent、进度工具、重复送达过滤与 fail-open |
| 配置 | 两种 Hook 合并、重复应用、保留用户其他 Hook/注释和后续编辑、撤销；既有 MCP、卸载保护与回执回归通过 |
| 实际目录包 | 产品问题 → 已关联 transcript call → 包内 Hook → 原 reporter 回答 → AI 粗估显示 → 等待冻结；应用/撤销接入成功，renderer 错误 0 |
| 真实 Codex | CLI 0.154.0，最终 v6 协作 MCP 会话退出 0，1 个 reporter 任务、观察到 agent ETA、完成原受控练习；未检测到估时聊天正文 |
| 当前桌面聊天原生接入 | 客户端重启后，四工具出现在原生目录；本聊天直接调用 begin/context/report/finish 成功，原 agent 回答产品估时问题，最终 reported_done / 100%；非另启 SDK 或模型替代 |
| 真实 Claude | 2.1.278 未登录，认证被拒；没有 reporter 或模型答复，不能记为真实宿主通过 |

包内 app.asar SHA256：`d4d780b5c7413aad340b7328f0592ed73cc1fc44f185c9ad5140dd10822f37c2`。

最终目录包夹具证据：`.artifacts/eta-inquiry/中文 测试-roP6ZT/result.json`，同目录 screenshots 已检查浅深色与等待状态。该夹具提供估时答案，不冒充 AI 预测质量。真实 Codex / Claude 受控练习分别见 `.artifacts/real-hosts/exercise-xYfEL1/codex-audit.json` 与 `exercise-ljwMZQ/claude-audit.json`；只保留白名单审计，不保存私有 handle 或聊天正文。

## 独立审阅及修复

新鲜上下文审查发现两项实际缺陷，均复现 RED 后修复 GREEN，再运行全部 113 项回归：

1. Codex 只过滤进度调用，没有过滤结果，导致关联后的 lastWorkAt 被估时工具返回刷新。现仅对已观察的非遥测 call ID 生成结束活动，跨 parser checkpoint 保留；覆盖直接进度调用、普通静态 code wrapper 和混合真实工作。未知/动态包装不执行源码进行猜测。
2. 同一 changes 批次 paused/waiting/blocked → active → 旧估时答案能绕过批末取消。现离开 active 的 reducer 事件立即取消待答问题；三种回归均拒绝旧答复且事务/序号不变，已接受估时的等待冻结仍有效。

截图检查还发现把询问文案追加到原有 ellipsis 元数据行会裁切，改为独立可换行的就地状态文字。探针显式选择目标 reporter，并对 EXE 路径取绝对路径，避免旧选中任务或临时 CLI cwd 造成假失败。

## 资源与分发

v6 标准资源回归已实测通过：10 个活动 reporter、20 事件/秒 ×300.017 秒，随后300.013秒空闲；6,000 ACK、6,003 持久报告事件（另3个控制事件），0崩溃。沿用主进程/Worker、renderer、GPU、Network Service 和一个常驻 MCP bridge 的进程口径，不扣估算开销。基准驱动、采样器、AI CLI 和其他应用不计入产品值；此标准负载不包含宿主临时启动的 Hook Node 并发峰值。

| 指标 | 实测 | 门槛 |
| --- | --- | --- |
| 产品 Private Bytes 峰值 | 214.4765625 MiB | ≤220 MiB |
| 报告 / 日志渲染接收 P95 | 51.86 / 66.89 ms | ≤1000 / ≤3000 ms |
| 启动到窗口可见 | 657.03 ms | ≤3000 ms |
| 活跃 / 空闲平均 CPU | 1.547% / 0.082% | ≤3% / ≤1% |
| 活跃 / 空闲资源样本 | 62 / 60；最大间隔5.027秒 | 覆盖门禁通过 |

数据为 `.artifacts/bench/中文 测试-rmPi5r/{raw,verdict}.json`，全部门禁 pass。原v4耐久同机继续；开始阶段还存在独立ZIP/NSIS打包进程，因此不称隔离空机测量，也未从产品值扣除任何额外开销。目录包、真实宿主及其他 GUI 验证均在本标准测量前完成。此结果不是 v6 八小时通过。

最终 ZIP / NSIS / SHA256SUMS / manifest 位于 `release/eta-candidate-v6`，实际签名检查为 NotSigned。ZIP 为187,390,791字节（约178.7MiB，≤180MiB），SHA256 `695b06109843327a0fa9d897aee98159649dd2909c48624054458901bcc2edb0`；NSIS 为146,250,553字节，SHA256 `ab9961d697a0bac92575b04f7be5cab3b07d2137541b814896d929b985e30430`。从ZIP直接读流比对 EXE、asar、内置Node、MCP、三套Hook文件及卸载helper共8项，全部与已验证目录包相同；实际目录包已通过中文路径、无系统Node和退出清理回归。打包和实际目录包测试不是新版本完整安装/升级、物理 IME、DPI、多屏或发布就绪验收。

## 剩余边界与使用

2026-10-27 16:20（Asia/Shanghai）补验：首次原生 begin 返回 UNAVAILABLE；只读检查发现 v6 桌面进程不存在，endpoint 文件仍在但记录端口未监听。启动原有 v6 后，使用同一幂等请求成功，不修改 Codex 配置。当前聊天的原生 context 取得属于本任务的 etaQuestion，由当前 agent 经原生 report 回答；回读为 answered、basis=agent，答复前后 lastWorkAt、进度和动作均不变。随后按步骤完成，原生 finish 后回读 reported_done / 100%，无待答问题。脱敏记录：`.artifacts/native-codex-2026-10-27/result.json`，未保存私有 handle 或凭据。本轮未重新拍摄窗口截图，不把状态回读当作新增视觉验收；桌面进程此前退出的原因未定位，也未复验原生异步 Hook。

真实 Codex 结果证明受控提示下的协作 MCP 答复；不证明任意会话的 Skill 自然触发率、原生 async Hook 在具体宿主版本/信任状态下的模型安全点响应，也不证明 AI 估时准确率。Claude 需先完成宿主登录，再按[接入说明](../integrations.md)验证。

v5 是审阅前诊断包，本记录的结果对应 v6。各候选的性能、耐久和完整安装分别验收，整体状态见 [V1 验收矩阵](acceptance.md)。
