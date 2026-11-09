// Local tokenizer measurement only: no model requests, billing API or chat logs.
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
import {launchHarness,key} from './harness.mjs';
const option=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const {getEncoding}=await import(pathToFileURL(resolve(option('--tokenizer')||'.artifacts/tokenizer-js/node_modules/js-tiktoken/dist/index.js')).href);
const encodings=Object.fromEntries(['o200k_base','cl100k_base'].map(name=>[name,getEncoding(name)]));
const count=text=>Object.fromEntries(Object.entries(encodings).map(([name,enc])=>[name,enc.encode(typeof text==='string'?text:JSON.stringify(text)).length]));
const exe=resolve(option('--exe')||join(process.env.SCHEDULE_TEST_PACKAGE_DIR||'release/win-unpacked','codingSchedule.exe')),h=await launchHarness(exe,'report-token-sample'),samples=[];
try{
 const tools=await h.client.listTools(),resources=resolve(exe,'../resources');
 const fixed={tools:count(tools.tools),serverInstructions:count(h.client.getInstructions()||''),skill:count(await readFile(join(resources,'integrations/skill/SKILL.md'),'utf8')),defaultRule:count(await readFile(join(resources,'integrations/reporting-rule.md'),'utf8'))};
 const call=async(label,name,args)=>{
  const result=await h.client.callTool({name,arguments:args});if(result.isError)throw new Error('Measurement fixture rejected');
  const value=JSON.parse(result.content[0].text);samples.push({label,generatedArguments:count({name,arguments:args}),returnedText:count(result.content[0].text)});return value;
 };
 const begin=await call('begin','progress_begin',{idempotencyKey:key(),title:'验证批量导入与错误提示',plan:{revision:1,complete:true,schedule:'serial',steps:[{id:'read',title:'核对字段与数据边界',weight:1,evidence:'declared',status:'running'},{id:'verify',title:'验证正常与异常场景',weight:2,evidence:'declared',status:'pending'}]}}),handle=begin.handle;
 let c=await call('initial-context','progress_context',{handle});
 await call('initial-report-with-eta','progress_report',{handle,reportId:key(),seq:c.nextSeq,changes:[{type:'activity.updated',activity:'已确认导入字段映射，正在实现校验与错误提示'},{type:'eta.answered',requestId:c.etaQuestion.requestId,planRevision:1,range:{minSec:600,maxSec:900},reason:'剩余为校验实现及正常与异常验证'}]});
 c=await call('action-context','progress_context',{handle});await call('action-only-report','progress_report',{handle,reportId:key(),seq:c.nextSeq,changes:[{type:'activity.updated',activity:'正在检查重复字段与空值处理，补齐失败后的恢复提示'}]});
 c=await call('step-context','progress_context',{handle});await call('step-report','progress_report',{handle,reportId:key(),seq:c.nextSeq,changes:[{type:'activity.updated',activity:'字段校验已完成，开始验证异常输入与回滚'},{type:'step.updated',revision:1,step:{id:'read',title:'核对字段与数据边界',weight:1,evidence:'verified',status:'completed'}}]});
 c=await call('complete-context','progress_context',{handle});await call('complete-step-report','progress_report',{handle,reportId:key(),seq:c.nextSeq,changes:[{type:'step.updated',revision:1,step:{id:'verify',title:'验证正常与异常场景',weight:2,evidence:'verified',status:'completed'}}]});
 c=await call('finish-context','progress_context',{handle});await call('finish','progress_finish',{handle,reportId:key(),seq:c.nextSeq,summary:'正常与异常导入均已验证，待用户验收'});
 const report={measuredAt:new Date().toISOString(),tokenizer:'js-tiktoken 1.0.21; BPE proxy counts, not exact Codex/Claude billing',fixed,samples,limitations:['Synthetic two-step Chinese fixture using real packaged MCP responses; no paid model invocation','Host message/tool framing, reasoning and cache reuse are not measured','Claude uses a different tokenizer; these two encodings are comparison proxies, not guaranteed lower/upper bounds','Counts describe newly added text. Repeated context history contributes additional input tokens on later inference turns.']};
 await mkdir('.artifacts/onboarding',{recursive:true});await writeFile('.artifacts/onboarding/token-measurement.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await h.close();}
