import {resolve,join} from 'node:path';import {mkdir,mkdtemp,cp,readFile,writeFile} from 'node:fs/promises';
import {launchHarness,key,sleep} from './harness.mjs';
const root=resolve('.artifacts/package-smoke');await mkdir(root,{recursive:true});const copied=await mkdtemp(join(root,'中文 程序-'));
const source=resolve(process.argv.find(a=>a.startsWith('--dir='))?.slice(6)||'release/win-unpacked');await cp(source,copied,{recursive:true});
for(const path of ['resources/bridge-runtime/LICENSE','resources/THIRD_PARTY_NOTICES.md','resources/dependency-notices/dependencies.json','resources/integration/remove-cli.cjs','resources/docs/user-guide.md','resources/docs/integrations.md','resources/README.md'])await readFile(join(copied,path));
const h=await launchHarness(join(copied,'codingSchedule.exe'),'package-smoke'),errors=[];h.page.on('pageerror',e=>errors.push(e.message));let pids;
try{
 if(h.tools.length!==4)throw new Error('MCP tools/list mismatch');
 const result=await h.client.callTool({name:'progress_begin',arguments:{idempotencyKey:key(),title:'中文路径包验证',plan:{revision:1,complete:true,schedule:'serial',steps:[{id:'one',title:'检查窗口',weight:1,status:'running',evidence:'declared'}]}}});
 if(result.isError)throw new Error('Begin failed');const handle=JSON.parse(result.content[0].text).handle;
 const report=await h.client.callTool({name:'progress_report',arguments:{handle,reportId:key(),seq:2,changes:[{type:'activity.updated',activity:'包内 MCP 报告已到达'}]}});if(report.isError)throw new Error('Report failed');
 await h.page.locator('#compact').hover();await h.page.waitForSelector('#details:not([hidden])');await h.page.locator('#tasks').selectOption(handle.runId);
 await h.page.waitForFunction(()=>document.querySelector('#activity')?.textContent==='包内 MCP 报告已到达');pids=await h.pids();
 if(errors.length)throw new Error('Renderer error');
}finally{await h.close();}
await sleep(750);const remaining=pids.filter(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});
const result={ok:remaining.length===0&&errors.length===0,scope:'same Windows user, copied Chinese executable/data paths, PATH without Node; not clean VM/user acceptance',coldStartMs:h.coldStartMs,tools:h.tools,remainingProcesses:remaining.length,errors,artifacts:copied};
await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
