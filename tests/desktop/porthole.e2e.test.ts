import {_electron} from '@playwright/test';
import {expect,test} from 'vitest';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRunState} from '../../src/domain/reducer.js';
import {clock,event} from '../helpers.js';
import type {RunSnapshot} from '../../src/shared/contracts.js';

test('porthole keeps completion separate from countdown and preserves readable density tiers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'schedule-porthole-'));
 await writeFile(join(dir,'position.json'),JSON.stringify({anchor:{x:450,y:380}}));
 const app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#porthole-ring');await page.mouse.move(-20,-20);
  await page.waitForFunction(()=>document.querySelector<HTMLElement>('#health')?.hidden);
  await app.evaluate(({BrowserWindow})=>{
   const contents=BrowserWindow.getAllWindows()[0]!.webContents,send=contents.send.bind(contents);
   (globalThis as unknown as {portholeFixture:(s:unknown)=>void}).portholeFixture=s=>send('schedule:update',{version:1,type:'snapshots',snapshots:[s]});
   contents.send=(channel,...args)=>{if(channel==='schedule:update'&&args[0]?.type==='snapshots')return;send(channel,...args);};
  });
  const original=createRunState(event({type:'run.started',title:'完善导入校验',scope:'task'}),clock()).snapshot;
  original.nativeSession={id:'porthole-fixture',turnId:'one',project:'示例项目',name:'导入校验'};
  original.activity='正在验证重复行、空值和错误提示。';original.activitySource={provider:'codex',kind:'reporter'};original.reportedAt=Date.now();
  original.plan={revision:1,complete:true,schedule:'serial',steps:['需求对齐','核心实现','回归验证','打包检查'].map((title,i)=>({id:String(i),title,status:i<2?'completed':i===2?'running':'pending',weight:1,evidence:'observed'}))};
  original.progress={value:68,completed:2,total:4,basis:'plan'};
  original.eta={range:{minSec:480,maxSec:720},basis:'agent',asOf:Date.now()};
  const inject=async(snapshot:RunSnapshot)=>{snapshot.lastWorkAt=Date.now();snapshot.lastSeenAt=Date.now();await app.evaluate((_,s)=>(globalThis as unknown as {portholeFixture:(s:unknown)=>void}).portholeFixture(s),snapshot);};
  const fits=async()=>{
   expect(await page.locator('#screen-content').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
   expect(await page.locator('#screen-eta').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  };
  await inject(original);await expect.poll(()=>page.locator('#screen-progress').textContent()).toBe('68%');
  expect(await page.locator('#screen-porthole').getAttribute('data-known')).toBe('true');
  expect(await page.locator('#porthole-ring-value').evaluate(e=>getComputedStyle(e).strokeDashoffset)).toMatch(/^(?:calc\()?32px\)?$/);
  expect(await page.locator('#screen-eta').textContent()).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);await fits();
  const first=await page.locator('#screen-eta').textContent();await expect.poll(()=>page.locator('#screen-eta').textContent(),{timeout:3000}).not.toBe(first);
  const waiting=structuredClone(original);waiting.status='waiting';await inject(waiting);
  await expect.poll(()=>page.locator('#porthole-caption').textContent()).toBe('计时暂停');
  const frozen=await page.locator('#screen-eta').textContent();await page.waitForTimeout(1200);expect(await page.locator('#screen-eta').textContent()).toBe(frozen);
  const unknown=structuredClone(original);unknown.progress.value=null;await inject(unknown);
  await expect.poll(()=>page.locator('#screen-porthole').getAttribute('data-known')).toBe('false');
  expect(await page.locator('#porthole-ring-value').isVisible()).toBe(false);expect(await page.locator('#screen-eta').textContent()).toContain('–');
  const finish=structuredClone(original);finish.progress.value=100;await inject(finish);
  await expect.poll(()=>page.locator('#screen-progress').textContent()).toBe('100%');expect(await page.locator('#screen-eta').textContent()).toContain('–');
  const artifacts=resolve('.artifacts/porthole');await mkdir(artifacts,{recursive:true});
  for(const theme of ['light','dark'] as const){
   await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});await inject(original);await expect.poll(()=>page.locator('#screen-progress').textContent()).toBe('68%');
   await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'closeSettings'}));await page.waitForSelector('#details[hidden]',{state:'attached'});await fits();
   await page.screenshot({path:join(artifacts,'collapsed-'+theme+'.png')});
   await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'pinExpanded',value:true}));await page.waitForSelector('#details:not([hidden])');await fits();
   await page.screenshot({path:join(artifacts,'expanded-'+theme+'.png')});
  }
  for(const scale of [.35,.5,.75,1,1.5]){
   await page.evaluate(scale=>window.schedule.dispatchUiCommand({type:'appearanceSet',scale,commit:true}),scale);
   await inject(original);await expect.poll(()=>page.locator('#widget').getAttribute('data-scale')).toBe(String(scale));await fits();
   expect(await page.locator('#porthole-ring').isVisible()).toBe(scale>=.75);
  }
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'appearanceSet',scale:1,commit:true}));
  const overdue=structuredClone(original);overdue.eta.asOf=Date.now()-800000;await inject(overdue);await expect.poll(()=>page.locator('#screen-eta').textContent()).toMatch(/^超时 /);await fits();
  for(const [status,value] of [['reported_done','AI 已完成'],['verified_done','已验收'],['failed','任务失败']] as const){
   await inject(original);await expect.poll(()=>page.locator('#widget').getAttribute('data-status')).toBe('active');
   const ended=structuredClone(original);ended.status=status;await inject(ended);await expect.poll(()=>page.locator('#screen-eta').textContent()).toBe(value);await fits();
  }
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},40000);
