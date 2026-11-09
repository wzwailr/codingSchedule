# Codex / Claude 一键接入

2026-11-02，本地 v39，Windows x64。使用现有 Electron、HTML/CSS/TypeScript；未推送或发布，未启动耐久测试。

## 使用路径

- 安装版在安装目录之后提供默认勾选的 Codex / Claude 自动接入选项；安装结束前使用包内 Node 执行统一 setup-cli，不要求系统 Node 或 Zig。取消勾选或静默参数 `--skip-integrations` 可跳过。
- 便携版启动后进入“接入 / 设置”，顶部“一键配置 Codex 与 Claude”完成同样操作。配置齐全后显示“重新检查并修复”；路径和整体撤销位于“查看路径与撤销”。保留逐项接入和通用 MCP 高级入口。
- 两宿主各安装 MCP、汇报 Skill、默认启用规则、异步估时 Hook，共八项；不安装 AI 客户端、不登录、不购买额度、不重启宿主、不改变审批权限。
- 界面只声明配置齐全，提示在方便时重新连接或重开 AI 工具，再确认实际汇报。没有模拟“已连接”或保证所有模型遵从；宿主工具卡与审计记录仍可能显示。

## 文件与安全恢复

默认使用当前 Windows 用户：Codex 的 `config.toml`、全局 AGENTS 规则与 `hooks.json`；用户级 Skill 位于 `~/.agents/skills/coding-schedule-report`。Claude 的用户 MCP 位于 `~/.claude.json`，Skill、CLAUDE.md、Hook 位于 `~/.claude`。支持 CODEX_HOME、CLAUDE_CONFIG_DIR；后者的自定义 MCP 为该目录内 `.claude.json`，已用实际 Claude CLI 读取验证。

非空 Codex `AGENTS.override.md` 优先于 AGENTS.md，因此把有界规则块追加到实际生效的 override。依据：[Codex 全局指令优先级](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[用户级 Skill 位置](https://learn.chatgpt.com/docs/build-skills)、[Claude MCP 用户范围](https://code.claude.com/docs/en/mcp)。不在业务项目里写规则。

- 保留其他 MCP、模型、权限、Hook、注释和规则正文；同名自定义 Skill / MCP、坏格式或被修改的受管块会阻止整体安装，不强制覆盖。
- 先核对整组文件，再写私有恢复日志，随后逐项备份及原子替换，最后提交回执。中途失败自动回滚；进程退出后，下次接入或卸载会恢复未提交事务。恢复遇到外部冲突保留现场，不覆盖用户新内容。
- 重复安装幂等，不堆叠回执；缺失组件可修复。安装目录变化可重新配置更新路径。撤销/卸载先核对整组，再移除本工具内容，保留后加的其他配置、原始会话日志和默认保留的进度库。
- 事务不是跨进程文件系统 CAS；外部进程恰在核对和替换之间写入的竞争窗口仍存在，备份和恢复日志是故障恢复手段。

## 本轮验证证据

- 类型检查、lint、生产 build、Windows 目录包、未签名 ZIP 和 NSIS 安装包构建通过。
- 8 个接入/Hook/卸载相关文件 20 项回归通过：已有配置保全、中文空格路径、重复安装、缺失修复、整体冲突、回执保存故障回滚、未完成事务及外部编辑恢复、NSIS 删除保护等。
- 7 个窗口/目录包文件 10 项通过：空白 HOME/USERPROFILE、受限 PATH、包内 setup-cli、两宿主实际 stdio 四工具、进度/估时到悬浮框、键盘一键配置、浅深色、偏好恢复、冲突及整体撤销；既有双视角、环扣、双翼和 ETA 回归通过。
- 实际安装的 Codex CLI 与 Claude CLI 在空白配置中识别用户 MCP；Claude 显示 Connected。这是配置发现与协议连接证据，没有调用付费模型，不冒充自然 Skill 触发。
- 另用编译后的 NSIS 实际 customInstall 宏在空白 HOME 执行自动配置及跳过路径，避免修改真实 Windows 注册表。结果见本地 `.artifacts/onboarding/installer-macro-tests.json`。
- 以上共 31 项，无跳过；最后对同一最终目录包重跑的两项一键接入窗口测试和一项 NSIS 宏测试与上述计数重叠，不相加。

本地原始结果与截图：`.artifacts/onboarding/integration-tests.json`、`window-tests.json`、`host-discovery.json`、`screens/`。目录包位于 `release/onboarding-final-v39/win-unpacked`；分发文件位于同级目录。

卸载器同时识别共享目录的 receipts.json 和未完成事务日志；即使安装后从未启动应用、尚无进度数据库，也会走正确的接入撤销目录。

边界：原生 UI 可访问树可读取，但真实鼠标操作返回 `GetCursorPos failed: 拒绝访问 (0x80070005)`；原生点击未通过。Windows Sandbox 功能未启用，本轮是全新用户目录/独立配置，不是全新 Windows VM 或新账户的完整安装卸载；物理高 DPI、多屏、最新宿主自然 Skill/Hook 触发率、完整资源门禁均未重跑，耐久保持取消。

## 进度汇报 token 开销

使用真实包内 MCP 响应、两步骤中文合成任务，以及 `js-tiktoken 1.0.21` 的 `o200k_base` / `cl100k_base` 两种 BPE 编码。无付费模型调用，不读取业务聊天。分词方法参考 [OpenAI tiktoken](https://github.com/openai/tiktoken)。这是新增文本的代理测量，不是 Codex/Claude 的实际账单；两编码也不是 Claude token 数的上下界。

| 内容 | 新增文本 token，两个编码结果 |
| --- | ---: |
| 四工具 schema 与描述 | 2,106–2,167 |
| MCP server instructions | 211–212 |
| Skill 正文与元数据 | 1,651–1,655 |
| 全局默认规则 | 229–230 |
| 上述静态材料合计 | 4,197–4,264 |
| begin 参数与返回 | 194–197 |
| 一次 context + 首次估时报告 | 675–684 |
| 一次 context + 仅动作报告 | 594–608 |
| 一次 context + 步骤及动作报告 | 646–659 |
| 最后 context + finish | 559–566 |

例如开工、首次估时、九次普通步骤/动作更新、收尾，按本样本约增加 11,500–11,600 个文本 token（包含静态材料一次）。不要把它解释成账单总增量：每轮推理可能重复带入工具定义、规则和历史报告，实际输入 token 会继续累积；提示缓存影响计费，宿主封装、模型内部推理和上下文压缩未计。计划越长，context 返回越大。

当前节省策略：只在有意义的步骤/动作/等待变化汇报；首次可估后仅必要时修正 ETA；倒计时、随时间增长的显示进度、视角切换均在本地完成，不逐秒请求模型。

复跑入口：先在独立开发目录安装 `js-tiktoken@1.0.21`，再运行 `node scripts/measure-reporting-tokens.mjs --exe <候选EXE> --tokenizer <该包dist/index.js绝对路径>`；不增加产品依赖。原始计数仅保存各项统计，不保存私有 handle 或凭据，见 `.artifacts/onboarding/token-measurement.json`。
