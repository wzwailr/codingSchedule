// Synthetic integration acceptance: shipped Node + MCP + async Hook + widget.
// Does not claim that an actual model chose this fixture's estimate.
import {join,resolve,dirname} from 'node:path';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
import {launchHarness,key,sleep} from './harness.mjs';
const executable=resolve(process.argv.find(a=>a.startsWith('--exe='))?.slice(6)||join(process.env.SCHEDULE_TEST_PACKAGE_DIR||'release/win-unpacked','codingSchedule.exe'));
const h=await launchHarness(executable,'eta-inquiry'),errors=[];h.page.on('pageerror',e=>errors.push(e.message));
const root=h.dir;await mkdir(join(root,'screenshots'));
const assert=(v,message)=>{if(!v)throw new Error(message);};
try{
 const call=async(name,body)=>{const r=await h.client.callTool({name,arguments:body});assert(!r.isError,'MCP '+name+' failed');return JSON.parse(r.content[0].text);};
 const {handle}=await call('progress_begin',{idempotencyKey:key(),title:'后台估时：原任务继续运行'});
 const before=await call('progress_context',{handle});assert(before.etaQuestion&&before.etaInstruction,'Product question missing');
 await h.page.locator('#compact').hover();await h.page.waitForSelector('#details:not([hidden])');
 await h.page.locator('#tasks').selectOption(handle.runId);
 await h.page.waitForFunction(()=>document.querySelector('#summary')?.textContent.includes('等待 agent 估时'));
 await h.page.evaluate(()=>window.schedule.dispatchUiCommand({type:'closeSettings'}));await h.page.waitForFunction(()=>document.querySelector('#details')?.hidden&&innerWidth===148);
 await h.page.screenshot({path:join(root,'screenshots','queued-compact.png')});
 await h.append({type:'response_item',timestamp:new Date().toISOString(),payload:{type:'function_call',name:'exec_command',call_id:'eta-owned-call',arguments:JSON.stringify({cmd:'fixture: verify current task'})}});
 await h.page.evaluate(()=>window.schedule.dispatchUiCommand({type:'hover',inside:true}));await h.page.waitForSelector('#details:not([hidden])');await h.page.locator('#settings-button').click();await h.page.waitForSelector('#login-startup');
 let native;
 for(let i=0;i<50;i++){const data=await h.page.evaluate(()=>window.schedule.dispatchUiCommand({type:'settingsRead'}));native=data.nativeSources.find(n=>n.provider==='codex'&&n.turnId==='bench-turn');if(native)break;await sleep(100);}
 assert(native,'Native fixture not collected');
 await h.page.evaluate(({run,nativeRun})=>window.schedule.dispatchUiCommand({type:'linkSource',run,nativeRun}),{run:{runId:handle.runId,generation:handle.generation},nativeRun:native.run});
 const configPath=join(root,'isolated-codex-hooks.json');
 const preview=await h.page.evaluate(configPath=>window.schedule.dispatchUiCommand({type:'integrationPreview',host:'codex-hooks',configPath}),configPath);
 const applied=await h.page.evaluate(previewId=>window.schedule.dispatchUiCommand({type:'integrationApply',previewId}),preview.previewId);assert(applied.applied,'Hook config apply failed');
 const installed=JSON.parse(await readFile(configPath,'utf8')).hooks.PostToolUse[0].hooks[0];assert(installed.async===true,'Hook must be async');
 const credentialPath=join(root,'connectors',createHash('sha256').update('codex-hook').digest('hex')+'.json');
 const script=join(dirname(executable),'resources/integrations/hooks/codex.cjs');
 const out=await new Promise((done,reject)=>{const c=spawn(h.runtime,[script,'--credential',credentialPath,'--endpoint',h.endpointPath,'--estimate'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);c.once('error',reject);c.on('close',code=>code===0&&!stderr?done(stdout):reject(new Error('Hook exit '+code)));c.stdin.end(JSON.stringify({session_id:'bench-native',turn_id:'bench-turn',tool_use_id:'eta-owned-call',tool_name:'exec_command',hook_event_name:'PostToolUse'}));});
 const output=JSON.parse(out);assert(Object.keys(output).join(',')==='hookSpecificOutput','Hook emitted other output');assert(output.hookSpecificOutput.additionalContext.includes(before.etaQuestion.requestId),'Wrong question');assert(!out.includes(handle.resumeHandle),'Private handle exposed');
 const ctx=await call('progress_context',{handle});assert(ctx.snapshot.etaInquiry.state==='sent','Hook delivery state missing');
 await call('progress_report',{handle,reportId:key(),seq:ctx.nextSeq,changes:[{type:'eta.answered',requestId:ctx.etaQuestion.requestId,planRevision:0,range:{minSec:180,maxSec:300},reason:'Synthetic acceptance fixture: remaining implementation and verification'}]});
 const answered=await call('progress_context',{handle});assert(answered.snapshot.eta.basis==='agent','Answer not applied');assert(answered.snapshot.lastWorkAt===ctx.snapshot.lastWorkAt,'ETA pretended to be work');assert(answered.snapshot.progress.value===null,'ETA manufactured progress');
 const settings=await h.page.evaluate(()=>window.schedule.dispatchUiCommand({type:'settingsRead'}));const receipt=settings.receipts.find(r=>r.path===configPath);assert(receipt,'Receipt missing');assert((await h.page.evaluate(receiptId=>window.schedule.dispatchUiCommand({type:'integrationRevert',receiptId}),receipt.id)).applied,'Revoke failed');
 await h.page.locator('#back').click();await h.page.evaluate(()=>window.schedule.dispatchUiCommand({type:'hover',inside:true}));await h.page.waitForSelector('#details:not([hidden])');
 await h.page.waitForFunction(()=>document.querySelector('#eta')?.textContent.includes('AI 粗估'));
 await h.page.screenshot({path:join(root,'screenshots','agent-estimate-light.png')});
 await h.page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await h.page.screenshot({path:join(root,'screenshots','agent-estimate-dark.png')});
 await call('progress_report',{handle,reportId:key(),seq:answered.nextSeq,changes:[{type:'run.status',status:'waiting'}]});await h.page.waitForFunction(()=>document.querySelector('#eta')?.textContent?.startsWith('计时暂停'));
 await h.page.screenshot({path:join(root,'screenshots','waiting-dark.png')});assert(errors.length===0,'Renderer errors');
 const asarHash=createHash('sha256').update(await readFile(join(dirname(executable),'resources/app.asar'))).digest('hex');
 const result={verifiedAt:new Date().toISOString(),executable,asarHash,tools:h.tools,productQuestion:true,exactNativeLink:true,asyncHookContext:true,originalReporterAnswer:true,syntheticEstimate:true,workTimestampUnchanged:true,progressUnknown:true,hookConfigApplyRevoke:true,rendererErrors:errors,screenshots:join(root,'screenshots'),scope:'Actual packaged process integration; fixture drives the agent answer. Native host/model safe-point delivery and natural Skill triggering are separate acceptance.'};
 await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({dir:root,...result}));
}finally{await h.close();}
