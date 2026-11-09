# codingSchedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. If the user later chooses subagent execution, use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** 交付 Windows 本地悬浮框，汇总多个 AI 工具的任务活动、可解释的计划进度和有依据的剩余时间区间，支持悬停详情与后台结构化报告。

**Architecture:** 薄 Electron 主进程+原生 HTML renderer，collector Worker 统一采集、归并及写 SQLite。2026-10-27 用户选择[阶段五线程内存优化](2026-10-27-runtime-memory.md)，替代原 utilityProcess，接受原生崩溃不再跨进程隔离；早期 utilityProcess 验证保留为历史。选择性移植 CCAM MIT 解析器与测试，通用 MCP/CLI/Hook 接入同一事件协议；UI仅接收脱敏快照。

**Tech Stack:** Electron 45.0.0、TypeScript strict、Node 24.22.x、node:sqlite、官方 MCP TypeScript SDK、esbuild、Vitest、Playwright Electron、electron-builder。除明确基线外，精确依赖版本在 T01 验证并锁定，不凭旧教程猜 SDK 包名/API。

**Spec:** [完整开发方案](../specs/2026-10-26-coding-schedule-design.md)  
**Evidence:** [源码核查及复用清单](../../research/2026-10-26-reference-source-review.md)  
**Status:** T02–T03底座完成；T04–T11主要代码和本机自动化已实现，见[阶段三、四报告](../../verification/phase-3-4.md)。T01原生输入/物理DPI/多屏补验及三、四阶段真实宿主验收未关闭，T12–T14候选交付实施中，见[验收矩阵](../../verification/acceptance.md)；资源和真实用户路径未齐。未勾选项不冒充完成。

## Global Constraints
- Windows 11 x64 首发，中文 UI，单个悬浮窗；无 dashboard、账户、云同步、远端控制。
- 正常日志/状态更新及hover不得抢焦点；键盘聚焦仅由用户明确操作触发。
- 只读宿主日志；不得自动改 Hook/MCP 配置，应用前预览差异、备份、原子合并。
- 任务/run跨轮身份与turn分开；禁止按cwd、当前焦点、最近更新时间猜测合并。
- 没有依据时进度/ETA为null；不以时间、token或调用次数自动增加完成度。
- 计划completed、AI reported_done、用户verified_done是不同状态。
- 每报告≤64 KiB、changes 1–20、每计划≤100叶子、权重1/2/3；seq、revision正整数。
- 标准事件schemaVersion=1；同report共享seq、eventIndex从0起，高水位在整个事务提交后推进。
- 新工作总是新runId；可信session按完整expectedRun:RunRef|null做CAS。reporter流ID跨MCP/CLI/bridge重启不变，owner为connectorId+run。
- begin/report幂等键为UUIDv7，有效24小时、未来偏差≤5分钟；控制记录活动期保留、终态30天，不随显示历史提前清理。
- estimate为接受时的剩余active时长，带独立version；同version不重置锚点，running重新估计不再乘校准系数。
- SQLite单写入者、WAL、synchronous=FULL、foreign_keys=ON、busy_timeout=1000ms；ACK仅在提交后发出。
- 源读取：单批1 MiB、初始尾窗8 MiB、单行1 MiB、最多20活动源、200候选。
- freshness阈值60/180秒，collector心跳10秒、失联30秒；心跳不等于工作更新。
- 收起320×48 DIP、展开宽360/高≤420 DIP、hover250ms/leave400ms、动画120ms、拖动4 DIP。
- 首发串行ETA；并行/范围不全/时长缺失时ETA未知；至少3个有效完成样本才校准。
- 所有移植代码保留来源与MIT许可；Agent Island及许可未澄清的AgentHUD不复制。
- 每轮实施先检查工作区与AGENTS，保留其他人改动；沿用已有仓库，不自动远程push。最初只有规划文件的条件仅适用于T01启动时。
- 每任务完成可创建本地checkpoint commit，但先确认仓库已存在且仅暂存该任务文件；不使用git add .混入用户改动。
- 不记录真实用户聊天原文作fixture，使用人工合成或经脱敏且授权的最小样本。

## Review Focus
1. 同一个MCP进程服务两项任务、多个会话在同一目录：绝不交叉写入（T02/T07）。
2. 半条UTF-8、CRLF、同inode截断/轮转、超长行：无重复/损坏事件、不无界读取（T04/T05）。
3. 报告已提交但ACK丢失、应用强杀后重试、旧generation迟到：仅一次且不能复活终态（T03/T06）。
4. 时钟跳变、休眠/关闭、等待后恢复、计划增加/重开：不虚增进度与工作耗时（T02/T09）。
5. 中文空格路径、宿主同时改配置、无系统Node、多屏DPI拔插：接入可回滚、窗口可找回且不抢焦点（T01/T08/T10/T12）。

## 1. 五个实施阶段、里程碑与规模估计

实施固定划分为**5个阶段**，T01–T14保留为内部编号。阶段退出条件全部通过后才能标记该阶段完成。目前阶段二完成，阶段一补验未关闭；阶段三、四主要代码与自动化已实现，但真实宿主和原生体验验收未齐；阶段五正在实施，候选产物不等于退出验收通过。未完成的体验验证不以领域测试替代。

~~~mermaid
flowchart LR
  P1["阶段一：技术验证与复用确认<br/>T01"] --> P2["阶段二：任务协议与数据底座<br/>T02 → T03"]
  P2 --> P3["阶段三：多工具采集与悬浮窗<br/>T04 → T05 → T06 → T08"]
  P3 --> P4["阶段四：AI后台汇报与估时<br/>T07 → T09 → T10 → T11"]
  P4 --> P5["阶段五：打包、真实验收与交付<br/>T12 → T13 → T14"]
~~~

