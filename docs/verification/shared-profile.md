# 共享数据目录、活动识别与真实进度接入

日期：2026-10-29，Windows 11；当前运行候选 `release/widget-reveal-final-v14/win-unpacked`。八小时耐久已由用户停止，本轮不重启。

## 根因与纠正

Codex 上下文和任务服务独立启动的悬浮框，对同一 `%APPDATA%/coding-schedule` 字符串读到了不同文件。前者读到的主库为1174页，后者为886页；前者的文件可在 Codex 包的 `LocalCache/Roaming` 中找到。外部检查把一处主库与另一处 WAL 组合，产生 `database disk image is malformed`。凭据也存在两份，同一 connector 的令牌不同，因此真实进度调用返回 `FORBIDDEN`。

独立服务上下文对实际运行库执行完整 `PRAGMA integrity_check` 返回 `ok`，使用该处凭据发送只读接口的空请求返回 `INVALID_SCHEMA`（400），而非鉴权拒绝（403）。诊断记录同时核对 Host、Origin、connector 类型和令牌匹配布尔值，没有输出令牌。此前将外部报错直接判断为真实库损坏的结论撤回；两次“恢复”写入的是宿主重定向副本，没有修复或替换独立窗口使用的健康真实库。

这与微软描述的 [AppData 按包重定向和合并读取](https://learn.microsoft.com/en-us/windows/uwp/porting/desktop-to-uwp-behind-the-scenes)一致。包身份 API 在本机辅助进程返回 unpackaged，不能凭这一项推定文件视图一致；根因判断依据实际文件内容和跨上下文接口结果。不是所有宿主或机器都已经复现。

## 实现

- Windows 默认数据目录改为 `%USERPROFILE%/.coding-schedule`；两种启动上下文已用随机标记交叉读回确认共享。显式 `--data-dir` 的隔离行为保持，非 Windows 默认路径保持。
- 首次迁移只读校验旧库，通过 SQLite backup 保存包含已提交 WAL 的一致性快照；保留来源目录、原凭据、设置、窗口位置及接入回执，不重置数据库。旧采集器仍运行、目标配置冲突或校验失败时停止迁移。
- 迁移有排他锁，先校验全部目标冲突，再提升配置和数据库；数据库最后提升。迁移标记避免用户清除进度后又恢复旧记录。新版本卸载选择共享目录，尚未迁移的旧安装仍使用旧目录。
- Codex 的真实 `task_started` 立即显示“准备响应”，无需等思考正文或首个工具；仅 turn_context/心跳仍不当作工作。无计划、无依据估时继续显示未知。本机原始记录存在约8.2秒启动空档。
- 当前已加载的旧 MCP 连接保持运行，只对本工具的旧引用做受保护、同身份的临时对齐；长期配置通过原有预览、备份和回执流程指向共享目录，不修改其他 MCP 条目或宿主审批策略。

## 验证状态

- 启动识别：16项专项及实际v11目录包窗口回归通过，先观察到缺少启动活动的失败，再修复。
- 迁移与卸载保护：9项通过，覆盖 WAL、凭据/设置保留、已有目标、不合法旧库、冲突、删除后不复活、运行中旧采集器与并发启动。类型/lint通过。
- 原生进度工具已实际接受本任务的 begin、context、report 及原 agent 对 etaQuestion 的答复；未使用另一个模型，未把 SDK 模拟结果当作原生目录验收。
- v13全量为156/157，一项设置焦点依赖失败；原有窗口文件随后单独4项通过。失败日志保留，不写成单次全量全绿。
- 14:33真实目录迁移完成：独立服务校验完整性通过，旧库67个run全部保留、缺失0，设置和5类凭据保留。旧实际目录保持。
- v14已于14:45启动，临时按需任务无触发器且条目已删除。既有Codex聊天未重启，同一私有任务句柄跨窗口重启后context/report及ETA答复成功；长期配置仅更新本工具command/args，其他配置语义一致，原生转发器四工具握手通过。
- 通过真实设置界面，把已明确核对的本任务与本聊天轮次关联；列表合并为一项，实际窗口显示计划80%及原agent的AI粗估区间。没有用最近目录猜归属，也没有另起模型或测试任务替代本任务。

## 悬浮框不可见的补充修复

现用窗口可见、未最小化、未被DWM隐藏且位于屏幕内，但实际WS_EX_TOPMOST为false，窗口中心命中Edge而非本工具。单独调用showInactive、moveTop、true/false重设均未解决。

核对 [Electron v45.0.0源码](https://raw.githubusercontent.com/electron/electron/v45.0.0/shell/browser/native_window_views.cc) 的SetAlwaysOnTop和MoveBehindTaskBarIfNeeded：Windows默认floating层级会将窗口放到Shell_TrayWnd后面，可能连同非置顶任务栏一起降级。改用Windows的screen-saver层级跳过此路径；没有提权、循环抢前台或调用其他应用。最终恢复入口只有showInactive、明确层级和moveTop，试探性重复切换已移除。

启动、托盘显示和第二次启动共用恢复入口。真实Electron测试先复现隐藏窗口不能恢复，再以Win32原生标记验证visible/topmost均为true，窗口仍不获得焦点。现场v14的窗口中心命中自身，真实截图和AX同时确认显示；设置关联后同一会话带计划和估时，历史列表不复活。普通窗口行为不等于所有全屏软件、DPI或多屏都已验收。

现场证据增加：`.artifacts/profile-layout/{shared-migration-service-check,shared-config-applied}.json`、`.artifacts/widget-reveal-live-native.json`、`widget-reveal-{red,green,final-tests}.log`。进程重启前先保留了包含已提交WAL的快照；当前数据库未清空。v14相关3文件19项全部通过，包含窗口恢复/焦点/重连、迁移和活动列表；类型/lint通过。旧全量焦点失败及三次无效恢复方法的记录保留，不升级为v14整套全量或完整资源通过。

原始证据：`.artifacts/profile-layout/real-profile.json`、`current-transport-aligned.json`、`.artifacts/shared-profile-{red,final-tests,typecheck,lint,full-tests}.log`。目录内的数据库、凭据和私有句柄不上传，不纳入知识库。

## 跨会话没有进度的后续核对

同日另一条真实会话在15:08:42至15:09:49运行约67秒。读取原始日志及共享库确认：开始和结束已被采集，状态为paused，但没有progress工具或原生计划调用，plan为null、进度未知；不是开始事件丢失，也没有证据表明该轮发生鉴权失败。此前只验通本聊天，用户级汇报Skill及默认启用规则缺失。

已将当前汇报Skill安装到`~/.agents/skills/coding-schedule-report/SKILL.md`，并在备份后向`~/.codex/AGENTS.md`追加独立标记块：多步骤任务在工具可用时默认汇报，明确关闭则跳过；未知计划/估时不造数，不唤醒或发消息给其他会话。原规则逐字节保留，源文件与安装文件一致。当前聊天随后收到包含新增规则的宿主上下文，但这不等于目标会话已自然触发。目标会话已结束的轮次不补造进度，下一次真实用户轮次的begin/report/context/finish仍待验。

安装与校验回执为`.artifacts/auto-report-{installation,verification}.json`。官方Python校验器因本机缺少PyYAML无法运行；使用项目既有js-yaml校验元数据及原规则/备份完整性。当前agent的原生进度和AI估时往返已实调通过。仅更新Skill和接入文档，不重启桌面程序、Codex或耐久；其他AI宿主的自动启用另验。

下一次真实任务已观察到原agent自然调用进度工具，但暴露原生观察与reporter分列的问题；后续自动关联与名称修复见[会话身份验证](session-identity.md)。
