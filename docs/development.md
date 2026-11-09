# 开发与运行
默认开发入口是 Electron 悬浮窗。WebView2 和 Electron 共用悬浮窗界面、任务采集和接入配置。

## 启动
开发 Node 要求 >=24.15 且 <25。Electron 候选通过 `ELECTRON_RUN_AS_NODE=1` 复用内置 Node v24.22.0，运行 Hook、安装和卸载 CLI 及手动 Node MCP；其安装包从 `fetch:runtime` 产物中只取 Node 许可。WebView2 候选从同一产物带入私有 `node.exe` 与许可。两版的 Windows MCP 默认使用原生转发器。Electron 的 runAsNode fuse 必须保持启用，安装器仅为 helper 调用临时设置变量。
~~~powershell
npm ci
npm run fetch:runtime
npm run fetch:relay-compiler
npm run dev
~~~

Windows 构建使用 Zig 0.15.2 编译 Win32 MCP 转发器和 WebView2 宿主。`fetch:relay-compiler` 校验固定官方 ZIP 的 SHA-256 后解压到 `.artifacts/relay-compiler/fast`。首次使用先阅读其中 README.md 和 LICENSE。可通过 `SCHEDULE_ZIG_MIRROR` 指定官方列出的镜像下载根目录，或通过 `SCHEDULE_RELAY_ZIG` 指定相同版本的编译器。最终用户无需安装 Zig、Node 或 .NET。

悬浮框默认位于右下角，OLED点击或悬停展开详情翼；整块OLED可拖动，靠右边缘改向左展开，窗口形状与CSS共用几何模型。接入/设置在同一个窗口内，核对日志根目录后勾选来源并“保存并检测来源”。普通启动默认检测已知日志根目录，保留显式关闭选择；隔离 --data-dir 仍需显式启用来源，不改宿主配置。托盘可显示、隐藏、展开并聚焦、设置、重新连接采集器和退出；Escape 回到不聚焦的收起状态。仅查看旧固定数据样机使用 npm run dev:probe。新布局和原生验证入口见[双翼折屏](verification/fold-window.md)。

外观偏好单独存于数据目录的`appearance.json`，避免来源保存覆盖。主进程校验35%–200%尺寸与40%–100%不透明度，旧值保留，损坏值回默认。`screenMetrics`在35%／50%／75%处提供连续的物理几何，50%以下微型、75%以下紧凑；小屏独立字号，详情翼始终至少按100%字号显示。几何分别给出screenScale与wingScale，renderer仅缩放各翼内部内容，原生bounds／setShape使用实际DIP；不再全局transform缩小整套widget。拖动预览、结束原子保存，取消恢复原值；滚轮归一化并限速，setOpacity修改整窗。详见[三档验收](verification/density.md)。

## 验证
~~~powershell
npm run build
npm test
npm run typecheck
npm run lint
npm run verify:origins
npm run verify:docs
npm run probe:runtime
node scripts/probe-widget.mjs
npm run package:win
node scripts/probe-widget.mjs "--exe=release/win-unpacked/codingSchedule.exe"
npm run package:webview2
~~~

直接运行桌面或 stdio 测试前先构建。测试使用临时用户目录、真实 SQLite/HTTP 和官方 MCP 客户端。`package:win` 输出未签名 Electron 安装包、便携 ZIP、`win-unpacked` 和文件散列。`package:webview2` 输出 `release/webview2-v1`，包含 NSIS 安装包、解包载荷和清单。若该目录有意外文件，可运行 `npm run package:webview2 -- --output=release/webview2-review` 另选目录。两个安装包都带生产依赖许可。

可选 node scripts/probe-widget.mjs --native 会短暂移动鼠标，并恢复原位置。追加 `--input` 会创建独立测试输入窗，验证前台及 20 次合成英文输入后关闭，不能证明物理键盘或 IME。阶段五和新版均在单屏100% DPI得到20次有效原生hover/前台句柄证据；也保留了未受控前台改变的失败，不推广到多屏。旧 npm run probe:native 只验证原技术样机；这些操作不可与其他桌面自动化并行。

`node scripts/probe-ui-states.mjs [打包EXE路径]` 使用隔离数据目录和合成任务，检查浅深色、长内容、等待、未知、AI 声明完成、底部按钮、键盘和文字对比度，并生成 `.artifacts/widget-states` 截图。多任务固定时显式选择要观测的 reporter；不把另一任务仍在接收的报告误判为选定任务更新。测试标题≤80字、动作≤120字，沿用协议限制，不为截图放宽产品验证。

