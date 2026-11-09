# 更新记录

## Unreleased

首次开源候选基于 Windows x64 实现。

- 自动发现 Codex 和 Claude Code 活动会话，合并日志观察与 MCP 任务报告。
- 双翼悬浮窗、贴边环扣、活动视角切换、任务进度与持续 ETA。
- Codex / Claude 的 MCP、Skill、默认汇报规则与异步估时 Hook 接入。
- Electron 候选和 WebView2 候选，提供隔离安装与配置回退验证入口。
- 项目自身代码采用 MIT，保留固定版本第三方来源和许可。

WebView2 完整进程树内存仍高于 220 MiB 目标。高 DPI、多屏、缺少 Runtime 的干净环境及完整真实宿主流程仍有待验收。各项历史证据与限制见[文档索引](docs/README.md)。
