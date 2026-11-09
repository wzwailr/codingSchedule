import {_electron,type ElectronApplication,type Page} from '@playwright/test';
import {expect,test} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRunState} from '../../src/domain/reducer.js';
import {clock,event} from '../helpers.js';
import {THEMES,type WidgetTheme} from '../../src/shared/themes.js';
import type {RunSnapshot} from '../../src/shared/contracts.js';
const ids=Object.keys(THEMES) as WidgetTheme[];
async function open(dir:string){const app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]});const page=await app.firstWindow();await page.waitForSelector('#screen-content');await page.mouse.move(-20,-20);await page.waitForFunction(()=>document.querySelector<HTMLElement>('#health')?.hidden);return {app,page};}
async function fixture(app:ElectronApplication,page:Page){
 await app.evaluate(({BrowserWindow})=>{const contents=BrowserWindow.getAllWindows()[0]!.webContents,send=contents.send.bind(contents);(globalThis as unknown as {themeFixture:(s:unknown)=>void}).themeFixture=s=>send('schedule:update',{version:1,type:'snapshots',snapshots:[s]});contents.send=(channel,...args)=>{if(channel==='schedule:update'&&args[0]?.type==='snapshots')return;send(channel,...args);};});
 const s=createRunState(event({type:'run.started',title:'完善 CSV 批量导入',scope:'task'}),clock()).snapshot;
 s.nativeSession={id:'theme-fixture',turnId:'one',project:'示例项目',name:'导入校验'};s.progress={value:68,completed:2,total:4,basis:'plan'};s.eta={range:{minSec:480,maxSec:720},basis:'agent',asOf:Date.now()};s.activity='正在验证重复行、空值和错误提示。';s.activitySource={provider:'codex',kind:'reporter'};s.reportedAt=Date.now();s.nativeActivity={lastEventAt:Date.now(),inFlight:true,hasWork:true,action:'调用工具 · 执行导入回归测试'};
 s.plan={revision:1,complete:true,schedule:'serial',steps:['需求对齐','核心实现','回归验证','打包检查'].map((title,i)=>({id:String(i),title,status:i<2?'completed':i===2?'running':'pending',weight:1,evidence:'observed'}))};
 const inject=async(snapshot:RunSnapshot)=>{snapshot.lastWorkAt=Date.now();snapshot.lastSeenAt=Date.now();await app.evaluate((_,value)=>(globalThis as unknown as {themeFixture:(s:unknown)=>void}).themeFixture(value),snapshot);await expect.poll(()=>page.locator('#widget').getAttribute('data-empty')).toBe('false');};
 await inject(s);return {s,inject};
}
async function contentFits(page:Page){
 const result=await page.locator('#screen-content').evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight}));expect(result.scroll).toBeLessThanOrEqual(result.height+1);
 expect(await page.locator('#screen-eta').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
}
test('all selected themes switch through settings, preserve live task and countdown, render three states and survive restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'schedule-themes-'));await writeFile(join(dir,'position.json'),JSON.stringify({anchor:{x:850,y:430}}));let {app,page}=await open(dir);
 const artifacts=resolve('.artifacts/themes');await mkdir(artifacts,{recursive:true});
 try{
  const {s,inject}=await fixture(app,page);
  for(const theme of ids){
   await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'openSettings'}));await page.waitForSelector('#widget-theme');expect(await page.locator('#widget-theme option').count()).toBe(4);
   await page.locator('#widget-theme').selectOption(theme);await expect.poll(()=>page.locator('#widget').getAttribute('data-theme')).toBe(theme);
   await expect.poll(async()=>JSON.parse(await readFile(join(dir,'theme.json'),'utf8')).theme).toBe(theme);
   await page.locator('#back').click();await page.waitForSelector('#details[hidden]',{state:'attached'});await inject(s);
   expect(await page.locator('#screen-progress').textContent()).toBe('68%');expect(await page.locator('#screen-eta').textContent()).toContain('–');await contentFits(page);
   const base=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.getBounds());
   expect([base.width,base.height]).toEqual([THEMES[theme].screen.width+24,THEMES[theme].screen.height+24]);
   await page.screenshot({path:join(artifacts,theme+'-collapsed.png')});
   await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'pinExpanded',value:true}));await page.waitForSelector('#details:not([hidden])');await page.screenshot({path:join(artifacts,theme+'-expanded.png')});
   await page.locator('#activity-execution').click();await expect.poll(()=>page.locator('#activity').textContent()).toContain('调用工具');
   await page.locator('#activity-work').click();await expect.poll(()=>page.locator('#activity').textContent()).toContain('重复行');
   await page.locator('#collapse').click();await page.waitForSelector('#details[hidden]',{state:'attached'});
   // An actual cursor inside a wide fixture correctly prevents edge hiding.
   const placement=await app.evaluate(({screen,BrowserWindow})=>{const area=screen.getPrimaryDisplay().workArea,b=BrowserWindow.getAllWindows()[0]!.getBounds(),cursor=screen.getCursorScreenPoint();return {from:{x:b.x+b.width/2,y:b.y+b.height/2},to:{x:area.x+area.width,y:area.y+area.height*(cursor.y<area.y+area.height/2?.8:.2)}};});
   await page.evaluate(async({from,to})=>{await window.schedule.dispatchUiCommand({type:'hover',inside:false});for(const [phase,point]of[['start',from],['move',to],['end',to]]as const)await window.schedule.dispatchUiCommand({type:'drag',phase,point});},placement);
   await expect.poll(()=>page.locator('#widget').getAttribute('data-edge-hidden'),{timeout:1800}).toBe('true');
   expect(await page.locator('#edge-value').textContent()).not.toBe('—');await page.screenshot({path:join(artifacts,theme+'-edge.png')});
   await page.locator('#edge-tab').click();await expect.poll(()=>page.locator('#widget').getAttribute('data-edge-hidden')).toBe('false');await page.waitForSelector('#details:not([hidden])');
   await page.evaluate(async()=>{await window.schedule.dispatchUiCommand({type:'closeSettings'});await window.schedule.dispatchUiCommand({type:'resetPosition'});});
  }
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'themeSet',value:'terminal'}));await app.close();({app,page}=await open(dir));
  await expect.poll(()=>page.locator('#widget').getAttribute('data-theme')).toBe('terminal');expect(JSON.parse(await readFile(join(dir,'appearance.json'),'utf8'))).toEqual({scale:1,opacity:1});
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},50000);

