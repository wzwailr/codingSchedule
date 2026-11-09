import {_electron} from '@playwright/test';
import {expect,test} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createRunState} from '../../src/domain/reducer.js';
import {clock,event} from '../helpers.js';
import type {RunSnapshot} from '../../src/shared/contracts.js';

test('users switch both perspectives in place, keep timers, persist choice, and retain the choice across providers and relaunch',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'activity-views-')),artifacts=resolve('.artifacts/activity-views/screens');await mkdir(artifacts,{recursive:true});await writeFile(join(dir,'view.json'),JSON.stringify({activityView:'invalid'}));await writeFile(join(dir,'position.json'),JSON.stringify({x:300,y:180}));
 let app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]});
 try{
  let page=await app.firstWindow();await page.waitForSelector('#activity-work',{state:'attached'});await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'pinExpanded',value:true}));await page.waitForFunction(()=>document.querySelector<HTMLElement>('#health')?.hidden);
  await app.evaluate(({BrowserWindow})=>{const contents=BrowserWindow.getAllWindows()[0]!.webContents,send=contents.send.bind(contents);(globalThis as unknown as {viewFixture:(s:unknown)=>void}).viewFixture=s=>send('schedule:update',{version:1,type:'snapshots',snapshots:[s]});contents.send=(channel,...args)=>{if(channel==='schedule:update'&&args[0]?.type==='snapshots')return;send(channel,...args);};});
  const s=createRunState(event({type:'run.started',title:'校验订单导入',scope:'task'}),clock()).snapshot;s.activity='验证导入文件与错误回滚';s.activitySource={provider:'codex',kind:'reporter'};s.reportedAt=Date.now();s.nativeActivity={lastEventAt:Date.now(),inFlight:true,hasWork:true,action:'调用工具 · exec_command'};s.lastWorkAt=s.lastSeenAt=Date.now();s.status='waiting';s.progress={value:50,completed:1,total:2,basis:'plan'};s.eta={range:{minSec:120,maxSec:240},basis:'agent',asOf:Date.now()};
  const inject=async(snapshot:RunSnapshot)=>app.evaluate((_,s)=>(globalThis as unknown as {viewFixture:(s:unknown)=>void}).viewFixture(s),snapshot);
  await inject(s);await expect.poll(()=>page.locator('#activity').textContent()).toBe(s.activity);expect(await page.locator('#activity-work').getAttribute('aria-pressed')).toBe('true');const frozen=await page.locator('#eta').textContent();
  await page.locator('#activity-execution').click();await expect.poll(()=>page.locator('#activity').textContent()).toBe('调用工具 · exec_command');expect(await page.locator('#activity-source').textContent()).toContain('会话观察');expect(await page.locator('#activity-execution').getAttribute('aria-pressed')).toBe('true');expect(await page.locator('#eta').textContent()).toBe(frozen);expect(await page.locator('#progress').textContent()).toBe('50%');
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isFocused())).toBe(false);expect(JSON.parse(await readFile(join(dir,'view.json'),'utf8'))).toEqual({activityView:'execution'});
  for(const colorScheme of ['light','dark'] as const){await page.emulateMedia({colorScheme});await page.screenshot({path:join(artifacts,'execution-'+colorScheme+'.png')});}
  s.provider='claude';s.activitySource.provider='claude';s.nativeActivity.action='调用工具 · Read';s.activity='检查敏感字段规则';await inject(s);await expect.poll(()=>page.locator('#activity').textContent()).toBe('调用工具 · Read');
  await page.locator('#activity-work').focus();await page.keyboard.press('Enter');await expect.poll(()=>page.locator('#activity').textContent()).toBe('检查敏感字段规则');expect(await page.locator('#eta').textContent()).toBe(frozen);await page.screenshot({path:join(artifacts,'work-dark.png')});
  delete s.nativeActivity;await inject(s);await page.locator('#activity-execution').click();await expect.poll(()=>page.locator('#activity').textContent()).toBe('尚未检测到执行状态');await page.screenshot({path:join(artifacts,'execution-missing.png')});
  await page.locator('#activity-work').click();await expect.poll(()=>page.locator('#activity-work').getAttribute('aria-pressed')).toBe('true');
  await page.locator('#activity-execution').click();await expect.poll(()=>page.locator('#activity-execution').getAttribute('aria-pressed')).toBe('true');
  await app.close();app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]});page=await app.firstWindow();await page.waitForSelector('#activity-execution',{state:'attached'});await expect.poll(()=>page.locator('#activity-execution').getAttribute('aria-pressed')).toBe('true');
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},30000);

test('a preference save failure leaves the previous view selected and exposes retryable feedback',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'activity-view-failure-'));await mkdir(join(dir,'view.json'));const app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]});
 try{const page=await app.firstWindow();await page.waitForSelector('#activity-work',{state:'attached'});await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'pinExpanded',value:true}));await page.locator('#activity-execution').click();await expect.poll(()=>page.locator('#health-detail').textContent()).toBe('操作未完成，请重试');expect(await page.locator('#activity-work').getAttribute('aria-pressed')).toBe('true');await expect(page.evaluate(()=>window.schedule.dispatchUiCommand({type:'activityViewSet',value:'invalid'} as never))).rejects.toThrow('Invalid activity view');}
 finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},20000);
