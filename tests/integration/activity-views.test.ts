import {expect,test} from 'vitest';
import {openStore} from '../../src/storage/repository.js';
import {linkSource} from '../../src/integration/source-link.js';
import {activityContent,visibleSessions} from '../../src/renderer/widget.js';
import {reportBatch} from '../../src/ingestion/normalize-report.js';
import {clock,event,key,source,plan,step} from '../helpers.js';

for(const provider of ['codex','claude'] as const)test(provider+' correlated native updates preserve both perspectives across later agent reports',async()=>{
 const store=await openStore(':memory:',()=>clock()),reporter={...source(),provider},native={...source('native','transcript'),provider,nativeSessionId:'session'};
 try{
  const target=await store.begin({idempotencyKey:key(),title:'task',plan:plan([step('one','completed'),step('two')])},reporter);
  await store.commit(reportBatch(target,key(),2,[{type:'activity.updated',activity:'实现订单校验'}],reporter,clock().wallMs),reporter);
  const passive=await store.resolveNative(native,'turn');
  const observe=async(activity:string,seq:number)=>store.commit({events:[event({type:'activity.updated',activity},{provider,run:{runId:passive.runId,generation:passive.generation},sourceKind:'transcript',nativeSessionId:'session',turnId:'turn',seq})]},native);
  await observe('调用工具 · 读取文件',2);await linkSource(store,target,{provider,nativeSessionId:'session'},{turnIds:['turn']});
  const first=visibleSessions(await store.listSnapshots(),clock().wallMs);expect(first).toHaveLength(1);expect(activityContent(first[0]!,'work').text).toBe('实现订单校验');expect(activityContent(first[0]!,'execution').text).toBe('调用工具 · 读取文件');
  const progress=structuredClone(first[0]!.progress),eta=structuredClone(first[0]!.eta);
  await store.commit(reportBatch(target,key(),3,[{type:'activity.updated',activity:'验证错误输入与回滚'}],reporter,clock().wallMs),reporter);await observe('分析任务',3);
  const next=visibleSessions(await store.listSnapshots(),clock().wallMs);expect(next).toHaveLength(1);expect(activityContent(next[0]!,'work').text).toBe('验证错误输入与回滚');expect(activityContent(next[0]!,'execution').text).toBe('分析任务');expect(next[0]!.progress).toEqual(progress);expect(next[0]!.eta).toEqual(eta);
 }finally{await store.close();}
});
