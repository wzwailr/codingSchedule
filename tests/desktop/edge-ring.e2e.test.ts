import {_electron} from '@playwright/test';
import {expect,test} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRunState} from '../../src/domain/reducer.js';
import type {RunSnapshot} from '../../src/shared/contracts.js';
import {clock,event} from '../helpers.js';

test('OLED edge clasp preserves progress, frozen/active ETA, semantic states, four-edge bounds and native rounded hit regions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'edge-ring-')),artifacts=resolve('.artifacts/ring/screens');await mkdir(artifacts,{recursive:true});
 await writeFile(join(dir,'appearance.json'),JSON.stringify({scale:.5,opacity:1}));await writeFile(join(dir,'position.json'),JSON.stringify({anchor:{x:0,y:400}}));
 const app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#edge-value');
  // Keep the native cursor outside the fixture rather than asking CDP to move
  // to a negative coordinate, which Windows may clamp back onto a screen edge.
  const placement=await app.evaluate(({screen,BrowserWindow})=>{const a=screen.getPrimaryDisplay().workArea,p=screen.getCursorScreenPoint(),b=BrowserWindow.getAllWindows()[0]!.getBounds();return {from:{x:b.x+b.width/2,y:b.y+b.height/2},to:{x:p.x<a.x+a.width/2?a.x+a.width:a.x,y:p.y<a.y+a.height/2?a.y+a.height*.75:a.y+a.height*.25}};});
  await page.evaluate(async({from,to})=>{for(const [phase,point] of [['start',from],['move',to],['end',to]] as const)await window.schedule.dispatchUiCommand({type:'drag',phase,point});await window.schedule.dispatchUiCommand({type:'hover',inside:false});},placement);
  await app.evaluate(({BrowserWindow})=>{
   const contents=BrowserWindow.getAllWindows()[0]!.webContents,send=contents.send.bind(contents);
   (globalThis as unknown as {ringFixture:(snapshot:unknown)=>void}).ringFixture=snapshot=>send('schedule:update',{version:1,type:'snapshots',snapshots:snapshot?[snapshot]:[]});
   contents.send=(channel,...args)=>{if(channel==='schedule:update'&&args[0]?.type==='snapshots')return;send(channel,...args);};
  });
  const inject=async(s:RunSnapshot|null)=>{if(s){s.lastWorkAt=s.lastSeenAt=Date.now();}await app.evaluate((_,s)=>(globalThis as unknown as {ringFixture:(snapshot:unknown)=>void}).ringFixture(s),s);};
  const hidden=()=>expect.poll(()=>page.locator('#widget').getAttribute('data-edge-hidden'),{timeout:6000}).toBe('true');
  await inject(null);await hidden();expect(await page.locator('#edge-tab').getAttribute('aria-label')).toContain('暂无活动会话');
  await page.screenshot({path:join(artifacts,'idle.png')});
  const original=createRunState(event({type:'run.started',title:'墨玉环扣回归',scope:'task'}),clock()).snapshot;
  original.nativeSession={id:'ring-fixture',turnId:'ring-turn',project:'codingSchedule',name:'进度和倒计时测试'};
  await inject(structuredClone(original));await expect.poll(()=>page.locator('#edge-tab').getAttribute('data-known')).toBe('false');expect(await page.locator('#edge-value').textContent()).toBe('—');
  await page.screenshot({path:join(artifacts,'unknown.png')});
  const active=structuredClone(original);active.progress={value:68,completed:17,total:25,basis:'plan'};active.eta={range:{minSec:120,maxSec:240},basis:'agent',asOf:Date.now()};
  active.displayProgress={value:68,anchor:{value:68,range:{minSec:120,maxSec:240},elapsedSec:0,asOf:Date.now()}};
  await inject(active);await expect.poll(()=>page.locator('#edge-value').textContent()).toBe('68');
  const label=await page.locator('#edge-tab').getAttribute('aria-label');expect(label).toContain('剩余');await expect.poll(()=>page.locator('#edge-tab').getAttribute('aria-label'),{timeout:6000}).not.toBe(label);
  for(const status of ['waiting','blocked','paused'] as const){
   const waiting=structuredClone(active);waiting.status=status;await inject(waiting);await expect.poll(()=>page.locator('#widget').getAttribute('data-status')).toBe(status);
   expect(await page.locator('#edge-value').textContent()).toBe('68');expect(await page.locator('.edge-pause').evaluate(e=>getComputedStyle(e).display)).toBe('block');
   const frozen=await page.locator('#edge-tab').getAttribute('aria-label');await page.waitForTimeout(1100);expect(await page.locator('#edge-tab').getAttribute('aria-label')).toBe(frozen);
   await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'hover',inside:false}));await hidden();await page.screenshot({path:join(artifacts,status+'.png')});
  }
  const stale=structuredClone(active);stale.freshness='stale';await inject(stale);await expect.poll(()=>page.locator('#widget').getAttribute('data-freshness')).toBe('stale');await page.screenshot({path:join(artifacts,'stale.png')});
  const overdue=structuredClone(active);overdue.eta.asOf=Date.now()-300000;await inject(overdue);await expect.poll(()=>page.locator('#widget').getAttribute('data-overdue')).toBe('true');expect(await page.locator('#edge-tab').getAttribute('aria-label')).toContain('已超时');await page.screenshot({path:join(artifacts,'overdue.png')});
  const area=await app.evaluate(({screen})=>screen.getPrimaryDisplay().workArea);
  for(const [edge,x,y] of [['left',area.x,area.y+400],['right',area.x+area.width,area.y+400],['top',area.x+area.width/2,area.y],['bottom',area.x+area.width/2,area.y+area.height]] as const){
   await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'expand'}));await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'closeSettings'}));
   const anchor=JSON.parse(await readFile(join(dir,'position.json'),'utf8')).anchor;
   await page.evaluate(async({from,to})=>{for(const [phase,point] of [['start',from],['move',to],['end',to]] as const)await window.schedule.dispatchUiCommand({type:'drag',phase,point});},{from:anchor,to:{x,y}});
   // The drag persists its actual clamped OLED anchor; the next iteration reads it.
   await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'hover',inside:false}));await hidden();
   expect(await page.locator('#edge-tab').getAttribute('data-edge')).toBe(edge);
   const b=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.getBounds());expect([b.width,b.height]).toEqual(edge==='left'||edge==='right'?[32,64]:[64,40]);
   expect(b.x).toBeGreaterThanOrEqual(area.x);expect(b.y).toBeGreaterThanOrEqual(area.y);expect(b.x+b.width).toBeLessThanOrEqual(area.x+area.width);expect(b.y+b.height).toBeLessThanOrEqual(area.y+area.height);
   await inject(active);
   for(const colorScheme of ['light','dark'] as const){await page.emulateMedia({colorScheme,reducedMotion:'reduce'});expect(await page.locator('#edge-tab').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(29, 45, 54)');expect(await page.locator('#edge-tab').evaluate(e=>getComputedStyle(e).transitionDuration)).toBe('0s');await page.screenshot({path:join(artifacts,edge+'-'+colorScheme+'.png')});}
   if(process.platform==='win32'){
    const native=await app.evaluate(({BrowserWindow})=>({owner:process.pid,handle:Number(BrowserWindow.getAllWindows()[0]!.getNativeWindowHandle().readBigUInt64LE())}));
    const points=[{name:'corner',x:0,y:0},{name:'center',x:b.width/2,y:b.height/2}];
    const result=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',resolve('tests/fixtures/fold-native-region.ps1'),'-WindowHandle',String(native.handle),'-OwnerPid',String(native.owner),'-PointsJson',JSON.stringify(points)],{encoding:'utf8',windowsHide:true}));
    expect(result.points[0].inRegion).toBe(false);expect(result.points[1].inRegion).toBe(true);expect(result.points[1].hitOwner).toBe(native.owner);await writeFile(join(artifacts,edge+'-native.json'),JSON.stringify(result,null,2));
   }
  }
  for(const status of ['reported_done','verified_done','failed'] as const){const done=structuredClone(active);done.status=status;await inject(done);await expect.poll(()=>page.locator('#widget').getAttribute('data-status')).toBe(status);expect(await page.locator(status==='failed'?'.edge-failure':'.edge-complete').isVisible()).toBe(true);await page.screenshot({path:join(artifacts,status+'.png')});}
  const finishing=structuredClone(active);finishing.progress.value=100;finishing.displayProgress={value:100};await inject(finishing);await expect.poll(()=>page.locator('#edge-value').textContent()).toBe('100');expect(await page.locator('#edge-value').isVisible()).toBe(true);expect(await page.locator('#edge-tab').getAttribute('aria-label')).toContain('剩余');
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},50000);
