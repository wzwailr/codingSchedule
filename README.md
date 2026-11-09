# codingSchedule

codingSchedule 是一个 Windows 任务进度悬浮窗，自动发现本机 Codex 和 Claude Code 的活动会话。悬停或点击状态屏可查看当前动作、计划和剩余时间。AI 可以通过 MCP 汇报进度与估时，窗口也会显示从会话日志观察到的活动。进度和估时缺少依据时显示未知，AI 完成与用户验收分别记录。

## 试用

当前可从源码构建两个 Windows x64 未签名候选。WebView2 安装器自动检测共享运行时，自带私有 Node，并默认提供 Codex 和 Claude Code 接入。Electron 候选支持安装版和便携版。切换版本前请退出正在使用同一数据目录的悬浮窗。

- [使用说明](docs/user-guide.md)包含启动、悬浮窗操作、升级和卸载。
- [接入说明](docs/integrations.md)包含自动监测、MCP、Skill、Hook 和撤销方法。
- [WebView2 验收记录](docs/verification/webview2-migration.md)列出安装包大小、实测范围和仍待验收的内存与原生交互。

## 从源码构建

在 Windows x64 上使用 Node 24.15 至 24.x。将下列命令在仓库根目录执行。

```powershell
npm ci
npm run fetch:relay-compiler
npm run fetch:runtime
npm run package:webview2
```

WebView2 安装包默认输出到 `release/webview2-v1/`。使用 `npm run package:win` 可构建 Electron 安装包和便携版。两种构建的详细步骤及验收命令见[开发说明](docs/development.md)。

设计、历史实现和验证证据收录在[文档索引](docs/README.md)。第三方组件与归属见[第三方声明](THIRD_PARTY_NOTICES.md)。

## 参与与许可

项目自身代码采用 [MIT License](LICENSE)，第三方组件保留各自许可。`package.json` 的 `private` 标记用于防止误发布到 npm。参与开发见[贡献指南](CONTRIBUTING.md)，安全反馈见[安全说明](SECURITY.md)，候选改动见[更新记录](CHANGELOG.md)。

WebView2 的完整进程树内存仍高于 220 MiB 目标，高 DPI、多屏和部分真实宿主流程仍有待验收。各项限制随[验收记录](docs/verification/webview2-migration.md)列明。
