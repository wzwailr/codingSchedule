import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {launchHarness,key} from './harness.mjs';

// Real packaged protocol/UI projection, synthetic task text only. No physical-input claim.
const root=resolve('.artifacts/widget-states');await mkdir(root,{recursive:true});
const h=await launchHarness(process.argv[2]||resolve('release/win-unpacked/codingSchedule.exe'),'widget-states'),errors=[],checks=[],contrast=[];
h.page.on('pageerror',e=>errors.push(e.message));
const assert=(ok,name)=>{checks.push({name,pass:!!ok});if(!ok)throw new Error(name);};
const send=async(operation,body)=>{const r=await h.send(operation,body);assert(r.status===200,operation+' accepted ('+r.status+')');return r.body;};
async function capture(name){
 const layout=await h.page.evaluate(()=>{
  const button=document.querySelector('#settings-button'),scroll=document.querySelector('#task-scroll'),r=button.getBoundingClientRect();
  return {footer:r.top>=0&&r.bottom<=innerHeight,overflow:scroll.scrollWidth>scroll.clientWidth};
 });assert(layout.footer&&!layout.overflow,name+' footer reachable, no horizontal overflow');
 await h.page.screenshot({path:join(root,name+'.png')});
}
async function textContrast(){return h.page.evaluate(()=>{
 const luminance=rgb=>rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
 const rgb=c=>c.match(/[\d.]+/g).map(Number);
 return ['title','activity','summary','basis','provider-label','status'].map(id=>{
  const el=document.getElementById(id),color=rgb(getComputedStyle(el).color);let node=el,bg;
  while(node){bg=rgb(getComputedStyle(node).backgroundColor);if(bg.length===3||bg[3]>0)break;node=node.parentElement;}
  const a=luminance(color),b=luminance(bg);return {id,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
 });
});}
try{
 await h.page.locator('#compact').hover();await h.page.waitForSelector('#details:not([hidden])');await h.page.locator('#pin').click();
 await capture('initial');
 const a=await send('begin',{idempotencyKey:key(),title:'实现多工具任务进度悬浮窗',plan:{revision:1,complete:true,schedule:'serial',steps:[{id:'a',title:'多来源采集与后台汇报',weight:1,status:'completed',evidence:'declared'},{id:'b',title:'悬浮窗体验与真实接入验证',weight:1,status:'running',estimate:{minSec:60,maxSec:180,version:1},evidence:'declared'}]}});
 await h.page.locator('#tasks').selectOption(a.handle.runId);
 await send('report',{handle:a.handle,reportId:key(),seq:2,changes:[{type:'activity.updated',activity:'正在完善任务详情和状态反馈，随后验证多工具接入。'}]});
 await h.page.waitForFunction(()=>document.querySelector('#activity')?.textContent?.includes('正在完善'));
 for(const theme of ['light','dark']){
  await h.page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});await capture('active-'+theme);
  const values=await textContrast();contrast.push({theme,values});assert(values.every(c=>c.ratio>=4.5),theme+' primary and supporting text contrast >=4.5');
 }
 await h.page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
 await send('report',{handle:a.handle,reportId:key(),seq:3,changes:[{type:'run.status',status:'waiting'}]});
 await h.page.waitForFunction(()=>document.querySelector('#eta')?.textContent==='计时暂停');assert(await h.page.locator('#track').getAttribute('aria-valuenow')==='50','waiting keeps plan value');await capture('waiting');
 await send('report',{handle:a.handle,reportId:key(),seq:4,changes:[{type:'run.status',status:'active'},{type:'activity.updated',activity:('长动作内容检查：'+ '检查当前任务、跨工具归属与更新记录。'.repeat(12)).slice(0,120)}]});
 await h.page.waitForFunction(()=>document.querySelector('#activity')?.textContent?.startsWith('长动作内容'));
 await capture('long-activity');assert(await h.page.locator('#task-scroll').evaluate(e=>e.scrollHeight>e.clientHeight),'long activity scrolls within body');
 const b=await send('begin',{idempotencyKey:key(),title:'长中文标题：'+ '多工具进度汇报和悬停详情'.repeat(5)});await h.page.locator('#tasks').selectOption(b.handle.runId);
 await h.page.waitForFunction(()=>document.querySelector('#track')?.getAttribute('aria-valuetext')==='进度未知');assert(await h.page.locator('#track').getAttribute('aria-valuenow')===null,'unknown has no accessible percentage');await capture('unknown');
 await send('finish',{handle:b.handle,reportId:key(),seq:2,summary:'AI 声明完成，尚未人工验收。'});await h.page.waitForFunction(()=>document.querySelectorAll('#tasks option').length===1);
 const completed=await send('context',{handle:b.handle});assert(completed.snapshot.status==='reported_done','completion stays unverified and leaves active list');await capture('completed-hidden');
 // Keyboard traverses real controls; focus is explicitly requested by this verification.
 await h.page.evaluate(()=>window.schedule.dispatchUiCommand({type:'showFocused'}));await h.page.locator('#pin').focus();await h.page.keyboard.press('Tab');
 assert(await h.page.locator('#tasks').evaluate(e=>e===document.activeElement),'keyboard reaches task switcher');
 assert(!errors.length,'no renderer errors');await writeFile(join(root,'result.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks,contrast,errors,scope:'packaged synthetic tasks; no physical IME, DPI or multi-monitor acceptance'},null,2));
 console.log(JSON.stringify({ok:true,checks:checks.length,artifacts:root}));
}finally{await h.close();}
