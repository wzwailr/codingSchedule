# 参与开发

欢迎通过 Issue 讨论缺陷和改进，通过 Pull Request 提交代码。较大的界面或协议变更请先说明目标、影响范围和验证方法。

## 开发环境

Windows x64，Node >=24.15 且 <25。建议使用较短的本地检出目录，本机验收中深层路径触发过 Windows ACL 工具的路径长度限制。在仓库根目录执行以下命令。

```powershell
npm ci
npm run fetch:relay-compiler
npm run fetch:runtime
npm run build
npm run typecheck
npm run lint
npm run verify:docs
npm run verify:origins
```

构建和打包会下载固定版本的工具或运行组件，下载内容按锁定散列校验。首次使用请阅读下载组件的许可。详细入口见[开发说明](docs/development.md)。

## 修改与验证

保持变更范围明确，复用现有模块并清理被替代的代码。修改后运行相关测试，记录实际执行的命令、结果和跳过项。

```powershell
npx vitest run tests/domain tests/storage tests/adapters
```

打包测试以实际候选目录为准。没有目录包的环境中，部分安装专项会跳过。Electron 使用 `SCHEDULE_TEST_PACKAGE_DIR` 指定目录包，WebView2 的隔离安装使用 `SCHEDULE_WEBVIEW2_TEST_DIR`。方法见[WebView2 验收](docs/verification/webview2-migration.md)。

窗口 DOM 测试与真实 Windows 输入、焦点、点击穿透和多屏验收分别记录。性能报告应计入全部子进程和 MCP 实例。长时间耐久及真实 AI 调用需单独安排，后者可能消耗登录账户的额度。

## 提交材料

- 说明触发条件、修改后的行为和验证证据。
- 测试使用合成任务及临时配置目录。删除日志、截图中的身份、路径、任务内容和凭据。
- 保留第三方 LICENSE、NOTICE 和来源记录。修改被登记的复用单元时，更新 `third_party/origins.json` 并运行来源检查。

项目自身代码采用 [MIT License](LICENSE)，第三方内容按各自声明分发。安全问题请遵循[安全反馈说明](SECURITY.md)。
