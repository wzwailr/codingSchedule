# 多 MCP 内存与耐久中断修复

更新：2026-10-29。阶段五仍未关闭；本页区分已验证修复、最终资源门禁和真实八小时结果。

## 已确认的问题

- 用户原 v7 桌面四进程约154.68MiB，三个旧 Node MCP 分别43.59/33.76/33.57MiB，总计约265.6MiB，超过220MiB。单实例性能记录不能说明多实例达标。
- 旧 v4 长测12:20:43开始、16:03:27退出1，26719个ACK、崩溃计数0，失败仅记录 fetch failed。没有底层cause，不能补认唯一历史根因。原始目录 `.artifacts/bench/中文 测试-ZYTdK8`；旧启动标记已按真实退出记录校正，原始文件另存。
- 真实采集器重启可复现：验收驱动缓存旧端口，下一次请求 ECONNREFUSED。旧驱动也会因一次丢失ACK直接退出，且终态仍可能残留running。

## 实现与边界

Windows MCP 默认改用小型 Win32 字节转发器；桌面主进程中的官方 SDK 负责每连接的 MCP 协议、工具校验和业务转发。转发器不带 Node/.NET/额外用户运行时，保留旧 Node MCP 与 CLI。管道逐连接鉴权，凭据仍引用受保护文件；最多32连接，每连接输入128KiB、在途工具调用8个、待写响应8个、输出积压256KiB；超限断开并释放连接。握手有截止，桌面退出关闭管道，采集器 Worker 重启时管道保持。

独立审阅实际发现两项P2：SDK的stdio close没有关闭其借用的Socket；慢读客户端可造成无界输出队列。两项均先补失败回归再修复；另用取消请求回归约束名额在本地操作结束时释放，避免已取消请求永久占额。正式SDK保持复用，未自行实现MCP解析器。

验收驱动每次读取endpoint；只读和带原幂等ID的写入允许至多3次瞬时传输重试。MCP负载通过三个独立客户端轮流发送，保留reportId/seq/内容；协议拒绝不换序号或ID覆盖。HTTP Lost ACK测试证明只持久一次，真实包控制场景另有代理消耗COMMIT后ACK。恢复事件、白名单cause、全部产品PID和失败终态落盘；真实崩溃/采集器重启仍使门禁失败。

构建依赖为固定Zig0.15.2 ZIP的SHA-256校验，仅读构建缓存，分发不含编译器。详见[开发说明](../development.md)。

## 当前证据

源码完整回归57文件/142项通过；对最终目录包另跑10文件/23项窗口、打包与真实采集器重启恢复测试通过；最终包22项界面检查通过。类型、lint、来源与文档链接检查通过。数据分别保存于 `.artifacts/v8-all-final.log`、`v8-final-package-tests.log`、`v8-ui-states-final.log`。最终目录包ASAR为 `c28e3af741a9a94596c77146f8882b5d5d7ddf79a3298288211c9f8078fbc7a4`，转发器为 `b8b0160b04ae71db090d3f24605ef916abae132f9b6ceedd54c3578ae63788c9`；Git HEAD仅是基线，实际源码有未提交改动，另记录源码树散列，不把基线提交冒充最终构建。

v8首轮20秒活动+15秒空闲短测：三个MCP客户端、400个活动事件，Private Bytes峰值193.33MiB；报告/日志P95为24.64/26.24ms。时长门禁正确失败；该旧7PID口径还遗漏了随后发现的conhost，**仅作诊断，不作为正式性能验收**。目录 `.artifacts/bench/中文 测试-wrbX76`。此后按审阅修复的最终包必须重新执行300+300秒。

v8最终包完整标准测量：300.013秒活动+300.012秒空闲、6000个活动ACK/6003个持久事件，61/61个资源样本；报告/日志P95为27.56/25.37ms，CPU1.523%/0.082%，有效库6.72MiB，0崩溃/0采集器重启。**Private Bytes峰值222.047MiB，唯一失败门槛，整体验收失败。** 峰值在活动段295秒；发现时已经进入空闲段，不能把发现时间当峰值发生时间。目录 `.artifacts/bench/中文 测试-FZX54b`。三转发器占用约4.1MiB/实例，主进程仍是主要成本。

v9进一步把主进程/共享MCP/collector共用的libuv I/O池由2减为1，保持同步SQLite独立JS线程，不改系统环境。已有独立Node对照表明原生池可有显著私有内存成本；当前变更仍以最终完整混合负载确认，不由旧单角色探针推定通过。标准门禁通过前不启动八小时。

