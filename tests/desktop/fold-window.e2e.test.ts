import {_electron} from '@playwright/test';
import {expect,test} from 'vitest';
import {mkdtemp,rm,writeFile,mkdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {sendLocal} from '../../src/bridge/transport.js';import {createRunState} from '../../src/domain/reducer.js';import {clock,event,key} from '../helpers.js';
import type {RunSnapshot} from '../../src/shared/contracts.js';
const artifacts=resolve('.artifacts/fold-window');
async function launch(){const dir=await mkdtemp(join(tmpdir(),'fold-window-'));await writeFile(join(dir,'position.json'),JSON.stringify({x:80,y:100}));return {dir,app:await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]})};}
test('real data follows both surfaces, folding shrinks the native window and preserves anchor, pin/collapse/keyboard work',async()=>{
 const {app,dir}=await launch();
 try{
  const page=await app.firstWindow();await page.waitForSelector('#compact');
  const bounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.getBounds());
  const anchor=async()=>{const b=await bounds(),r=await page.locator('#compact').boundingBox();return {x:b.x+r!.x+r!.width/2,y:b.y+r!.y+r!.height/2};};
  expect((await bounds()).width).toBe(148);expect(await page.locator('#details').isHidden()).toBe(true);
  const dragBefore=await bounds();
  await page.evaluate(async()=>{for(const command of [{phase:'start',point:{x:200,y:200}},{phase:'move',point:{x:300,y:240}},{phase:'end',point:{x:300,y:240}}] as const)await window.schedule.dispatchUiCommand({type:'drag',...command});});
  expect((await bounds()).x).toBe(dragBefore.x+100);expect((await bounds()).y).toBe(dragBefore.y+40);
  expect(await page.locator('#screen-session').textContent()).toBe('暂无活动会话');
  const endpointPath=join(dir,'endpoint.json'),credentialPath=join(dir,'connectors',createHash('sha256').update('codex-reporter').digest('hex')+'.json');
  await expect.poll(()=>access(endpointPath).then(()=>true).catch(()=>false),{timeout:12000}).toBe(true);
  const result=await sendLocal({operation:'begin',body:{idempotencyKey:key(Date.now()),title:'真实双翼进度任务',plan:{revision:1,complete:true,schedule:'serial',steps:[{id:'one',title:'已验证的工作',status:'completed',weight:1,evidence:'verified'},{id:'two',title:'正在验证折展',status:'running',weight:1,evidence:'observed',estimate:{minSec:60,maxSec:120,version:1}}]}},connectorId:'codex-reporter',endpointPath,credentialPath});expect(result.status).toBe(200);
  await page.waitForFunction(()=>document.querySelector('#screen-progress')?.textContent==='50%');
  expect(await page.locator('#screen-eta').textContent()).toMatch(/\d\d:\d\d/);
  const before=await anchor();await page.locator('#compact').hover();await page.waitForSelector('#details:not([hidden])');
  expect((await bounds()).width).toBe(456);const after=await anchor();expect(after.x).toBeCloseTo(before.x,1);expect(after.y).toBeCloseTo(before.y,1);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isFocused())).toBe(false);
  await page.locator('#pin').click();await page.mouse.move(-20,-20);await page.waitForTimeout(550);expect(await page.locator('#details').isVisible()).toBe(true);
  await page.locator('#collapse').click();await page.waitForSelector('#details[hidden]',{state:'attached'});expect((await bounds()).width).toBe(148);expect(await page.locator('#pin').getAttribute('aria-pressed')).toBe('false');
  const again=await anchor();expect(again.x).toBeCloseTo(before.x,1);expect(again.y).toBeCloseTo(before.y,1);
  await page.waitForTimeout(450);expect(await page.locator('#details').isHidden()).toBe(true);
  await page.mouse.move(-20,-20);await page.locator('#compact').click();await page.waitForSelector('#details:not([hidden])');
  await page.mouse.move(-20,-20);await page.waitForSelector('#details[hidden]',{state:'attached'});
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'showFocused'}));await page.locator('#compact').focus();await page.keyboard.press('Enter');await page.waitForSelector('#details[hidden]',{state:'attached'});
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'showFocused'}));await page.keyboard.press('Escape');await page.waitForSelector('#details[hidden]',{state:'attached'});
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},30000);
test('OLED and detail states distinguish unknown, waiting, stale, overtime, failure and completion in light/dark themes',async()=>{
 const {app,dir}=await launch();await mkdir(artifacts,{recursive:true});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#compact');await page.mouse.move(-20,-20);
  await page.waitForFunction(()=>document.querySelector<HTMLElement>('#health')?.hidden);
  // Presentation fixtures are isolated from the empty real collector. The other
  // test above uses its actual HTTP/SQLite pipeline and unchanged IPC bridge.
  await app.evaluate(({BrowserWindow})=>{
   const contents=BrowserWindow.getAllWindows()[0]!.webContents,send=contents.send.bind(contents);
   (globalThis as unknown as {foldFixture:(snapshot:unknown)=>void}).foldFixture=snapshot=>send('schedule:update',{version:1,type:'snapshots',snapshots:[snapshot]});
   contents.send=(channel,...args)=>{if(channel==='schedule:update'&&args[0]?.type==='snapshots')return;send(channel,...args);};
  });
  const original=createRunState(event({type:'run.started',title:'验证完整任务标题',scope:'task'}),clock()).snapshot;
  original.nativeSession={id:'fixture-session',turnId:'fixture-turn',project:'示例工程 · 很长的项目名称',name:'校验中文与超长会话名称的显示和可访问性'};original.activity='正在验证长动作的可读性与内部滚动。'.repeat(20);
  const inject=async(snapshot:RunSnapshot)=>{snapshot.lastWorkAt=Date.now();snapshot.lastSeenAt=Date.now();await app.evaluate((_,s)=>(globalThis as unknown as {foldFixture:(snapshot:unknown)=>void}).foldFixture(s),snapshot);};
  await inject(structuredClone(original));await page.waitForFunction(()=>document.querySelector('#screen-session')?.textContent?.startsWith('校验中文'));
  expect(await page.locator('#screen-progress').textContent()).toBe('—');expect(await page.locator('#screen-eta').textContent()).toBe('—');
  const active=structuredClone(original);active.progress={value:50,completed:10,total:20,basis:'plan'};active.eta={range:{minSec:120,maxSec:240},basis:'agent',asOf:Date.now()};active.plan={revision:1,complete:true,schedule:'serial',steps:Array.from({length:20},(_,i)=>({id:'s'+i,title:'真实步骤标题长度测试 '.repeat(3)+i,status:i<10?'completed':i===10?'running':'pending',weight:1,evidence:'observed'}))};
  await inject(active);await page.waitForFunction(()=>document.querySelector('#screen-progress')?.textContent==='50%');
  await page.emulateMedia({colorScheme:'light'});await page.screenshot({path:join(artifacts,'running-collapsed-light.png')});
  await page.locator('#compact').hover();await page.waitForSelector('#details:not([hidden])');await page.locator('#pin').click();
  expect(await page.locator('#task-scroll').evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);expect(await page.locator('#activity').evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  expect(await page.locator('#compact').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
  const settings=await page.locator('#settings-button').boundingBox();expect(settings!.y+settings!.height).toBeLessThan(await page.evaluate(()=>innerHeight));
  await page.screenshot({path:join(artifacts,'running-expanded-light.png')});
  const longEta=structuredClone(active);longEta.eta.range={minSec:172800,maxSec:604800};await inject(longEta);await page.waitForFunction(()=>document.querySelector('#screen-eta')?.textContent?.startsWith('约'));
  expect(await page.locator('#compact').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);await inject(active);
  const light=await page.locator('#details').evaluate(e=>getComputedStyle(e).backgroundImage);await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});expect(await page.locator('#details').evaluate(e=>getComputedStyle(e).backgroundImage)).not.toBe(light);expect(await page.locator('#details').evaluate(e=>getComputedStyle(e).animationName)).toBe('none');await page.screenshot({path:join(artifacts,'running-expanded-dark.png')});
  const waiting=structuredClone(active);waiting.status='waiting';await inject(waiting);await page.waitForFunction(()=>document.querySelector('#screen-eta-label')?.textContent?.startsWith('计时暂停'));
  const frozen=await page.locator('#screen-eta').textContent();await page.waitForTimeout(1100);expect(await page.locator('#screen-eta').textContent()).toBe(frozen);
  const stale=structuredClone(active);stale.freshness='stale';await inject(stale);await page.waitForFunction(()=>document.querySelector('#screen-freshness')?.textContent==='状态可能过期');expect(await page.locator('#screen-eta').textContent()).not.toBe('—');
  const overdue=structuredClone(active);overdue.eta.asOf=Date.now()-300000;await inject(overdue);await page.waitForFunction(()=>document.querySelector('#screen-eta')?.textContent?.startsWith('超时 '));
  for(const [status,value,label] of [['failed','任务失败','展开查看当前动作'],['reported_done','AI 已完成','尚待人工验收'],['verified_done','已验收','人工确认完成']] as const){
   await inject(structuredClone(active));await page.waitForFunction(()=>document.querySelector('#widget')?.getAttribute('data-status')==='active');const ended=structuredClone(active);ended.status=status;await inject(ended);
   await page.waitForFunction(v=>document.querySelector('#screen-eta')?.textContent===v,value);expect(await page.locator('#screen-eta-label').textContent()).toBe(label);expect(await page.locator('#tasks option').count()).toBe(0);
  }
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},30000);
