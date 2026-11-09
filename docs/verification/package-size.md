# Windows 包体精简

2026-11-03，本地候选 `release/slim-runtime-v43`。保留 Electron + HTML/CSS/TypeScript 与现有悬浮窗行为，无新增运行依赖、宿主权限调整或耐久测试启动。

## 改动及体积来源

旧 v41 解压目录为 471,620,909 字节（449.77 MiB），其中 Electron EXE 约 238.23 MiB、独立 Node EXE 89.53 MiB、全量 locale 48.82 MiB。业务代码与资源只占少量，缩减源文件不会解决主要体积问题。

- Hook、setup/remove CLI 和可选 Node MCP 共用 Electron 内置 Node 24.22.0，以子进程环境 `ELECTRON_RUN_AS_NODE=1` 运行。Windows MCP 默认仍为轻量原生转发器；没有把每个 MCP 恢复成 Electron/Node 常驻进程。
- 分发排除独立 node.exe 与旧运行时下载 manifest，保留完整 Node LICENSE。仅保留 `en-US`、`zh-CN`、`zh-TW` 三个运行时语言包。Chromium 的 ICU、图形/软件渲染组件与许可证继续保留。
- 安装、卸载 helper 在本进程环境中临时开启 Node 模式并恢复原值，避免后续普通 GUI 启动到 CLI 模式。Codex Hook 的 cmd/POSIX 命令和 Claude 的 PowerShell 命令分别设置子进程模式。
- 发现并修复 PowerShell 对 GUI 子系统 EXE 不等待的实际反例：Claude 命令通过 `Out-String -Stream` 管道等待，保留单行 JSON。未加管道的版本在真实 Hook 测试中返回空串，不能沿用为兼容配置。
- 受管旧 Hook 可以按回执迁移，保留宿主其他内容与后续用户编辑；未归属的冲突条目仍拒绝覆盖。运行中的旧 MCP/Hook 不会因新包生成而自动换路径，旧目录需在接入修复、方便时重连后再清理。

`runAsNode` fuse 需保持启用；本轮沿用既有默认状态，没有增加系统或宿主权限。参见 [Electron 环境变量](https://github.com/electron/electron/blob/main/docs/api/environment-variables.md) 与 [builder 语言过滤及压缩说明](https://www.electron.build/v26/docs/api/electron-builder.interface.configuration/)。未用 maximum 压缩掩盖冗余资源：builder 明确说明其大小收益通常不明显。

## 验证

类型检查、全目录 lint、生产 build、origin 核对通过。最终候选的十个相关测试文件 **22 项通过、零失败、零跳过**，结果在本地 `.artifacts/size/final-tests.json`：

- 隔离 HOME、限制 PATH 为 System32，不依赖系统 Node；两宿主共八组件安装、重复安装、受管旧配置迁移与撤销。
- Codex / Claude 的真实 stdio 客户端四工具目录、进度/动作/ETA 到悬浮框、正常 Electron GUI 启动、主题/结果反馈。
- 两宿主生成的异步 Hook 命令经 cmd / PowerShell 真实执行，准确关联原任务后读取估时问题，遥测与重复/无关调用不输出。
- 真实编译的 NSIS 安装宏覆盖默认/跳过、已有环境变量恢复、配置错误后环境恢复和原配置保留；独立卸载 CLI 撤销及拒绝递归删除参数。
- 便携目录复制到中文含空格路径后运行，退出后探针跟踪的应用与 MCP 进程均为零残留；截图位于 `.artifacts/size/final-screens`。这不是全部后代进程的资源门禁。

该轮不包含干净 Windows VM、完整安装器系统注册/卸载向导、自然模型触发率、高 DPI/多屏或扩大内存/CPU/耐久验收。没有改变窗口布局/裁剪/鼠标/焦点实现，也没有把 DOM/协议测试称作新的原生输入验收。

## 实测大小

| 项目 | 旧包 | 精简候选 | 减少约 |
| --- | ---: | ---: | ---: |
| NSIS 安装包（十进制 MB） | 146.7 | 113.9 | 22.3% |
| 便携 ZIP（十进制 MB） | 187.8 | 143.0 | 23.9% |
| 解压目录（二进制 MiB） | 449.77 | 313.23 | 30.4% |

压缩文件基线为最近已有完整分发 v40，解压目录基线为当前日常 v41；两者均为同一 Electron 45.0.0/Node 基线，v41只有目录包。最终安装包为113,927,266字节，ZIP为142,962,021字节，解压目录为328,443,076字节。完整差值及候选哈希以 `.artifacts/size/comparison.json` 和 `release/slim-runtime-v43/manifest.json` 为准。包内报告保留归档前近似值，仓库本页补录最终精确读数；生产代码与22项测试对应的app.asar保持一致，已核对ZIP内代码SHA-256、三语言清单、无独立Node及最新接入说明。

## 体积上限

剩余体积主要是 Electron/Chromium。若继续追求几十 MB 级分发，需要另行评估共享系统 WebView2 或原生 UI，重验透明异形窗口、鼠标穿透、拖动、边缘恢复、输入焦点与部署依赖；本轮没有进行技术栈迁移。下载体积、解压占用和运行内存是三个不同指标。
