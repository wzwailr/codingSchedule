# 阶段一、二实施报告
日期：2026-10-26。范围仅T01–T03。分支：codex/phase-1-2，本地仓库无远端推送。

## 当前结论
- 阶段一：工具链、打包、独立Node/MCP、SQLite及本机原生hover核心验证已完成；实际输入混合测试、多屏和150%DPI仍待验收。未将阶段一整体标为完成。
- 阶段二：协议、任务身份、状态机、计划进度、活动时间底座和事务存储已实现并通过验证。
- 阶段三至五：未实施。当前dev入口只显示固定数据技术样机。

## 实现内容
| 路径 | 实现与用途 |
| --- | --- |
| src/shared | 严格类型、Zod边界校验、错误码；模型证据强制declared，禁止伪造验收 |
| src/domain | 新runId/完整RunRef CAS、UUIDv7重试窗、计划/数量完成度、状态权限、活动时间/连续性 |
| src/storage | SQLite WAL/FULL、单事务事件/快照/序号/回执/解析断点；逻辑流重连和终态保护 |
| scripts、tests/fixtures/probe | 官方运行时校验、原生样机、包内MCP及SQLite能力探测 |
| tests/domain、tests/storage | 真实行为回归，含独立进程竞争及COMMIT后强杀，不用mock数据库证明持久性 |

进度不会随时间上涨；没有完整计划时返回unknown；100%计划、AI报告完成和用户验收分别保留。ETA计算在阶段四T09，当前返回unknown。

## 新鲜验证结果
| 命令/检查 | 结果 |
| --- | --- |
| npm run test | 8个测试文件、34项通过（33项领域/存储+1项Electron/运行时） |
| 独立Node24.22.0运行tests/domain、tests/storage | 7文件、33项通过 |
| npm run typecheck | 通过 |
| npm run lint | 通过 |
| npm run build / npm run package:win | 通过，未签名目录包 |
| probe-runtime --exe=打包程序 | 包内SQLite、Node及MCP通过；中文空格路径同样通过 |
| probe-native | 20次原生hover、前台窗口不变，通过；不等于键盘/IME人工验收 |
| 文档相对链接检查 | 通过；输出数字随文档新增而变化，以本次命令结果为准 |

测试先观察到未实现失败，再补实现。存储使用真实临时SQLite；模拟ACK丢失的子进程在COMMIT后被强杀，重开后同reportId返回duplicate、事件仍只一份。不同进程对同native session的begin只有一个成功。

## 独立审阅及修复
一次独立只读审阅提出4项正确性问题，均以新回归测试观察失败并修复，随后全套测试通过：
1. 非owner hook能修改transcript计划步骤：统一所有计划写入的owner校验，原生活动与计划权限分开。
2. passive begin使用随机reporter流身份，后续计划ACK成功却未更新：reporter使用持久逻辑流，native使用真实来源序号；原生计划owner按来源种类/provider/session稳定识别。
3. 只有tool_use/半行时不能提交checkpoint：可信transcript允许无领域事件的解析事务，不伪造工作事件。
4. 去重分支漏提交cursor/checkpoint：重复原生事件仍提交合法断点，文件换代增加expectedCursor CAS，拒绝旧游标回退。

审阅未留待修复的minor项。审阅排除的正式MCP/HTTP/绑定、ETA、保留清理、完整UI属于T06/T07/T09/T10/T11及以后；当前旧handle只作用于自身旧run，不会串写新run。这些范围裁定不会把未来功能冒充已实现。

## 实施裁定、依据和风险
- 新空项目在原目录建立开发分支，未创建第二checkout：没有已有源码或分支要隔离；风险是后续若出现并行编辑，仍须检查当前工作区。
- 技能脚本只识别Task N标题，本计划为T01等五阶段层级，因此直接维护本项目执行账本与阶段报告；风险是继续执行时必须同时读计划状态与报告。
- TypeScript7与typescript-eslint的peer范围冲突，锁定6.0.3；不强制忽略peer冲突。未来工具升级需重验。
- SDK本地README表明v2是当前稳定线，选官方server/client/core2.4.0；删除已替代的v1 SDK。其完整许可包含MIT→Apache过渡说明，不能只写单一许可标签。
- 独立Node下载受连接超时影响，采用官方HTTPS+curl断点续传+最终SHA校验；依赖Windows自带curl，其他平台需实现等价下载器。
- 补充TrustedSource.kind、内部canVerify、reporter batch.handle及checkpoint读取/expectedCursor；否则边界层无法证明来源/恢复和换代权限。这些均为内部接口，不能由模型自报权限。
- begin使用seq=1，后续写入必须取context.nextSeq；reporter序号连续，原生日志流只要求递增。风险是未来桥接器硬编码序号会收到冲突，因此已写入开发指南。
- 原生测量使用客户区而非含不可见边框的GetWindowRect；尺寸未放宽。单屏自动hover不代替实际键盘、IME和物理多屏验收。
- 阶段一补验未关闭时，先推进不依赖这些UI环境的阶段二逻辑；阶段三前仍须复核界面门槛。若后续换壳，需重新验证窗口/运行时集成，领域和存储测试不能证明新壳体验。
- 未连续观测超过180秒、单调/墙钟差超过2秒或continuityId变化时，不累计这段活动耗时；这是保守防虚报，可能少计真实长工具时间，需要后续collector心跳维持连续性。

## 证据与限制
完整M0矩阵见[本机能力报告](m0-capabilities.md)。原始JSON在.artifacts/probe，运行时包在release/win-unpacked；它们是本机测试产物，不能证明干净新电脑、所有AI工具或完整产品已验收。可复用源码仍按[研究清单](../research/2026-10-26-reference-source-review.md)执行，CCAM解析代码移植尚未开始。