| 实施阶段 | 内部任务与执行顺序 | 可检查产物 | 退出条件 | 排程估算 |
| --- | --- | --- | --- | --- |
| 阶段一：技术验证与复用确认 | T01 | 固定依赖、本机能力矩阵、打包样机、源码复用边界 | 原生窗口/SQLite/日志/MCP关键假设通过；失败先修订方案 | 0.5–1人日 |
| 阶段二：任务协议与数据底座 | T02 → T03 | 协议、身份/状态机、计划进度、事务存储与恢复 | 同目录任务不串写；重复报告、旧消息与ACK丢失可正确处理 | 1–2人日 |
| 阶段三：多工具采集与悬浮窗 | T04 → T05 → T06 → T08 | Codex/Claude日志+Hook、基础采集到窗口通路、可使用的悬浮框 | 两个真实来源的当前动作/计划在悬浮框更新；hover不抢焦点、可切换任务 | 3–4人日 |
| 阶段四：AI后台汇报与估时 | T07 → T09 → T10 → T11 | MCP/CLI/Skill、区间ETA、接入配置/来源绑定、完整健康与恢复机制 | 主动/被动来源不冲突；估时未知/暂停/超时诚实；安装配置可撤销、异常可恢复 | 2–4人日 |
| 阶段五：打包、真实验收与交付 | T12 → T13 → T14 | Windows分发包、真实宿主/性能验收、使用说明与许可清单 | 所有必需验收证据完整；兼容范围和未验证项如实标注，无未解决的交付阻断项 | 1.5–3人日 |

M0、M1、V1保留为**交付里程碑名称**，不是额外实施阶段：M0对应阶段一通过，M1对应阶段三通过，V1对应阶段五通过。阶段四结束代表首发功能齐备，仍需阶段五打包和真实验收。

估算仅用于排程：五个阶段合计约8–14人日，取决于复用成功率和本机联调问题；不是AI运行时长或交付承诺。阶段一结束按实际解析/打包问题重估；真实宿主缺失、签名证书采购、第三工具兼容不在代码工时里伪装成已完成。

## 2. 文件与职责地图
~~~text
src/
  shared/contracts.ts, schemas.ts, ui-contract.ts
  domain/identity.ts, reducer.ts, progress.ts, eta.ts, clock.ts
  storage/database.ts, migrations.ts, repository.ts
  collector/main.ts, service.ts, supervisor.ts, health.ts
  ingestion/server.ts, auth.ts, normalize-report.ts
  adapters/types.ts, registry.ts
  adapters/common/tail-reader.ts, discovery.ts
  adapters/codex/parse.ts, discover.ts, plan-call.ts
  adapters/claude/parse.ts, discover.ts
  bridge/main.ts, mcp.ts, cli.ts, transport.ts, credential.ts
  desktop/main.ts, window.ts, preload.ts, ipc.ts, tray.ts
  renderer/index.html, app.ts, widget.ts, styles.css, settings.ts
  integration/config-patch.ts, installers.ts, source-link.ts
integrations/
  skill/SKILL.md
  hooks/claude.cjs, codex.cjs
  templates/codex-mcp.json, claude-mcp.json, generic-mcp.json
tests/
  domain/, storage/, ingestion/, adapters/, bridge/, desktop/, integration/
  fixtures/codex/, claude/, replay/
scripts/
  fetch-bridge-runtime.mjs, probe-runtime.mjs, replay.mjs, bench.mjs
  verify-docs.mjs, verify-origins.mjs
docs/
  research/2026-10-26-reference-source-review.md
  verification/m0-capabilities.md, acceptance.md, performance.md
  integrations.md, user-guide.md, development.md
third_party/
  README.md, origins.json, licenses/
package.json, package-lock.json, tsconfig.json
vite.config.ts, vitest.config.ts, playwright.config.ts, electron-builder.yml
THIRD_PARTY_NOTICES.md
~~~

这是待建目录，不提前创建空占位文件。每个源模块由任务拥有；内部私有函数可合理调整，但公开契约变更需同时更新引用任务与设计。

### 核心共用接口
在T02定义，后续任务只引用，不重复发明名称：
~~~ts
// contracts.ts中的Step/Plan/RunRef/EventPayload/NormalizedEvent/RunSnapshot
// 与设计保持完全一致；以下为实现边界补充。
type RunHandle = RunRef & { resumeHandle: string };
type TrustedSource = {
  connectorId: string; sourceInstanceId: string;
  provider: ProviderId; nativeSessionId?: string; kind: SourceKind; canVerify?: boolean;
};
type BeginInput = {
  idempotencyKey: string; title: string; expectedRun?: RunRef | null; plan?: Plan;
};
type ReportInput = {
  handle: RunHandle; reportId: string; seq: number; changes: ReporterChange[];
};
type ReporterChange = Exclude<EventPayload,
  { type: 'run.started' | 'completion.reported' |
    'completion.verified' | 'source.heartbeat' }>;
type FinishInput = { handle: RunHandle; reportId: string; seq: number; summary: string };
type Ack = { accepted: true; duplicate: boolean; nextSeq: number };
type ContextResult = { snapshot: RunSnapshot; nextSeq: number; sessionHead: RunRef | null };
type ClockSample = { wallMs: number; monoMs: number; continuityId: string };
type TimingState = {
  currentAttemptByStep: Record<string, number>;
  activeMsByAttempt: Record<string, number>;
  estimateAnchors: Record<string, { version: number; anchorActiveMs: number;
    kind: 'prior' | 'remaining'; continuous: boolean }>;
  completedSamples: Array<{ stepId: string; attempt: number; activeSec: number;
    estimateAtStart: Estimate; valid: boolean }>;
  continuous: boolean;
};
type RunState = {
  snapshot: RunSnapshot; timing: TimingState;
  lastClock: ClockSample | null; planOwner: string | null;
};
type EventBatch = {
  events: NormalizedEvent[]; handle?: RunHandle;
  expectedCursor?: { fileGeneration: string; committedOffset: number } | null;
  receipt?: { reportId: string; bodyHash: string };
  cursor?: FileCursor; parserCheckpoint?: ParserState;
};
type FileCursor = {
  pathKey: string; fileGeneration: string; committedOffset: number;
  pendingBytes: Uint8Array; fingerprint?:string;
};
type FileCheckpoint = { cursor: FileCursor; parserCheckpoint: ParserState | null };
type Store = {
  begin(input: BeginInput, source: TrustedSource): Promise<RunHandle>;
  context(handle: RunHandle, source: TrustedSource): Promise<ContextResult>;
  commit(batch: EventBatch, source: TrustedSource): Promise<Ack>;
  checkpoint(pathKey: string): Promise<FileCheckpoint | null>;
  listSnapshots(): Promise<RunSnapshot[]>;
  close(): Promise<void>;
};
~~~

