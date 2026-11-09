# Claude Code 真实会话进度与估时验收

日期：2026-10-30（Asia/Shanghai）；当前日常运行包 `release/claude-countdown-final-v22/win-unpacked`，Windows / Electron45。第二轮原 agent 汇报及后续原生窗口倒计时补验已通过。耐久保持用户取消，不启动后台长测。

## 实际接入缺口与修复

最初 Claude 用户配置没有 codingSchedule MCP、个人 Skill 或默认汇报规则。已补入 `~/.claude.json` 的 owned MCP 条目、`~/.claude/settings.json` 的异步 PostToolUse handler、`~/.claude/skills/coding-schedule-report/SKILL.md` 及 `~/.claude/CLAUDE.md` 独立标记块。使用既有预览、冲突校验、备份和撤销回执，其他配置语义及原规则保留，未修改权限、凭据或重启现有业务会话。四工具经实际 stdio 发现。

独立 Claude Code CLI 2.1.278 实际启动后已发现 MCP 和 Skill，但模型请求返回 403，未执行任务；此失败保留，不能用登录状态或 SDK 成功宣称端到端通过。用户确认实际入口为 Claude 桌面 Code，后续通过该入口创建合成任务验收，不操作既有业务会话或复制其认证。

## 第一轮桌面 Code

真实桌面 Code 内核 2.1.308，在临时目录执行普通去重开发请求；提示词没有指定进度工具或估时。原 agent 自行调用 Skill、progress_begin/context/report，日志与 reporter 按公开引用自动归并，悬浮框现场显示同一任务的 17% 计划和动作。独立复核其输出的 7 项 Node 测试通过，原会话最终回复测试结果；报告失败没有阻止主任务完成。

本轮估时未通过：agent 在同批 plan.replaced 后提交旧计划版本的 eta.answered，得到 STALE_ETA_REQUEST，不能把被拒绝的 15–120 秒范围记为有效估时。未替 agent 作答、手动标记完成或清库。

另从真实记录发现桌面 Code 写入 api-request-blob，内含历史工具消息。旧适配器会重放这些归档消息，并遗漏 mcp__ccd_turn__update_plan 的 items/scope 计划。现仅处理实际 assistant/user/system 记录，工具调用/返回限定对应角色，支持已观察的 first_task 完整计划；未知 scope 仍为部分计划。新增反例先失败，修复后通过。

Skill 已明确普通步骤更新和版本变更后的 ETA 提交顺序，安装副本先备份再同步。MCP 的 STALE_ETA_REQUEST 响应增加原子拒绝与恢复提示，不放宽版本校验。三宿主真实 stdio 回归确认拒绝后序号与原计划不变。

## 第二轮桌面 Code：自动汇报通过

用户明确授权信任 `.artifacts/ClaudeCodeAcceptance-round2` 后，在该隔离目录提交一条普通库存汇总开发请求；提示词没有要求使用报告工具或提供时间。原 Claude agent 自行启用 `coding-schedule-report`，完成真实 `progress_begin → progress_context → progress_report → progress_finish`。四类调用均成功，估时提交和完成返回 `accepted:true`，无 STALE_ETA_REQUEST 或 FORBIDDEN。

真实计划从17%更新到100%；context读到Hook渠道的初始估时问题，原 agent 提交5–30秒范围并被接受。只读观察得到3个活跃估时样本且范围递减。原会话最终仅回复测试结果，13/13通过；独立执行合成目录的测试也通过。reporter与该原生session/turn自动关联，没有手动配对、代答估时、清库或追加追问。证据：`desktop-round2-final.json`、`desktop-round2-observation.json`。

## v22 原生窗口补验：倒计时及省略时间通过

第二轮暴露过“计划100%仍进行中时，窗口用等待收尾覆盖有效ETA”的显示问题；v22已保留有效倒计时。完成步骤不再清除最后有效agent估时，真正产生新估时的未完成步骤仍能更新依据；20项相关回归通过，见 `countdown-final-tests.log`。该历史回归不代表当前正在修改的其他界面代码已完成验收。

2026-10-30 13:31–13:34（本地时间），在同一已信任目录新开隔离Code任务，提交一条普通 `sortBySku` 开发请求。期间没有进度提醒、估时追问或对原 agent 的消息注入，也没有操作其他业务会话、修改宿主配置、重启日常窗口或启动耐久。

- 新会话再次自然调用Skill及四类报告工具，所有提交成功，计划17%→83%→100%。原agent只提交一次20–120秒估时；后续普通进度报告不包含时间，仍成功接收并保留倒计时。
- 实际日常v22窗口现场截图：83%时显示剩余 `00:12–01:52`，之后100%待收尾时显示 `00:08–01:48`，均为AI粗估。截图期间没有新的估时覆盖；完成后Claude任务退出活动列表，窗口恢复展示其他活动任务。
- 新任务最终回复19/19通过，独立重跑也是19/19；日志审计仅1条用户请求，没有估时聊天播报，`progress_finish`成功、精确来源关联存在、数据库 `quick_check` 正常。只读观察器自行结束，未留下轮询进程。

本次没有新增产品代码；对已有运行包补齐了实际Claude任务、原agent时间答复、报告省略时间和原生窗口显示的联合证据。现场证明文件为 `desktop-countdown-final.json`、`desktop-countdown-observation.json`、`native-countdown-visual-proof.json`、`native-countdown-{a,b}.png`，均在 `.artifacts/claude-real-20261030/`。可访问性文本存在缓存滞后，倒计时视觉结论依据对应真实窗口截图，未用过期树文本替代。

## 验证边界

- 两个解析反例先失败；估时恢复提示的三宿主反例先失败，随后六文件 21 项相关回归通过，含实际 Electron 窗口、自动关联、Hook 和三类 MCP。类型检查、lint、v20 目录构建与启用通过。
- 第二轮工作区信任已获得用户对确切目录的明确授权并完成，不再属于待验项。独立CLI的403账户余额不足结论仍保留；桌面入口成功不证明CLI已恢复。
- 第二轮和补验各只提交1条开发请求，不在运行中向agent追问；宿主仍可显示工具卡和审计记录。未单独测量全过程前台句柄稳定性，不外推所有环境都绝不抢焦点。
- 只读观察器均已结束，没有修改来源日志或调用额外模型。未重跑完整资源门禁、安装器、八小时、跨版本或AI估时准确率验收。阶段五尚不能据本项通过宣称全部关闭。

证据在 `.artifacts/claude-real-20261030/`：`activation{,-v20}.json`、`result.json`、`desktop-observation.json`、`desktop-binding-diagnostic.json`、`skill-plan-order.json`、`desktop-parser-red.log`、`eta-recovery-red.log`、`final-related-tests.log`、`typecheck.log`、`lint.log`、`package-v20.log` 和 `backup-v20.json`。观察阶段的归档重复应以角色过滤后的原始工具调用审计为准；不能据归档出现次数推算模型重试次数。审计不保存私有 resumeHandle 或原始聊天全文。

来源：个人 Skill 与用户 MCP 分别参见 [Claude Skill 文档](https://code.claude.com/docs/en/skills)及 [MCP 文档](https://code.claude.com/docs/en/mcp)；异步 Hook 不使用 asyncRewake，其交付边界参见 [Hook 文档](https://code.claude.com/docs/en/hooks)。配置说明不是当前会话通过证据。
