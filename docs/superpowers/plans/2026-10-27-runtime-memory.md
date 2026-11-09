# 阶段五内存修复与剩余验收实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. This is a phase-five supplement, not a sixth implementation phase.

**Goal:** 保持 220MiB 门槛，减少产品常驻成本，再完成可执行的剩余验收。

**Architecture:** 用户于 2026-10-27 明确选择后台线程路线。保留 Electron 窗口、预加载隔离、独立 Node MCP bridge 与 SQLite 单写入者；将 collector 从 utilityProcess 移为主进程内的 Node Worker，仍在独立 JS isolate 中执行同步 SQLite。软件渲染减少 GPU 常驻分配，渲染器采用偏重内存的 V8 回收策略，不设置小型老年代硬上限。

**Tech Stack:** Electron 45.0.0 / embedded Node 24.22.0 / worker_threads / SQLite / TypeScript。

**Spec:** [原设计](../specs/2026-10-26-coding-schedule-design.md)，以下变更约定替代其 utilityProcess 拓扑。

## 变更约定与限制

- Worker 的异常退出仍遵循 1/2/5 秒重启，四次失败后由用户明确重试；关闭及重配必须等旧线程退出，避免双写入者。
- 线程拥有独立事件循环和 JS 堆，同步 SQLite 不进入窗口主线程。没有跨进程原生崩溃隔离；全局 OOM 或原生崩溃可能退出整应用，不能声称等同 utilityProcess。
- renderer 的 sandbox/contextIsolation/禁用 Node 和敏感操作聚焦校验保持原要求。MCP 协议、领域事件、数据库格式及完成语义保持原要求。
- 计量仍覆盖主进程（包含 collector 线程）、renderer、GPU、Network Service、常驻独立 Node MCP bridge 的实际 Private Bytes 总和；不减掉估算开销。
- `--initial-old-space-size=8`、`--heap-growing-percent=10`、`--max-semi-space-size=1`、`--optimize-for-size` 为固定 Electron/V8 版本的回收策略，允许老年代按实际存活数据增长，不是总内存保证。需要实际负载/CPU/渲染验证。
- 第一次实际工具调用还会启动 libuv 文件 I/O 池。本机独立 Node 从 35.45 升至 67.45MiB；池大小 1 时从 35.14 升至 42.84MiB。独立 bridge 在首次文件操作前设置 `UV_THREADPOOL_SIZE=1`，主进程与 collector 共用池为 2；这是本工具局部策略，不修改系统环境。需用实际源读取、报告、CPU 和完整资源门禁验证吞吐，不能把握手结果外推工具调用。
- 非 React 栈沿用 ant-design-ux 反馈及动效规范，核对软件渲染后的 hover、深浅主题、键盘和错误恢复；物理 IME/多屏不得由自动化冒充。
- 220MiB、CPU 3%/1%、报告/日志 P95 1s/3s、启动 3s、ZIP 180MiB、八小时末小时与第二小时中位差 20MiB 均不变。
- 用户确认耐久负载为 2 事件/秒、10 活动任务、100MiB 有效数据库预算；正常五分钟仍为 20 事件/秒。两种负载和结果分别记录，不以单元生成的八小时样本替代真实时长。

## Review Focus

1. 原生崩溃/全局 OOM 的共享进程风险必须披露，不能用普通线程终止验收代替。
2. 退出、显式重连和旧线程延迟消息不能形成双 SQLite writer 或遗留 listener。
3. Worker 启动错误必须进入有限重试，不能变成主进程未处理 error。
4. 默认软件渲染和 GC 策略不能破坏透明窗口、焦点、吞吐或可信数据语义。
5. 短时小样、完整开发小样、最终打包标准回放、八小时和真实 AI 宿主分别记录，不能互相替代。

### Task M1：线程采集器及内存策略

**Files:** src/desktop/main.ts、src/collector/main.ts、src/storage/statements.ts/repository.ts/checkpoint.ts；tests/collector/worker.test.ts、tests/desktop/window.e2e.test.ts、tests/storage/statement-reuse.test.ts。
**Consumes:** 原 SnapshotUpdate/HealthUpdate/command/reply 接口、collector supervisor。
**Produces:** 同样的有限命令接口和单 writer，独立 JS 线程生命周期。