ReporterChange的TypeScript类型不是安全校验，schemas必须进一步禁止run.status里的reported_done/verified_done，强制evidence=declared。进程内部时间函数统一使用ClockSample；不直接在纯逻辑中Date.now()。

边界类型由所属任务在其模块导出，以下字段不能靠实现者跨模块猜测：
- T04 ReadLimits={batchBytes:1048576,tailBytes:8388608,lineBytes:1048576}；SourceFile见T04。ProviderAdapter={provider:ProviderId,discover():Promise<SourceFile[]>,parse:Parser}，注册表只收内置白名单适配器，不加载任意插件代码。
- T05 ParserState={currentTurnId:string|null,nativePlanRevision:number,completePlan:boolean,pendingCalls:Record<string,{name:string,input:unknown,offset:number}>}；序列化限制200项/256KiB，超限partial。SourceObservation=Omit<NormalizedEvent,'run'|'receivedAt'|'seq'|'eventIndex'> & {completePlan?:boolean;nativeSequence:number}；nativeSequence按文件位置及记录内次序稳定产生。Parser=(lines:TailBatch['lines'],context:ParseContext)=>ParseResult。解析器不分配run，collector先依据session/turn映射，再填入标准事件所缺字段。
- T06 IngestOptions={userDataDir:string,clock:()=>ClockSample}；LocalRequest={operation:'begin'|'report'|'context'|'finish'|'hook',body:unknown,connectorId:string,endpointPath:string,credentialPath:string}；LocalResponse={status:number,body:unknown}；SnapshotUpdate={version:1,type:'snapshots',snapshots:RunSnapshot[]}在shared/ui-contract.ts定义，供阶段三窗口使用。内部鉴权返回TrustedSource，模型输入不能覆盖其字段。
- T08 WidgetOptions={userDataDir:string,initialSnapshots:RunSnapshot[]}；WidgetState={snapshots:RunSnapshot[],selected:RunRef|null,expanded:boolean,pinned:boolean,mode:'task'|'settings'}。主进程和renderer只通过UiCommand与脱敏SnapshotUpdate通信。
- T10 IntegrationRequest={host:'codex'|'claude'|'generic',configPath:string,bridgePath:string,connectorId:string}；ConfigPatch={path:string,beforeHash:string|null,beforeText:string|null,afterText:string,ownedKeys:string[]}；InstallReceipt={path:string,beforeHash:string|null,afterHash:string,backupPath:string|null,ownedKeys:string[]}；ApplyResult={applied:boolean,receipt?:InstallReceipt,reason?:'conflict'|'invalid'|'permission'}。原文件hash相符才应用，receipt不足不猜测删除。
- T11 CollectorOptions={userDataDir:string,sources:Array<{provider:ProviderId,root:string}>,onMessage:(message:SnapshotUpdate|HealthUpdate)=>void}；沿用T06的SnapshotUpdate，补充HealthUpdate={version:1,type:'health',status:'ok'|'degraded'|'offline',message:string}。健康消息不改变任务完成度。

## 3. 五个实施阶段及内部任务

### 阶段一：技术验证与复用确认

**执行顺序：** T01。**状态：** 核心验证通过，补充验收待完成。

目标：验证关键技术假设和复用边界，锁定可构建的工具链。入口：设计与源码核查文档已具备；退出：打包样机、原生焦点、SQLite和接入能力证据满足T01要求。交付里程碑：M0。

#### T01：验证原生体验与打包通路，锁定依赖
**Files:** 创建package.json/package-lock.json、tsconfig.json、基础构建/测试配置、scripts/probe-runtime.mjs、scripts/fetch-bridge-runtime.mjs、tests/desktop/runtime-probe.test.ts、docs/verification/m0-capabilities.md、docs/development.md。样机代码只放tests/fixtures/probe/，不能以完成产品名义发布。  
**Consumes:** 设计12节的预算与证据附件。  
**Produces:** 固定可构建的工具链；运行时探测JSON；真实宿主能力矩阵（工具版本、日志格式、session/turn/call字段、Hook与MCP是否可用）。

- [x] 检查当前仓库、工作区、AGENTS与现有变更；记录环境，建立本地Git（若仍为空项目），只纳入本项目文档。
- [x] 核验并锁定Electron45.0.0/Node24.22.x及官方MCP SDK实际版本；读包README，不直接复用上游旧依赖表；建立npm scripts：dev、build、typecheck、lint、test、test:desktop、package:win、verify:docs。
- [x] 写打包探测测试：utilityProcess可import node:sqlite、创建临时库、事务插入后重开读回；窗口用showInactive、focusable=false；探测输出包含实际Electron/Node/SQLite版本及是否通过。
- [x] 在中文空格路径打包运行；隐藏系统Node的PATH，只用分发Node sidecar启动一个stdio MCP server并完成initialize/tools/list。校验Node官方下载包哈希及再分发许可。
- [x] 用用户环境里的真实Codex与Claude进行最小只读探测，定位合法日志根；采集脱敏字段结构，不复制全部聊天。确认缺少Claude/第三工具环境时明确写“未验证”，不得伪造样本。
- [ ] 在记事本输入中悬停样机20次，记录前台窗口句柄无变化；测试100%/150% DPI、屏幕边缘缩放。记录进程树Private Bytes/CPU初值。
- [x] Run: npm run build；npm run test -- tests/desktop/runtime-probe.test.ts；npm run package:win。期望：构建成功、探测断言PASS、打包运行证据存在；文档逐项给出pass/fail/unverified。
- [ ] 若原生焦点、打包SQLite、helper或资源预算失败，先定位并更新设计；不得把M0打勾后把问题留给最后打包。其余问题可继续独立工作，V1真实验收仍不可跳过。

### 阶段二：任务协议与数据底座

**执行顺序：** T02 → T03。**状态：** 已完成并验证。

