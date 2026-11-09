# 接入与后台报告

2026-10-29补充：Windows默认共享数据改为 `%USERPROFILE%/.coding-schedule`，避免宿主AppData重定向分离数据库和凭据。升级后重新预览/应用本工具的接入条目；不要手工混用两处数据库/WAL或令牌。当前聊天的既有连接可临时对齐，后续安全点重连后使用新的明确路径，见[共享目录与真实接入](verification/shared-profile.md)。
更新：2026-10-27。适用当前 Windows 开发/目录构建；真实宿主自动触发率与完整安装仍待验收。新增原任务 agent 估时询问，见下方接入步骤与边界。

## 首次接入
推荐使用设置顶部“一键配置 Codex 与 Claude”，同时完成两宿主 MCP、用户级 Skill、默认汇报规则、异步估时 Hook 的安装，支持检查/修复和整体撤销。安装器默认勾选同样的接入选项，可取消或用 `--skip-integrations` 跳过。支持 CODEX_HOME、CLAUDE_CONFIG_DIR 和 Codex 全局 override；不改审批权限、不重启宿主。配置完成不等于模型已加载或每次必然汇报，见[本地验证与 token 开销](verification/one-click-setup.md)。以下逐项步骤作为高级接入与手动回退。

普通启动自动检测 CODEX_HOME/sessions 与 CLAUDE_CONFIG_DIR/projects（未设置环境变量时为 ~/.codex/sessions 和 ~/.claude/projects）。悬停悬浮框 → 接入/设置，可关闭来源或修改路径；显式关闭的来源不会读取。隔离 --data-dir 模式仍需显式启用。只读有界候选，不修改原始 JSONL、不扫描整盘；无完整计划时进度未知。

后台报告接入中选择宿主和配置路径。预览只显示本工具新增的 command/args 与 owned key，不返回整份原配置或 token。确认后备份、检查 hash 并替换；预览后文件改变则拒绝。撤销只处理仍匹配的本工具条目，后来修改过的条目需人工核对。

