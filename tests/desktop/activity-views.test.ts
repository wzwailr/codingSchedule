import {expect,test} from 'vitest';
import {activityContent} from '../../src/renderer/widget.js';
import {createRunState} from '../../src/domain/reducer.js';
import {clock,event} from '../helpers.js';

for(const provider of ['codex','claude'] as const)test(provider+' keeps reported work and observed execution separate without changing progress or time',()=>{
 const s=createRunState(event({type:'run.started',title:'task',scope:'task'},{provider}),clock()).snapshot;
 s.activity='修复数据库一致性';s.activitySource={provider,kind:'reporter'};s.reportedAt=100;s.nativeActivity={lastEventAt:200,inFlight:true,action:'调用工具 · Read'};
 s.progress.value=50;s.eta={range:{minSec:60,maxSec:120},basis:'agent',asOf:100};const before=structuredClone(s);
 expect(activityContent(s,'work')).toEqual({text:'修复数据库一致性',source:'AI 汇报',at:100});expect(activityContent(s,'execution')).toEqual({text:'调用工具 · Read',source:'会话观察',at:200});expect(s).toEqual(before);
});
test('native-only sessions do not invent a work report and reporter-only tasks do not invent execution',()=>{
 const s=createRunState(event({type:'run.started',title:'task',scope:'turn'}),clock()).snapshot;s.activity='分析任务';s.activitySource={provider:'codex',kind:'transcript'};
 expect(activityContent(s,'work').text).toBe('尚未收到具体工作事项');expect(activityContent(s,'execution').text).toBe('分析任务');
 s.scope='task';s.activity='实现导入校验';s.activitySource.kind='reporter';delete s.nativeActivity;
 expect(activityContent(s,'work').text).toBe('实现导入校验');expect(activityContent(s,'execution').text).toBe('尚未检测到执行状态');
 s.nativeActivity={lastEventAt:300,inFlight:true};expect(activityContent(s,'execution').text).toBe('工具执行中');
});