目标：建立不串任务、可解释且能恢复的数据模型。入口原定阶段一通过；实际在阶段一核心技术验证通过后，先实施不依赖未完成物理UI补验的领域/存储逻辑，裁定与风险记录在阶段报告。退出：身份、进度、事务、幂等及恢复测试通过。交付物：可供后续采集器和窗口共用的领域接口与存储。

#### T02：协议、任务身份和诚实的进度状态机
**Files:** shared/contracts.ts、schemas.ts、domain/identity.ts、reducer.ts、progress.ts、clock.ts；tests/domain/identity.test.ts、reducer.test.ts、progress.test.ts、schemas.test.ts。  
**Consumes:** 设计5–8节。  
**Produces:** 所有共用类型；validateBegin/validateReport/validateFinish；createRunState(event:NormalizedEvent,clock:ClockSample):RunState；reduceRun(state:RunState,event:NormalizedEvent,clock:ClockSample):RunState；calculateProgress(plan:Plan|null):RunSnapshot['progress']；classifyFreshness(lastWorkAt:number|null,now:number):Freshness。identity仅负责身份键/CAS规则的纯判断，持久化交给T03。plan.complete随事件持久化，false时百分比/ETA未知且不能finish。

- [x] 写失败测试：两run同cwd不相等；两MCP任务handle不同；旧generation不能应用；finish不能使pending/failed计划终态；计划全完成只显示待收尾。
- [x] 加CAS断言：expectedRun比较runId和generation；新工作获得全新runId；有head却传null拒绝；无可信session时两独立begin不共享head。
- [x] 写进度例子：weights=[1,2,1]，状态completed/running(1/2)/pending ⇒50%；仅第一个completed⇒25%；增加weight2新任务后⇒17%；全skipped⇒null；failed不计完成分。
- [x] 写边界断言：60秒fresh、60001ms aging、180001ms stale；heartbeat不变lastWorkAt；context只读；seq/revision≤0、>100steps、非法quantity、NaN/Infinity估计均拒绝。
- [x] 测试UUIDv7过期24小时后410、未来超过5分钟拒绝；未知run的report绝不创建run。相同estimate.version改数值拒绝，增加version才允许新锚点。
- [x] Run: npm run test -- tests/domain。期望先因缺失实现/断言不满足FAIL；不得把编译配置错误当作唯一红灯。
- [x] 实现纯reducer；将原生turn结束映射paused，明确新任务/generation与终态拒写；工作时钟不跨continuityId累加；估时暂返回unknown。
- [x] Run: npm run typecheck；npm run test -- tests/domain。期望全部PASS，plan.replaced/step.updated和类型schema一致；检查所有终态转换有测试。

#### T03：事务、幂等回执与重启恢复
**Files:** storage/database.ts、migrations.ts、repository.ts、batch.ts、checkpoint.ts；tests/storage/repository.test.ts、crash-recovery.test.ts。
**Consumes:** T02类型及reducer。  
**Produces:** openStore(dbPath:string,clock:()=>ClockSample):Promise<Store>；Store共用接口、checkpoint(pathKey)；hashBatch(batch:EventBatch):string；SQLite migrations v1。内部transcript允许events=[]的纯解析事务，kind/nativeSessionId必须来自可信注册；文件代次切换用expectedCursor作CAS，去重不跳过合法断点提交。

- [x] 写真实临时SQLite测试，不mock数据库：同idempotencyKey两次begin返回同handle；同native session的并发CAS只有一个成功；相同reportId+body重复ACK不追加；相同ID不同body返回409。
- [x] 覆盖同批2事件同seq不同eventIndex一次提交；不合法第二事件导致整包回滚；乱序seq不能覆盖；未提交游标不前移。
- [x] 验证parser checkpoint与游标同事务：tool_use已保存后重启，追加tool_result仍只匹配一次；256KiB上限产生partial而非无界状态。
- [x] 子进程写库成功后模拟ACK丢失并强杀该测试子进程，重启再发同报告，断言只有一批事件且nextSeq正确。不得杀用户进程。
- [x] Run: npm run test -- tests/storage。先FAIL，再实现单写入者事务、WAL、migrations、receipts/tombstones与replay。
- [x] 恢复时将未终态active快照标paused并切换continuityId；历史工作耗时不含程序关闭时间。
- [x] 为reporter持久化服务分配的逻辑sourceInstanceId与owner；context重连返回同一流nextSeq。MCP/CLI切换并发同seq仅一个成功，换进程不能绕过高水位。
- [x] Run: npm run test -- tests/storage；npm run typecheck。PASS后检查ACK路径严格在commit成功之后，无request.end假ACK。

### 阶段三：多工具采集与悬浮窗

**执行顺序：** T04 → T05 → T06 → T08。**状态：** 主要代码、本机回放及自动化已实现；真实任务和原生体验验收未齐，见阶段报告。下面复合检查项仅在全部条件有证据时勾选，保留未关闭项。

目标：让真实任务首次进入可用的悬浮框。入口：阶段二通过；退出：Codex与Claude的被动采集和Hook补充接通，窗口显示当前动作/计划，悬停不抢焦点。交付里程碑：M1；无依据的ETA仍显示未知。

#### T04：有界增量日志读取和发现
**Files:** adapters/types.ts、registry.ts、common/tail-reader.ts、discovery.ts；tests/adapters/tail-reader.test.ts、discovery.test.ts。  
**Consumes:** FileCursor、EventBatch；T03 commit游标。  
**Produces:** readTail(path:string,cursor:FileCursor|null,limits:ReadLimits):Promise<TailBatch>；TailBatch={lines:Array<{text:string,offset:number}>,nextCursor:FileCursor,partial:boolean,skippedLines:number,bytesRead:number,ioBytes:number}；bytesRead表示新载荷，ioBytes包含有界指纹读取。discoverCandidates(roots:string[],now:number):Promise<Discovery>；Discovery={candidates:SourceFile[],active:SourceFile[],unavailable:string[]}。ReadLimits固定为设计10节；SourceFile={path,provider,nativeSessionId?,mtimeMs}。

