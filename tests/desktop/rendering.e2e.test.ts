import {_electron} from '@playwright/test';import {mkdtemp,rm,access} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {expect,test} from 'vitest';
import {sendLocal} from '../../src/bridge/transport.js';import {key} from '../helpers.js';import type {RunHandle} from '../../src/shared/contracts.js';
test('expanded pinned view preserves step and option nodes across other-task and timer updates',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-render-')),app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',d]});
 try{
  const page=await app.firstWindow(),credentialPath=join(d,'connectors',createHash('sha256').update('codex-reporter').digest('hex')+'.json'),endpointPath=join(d,'endpoint.json');await expect.poll(async()=>access(endpointPath).then(()=>true).catch(()=>false),{timeout:12000}).toBe(true);
  const send=(operation:'begin'|'report'|'finish',body:unknown)=>sendLocal({operation,body,connectorId:'codex-reporter',credentialPath,endpointPath});
  const a=(await send('begin',{idempotencyKey:key(Date.now()),title:'Selected',plan:{revision:1,complete:true,schedule:'serial',steps:[{id:'a',title:'Preserve this row',weight:1,status:'running',evidence:'declared'}]}})).body as {handle:RunHandle};
  await page.waitForFunction(()=>document.querySelector('#title')?.textContent==='Selected');
  expect(await page.locator('#compact-title').textContent({timeout:1500})).toBe('Selected');
  await page.locator('#compact').hover();await page.waitForSelector('#details:not([hidden])');await page.locator('#pin').click();
  const b=(await send('begin',{idempotencyKey:key(Date.now()),title:'Other'})).body as {handle:RunHandle};await page.waitForFunction(()=>document.querySelector('#count')?.textContent==='+1');
  const row=await page.locator('#steps li').elementHandle(),option=await page.locator('#tasks option').first().elementHandle();
  const beforeOther=await page.locator('#freshness').textContent();await page.clock.setFixedTime(Date.now()+10000);
  await page.evaluate(()=>{(globalThis as unknown as {otherSeen:boolean}).otherSeen=false;window.schedule.subscribeSnapshots(m=>{if(m.type==='snapshots'&&m.snapshots.some(s=>s.activity==='Other update'))(globalThis as unknown as {otherSeen:boolean}).otherSeen=true;});});
  await send('report',{handle:b.handle,reportId:key(Date.now()),seq:2,changes:[{type:'activity.updated',activity:'Other update'}]});await page.waitForFunction(()=>(globalThis as unknown as {otherSeen:boolean}).otherSeen);
  expect(await row!.evaluate(e=>e.isConnected)).toBe(true);
  expect(await option!.evaluate(e=>e.isConnected)).toBe(true);expect(await page.locator('#freshness').textContent()).not.toBe(beforeOther);
  const beforeTimer=await page.locator('#freshness').textContent();await page.clock.setFixedTime(Date.now()+20000);
  await expect.poll(()=>page.locator('#freshness').textContent(),{timeout:7000}).not.toBe(beforeTimer);
  expect(await row!.evaluate(e=>e.isConnected)).toBe(true);expect(await option!.evaluate(e=>e.isConnected)).toBe(true);
  await send('report',{handle:a.handle,reportId:key(Date.now()),seq:2,changes:[{type:'activity.updated',activity:'Selected update'}]});await page.waitForFunction(()=>document.querySelector('#activity')?.textContent==='Selected update');
  await send('report',{handle:a.handle,reportId:key(Date.now()),seq:3,changes:[{type:'run.status',status:'waiting'}]});await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='等待你处理');
  expect(await page.locator('#track').getAttribute('aria-valuenow')).toBe('0');expect(await page.locator('#eta').textContent()).toBe('计时暂停');
  await page.locator('#compact').hover();await page.waitForSelector('#details:not([hidden])');
  await page.locator('#tasks').selectOption(b.handle.runId);await page.waitForFunction(()=>document.querySelector('#title')?.textContent==='Other');
  expect(await page.locator('#track').getAttribute('aria-valuenow')).toBeNull();expect(await page.locator('#track').getAttribute('aria-valuetext')).toBe('进度未知');
  expect(await page.locator('#steps-empty').isVisible()).toBe(true);
  expect(await page.locator('#compact-title').textContent()).toBe('Other');
  await send('finish',{handle:b.handle,reportId:key(Date.now()),seq:3,summary:'AI finished, user has not accepted'});await page.waitForFunction(()=>document.querySelector('#title')?.textContent==='Selected');
  expect(await page.locator('#tasks option').count()).toBe(1);expect(await page.locator('#widget').getAttribute('data-status')).toBe('waiting');
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'showFocused'}));await page.keyboard.press('Escape');
  await page.waitForSelector('#details[hidden]',{state:'attached'});
  expect(await page.locator('#pin').getAttribute('aria-pressed')).toBe('false');expect(await page.locator('#pin').textContent()).toBe('固定展开');
 }finally{await app.close();await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},25000);
