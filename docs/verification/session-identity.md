# 同一会话重复显示与名称修复

当前标签已按后续需求改为“项目名称 · session名称”，并加入Claude Code显式标题读取；本页保留v16当时的四位编号验收事实。新版证据见[倒计时与兼容验证](eta-countdown.md)。

日期：2026-10-29，Windows 11 / Electron45；日常运行目录`release/session-identity-final-v16/win-unpacked`，未签名内部候选。本轮不重启耐久。

## 原因与实现

用户反馈的两个选项分别为原生会话观察和原agent的整体汇报任务。前一轮已补齐跨项目默认汇报，但原有来源关联仅手动启用，因此同一session被投影成两项。

采集器现在按本工具begin/context实际返回的公开任务引用自动关联；代码包装隐藏返回时，由Skill在同一次工具输出中发送codingScheduleBinding公开引用。只保存runId/generation和当前来源session/turn，不保存resumeHandle、凭据、代码或模型正文；不按标题、目录或时间猜测，不覆盖其他会话或手动绑定。来源关联与游标事务一同提交，重复取件幂等，跨轮继续任务选择最新generation。

Codex会话名称读取宿主session_index.jsonl，最多读取末2MiB，按文件变化缓存；名称改变但原始日志未变时也发布元数据更新。悬浮框及设置原生会话选项均显示“会话名称 · 末四位”，无名称才回退到项目名；设置仅列可关联的活动会话。

## 新鲜验证

- 先得到重复两项、名称缺失与旧长编号的失败回归，再实现；9文件30项先通过。
- 首次现场发现真实Codex输出为input_text数组，最初合成样本未覆盖，v15未自动关联；保留反例并补实际数组回归，未把早期合成测试当作现场成功。
- 最终11文件38项全部通过，包含真实Electron窗口2项及既有窗口5项，覆盖两项到一项、保留50%计划、实时重命名、四位标签、跨来源/跨轮隔离、旧generation、失败/歧义输出及事务回滚。类型/lint通过。
- v16已在日常共享数据上启用。原agent保留同一私有句柄跨窗口重连，成功输出公开引用后，数据库自动产生本聊天当前轮次的来源关联；未通过设置手动配对。现场截图实际显示“查找 AI 任务实时进度工具 · 8c68”和计划80%，无重复附加项；原生visible/topmost均为true。
- 切换前执行完整integrity_check并通过SQLite backup备份，保留原库及旧记录。接入配置只更新本工具路径，其他配置语义不变，原生转发器四工具握手通过；既有Codex不重启，耐久保持cancelled。

证据：`.artifacts/session-identity-{red,link-red,host-shape-red,final-tests,window,typecheck,lint}.log`，以及`session-identity-{backup,default-v16,config-applied,skill-update,live-proof}.json`。最终只读校验完整性通过，切换前旧run缺失0，实际可见会话数1、当前session项数1且计划80%。数据库和备份含私有材料，不上传。

边界：Claude解析器有夹具回归，未新增真实Claude登录验收。隐藏结果的旧Skill任务无公开引用时不强行猜关联；需原agent正常下一轮读取更新Skill。此次只形成并启用目录候选，未重新生成v16 ZIP/安装器，也未重跑完整资源门禁或耐久；不关闭V1验收。