- [ ] 写合成fixtures：汉字UTF-8跨块、CRLF跨块、无尾换行继续追加、超长行含伪合法JSON后缀、同inode变短、文件替换、短暂共享锁；每份给出期望输出事件数/offset。
- [x] 写100MiB合成日志有界读取测试，spy实际读字节：冷读≤8MiB+1MiB边界余量、增量单批≤1MiB；初次截掉半行不解析伪JSON尾。
- [ ] 写发现测试：缺目录返回unavailable；候选200/活动20上限；只有mtime不证明进程活着；权限拒绝不拖垮其他来源。
- [x] Run: npm run test -- tests/adapters/tail-reader.test.ts tests/adapters/discovery.test.ts。预期先FAIL。
- [ ] 提取CCAM适用读取逻辑和用例，剥离snapshot-store/压缩/原始日志清理；记录actual origins。监听器只给提示，采用1秒stat与30秒批量发现兜底。
- [ ] Run同上及npm run typecheck，期望PASS。检查测试未引入真实用户路径；旋转代次后eventId稳定且不复用旧offset。

#### T05：Codex和Claude计划解析器
**Files:** adapters/codex/parse.ts、discover.ts、plan-call.ts；adapters/claude/parse.ts、discover.ts；tests/adapters/codex.test.ts、claude.test.ts；fixtures/codex/、claude/；third_party/README.md、origins.json、licenses/CCAM-MIT.txt、THIRD_PARTY_NOTICES.md。  
**Consumes:** TailBatch、T02EventPayload；T04注册表。  
**Produces:** parseCodex(lines:TailBatch['lines'],context:ParseContext):ParseResult；parseClaude同签名；ParseContext={source:TrustedSource,fileGeneration:string,previous:ParserState}；ParseResult={observations:SourceObservation[],state:ParserState,diagnostics:string[]}。run/receivedAt/seq/eventIndex由采集编排填充，不从不可信正文照抄；同批多个turn不会被预先塞进同一个run。

- [x] 移植固定SHA的codex-plan-call定位器和受限数据字面量解析；单独保留来源头、实际文件/行范围。限制解析深度32；嵌套更深/超1MiB直接返回诊断。
- [x] 写失败测试：Codex update_plan及exec包装；字符串/注释中的tools.update_plan不产生计划；变量引用/脚本不执行；缺turnId的边界降级。
- [ ] 写Claude TodoWrite完整快照、TaskCreate/Update/Get/List增量、tool_use/tool_result跨块关联、通知/压缩消息不作为用户新任务；部分任务列表返回completePlan=false。
- [ ] 加上游与本项目差异测试：Stop保留未完成计划并paused；新用户轮次是新被动run；已绑定reporter的跨轮run不被日志重置。
- [ ] Run: npm run test -- tests/adapters/parsers.test.ts。先FAIL，再实现语义归一；不复制CCAM全局reset/finalize策略。
- [x] Run同上+verify-origins。PASS后在证据表把实际完成的移植单元改为“本地测试通过”，仍不声称真实宿主通过。

#### T06：本地接收服务、Hook与基础采集连接
**Files:** ingestion/server.ts、auth.ts、normalize-report.ts；collector/main.ts、service.ts、shared/ui-contract.ts；bridge/transport.ts、credential.ts；integrations/hooks/claude.cjs、codex.cjs；tests/ingestion/server.test.ts、auth.test.ts、hook.test.ts、collection.test.ts。  
**Consumes:** T03 Store、validate*、TrustedSource，以及T04/T05的ProviderAdapter与解析器。  
**Produces:** startIngest(store:Store,options:IngestOptions):Promise<IngestServer>；IngestServer={port,close():Promise<void>}；sendLocal(request:LocalRequest,deadlineMs:number):Promise<LocalResponse>。路由仅POST /v1/begin、/v1/report、/v1/context、/v1/finish、/v1/hook；鉴权失败也不泄漏run存在性。基础采集接口startCollection(store:Store,adapters:ProviderAdapter[],publish:(update:SnapshotUpdate)=>void):Promise<{stop():Promise<void>}>在本任务实现，打通日志/Hook→标准事件→事务存储→快照发布；不把窗口需要的数据通路推迟到T11。

- [x] 测试127.0.0.1绑定、错误Host/任意Origin/缺token拒绝；正文64KiB上限（按字节）；无效schema、未知操作、伪verified拒绝；不提供任意路径/命令端点。
- [ ] 测试每connector每秒最多20请求、burst40，超过429；总负载100事件/秒10秒时已ACK全保留，独立来源不饥饿。限速按请求，负载指标按事件，报告中不能混用。
- [ ] 测试服务拒绝/超时Hook总执行≤750ms且exit0；网络timeout350ms；成功stdout为空；progress_*及helper自身被过滤。上报错误只限频诊断。
- [x] Run: npm run test -- tests/ingestion。先FAIL，再实现token文件ACL、随机端口endpoint原子发布、credential读取与单地址HTTP。
- [ ] 实现接收原生Hook的白名单映射：只有可信宿主payload中的session/call能用于关联；不直接信任模型填写的路径/session。不支持的Hook字段降为activity或diagnostic。同时在collector/main.ts与service.ts接通日志适配器、身份映射、Store及提交后SnapshotUpdate；基础轮询、正常退出和freshness已有可用实现，崩溃重启/保留策略等由T11补强。
- [ ] Run同上+typecheck，PASS；带真实承载脚本进程测deadline，不能只mock网络延迟。collection.test.ts追加Codex/Claude合成记录，断言持久化后才发布对应run快照、两个来源不串写、stop关闭监听；作为T08真实显示的前置验证。

#### T08：悬浮窗、鼠标详情与多任务选择
**Files:** desktop/main.ts、window.ts、preload.ts、ipc.ts、tray.ts；shared/ui-contract.ts；renderer/index.html、app.ts、widget.ts、styles.css；tests/desktop/widget.test.ts、window.e2e.ts。  
**Consumes:** T06基础采集器的SnapshotUpdate/RunSnapshot[]；T01原生能力结论。  
**Produces:** createWidget(options:WidgetOptions):BrowserWindow；renderWidget(state:WidgetState):void；preload只暴露subscribeSnapshots(listener):()=>void、dispatchUiCommand(command):Promise<void>。UiCommand枚举selectRun/pinExpanded/hide/showFocused/resetPosition/openSettings/confirmVerified，参数run必须是RunRef。

