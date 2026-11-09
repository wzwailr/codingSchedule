# WebView2 本地候选与验收

2026-11-06，Windows x64。v43 Electron 包和 WebView2 候选分开构建，候选保留现有双翼、贴边、进度与 ETA 前端。共享 TypeScript 控制器管理窗口状态和采集流程，C++ Win32 宿主管理 DirectComposition、输入、区域裁剪和托盘。编译复用项目的 Zig 工具链。安装包自带私有 Node v24.22.0，用于采集、SQLite、MCP 接入配置及 Hook。

## 安装

本地试用包在 `release/webview2-v1/codingSchedule-WebView2-0.1.0-setup.exe`，未签名。安装前退出使用同一进度目录的旧悬浮窗。安装器以当前用户运行，检测 Windows 版本、架构和 WebView2 Runtime 注册信息，并实际创建透明合成窗口。运行环境可用时直接复用，缺失或无法创建窗口时运行包内微软 Evergreen 引导程序，然后再次探测。补装需要网络，失败会在写入应用和 AI 配置之前停下。WebView2 是系统共享组件，首次补装的额外下载及缓存另计。[微软 WebView2 分发说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

默认配置 Codex 与 Claude Code 的 MCP、Skill、默认汇报规则和估时 Hook。安装器复用现有配置事务，只迁移可确认归属的命令，保留兼容的自定义接入和其他设置。冲突时可在应用设置中检查，也可以先跳过此组件。配置成功后，按需重新连接 AI 客户端以加载配置。卸载按安装归属撤回接入并保留进度库，迁移过的配置会回到上一个已记录的版本。保留旧版程序文件才能在回退后继续使用旧路径。

| 本机实测 | Electron v43 | WebView2 候选 | 减少 |
| --- | ---: | ---: | ---: |
| 安装包 | 113,927,266 B | 25,872,406 B | 77.3% |
| 解包载荷 | 328,443,076 B | 97,551,718 B | 70.3% |

## 构建和验证

开发环境使用锁定的 Node 和依赖。构建前运行 `npm run fetch:runtime` 与 `npm run fetch:relay-compiler` 准备项目锁定的运行组件及工具链。`npm run package:webview2` 输出本地候选，体积和 SHA-256 记录在同目录的 `manifest.json`。构建按 SHA-256 校验 SDK 与引导程序，另用 Authenticode 核实 Loader 和引导程序的微软签名。试用包与隔离安装器的 45 个应用载荷文件散列一致。

隔离安装器通过 `node scripts/package-webview2.mjs --test-installer --output=.artifacts/webview2-assessment/test-release` 生成，自动验收用 `SCHEDULE_WEBVIEW2_TEST_DIR` 指向此目录。隔离版使用临时用户配置和数据，跳过真实账户的快捷方式及卸载注册表项。验证使用 `vitest run tests/desktop/webview2.e2e.test.ts`、共享窗口相关回归和 `tests/integration` 下的 setup、config-patch 专项测试，另运行类型检查、ESLint 和文档链接检查。

验收包含 Runtime 实际创建、中文含空格路径、私有 Node、两套宿主共八项接入、保留用户设置、重复安装、卸载和进度库保留。真实 stdio 连接从两套配置经 MCP 转发器执行进度、动作、ETA 和完成流程。Win32 读取实际窗口的可见、置顶和前台状态，检查折叠态中心与透明角落的区域及命中。证据 JSON 位于 `.artifacts/webview2-assessment`。

最终窗口与隔离安装回归 13/13，配置与回退 14/14。类型检查、ESLint、构建和文档链接检查通过。两组测试结果分别记录在 `webview2-final.json` 和 `webview2-integration.json`，原生检查记录在 `webview2-e2e-proof.json`。

## 当前限制

- 220 MiB 进程树私有内存预算仍需解决。复用 Node 的 V8 内存配置，并在后台窗口使用 WebView2 低内存目标。最终短测中 12 个进程含原生宿主、私有 Node、WebView2 子进程和三个 MCP 转发器，私有内存单次采样为 267,079,680 B（254.7 MiB）。生产负载及耐久另行验收。[微软内存目标接口说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_19?view=webview2-1.0.2849.39)
- 原生鼠标连续拖动、展开及贴边恢复、透明区实际点击、透明度变化、键盘焦点恢复和高 DPI 多屏布局尚待交互验收。Electron 交互测试覆盖共用逻辑。
- 已有 Runtime 复用路径通过。缺失 Runtime 的在线补装、离线或策略阻断恢复，需要在干净 Windows 环境验证。
- Codex 和 Claude Code 使用各自配置启动的 MCP stdio 测试已执行。真实客户端重新载入配置、自动触发估时 Hook、界面实时显示内容仍需单独验收。
- 早期扩展回归中的 Electron 设置用例加载了旧候选包，该包缺少当前界面的 `#monitor-mode`。后续测试统一使用 `release/win-unpacked` 或指定的当次构建目录。边扣用例曾超时，随后复验通过。
