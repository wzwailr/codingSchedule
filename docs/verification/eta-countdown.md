# 最近有效估时倒计时与按需修正

日期：2026-10-29，Windows11/Electron45，当前日常目录候选`release/eta-claude-final-v19/win-unpacked`。耐久保持用户取消。

## 行为

- 任一支持来源产生有效估时后保留最近值，按活跃时间倒计时。省略时间或明确返回null不清空；部分计划、计划修订、工作活动过期和重连也不使已有倒计时变未知。
- 新的有效范围或计划估时更新时重设锚点。等待/暂停冻结；到零显示已超时及超时时长，不宣称完成。时钟断点冻结无法核实的间隔，保留剩余量并在恢复后继续。
- 后端提供asOf，前端按每秒本地渲染递减，不依赖下一次模型回复或10秒快照。保留工作freshness提示，估时不充当工作心跳。
- 最多一次初始询问；已能从计划取得估时则不询问。后续context.etaUpdate是可选的主动修改引用，沿用现有eta.answered输入，无新MCP工具或消息注入。原agent仅在必要时修正，不需反复输出同一时间；未知首次答复也不触发定时重问。
- Skill与用户级owned规则已备份后调整，取消单为ETA的定时取件，原有其他规则保留。

## 验证

20项核心状态/显示回归先通过，随后15文件47项相关回归通过，含三类MCP、两类Hook、数据库重连、空答复保留、最新估时覆盖、暂停冻结及真实Electron窗口。窗口回归用两个连续的一秒变化识别原有5秒刷新反例，修复为每秒后通过。

首次全量165/169，失败为刷新反例、调度器ValidateOnly及两个指向旧release/win-unpacked的包测试。失败记录保留，不声称单次全量全绿；最终候选复核与现场结果见后续补记。

证据：`.artifacts/eta-retention-{red,green,timer-red,timer-green,final-related,full-tests,candidate-tests,typecheck,lint}.log`，以及`eta-retention-reporting-update.json`。本轮未运行八小时或完整资源门禁，真实多宿主估时质量仍不由夹具证明。

## 最终候选与Claude Code补记

- 最新标签统一为“项目名称 · session名称”，无编号；缺字段分别显示“未知项目”“未命名会话”。Codex宿主索引与Claude Code显式custom-title元数据均可更新标题。Claude按精确sessionId读取，忽略其他会话及sidechain；发现阶段排除subagents目录，25个较新的子日志不会挤掉主会话。大日志采用有界尾读与已有名称缓存，不从用户/模型正文提取名称。
- 只读核对本机16份Claude主日志，其中13份读到显式标题；未修改宿主日志、Claude配置或调用Claude模型。新增适配器21项回归及最终11文件39项相关测试通过，包含混合Codex/Claude真实Electron窗口、MCP和Hook；类型检查、lint通过。真实Claude agent自然汇报、登录与估时质量仍未验收，不外推到Claude桌面全部模式。
- 当前原agent通过既有原生MCP工具实际提交新估时，并随后省略时间、提交null；剩余范围持续递减，未触发重复询问。重启保留剩余量，原任务继续后恢复倒计时。证据`eta-retention-live-proof.json`；私有handle未落盘。
- v19目录包构建、启用和四工具stdio检查通过，其他Codex配置未改变。SQLite一致性备份已保留，切换前历史数据保全与当前session单项投影另存现场证明。v17候选包smoke与回放复核通过；调度器ValidateOnly测试仍失败，因此不声称全量测试全绿。未重启长测，未重跑v19完整资源门禁、八小时或ZIP/NSIS验收。

现场证据：`.artifacts/claude-title-metadata-proof.json`、`claude-compat-{final-tests,typecheck,lint,package}.log`、`claude-final-{backup,default-v19,config-applied,live-proof}.json`。数据库和备份含私人信息，仅本机保留。

## 2026-10-30 Claude 桌面真实任务补验

上文v19的“真实Claude自然汇报待验”是当时边界，已由当前日常v22的第二轮及原生窗口补验补齐。普通任务自然启用Skill，原agent的初始ETA被接受，后续省略时间仍倒计时，计划100%待收尾不覆盖有效ETA；真实窗口两次截图从 `00:12–01:52` 减到 `00:08–01:48`。最终19/19测试通过，只有1条用户请求，无估时聊天播报，耐久未重启。

完整过程、失败历史和证据范围见 [Claude Code真实会话验收](claude-code-real-session.md)。这不代替资源、八小时、多屏或估时准确率验收，也不代表正在修改的其他界面已经通过。