- [x] 写UI测试：未知值显示文字不显示0%；三个完成状态文案不同；hover249ms不展开/250ms展开，leave399ms不收/400ms收；pin/drag阻止误收起。
- [ ] 写任务选择测试：同目录两项独立显示；鼠标停留时新run不抢选；手动选择保持；其他run等待仅显示徽标；不汇总成总百分比。
- [x] 写位置纯函数clampBounds(bounds,workArea)和展开方向测试：右下角、小屏、负坐标副屏、150%DPI，均在workArea内。
- [ ] Run: npm run test -- tests/desktop/widget.test.ts。先FAIL，再实现单窗口+本地app协议、严格CSP、无nodeIntegration、有限IPC与来源校验；主进程启动T06的collector utilityProcess，将提交后快照通过preload送到renderer。
- [ ] 实现键盘通过托盘聚焦，Escape恢复非聚焦；主题与减少动画；标题/动作textContent；精简“当前动作/步骤/时间依据”内容。
- [ ] Run: npm run test:desktop -- tests/desktop/window.e2e.ts；预期结构/IPC PASS。
- [ ] 原生人工验收：记事本持续输入，hover/日志更新/错误各20次不丢输入；真实双屏移动、断开副屏、睡眠恢复；截图+前台句柄记录写acceptance。DOM PASS不替代这一步。另各运行一条真实Codex/Claude任务，确认日志/Hook→collector→悬浮框的动作、计划、freshness和任务切换，结果作为阶段三退出证据。

### 阶段四：AI后台汇报与估时

**执行顺序：** T07 → T09 → T10 → T11。**状态：** 主要代码与本机自动化已实现；真实Skill触发率/宿主及环境故障验收待补，见阶段报告。未勾选的复合项不得只凭代码存在判定通过。

目标：补齐主动语义报告、估时、来源关联和运行可靠性。入口：阶段三通过；退出：MCP/CLI/Skill到悬浮框全链路可用，ETA退化、来源冲突、配置回滚与故障恢复有测试证据。交付物：首发功能齐备的候选版本，尚不能代替阶段五验收。

#### T07：通用MCP、CLI与后台汇报Skill
**Files:** bridge/main.ts、mcp.ts、cli.ts；integrations/skill/SKILL.md；tests/bridge/mcp.test.ts、cli.test.ts、reporting-flow.test.ts；docs/integrations.md。  
**Consumes:** T06sendLocal；T02输入/输出类型。  
**Produces:** startMcpServer(options:BridgeOptions):Promise<void>；runCli(args:string[],stdin:Readable):Promise<number>。BridgeOptions={connectorId,credentialPath,endpointPath}；无凭据经stdout泄漏。

- [x] 用官方client测试initialize/tools/list及四工具完整流程begin→plan/step→context→finish；schema与服务校验一致；不手写SDK替代物。
- [ ] 同一MCP进程同时执行A/B两run，各自更新不同计划，断言没有“当前run”隐式全局变量。跨connector拿他人handle返回403；旧generation409。
- [ ] 测试重试reportId幂等、断连再连使用handle恢复；App不在时工具及时返回结构化不可用错误，CLI exit码区分报告不可用与参数错误，Hook入口仍按T06 fail-open。
- [ ] 测试同connector重启/MCP转CLI仍沿用逻辑流；旧KEY_EXPIRED应提示重新判断当前工作，不自动换UUID再提交。宿主可审计工具入参/返回值，不宣称handle在宿主记录中不可见。
- [ ] Run: npm run test -- tests/bridge。先FAIL，再实现stdio（stdout仅JSON-RPC）、stdin JSON CLI、内部HTTP复用。
- [x] 编写独立小Skill：开工/计划/动作改变/等待/收尾报告；自然边界约60秒、同内容≥15秒；无计划报unknown；不新增聊天进度正文；失败不循环；压缩不新建任务；子代理不共享handle。先读skill-creator或writing-great-skills再写，不搬上游大Skill。
- [ ] 合成会话按Skill模拟消息序列验证无递归report；实际宿主的自动触发率/工具卡可见性留T13记录，不能用文本检查替代。
- [ ] Run上述测试+typecheck，PASS后记录实际SDK和协议协商版本。

#### T09：活动时钟、区间ETA与范围变更
**Files:** domain/eta.ts、clock.ts、reducer.ts；tests/domain/eta.test.ts、clock.test.ts；renderer/widget.ts（ETA文案）。  
**Consumes:** TimingState、Plan、ClockSample。  
**Produces:** estimateRemaining(plan:Plan|null,timing:TimingState):RunSnapshot['eta']；advanceTiming(state:RunState,event:NormalizedEvent,clock:ClockSample):TimingState。

- [x] 先写精确断言：serial两未完成步骤[60,120]与[120,180]⇒[180,300]；第一个running已active30s⇒[150,270]；未知estimate/parallel/unknown⇒null。
- [ ] 先工作480秒，再提交estimate.version=2、区间[240,480]，断言立即剩余[240,480]；再工作60秒为[180,420]。重发同version不重置；k=2时running的新版remaining仍不乘2；修改过的尝试不进校准样本。
- [ ] 完成样本比值[1,2,4] ⇒ k=2；[5,6,7] ⇒3；少于3样本用prior。失败/重开/continuity断裂的样本不参与。
- [ ] 等待10分钟不减少remaining；系统wall回拨不出现负active；休眠/应用关闭的时间不能加入active；running超过校准上界⇒null且overdue原因；心跳不增加progress。
- [x] Run: npm run test -- tests/domain/eta.test.ts tests/domain/clock.test.ts。先FAIL，再实现中位数校准及尝试级计时，记录估计原revision。
- [ ] 更新当前步骤估计用新plan revision；状态不变不重复开启attempt。completed→running必须新revision及reason，分数可降、旧样本不复用。
- [x] Run同上和tests/domain全套，PASS；快照测试只验证具体状态文案，避免大段HTML快照镜像实现。