随后实际进程树核对发现v8/v9的三个conhost没有计入旧7PID数值（瞬时合计约3.61MiB，不能直接加到不同时间点推定峰值）。v9当轮已排除，v8的222.047MiB仍只是原采样范围的失败下界。采样器改为计入所有后代，独立检查原请求PID是否缺失。转发器改为Windows子系统，保留宿主传入的stdio管道；真实SDK三客户端测试先观察到6个进程RED，修复后3个进程且四工具往返GREEN。此能力依据[GetStdHandle](https://learn.microsoft.com/en-us/windows/console/getstdhandle)和[SUBSYSTEM](https://learn.microsoft.com/en-us/cpp/build/reference/subsystem-specify-subsystem?view=msvc-170)接口，并以实际二进制验证。当前候选为v10，等待完整资源门禁。

## v10 最终标准资源结果

实际候选 `release/multi-mcp-final-v10/win-unpacked`，ASAR `c2ac93707b4876d2c950785cf9a0d514bf562555f51c7680da1f1ede24a8c348`，Win32转发器 `09154d23de94023a68013497cab2b2ccd61fc3f09b1b7967faf62d371c26265e`。源码树散列及未提交状态另存 `build.json`；不能把Git基线HEAD称为最终构建提交。

三条真实MCP stdio连接轮流报告，10个活动reporter任务加原生日志混合源；活动300.005秒、空闲300.010秒。采样器从产品角色PID扩展全部后代，连续122次采样（61/61），实际均为7个进程，整个PID集合保持一致，没有漏计控制台后代。驱动、采样器及其他应用排除，未从产品数值减去估算开销。

| 项目 | 实测 | 门槛与结果 |
| --- | --- | --- |
| Private Bytes峰值 | **217.418MiB** | ≤220MiB，通过；仅约2.58MiB余量 |
| 活动/空闲平均CPU | 1.263% / 0.0346% | ≤3% / 1%，通过 |
| 报告/日志P95 | 23.17 / 24.82ms | ≤1000 / 3000ms，通过 |
| 冷启动到可见 | 549.05ms | ≤3000ms，通过 |
| 活动ACK/持久报告事件 | 6000 / 6003（另3个控制事件） | 数量一致，通过 |
| 有效数据库/物理库 | 7045120 / 7045120字节，WAL=0 | 有效库≤100MiB，通过 |
| 崩溃/采集器重启/传输恢复 | 0 / 0 / 0 | 无失败掩盖 |

**完整29项数值及覆盖检查均通过，退出码0。** 原始目录 `.artifacts/bench/中文 测试-MbOipT` 的 `raw.json`、`verdict.json`、`resources.jsonl`、`storage.json` 和构建证明保留。它只证明本机固定合成负载，不证明真实AI估时准确率、全部宿主、物理输入或八小时；内存余量较小，仍需真实长测。

最终交付回归单次 **58文件/143项全部通过、退出码0**（`.artifacts/v10-release-regression.log`）；类型/lint、23份文档链接、来源登记和最终包22项界面检查通过。此前完整运行曾有esbuild原生辅助进程异常退出，受影响的存储测试独立补测通过，并又完成上述全量重跑；失败记录保留。守护夹具也替换了嵌套PowerShell，实际Node stderr/退出码、重复所有者和临时电源请求释放回归通过。这些是功能/工具链证据，不代替八小时。

2026-10-29 10:26启动该候选的默认用户目录实例，并通过受保护凭据实调原生转发器tools/list（4工具）。实际Codex配置经现有预览/备份/回执流程仅更新 `mcp_servers.codingSchedule` 的command/args，TOML语义核对其余配置不变。旧后台v7进程当时已不存在，退出原因本轮未定位；未以强杀旧程序来升级。已经加载的旧Node MCP连接保留，宿主须在安全点重连才换成轻量转发器，不能把新文件落盘称为旧进程已经降内存。

## 使用当前候选

实际目录候选：`release/multi-mcp-final-v10/win-unpacked/codingSchedule.exe`。先启动悬浮框，在设置中重新预览/应用本工具MCP条目，再在宿主安全点重新连接。现有Node进程不会因文件升级而改变；本轮不会终止正在开发的Codex宿主来强行回收内存。桌面完全退出后需按宿主重连，单独重连采集器无须重连MCP。

标准命令：

~~~powershell
node scripts/bench.mjs --exe release/multi-mcp-final-v10/win-unpacked/codingSchedule.exe --runs 10 --mcp-instances 3 --rate 20 --duration 300 --idle 300
~~~

标准门禁通过后，使用 `scripts/start-endurance.ps1 -Executable <同一候选EXE>` 跑真实8小时/2事件每秒/10活动任务+300秒空闲。脚本写 `.artifacts/endurance-current.json`，数据目录里的 `status.json` / `resources.jsonl` 记录进度和资源，最终以 `verdict.json` 与 `.artifacts/endurance-exit.json` 为准。有效数据库100MiB、峰值220MiB、增长20MiB及采样覆盖门槛不变。仅申请本测试线程的临时系统保持运行请求，finally释放；不改变系统电源策略，不新增自动通知。

物理睡眠、干净用户/VM、完整真实Claude/第三宿主、跨DPI/多屏仍未验收。原生崩溃失去Worker进程隔离的既有决定保持；共享SDK增加主进程职责，输入/输出与连接边界需要上述独立回归。

## 独立长测守护与最终运行

本轮先发现直接Start-Process启动的守护进程仍受Codex的Windows Job约束（查询标志0x2800，包含KILL_ON_JOB_CLOSE）；父PowerShell退出后子进程虽仍存活，不代表宿主退出时也能存活。BREAKAWAY试样仍留在外层Job，已移除这一不可靠启动实现。

当前启动器用同用户、非提升权限、交互会话中的Windows任务服务按需启动，触发器数量为0，不创建周期任务、LLM复核或通知。启动器先验证Node单一绝对路径与24.x版本，等真正driver ready后才报告启动成功。运行器持有工作区FileShare.None排他锁，初始化到终态都在独立清理finally内；任何verdict读取/解析异常都退出非零。临时保持系统运行请求在finally释放，具名临时任务自删除；入口及终态I/O失败不能绕过清理。日常试用实例也已从本轮工具Job迁移到系统服务启动，原进程正常退出，临时启动任务条目已删除而新实例仍存活；没有开启登录自启。

独立收尾审阅的3项P2（损坏verdict误报通过、初始化/状态I/O跳过任务清理、启动检查竞态）均已修复。6项生命周期专项通过；分别破坏失败判定、任务删除、排他锁的三个隔离变异体，均在对应负面回归失败。另有初始资源缺失和终态文件变为目录的真实失败测试。类型/lint通过。控制器源码变更不修改已完成217.418MiB标准门禁的应用二进制；应用构建与控制器各自保存散列。

10:31的宿主Job启动样本、10:49的控制器评审样本和一次Node多路径启动失败均保留并明确排除，未拼接成八小时。**正式新运行从2026-10-29 11:17:05（Asia/Shanghai）重新计时，预计19:22:21左右完成（含300秒空闲），仍未验收。** 独立数据目录 `.artifacts/bench/中文 测试-TRSLD7`；初期真实报告、7个完整产品进程及服务父进程已核对。左侧为独立耐久实例，日常悬浮框保留右下；按ant-design-ux布局与就地反馈原则分离测试干扰，非React技术栈和生产交互保持。

13:23用户要求停止并自行关闭测试，随后核对所有测试进程均已退出，删除残留临时任务条目，状态改为cancelled/user_requested_stop。15114个ACK及原始数据保留，不计为八小时通过，也不会自动重启。后续共享目录接入修复见[新记录](shared-profile.md)。

当前状态以 `.artifacts/endurance-current.json`、所指 `status.json` / `resources.jsonl` 为准；验收必须同时读取真实 `verdict.json` 和 `.artifacts/endurance-exit.json`。不能把running、预期结束时间或初期低内存当作八小时通过。临时启动器父进程/交互会话和无触发器已实调，当前Codex客户端未被重启；物理睡眠、注销、系统重启、干净VM和完整多宿主AI流程仍未验收。

## v10 分发核对

目录、ZIP和安装包位于 `release/multi-mcp-final-v10`。ZIP为187727135字节（179.031MiB，≤180MiB），SHA-256为 `253e846ce19fb669fa3913874f71435a34e66de0d6a5fbcde690c344b1fcfb6a`；NSIS为146453499字节，SHA-256为 `befc6a50b8cf8552a7117d55cd40d955169fe42ee2fd07f96e67ceb3e00e5f4e`，实际Authenticode=NotSigned。ZIP内ASAR、原生转发器及兼容Node桥接文件的SHA逐项等于已测构建。后续控制器证明和当前长测入口在伴随manifest及项目报告更新，不把包内较早状态当作实时结果。v10本轮未重新执行安装/卸载现场流程，原有安装证据仍按版本区分。
