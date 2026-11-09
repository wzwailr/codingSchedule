# Third-party notices

Project-authored code is licensed under the root MIT LICENSE. Third-party code and redistributed components retain the licenses and notices listed below. Windows binaries are unsigned development candidates.

- Electron 45.0.0: MIT; the Electron distribution also includes Chromium and its third-party notices.
- Node.js v24.22.0: the full upstream LICENSE is retained under resources/bridge-runtime. The Electron package shares Electron's Node runtime. The WebView2 package includes a private node.exe for the collector, hooks and helper CLIs.
- Microsoft WebView2 SDK 1.0.3537.50: the WebView2 package includes the x64 loader and retains the SDK LICENSE and NOTICE beside the executable. The installer carries Microsoft's Evergreen bootstrapper for machines that need the shared Runtime.
- MCP TypeScript SDK server/client/core 2.4.0: upstream licensing is in transition from MIT to Apache-2.0. Preserve the full package LICENSE texts, including the transition statement and retained MIT contribution terms, under resources/third-party-licenses. Do not describe every bundled contribution as exclusively Apache-2.0.
- Zod 4.6.7: MIT, included under resources/third-party-licenses.

- CCAM / Claude-Code-Agent-Monitor, Son Nguyen, commit 3cb22ae4a4e2ca31145351e1d73e05d0ff41f2dc: MIT; selected locator/literal parser and adapted normalization. Full license and exact origins are in third_party/. The original snapshot store and application reducer are excluded.
- smol-toml 1.9.1: MIT; full text under resources/third-party-licenses.
- jsonc-parser 3.3.1, Microsoft: MIT; full text under resources/third-party-licenses.

Herdr, task-progress-reporter and claude-how-long are prior art, without copied runtime code. AgentHUD/Agent Island code and assets are not copied.

Build-only tools and test drivers are listed with exact versions in package-lock.json. These tools are not evidence that production integration or human UX acceptance passed.

## 分发依赖清单

打包时从锁文件生成 resources/dependency-notices/dependencies.json 及完整 LICENSE/NOTICE 副本，覆盖生产 bundle 的 16 项 npm 依赖。项目 MIT 许可位于 resources/LICENSE，Electron/Chromium 许可随运行时分发，Node 的完整 LICENSE 另存于 bridge-runtime。WebView2 包还保留微软 SDK 的 LICENSE 和 NOTICE。安装包与便携包均为未签名候选。