#### T10：接入配置、显式关联与单窗口设置
**Files:** integration/config-patch.ts、installers.ts、source-link.ts；renderer/settings.ts；templates三份；tests/integration/config-patch.test.ts、source-link.test.ts；docs/integrations.md。  
**Consumes:** Store、UiCommand、BridgeOptions；M0已确认的宿主配置schema。  
**Produces:** previewIntegration(input:IntegrationRequest):Promise<ConfigPatch>；applyIntegration(patch:ConfigPatch):Promise<ApplyResult>；revertIntegration(receipt:InstallReceipt):Promise<ApplyResult>；linkSource(run:RunRef,source:NativeSourceRef,scope:LinkScope):Promise<void>。NativeSourceRef={provider,nativeSessionId}；LinkScope={turnIds:string[]}，不自动跟随未来turn。

- [x] 测试中文/空格/引号路径输出command+args数组，凭据不内嵌；保留其他MCP和Hook；宿主在preview后改文件则hash冲突拒绝。
- [ ] 写撤销测试：只移除本工具仍匹配条目；他人后来修改不覆盖；原文件为空/无文件/损坏JSON分别处理；不全文件重写丢注释（宿主格式有注释时使用匹配的parser）。
- [ ] 写关联测试：只选择指定run/session/turnIds；未来turn不自动归属，缺可信turnId或完整回放记录拒绝关联；两同cwd不能自动合并；解除后原生快照恢复独立，reporter计划/状态不变。
- [ ] reporter已waiting时迟到native tool end/Stop不能改active/paused；native可更新来源标注的动作但不能覆盖reporter状态/计划；reporter过期同样不转移owner。
- [x] Run: npm run test -- tests/integration。先FAIL，再实现预览/备份/hash比较/原子替换/回读。
- [x] 将选择来源、导出配置、应用/撤销、关联两个任务放在同一悬浮框的临时设置状态；不增加常驻管理窗口；能返回compact。
- [ ] Run测试与desktop设置交互测试；用隔离临时宿主配置完成安装→更新→撤销往返。用户真实配置修改仅由用户点击确认触发。

#### T11：采集运行加固、健康、保留和失败恢复
**Files:** 修改T06已有collector/main.ts、service.ts与shared/ui-contract.ts；创建collector/supervisor.ts、health.ts；修改storage/repository.ts；tests/integration/collector.test.ts、retention.test.ts、recovery.test.ts。  
**Consumes:** T03Store、T04/05adapters、T06已连通的基础采集器/server、T09ETA。  
**Produces:** startCollector(options:CollectorOptions):Promise<CollectorHandle>；CollectorHandle={stop():Promise<void>}；沿用T06定义的SnapshotUpdate并补充HealthUpdate（shared/ui-contract.ts，显式版本1），不重建第二套采集通路。

- [ ] 测试watch/1秒stat并存不双读提交；心跳10秒、30秒断连；超过180秒未工作但heartbeat在线仍stale；context读取也不刷新。
- [ ] 测试worker崩溃按1/2/5秒最多重启3次，后续必须用户重试；任何adapter异常不会终止其他源；退出关闭监听/端口/DB。
- [ ] 重启后迟到native tool end只可恢复独立被动run，reporter run仍paused，收到reporter active才恢复。
- [x] 测试终态events7天、snapshots30天清理；活动run不删；每批≤500行；100MiB预算触发清理/压力而不是静默丢事件。
- [ ] 测试events已清理但24小时有效幂等回执仍可重试；begin/receipt保留24小时+5分钟，控制记录终态30天；清显示历史不删控制信息；31天旧handle返回410、过期begin key不能重建。预算不得提前驱逐这些记录。
- [x] 清理预算使用SQLite有效页不含freelist；物理库文件未缩小不误报超限，WAL>8MiB空闲checkpoint。与100MiB上限的测试区分有效数据、物理文件和WAL。
- [ ] Run: npm run test -- tests/ingestion/collection.test.ts tests/integration/retention.test.ts tests/integration/recovery.test.ts。先FAIL，再补强已有编排的监控、崩溃恢复和保留策略。
- [ ] 再现数据库写拒绝/磁盘不足：ACK失败、窗口说明记录异常；恢复后同reportId重试不重复。source游标未成功提交不能前移。
- [x] Run全套单元/集成+typecheck；完成一次进程内端到端合成回放，证据明确标“回放”，不冒充真实AI。

### 阶段五：打包、真实验收与交付

**执行顺序：** T12 → T13 → T14。**状态：** 实施中；阶段五审阅修复后源码 37 文件 / 88 项通过，独立审阅的四项 Important 已修复，未签名便携和安装包已完成当前用户隔离路径冒烟；资源和完整真实宿主 / 原生输入门槛未关闭。用户随后授权[紧凑悬浮窗改版](2026-10-27-floating-widget-redesign.md)，原五阶段继续，改版前采样与新版验证分别记录。

目标：把候选版本变成可安装、可验证、可维护的交付物。入口：阶段四通过；退出：打包、真实多工具任务、资源/耐久与安装卸载验收完成，文档和第三方许可齐全。交付里程碑：V1，兼容性只按实际验证范围声明。

#### T12：Windows分发、升级和可撤销安装
**Files:** electron-builder.yml；scripts/fetch-bridge-runtime.mjs、verify-origins.mjs；tests/integration/package-smoke.test.ts；docs/user-guide.md；THIRD_PARTY_NOTICES.md。  
**Consumes:** 完整应用、Node sidecar、T10安装回执。  
**Produces:** win-x64便携压缩包和安装包；哈希清单、依赖/许可证清单。

- [ ] 写package smoke：干净测试用户/隔离VM、PATH无Node、中文目录，启动窗口→helper→MCP tools/list→报告→窗口出现→退出无残留collector。
- [x] 测试升级migrations前备份、迁移失败保留旧库；不能用新程序失败后清空数据库“修复”。
- [ ] 安装默认不开机启动；显式开关可撤销。卸载撤销自己拥有的配置，不删除AI日志；保留个人进度数据默认由卸载界面明确选择。
- [ ] Run: npm run build；npm run package:win；npm run test -- tests/integration/package-smoke.test.ts；npm run verify:origins。期望全部PASS且包包含Node许可/上游NOTICE。
- [ ] 分别测试便携与安装版本，报告是否签名。没有证书时内部包明确标“未签名”，不能称公开发布就绪；代码签名/公开上传另需实际授权与证书，不在本计划中采购。
- [ ] 记录包大小、cold start、资源测量；不能只检验dist目录存在。