Codex 使用 config.toml 的 mcp_servers 表，已依据[官方 Codex MCP 文档](https://learn.chatgpt.com/docs/extend/mcp)及本机 codex mcp add --help 核对。Claude 使用 mcpServers，用户级可选 ~/.claude.json，项目级可选 .mcp.json，见[官方 Claude MCP 文档](https://code.claude.com/docs/en/mcp)。通用导出的 mcpServers 键须按第三宿主自己的 schema 适配，不能外推为所有客户端兼容。

程序不自动执行宿主安装命令、不重启 AI 工具；应用后按宿主说明重新连接。路径以 command/args 数组提供，不拼接 shell；凭据仅通过受保护本地文件引用。

## MCP / CLI
四工具为 progress_begin、progress_report、progress_context、progress_finish，stdout 仅UTF-8换行JSON-RPC。Node入口使用官方SDK2；Windows原生入口从同一SDK生成工具schema、instructions和支持的协议版本，自行处理有界stdio信封，业务payload原样交给已有HTTP鉴权与schema校验。一个连接服务多个任务，必须显式携带各自handle。凭据和resumeHandle不进入悬浮框。

Windows原生入口在有合法reporter凭据时，即使后台离线也能完成initialize／tools/list。业务调用暂不可达返回UNAVAILABLE，保持同一stdio进程；下一次自然调用重读凭据和endpoint，后台新端口恢复后无需再重连。不会自动重放写入；不确定ACK仍使用原ID、原seq、原body恢复。旧版已关闭的连接不能被新文件复活，升级后按宿主方式重连一次。原共享SDK管道服务已退出生产路径。

通用启动结构，替换为设置预览里的绝对路径：
~~~json
{"command":"<resources/bridge/mcp-relay.exe>","args":["--connector","generic-reporter","--credential","<connector.json>","--endpoint","<endpoint.json>"]}
~~~

既有 Node MCP 和 CLI 入口保留，可手动使用：
~~~json
{"command":"<codingSchedule.exe>","args":["--optimize-for-size","--initial-old-space-size=8","--heap-growing-percent=10","--max-semi-space-size=1","<resources/bridge/main.cjs>","--mcp","--connector","generic-reporter","--credential","<connector.json>","--endpoint","<endpoint.json>"],"env":{"ELECTRON_RUN_AS_NODE":"1"}}
~~~

Node 参数用于软性回收策略。旧 Node 进程不会因为升级文件而变成轻量转发器；请在设置重新预览并应用本工具条目，再在安全时按宿主要求重新连接。多实例 220MiB 门槛针对实际启动配置另测，不能由单实例结果外推。

CLI 读取 stdin JSON：
~~~powershell
$previousNodeMode = $env:ELECTRON_RUN_AS_NODE
try {
  $env:ELECTRON_RUN_AS_NODE = '1'
  '{"idempotencyKey":"<fresh-UUIDv7>","title":"本次任务"}' | & '<codingSchedule.exe>' '<resources/bridge/main.cjs>' begin --connector generic-reporter --credential '<connector.json>' --endpoint '<endpoint.json>'
  & '<codingSchedule.exe>' '<resources/bridge/main.cjs>' new-key
} finally { $env:ELECTRON_RUN_AS_NODE = $previousNodeMode }
~~~

begin 返回 handle；context 返回 nextSeq。report/finish 使用该序号及新 UUIDv7 reportId。ACK 不确定时只重试同 ID、同内容；冲突后重新判断当前工作，不盲目换序号覆盖。CLI 退出码：0 成功、2 参数/协议拒绝、3 服务不可用。应用未启动时报告失败，AI 继续主任务。

## 后台汇报 Skill
入口为 [coding-schedule-report](../integrations/skill/SKILL.md)。MCP 配置成功只代表工具可用，不会自动让所有会话调用工具。Codex 跨项目使用时，将该目录中的 SKILL.md 安装到 `~/.agents/skills/coding-schedule-report/SKILL.md`；用户级 `~/.codex/AGENTS.md` 可添加有边界的默认汇报规则：多步骤开发、排障、研究与项目状态核对任务，在四个进度工具可用时使用该 Skill，不再逐任务询问；用户明确关闭时跳过。保留原有规则，修改前备份，不修改业务项目文件或审批策略。

Codex 会自动发现 Skill 变化，见[官方 Skill 说明](https://learn.chatgpt.com/docs/build-skills)。已执行中的 agent 不因此获得即时注入；下一轮仍须检查实际 begin/report/context/finish，安装成功不能代替自然触发验收。仅安装 Skill 而没有适用的默认启用规则，仍取决于模型是否选择该 Skill。当前已结束的轮次不补造计划、百分比或原 agent 估时。

它在开工、真实计划/动作变化、等待和收尾时报告，报告前读context取得nextSeq；不为未变化的ETA定时取件，也不要求每次进度汇报携带时间。首次可合理估计时提供一次，后续仅必要的时间修正主动提交；倒计时由本地窗口完成。工具卡和审计记录由宿主管理，压缩沿用同handle，子代理不共享句柄。

Claude Code 还需在自身宿主安装同一份 Skill：`~/.claude/skills/coding-schedule-report/SKILL.md`，并在用户级 `~/.claude/CLAUDE.md` 的独立标记块启用默认汇报；不会读取 Codex 的用户级规则来获得这项能力。MCP 用户条目在 `~/.claude.json`，异步 Hook 在 `~/.claude/settings.json`。本机已备份并安装这些 owned 条目，保留其他配置与权限。适用本机 Claude Code；Cowork、云会话及其他配置目录需分别接入。新会话可核对自然触发，正在执行的旧会话不强行重启或注入消息。实际验收状态见[Claude 桌面 Code 验证](verification/claude-code-real-session.md)。

估时引用绑定 context 返回的计划版本。普通步骤完成优先用同版本 `step.updated`；必要的 `plan.replaced` 先单独提交，再读取 context 后修正估时，不把旧版本答复与新计划混在同批。`STALE_ETA_REQUEST` 表示整批已拒绝，不能把它当丢 ACK 原样循环重试；最新版本的错误响应会给出恢复提示。

## Hook
integrations/hooks/claude.cjs、codex.cjs 配套 common.cjs。传入 --credential 与 --endpoint，读取宿主 JSON，成功 stdout 为空；网络截止 350ms、进程硬截止 700ms、失败退出 0，过滤 progress_* 和本工具 helper。

只使用白名单生命周期和可信 session/turn/call 路由。缺 turn 时只允许由已存 transcript call 精确查回；未知 call 或无 turn 的 Stop 忽略，不猜最近任务。Hook 不是独立完整计划来源，日志仍是被动计划基础。

旧式活动 Hook 仍可手动配置。设置新增 Codex / Claude 的“后台估时询问 Hook”预览和可撤销安装，只添加带 `--coding-schedule-eta` 标识的异步 PostToolUse handler。保留已有 Hook/notify，不覆盖它们。fail-open/exit0 不等于采集或询问成功。

## 原任务 agent 后台估时

1. 在设置接入对应 MCP。任务原 agent 通过 progress_begin 创建整体任务并私有保留 handle；MCP 服务 instructions 与报告 Skill 说明估时取件和回答方式。未接入 reporter 的日志观察任务不能自动获得语义估时。
2. Codex / Claude 如需原生安全点交付，再选对应“后台估时询问 Hook”，核对路径、预览并应用。默认分别为 `~/.codex/hooks.json`、`~/.claude/settings.json`。宿主需正常允许本地报告工具和信任Hook；程序不改变审批策略。通用MCP不需Hook，在正常报告或必要改时前读取context即可。
3. 已启用日志来源时，采集器从该原生工具调用的实际返回结果读取公开任务引用，自动关联当前轮次。Codex代码包装若隐藏返回值，汇报Skill会在同一次工具结果里输出`codingScheduleBinding:{runId,generation}`；不输出resumeHandle或凭据，不新增聊天消息。缺少该证据时可在设置手动关联，不能按标题、目录或时间猜测。后台Hook仍需匹配provider/session/turn和已记录的transcript call。未来轮次独立，原agent继续同一整体任务时由其新轮次的引用再次确认；解除关联取消旧问题。

没有任何可用估时时，产品最多生成一次初始etaQuestion，仍有120秒有效期；不再按间隔反复询问或因未知答复、计划变化而重问。context另提供可选etaUpdate:{requestId,planRevision}，它是主动改时通道，不是要求答复的问题。原agent仅在必要时，用同一个progress_report/eta.answered字段提交该引用与新的remaining ACTIVE秒区间；原有四工具和输入结构保持。计划改变或暂停会撤销旧引用，当前私有handle仍是鉴权依据；过期问题、旧计划和其他任务的答复拒绝。

计划先验、校准或AI答复只要产生过有效范围，就保留最近值并按秒倒计时；普通报告省略时间、range:null、部分计划、活动陈旧或重连不清空已有值。有效新范围重新锚定计时；等待/暂停冻结，到零显示超时时长而不伪称完成。时钟不连续时保留最后可核实的剩余量，恢复后继续计时。估时不会制造进度或刷新工作活动，工作过期提示仍独立保留。渲染每秒本地刷新，不增加模型调用。验证见[倒计时保留与按需改时](verification/eta-countdown.md)。

带 `--estimate` 的 Hook 仅请求估时，不写活动事件。350ms 网络 / 700ms 进程截止、失败 exit0；有问题时 stdout 为单行 JSON additionalContext，无 systemMessage、block 或 asyncRewake。长工具期间交付会等待；空闲会话不会被唤醒。工具卡、Hook 调试和审计日志是否显示由宿主管理，不能承诺“系统完全不可见”。

两种原生路径依据 [Codex 后台 Hook](https://learn.chatgpt.com/docs/hooks#run-hooks-in-the-background)与 [Claude 后台 Hook](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background)接口；实际版本、信任与登录状态须另行验证。MCP 协作取件不能外推为任意 AI 工具的主动推送。没有额外 LLM、sampling 或新会话；不会通过向现有聊天追加用户消息询问。

## 自动关联与手动回退

同一会话的日志观察与MCP汇报关联后，列表只保留一项，保留reporter计划和AI估时。自动关联仅接受与本工具begin/context调用对应的有效结果；Codex支持真实input_text结果数组及代码包装公开标记，Claude支持工具结果。错误、无匹配调用、歧义引用、旧generation和其他会话已占用的引用不关联。关联与日志游标同事务提交；不保存原始工具输入、私有句柄或模型正文。

经授权使用本地降级报告时，`binding`操作先校验私有handle和connector，再签发仅绑定实际provider/session/turn/item或call的十分钟回执。仅同一原生工具调用的成功结果可消费；跨会话、跨轮次、跨调用复制、过期和伪造不关联。回执必须是独立JSON行。raw context不附加listSnapshots的关联装饰，不能仅凭该字段缺失判定未关联；同时核对collector投影与实际窗口。

会话标签采用“项目名称 · session名称”，缺字段分别显示“未知项目”“未命名会话”，不显示编号。Codex名称读取有界session_index.jsonl并缓存；Claude Code读取匹配sessionId的custom-title元数据，头部最多64KiB、尾部最多256KiB，改名会刷新，不从消息正文猜名字。Claude Code发现阶段先排除subagents目录，避免子 agent 挤掉主会话的有界候选位置。日志识别和工具协议回归不代表Claude真实模型已自然调用汇报工具，见[验证记录](verification/eta-countdown.md)。

同窗口选择整体 reporter 任务和已捕获的原生轮次。重放/跟随指定 turn 的动作，并允许已安装的估时 Hook 向该原 agent 投递问题；不覆盖 reporter 计划或等待状态，未来 turn 独立。缺可信身份或完整回放时拒绝关联。解除后原生快照继续存在。曾跳过原始记录的轮次即便后来获得新计划，也不能据此声称整轮历史完整。

## 限制
配置替换前再次校验 hash 并原子 rename；不合作进程若恰在最终检查和 rename 间写入，文件系统没有跨进程 CAS，仍有竞争窗口，备份保留供核对。Hook、Skill、MCP 是不同能力。目录包和本机回放通过不代表真实 AI 自动报告、IME、多屏/DPI、物理睡眠或最终性能已验收。


## Codex 非交互审批

本机 Codex CLI 0.154.0 的默认非交互策略会拒绝需要审批的写入型 MCP 工具。官方支持服务器级 `default_tools_approval_mode` 和逐工具 `tools.<name>.approval_mode`，见[官方 MCP 配置](https://learn.chatgpt.com/docs/extend/mcp)。阶段五隔离测试仅在自己的四工具服务器命令参数中明确设置 `approve`，没有降低 shell 沙箱或修改真实配置。交互宿主中应由用户按需要批准这些本地报告工具；程序的自动配置预览不替用户开启免审批。