- [x] 写真实 Worker 启停/命令测试，针对现有 collector 观察失败；加入强制终止后 WAL 重开与事件恢复验证。
- [x] 最小修改为 Node Worker/parentPort，补 error 监听；重连超时 terminate 完成后再启新线程；渲染器内存策略在 app ready 前设置。
- [x] 将原生进程强杀 E2E 改为测试端捕获实际 Worker 后 terminate，验证四次终止、离线设置及明确重试，无生产测试后门。并发重连 4 线程 RED→1 线程 GREEN。
- [x] 真实 SQL 执行次数回归先 RED（100 次提交触发 915 次 prepare），按连接有界复用热路径预编译语句，关闭连接时释放引用；事务与回放回归通过。
- [x] 运行专项、typecheck/lint、完整源码回归；本地提交 ac4f490，后续 MCP 启动策略与真实打包 Lost ACK 补充后完整 41 文件 / 95 项通过。

### Task M2：最终包资源、体验与耐久

**Files:** scripts/profile-runtime.mjs、scripts/measure-process.ps1（仅按诊断需要）；docs/verification/performance.md、acceptance.md；打包产物。
**Consumes:** M1 的真实代码、原始 benchmark 门禁。
**Produces:** 同口径最终包原始资源数据与分项判定。

打包目录锁定时仅使用新的隔离输出目录，不结束未知进程、不删除被占用文件；测试/哈希/安装验证通过参数指向实际同一候选包。

首个线程/SQL 复用包完整标准测量峰值 222.07MiB，未通过。MCP 初始堆单项回归复现 50.16MiB；随后把同一软性 V8 策略加入实际生成的 Node MCP command/args，并让回放/原生探针/真实宿主探针使用相同参数。旧接入配置需要用户在设置重新预览应用，不自动修改。该参数修复须重做整个最终包门禁，不能从单角色测试推定通过。

第二个包在真实 Lost ACK 工具调用后仍超标（早期约 237–246MiB）；工具调用后的内存回归复现 68.27MiB。定位到文件 I/O 池后才加入上述固定池大小策略，并在新目录 `release/memory-candidate-v3` 构建，重新验证。

一次独立审阅后补齐 Worker 构造同步抛错的有限重试；最终审阅修复包转到 `release/memory-candidate-v4`，完整测量必须使用该包，v3 的源码回归不代替 v4 门禁。

- [x] 最终 v4：300.000s负载+300.011s空闲，6000 ACK、6003持久事件、61/61完整采样；210.496MiB、CPU0.943%/0.030%、P95报告35.92/日志25.63ms，整体门禁通过。
- [ ] 资源已达标，12:20启动真实八小时2事件/秒回放（预计20:26）；待实际结果，不提前关闭耐久。
- [ ] 突发、21 项 UI 检查及环境允许的原生 hover/输入；实际 ZIP/NSIS 安装卸载及哈希复核。
- 当前分项：突发/21项UI、ZIP解压与哈希、当前用户临时安装/静默卸载通过；原生探针因参考窗未聚焦/无交互前台停止，故上方组合项仍开放。
- [ ] 不具备真实登录、物理输入/睡眠/多屏、干净 VM 的条目继续保留明确证据缺口。

### Task M3：剩余验收与闭环

**Files:** tests/ingestion/lost-ack.test.ts；文档/原计划/知识索引。
**Consumes:** M1/M2 的结果、原验收矩阵。
**Produces:** 真实 Lost ACK 传输故障证据、交付边界、一次独立审阅结果。

- [x] 本地代理消费真实 COMMIT 后 ACK，再在发出响应头前断开客户端；相同 reportId 重试确认 duplicate、nextSeq 与事件数，专项通过。
- [x] 扩展到真实打包应用及包内常驻 MCP bridge；调用方收到错误、原 ID 重试返回 duplicate、持久数独立核对，失败回归再修复通过。
- [ ] 完整回归、文档链接/来源验证；一次新鲜独立审阅及单次必要修复，更新可复用知识和类别索引。
- [ ] 交付最终包路径、哈希、签名、资源与耐久真实状态；所有未验收项保持开放。