#### T13：真实多工具任务与性能验收
**Files:** scripts/replay.mjs、bench.mjs；tests/fixtures/replay/*.jsonl；docs/verification/acceptance.md、performance.md。  
**Consumes:** T12打包产物、设计12节指标。  
**Produces:** 可复核的宿主版本矩阵、验收记录、性能原始数据摘要与失败项。

- [ ] 新增npm run bench和npm run replay入口；合成回放脚本支持--runs 10 --rate 20 --duration 300，包含重复/乱序/重开/等候/报告丢ACK。bench输出每项阈值pass/fail，失败退出非0。
- [ ] Run: npm run bench -- --runs 10 --rate 20 --duration 300；突发100events/s×10s。核对P95端到端延迟≤1秒、日志≤3秒、Private Bytes≤220MiB、CPU≤3%；空闲CPU≤1%另测5分钟。
- [ ] 进行8小时耐久回放；测最后1小时与第2小时Private Bytes中位差≤20MiB。记录驱动器开销并排除测试浏览器/基准自身；工作集另列。
- [ ] Codex真实任务：明确计划→编辑/检查→用户补充范围→工具等待→继续→报告完成→人工验收；检查跨轮run不丢失，百分比允许下降。
- [ ] Claude真实任务：TodoWrite/TaskCreate族+Hook+MCP混合，验证去重、暂停、对话压缩、结束条件，不以assistant Stop认定交付。
- [ ] 两工具同时同目录执行独立工作，核对所有run/step归属零串写；新增第三个MCP宿主（优先Cursor）实测begin→report→finish，并记录卡片/授权可见性。
- [ ] 断开collector/杀死测试应用/睡眠/移除副屏/权限拒绝，确认退化文案与恢复。用户任务不可为了测试故意破坏；使用临时练习仓库。
- [ ] ETA至少采集10个自包含串行任务样本，记录每个预测时点的区间、真实剩余active时长、超时率/未知率；仅10样本不足以承诺统计准确率。首版验收重点是不伪报、不假完成；区间质量用数据暴露。
- [ ] 不可获得真实工具环境时保留unverified项，收缩对外兼容声明；不把fixtures补成“真机通过”。

#### T14：整体交付审查与文档闭环
**Files:** README.md、docs/user-guide.md、integrations.md、development.md、verification/acceptance.md、research复用记录、计划本文件。  
**Consumes:** T01–T13证据。  
**Produces:** 可运行交付包及可追溯“需求→实现→测试→限制”记录。

- [ ] 检查所有用户要求都有验收：多工具、多途径、隐式报告、单悬浮框、hover当前动作、进度与ETA；不以技术覆盖替代用户路径。
- [ ] 清理本任务造成的替代实现/未用依赖/临时shim，尤其上游dashboard、snapshot清理、重复解析路径；保留必要测试fixtures与许可。
- [ ] Run: npm run typecheck；npm run lint；npm run test；npm run test:desktop；npm run verify:docs；npm run verify:origins；npm run build。新变更引起的相关打包/原生验收再跑，避免无原因重复8小时基准。
- [ ] 阅读最终安装指南，从空配置执行一次“安装→选择来源→运行任务→hover→等待处理→完成→退出/卸载”；记录实际步骤而非开发者隐含前置条件。
- [ ] 独立代码/体验审查按执行时用户选择的工作流进行；blocking问题修复并复验后关闭；没有真实证据的项目不勾选。
- [ ] 更新本地来源登记和已验证知识。D:/Self-evolution仅保存可复用的验证结论与限制，同步INDEX；不把待实现方案或临时数据当经验。
- [ ] 交付说明写明版本、包路径/哈希、真实测试结果、已支持工具与版本、未知/不可用场景、是否签名。没有实现/验收的部分明确保留，不以“代码已写”宣布完成。

## 4. 需求与验证追踪
| ID | 要求 | 任务 | 验收证据 |
| --- | --- | --- | --- |
| R01 | 单悬浮框、hover详情 | T01/T08 | 原生前台句柄+双屏录像/记录 |
| R02 | 多AI工具 | T05/T07/T13 | Codex+Claude真实任务，第三MCP宿主矩阵 |
| R03 | 多方式并行 | T04/T06/T07/T10 | 混合源去重/绑定回放+真实链路 |
| R04 | AI隐式报告 | T07/T13 | 聊天无额外进度正文、宿主卡片可见性记录 |
| R05 | 当前动作及时更新 | T06/T08/T11/T13 | P95延迟、lastWorkAt与heartbeat区分 |
| R06 | 可信计划百分比 | T02/T05 | 数量/权重/增范围/失败用例 |
| R07 | 大致完成时间 | T09/T13 | 串行区间、暂停/超时/未知、样本记录 |
| R08 | 不串任务/不误报完成 | T02/T03/T07 | CAS/代次/终态/同目录并发测试 |
| R09 | 本地轻量及可恢复 | T03/T11/T12/T13 | 崩溃、资源、安装卸载实证 |
| R10 | 尽量复用 | T04/T05/T14 | 固定SHA、实际移植清单、许可、对应测试 |

## 5. 计划自检与执行交接
规划自检必须核对：公共类型只在contracts定义、EventBatch顺序与report seq一致、所有新增配置都有撤销路径、上游语义冲突已用回归测试锁定、原生验收与自动化测试不混淆。任何实施时新增功能必须说明对应需求，避免演变成AI任务管理平台。

本计划本身不表示已开始开发。实施按上述五个阶段推进，从阶段一T01开始；阶段一通过后进入阶段二，阶段三结束交付可用悬浮框，阶段五通过才视为V1完成。每阶段记录任务状态、验证证据和未解决问题，不能仅按任务数量勾选阶段完成。方案中的界面尺寸、Windows首发和技术栈为明确默认选择，允许用户在实施前调整；不需要再为“是否研究参考源码”单独确认。