test('all four themes keep reliable progress and ETA semantics for both providers at all density tiers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'schedule-theme-states-'));const {app,page}=await open(dir);
 try{
  const {s,inject}=await fixture(app,page);
  for(const theme of ids){
   await page.evaluate(value=>window.schedule.dispatchUiCommand({type:'themeSet',value}),theme);
   for(const scale of [.35,.49,.5,.74,.75,1]){
    await page.evaluate(scale=>window.schedule.dispatchUiCommand({type:'appearanceSet',scale,commit:true}),scale);
    const active=structuredClone(s);active.provider=theme==='silver'?'claude':'codex';active.nativeSession!.name='超长会话名称'.repeat(12);active.nativeSession!.project='超长项目名称'.repeat(12);await inject(active);await contentFits(page);
    expect(await page.locator('#compact').getAttribute('aria-label')).toContain(active.nativeSession!.name);
   }
   await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'appearanceSet',scale:1,commit:true}));
   const waiting=structuredClone(s);waiting.status='waiting';await inject(waiting);const frozen=await page.locator('#screen-eta').textContent();await page.waitForTimeout(1100);expect(await page.locator('#screen-eta').textContent()).toBe(frozen);
   const unknown=structuredClone(s);unknown.progress.value=null;await inject(unknown);await expect.poll(()=>page.locator('#screen-progress').textContent()).toBe('—');expect(await page.locator('#screen-eta').textContent()).toContain('–');
   const noEta=structuredClone(s);noEta.eta={basis:'unknown',range:null};await inject(noEta);await expect.poll(()=>page.locator('#screen-eta').textContent()).toBe('—');
   const completePlan=structuredClone(s);completePlan.progress.value=100;await inject(completePlan);await expect.poll(()=>page.locator('#screen-progress').textContent()).toBe('100%');expect(await page.locator('#screen-eta').textContent()).toContain('–');
   const stale=structuredClone(s);stale.freshness='stale';await inject(stale);expect(await page.locator('#screen-state').textContent()).toContain('过期');
   const overdue=structuredClone(s);overdue.eta.asOf=Date.now()-800000;await inject(overdue);await expect.poll(()=>page.locator('#screen-eta').textContent()).toMatch(/^超时 /);
   for(const [status,label]of[['reported_done','AI 已完成'],['verified_done','已验收'],['failed','任务失败']]as const){await inject(s);const ended=structuredClone(s);ended.status=status;await inject(ended);await expect.poll(()=>page.locator('#screen-eta').textContent()).toBe(label);await contentFits(page);}
  }
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},45000);

test('a failed theme save keeps the current theme and reports a recoverable settings error',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'schedule-theme-failure-'));await mkdir(join(dir,'theme.json'));const {app,page}=await open(dir);
 try{
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'openSettings'}));await page.waitForSelector('#widget-theme');
  await page.locator('#widget-theme').selectOption('terminal');await expect.poll(()=>page.locator('#settings-status').textContent()).toContain('主题未保存');
  expect(await page.locator('#widget').getAttribute('data-theme')).toBe('porthole');expect(await page.locator('#widget-theme').inputValue()).toBe('porthole');expect(await page.locator('#widget-theme').isEnabled()).toBe(true);
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},20000);

test('a position-save failure does not roll back a successfully saved theme',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'schedule-theme-position-'));await mkdir(join(dir,'position.json'));const {app,page}=await open(dir);
 try{
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'openSettings'}));await page.waitForSelector('#widget-theme');
  await page.locator('#widget-theme').selectOption('terminal');await expect.poll(()=>page.locator('#settings-status').textContent()).toContain('已切换为像素终端');
  expect(await page.locator('#widget').getAttribute('data-theme')).toBe('terminal');expect(await page.locator('#widget-theme').inputValue()).toBe('terminal');
  expect(JSON.parse(await readFile(join(dir,'theme.json'),'utf8')).theme).toBe('terminal');
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},20000);