node scripts/probe-live.mjs 只读标准目录中少量现存日志，保存字段/事件数量，不保存聊天原文、会话标识值或完整路径。不发起新 AI 请求，不证明实时计划或 Skill 自动触发。

## 内部边界
Electron 安装包专项测试默认检查 `release/win-unpacked`。验证其他目录中的候选前，可在当前 PowerShell 设置 `$env:SCHEDULE_TEST_PACKAGE_DIR='release/electron-review/win-unpacked'`。未生成目录包时，依赖安装产物的测试可跳过。交付验证应指定当次构建并核对清单和散列，`bench --exe`、`profile-runtime.mjs <EXE>` 和 `probe-installer.ps1 -InstallerPath <setup>` 应指向同一候选。WebView2 的隔离安装方法见 [WebView2 验收记录](verification/webview2-migration.md)。

- collector Worker 线程是产品唯一 SQLite 写入者，拥有独立 JS isolate/事件循环；并发重连合并，等待旧线程退出再启动。原生崩溃与全局 OOM 没有跨进程隔离。renderer 无 Node、网络或任意文件权限；有限 IPC 校验本窗口顶层页面，敏感设置要求明确聚焦操作。窗口默认软件渲染，V8 从较小初始老年代开始回收并按实际存活数据增长；不设置小型老年代硬上限。实际内存/CPU 门槛仍须测量，不能从参数推定达标。
- openStore → begin → context.nextSeq → commit。begin 消耗 seq=1；reporter 携带完整 RunHandle，回执 hash 由服务生成，ACK 在 COMMIT 后返回。
- resolveNative 依据可信 provider/session/turn 持久映射；commitNative 原子提交本批事件、快照及解析断点。不得按 cwd/最近任务猜测路由。
- 原生文件版本与任务 revision 分开，换代时保留任务版本连续性；原始观察保持稳定身份以便去重。
- tick 维护活动时钟，不刷新 lastWorkAt；context 只读。重开先暂停，可信原生活动只恢复自身被动轮次。
- canVerify 仅由本地验收操作持有，HTTP/MCP 不能自报权限。计划完成、AI 完成和用户验收分别保留。
- source.diagnostic 是仅 transcript 可写的内部事件；sourcePartial 持久化并影响计划完整性。后续可信完整计划才能恢复进度。
- SQLite 迁移保留旧版本数据。v3 新增有界游标内容指纹，v5 新增任务关联回执。已有旧版库迁移前先做包含 WAL 的一致性备份，整个升级事务失败则回滚。日志只核对文件头和游标附近字节，任意中部篡改不在追加日志契约内。
- 第三方复用记录在 third_party/origins.json；修改受追踪单元时更新理由、散列和回归测试。

.artifacts、dist、release 是本地验证/构建产物，Git 忽略。长期证据见[阶段三、四报告](verification/phase-3-4.md)，操作说明见[接入说明](integrations.md)。回放、截图、组件测试与完整产品验收必须分开。

## 阶段五验证入口

~~~powershell
npm run package:win
npx vitest run tests/integration/package-smoke.test.ts
powershell.exe -NoProfile -NonInteractive -File scripts/probe-installer.ps1
npm run replay -- --runs 10 --rate 20 --duration 300
npm run bench -- --runs 10 --mcp-instances 3 --rate 20 --duration 300
node scripts/sample-eta.mjs
~~~

bench 另测 300 秒空闲，使用 Windows Private Bytes，当前v8主进程（含 collector Worker/共享SDK）、renderer、GPU、Network Service及3个常驻Win32 MCP转发器全部计入，驱动与采样器排除。逐项阈值失败或采样失败都会非零退出；原始样本在 .artifacts/bench。`--endurance --rate 2 --duration 28800` 执行用户确认的真实八小时负载，保留 100MiB 有效数据库预算；正常五分钟仍要求 20 事件/秒。不能用缩短时间或生成样本证明耐久。隔离候选包需另加 `--exe <实际 codingSchedule.exe 路径>`。

probe-installer 只在没有既有安装、快捷方式和真实接入回执时执行；临时当前用户安装/静默卸载会短暂创建并撤销本工具的 Windows 注册项。仍不代替干净用户、VM 或交互式卸载复选框验收。

`node scripts/probe-real-hosts.mjs` **会调用已安装并登录的真实 AI CLI，消耗该账户额度**，只在授权的集成测试中手动运行，默认测试不调用。练习只位于临时目录；只保存白名单审计，不保存工具返回的私有 handle 或聊天原文。`--mcp-only` 只测 Codex MCP，并通过本次命令参数预先批准该本地服务器四个工具，不改用户配置。完整代码任务仍受宿主沙箱、登录与审批限制。Cursor 未安装时不外推兼容。
