import { _electron } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect,test } from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
async function isolatedProfile(prefix:string){
 const dir=await mkdtemp(join(tmpdir(),prefix));
 await writeFile(join(dir,'position.json'),JSON.stringify({x:24,y:24}));
 return dir;
}

test('relaunch restores a hidden lowered widget to visible topmost without focus',async()=>{
 const d=await isolatedProfile('schedule-reveal-'),entry=resolve('dist/desktop/main.cjs'),app=await _electron.launch({args:[entry,'--data-dir',d],timeout:15000});
 try{
  await (await app.firstWindow()).waitForSelector('#compact');
  const identity=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0]!;w.hide();w.setAlwaysOnTop(false);return {handle:Number(w.getNativeWindowHandle().readBigUInt64LE()),pid:process.pid,exe:process.execPath};});
  await promisify(execFile)(identity.exe,[entry,'--data-dir',d],{windowsHide:true});
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true);
  const {stdout}=await promisify(execFile)(join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',resolve('tests/fixtures/window-flags.ps1'),'-WindowHandle',String(identity.handle),'-OwnerPid',String(identity.pid)],{windowsHide:true});
  const modelTopmost=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isAlwaysOnTop());
  expect({...JSON.parse(stdout),modelTopmost}).toEqual({visible:true,topmost:true,modelTopmost:true});
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isFocused())).toBe(false);
 }finally{await app.close();await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},20000);
test('production window loads real collector, safe text and single-window settings; hover never focuses',async()=>{
  const d=await isolatedProfile('schedule-window-');
  await writeFile(join(d,'native.jsonl'),[
    {type:'session_meta',payload:{id:'session'}},{type:'turn_context',payload:{turn_id:'turn'}},
    {type:'response_item',payload:{type:'function_call',name:'update_plan',call_id:'call',arguments:JSON.stringify({plan:[{step:'<img src=x onerror=alert(1)>',status:'in_progress'}]})}}
  ].map(r=>JSON.stringify({...r,timestamp:new Date().toISOString()})).join('\n')+'\n');
  await writeFile(join(d,'settings.json'),JSON.stringify({sources:[{provider:'codex',root:d,enabled:true}]}));
  const app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',d],timeout:15000});
  try{
    const page=await app.firstWindow();await page.waitForSelector('#compact');
    await expect.poll(()=>page.locator('#summary').textContent(),{timeout:10000}).toContain('Codex');
    await page.locator('#compact').hover();await expect.poll(()=>page.locator('#details').isVisible()).toBe(true);
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isFocused())).toBe(false);
    expect(await page.locator('#steps').textContent()).toContain('<img src=x onerror=alert(1)>');
    expect(await page.locator('img').count()).toBe(0);
    expect(await page.evaluate(()=>({node:typeof (globalThis as unknown as {require:unknown}).require,api:Object.keys((globalThis as unknown as {schedule:object}).schedule)}))).toEqual({node:'undefined',api:['subscribeSnapshots','dispatchUiCommand']});
    await page.locator('#settings-button').click();await page.waitForSelector('#settings:not([hidden])');
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);
    await page.locator('#advanced-settings summary').click();await page.waitForSelector('#preview-integration');
    expect(await page.locator('#login-startup').isChecked()).toBe(false);expect(await page.locator('#login-startup').isDisabled()).toBe(true);
    await page.locator('#host').selectOption('claude');await page.locator('#config-path').fill(join(d,'isolated.mcp.json'));
    await page.locator('#preview-integration').click();await page.waitForSelector('#integration-preview:not([hidden])');
    expect(await page.locator('#integration-preview').textContent()).toContain('--credential');
    await page.locator('#apply-integration').click();await page.waitForSelector('#installed button');
    await page.locator('#host').selectOption('claude');await page.locator('#config-path').fill(join(d,'isolated.mcp.json'));
    await page.locator('#preview-integration').click();await page.waitForSelector('#apply-integration:not([hidden])');await page.locator('#apply-integration').click();
    await page.waitForSelector('#apply-integration[hidden]',{state:'attached'});
    await expect.poll(()=>page.locator('#installed button').count()).toBe(1);
    await page.locator('#installed button').click();await expect.poll(()=>page.locator('#installed button').count()).toBe(0);
    await page.locator('#back').click();await expect.poll(()=>page.locator('#settings').isVisible()).toBe(false);
  }finally{await app.close();await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},30000);

test('synchronous worker creation failures exhaust bounded retries without closing the window and explicit retry recovers',async()=>{
  const d=await isolatedProfile('schedule-startup-ui-'),entry=join(d,'startup.cjs');
  await writeFile(entry,`const threads=require('node:worker_threads'),Actual=threads.Worker;
globalThis.startupProbe={attempts:0,failures:4};
threads.Worker=class extends Actual{constructor(...args){globalThis.startupProbe.attempts++;if(globalThis.startupProbe.failures-->0)throw Object.assign(new Error('controlled thread creation failure'),{code:'ERR_WORKER_INIT_FAILED'});super(...args);}};
require(${JSON.stringify(resolve('dist/desktop/main.cjs'))});`);
  const app=await _electron.launch({args:[entry,'--data-dir',d],timeout:15000});
  try{
    const page=await app.firstWindow();await page.waitForSelector('#compact');
    const attempts=()=>app.evaluate(()=>(globalThis as unknown as {startupProbe:{attempts:number}}).startupProbe.attempts);
    await expect.poll(attempts,{timeout:12000}).toBe(4);
    await expect.poll(()=>page.locator('#health').textContent()).toContain('重新连接');
    await new Promise(r=>setTimeout(r,1200));expect(await attempts()).toBe(4);
    await app.evaluate(()=>(globalThis as unknown as {startupProbe:{failures:number}}).startupProbe.failures=1);
    await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'retryCollector'}));
    await expect.poll(attempts,{timeout:5000}).toBe(6);
    await expect.poll(()=>page.locator('#health').textContent(),{timeout:5000}).not.toContain('采集');
  }finally{await app.close();await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},30000);
test('after four collector thread terminations local settings still offer retry and explicit reconnect starts a worker',async()=>{
  const d=await isolatedProfile('schedule-crash-ui-'),app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',d],timeout:15000});
  // Capture the real worker at its existing command boundary. This lives only
  // in the test process context; the product exposes no fault-injection API.
  await app.evaluate(()=>{
    const {Worker}=process.getBuiltinModule('node:worker_threads'),post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(value,transferList){(globalThis as unknown as {collectorForTest:import('node:worker_threads').Worker}).collectorForTest=this;return post.call(this,value,transferList);};
  });
  const threadId=async()=>{
    // A native focus transition can finish after the settings layout arrives.
    // Respect the product's focus guard instead of turning that race into a
    // collector-recovery failure; polling still fails if focus never arrives.
    if(!await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isFocused()))return -1;
    try{await (await app.firstWindow()).evaluate(()=>window.schedule.dispatchUiCommand({type:'settingsRead'}));}catch(error){if(String(error).includes('Explicit focused action required'))return -1;throw error;}
    return app.evaluate(()=>(globalThis as unknown as {collectorForTest?:import('node:worker_threads').Worker}).collectorForTest?.threadId??-1);
  };
  try{
    const page=await app.firstWindow();await page.locator('#compact').hover();await page.waitForSelector('#details:not([hidden])');await page.locator('#settings-button').click();await page.waitForSelector('#settings:not([hidden])');
    for(let i=0;i<4;i++){
      await expect.poll(threadId,{timeout:12000}).toBeGreaterThan(0);
      await app.evaluate(()=>(globalThis as unknown as {collectorForTest:import('node:worker_threads').Worker}).collectorForTest.terminate());
    }
    await page.locator('#back').click();
    const warning=await page.locator('#health').boundingBox();expect(warning).not.toBeNull();expect(warning!.y).toBeGreaterThanOrEqual(0);expect(warning!.y+warning!.height).toBeLessThanOrEqual(await page.evaluate(()=>innerHeight));
    // Window geometry changes during preceding desktop tests. Establish an actual
    // outside-to-inside transition instead of assuming hover() starts outside.
    await page.mouse.move(-10,-10);expect(await page.locator('#widget').evaluate(e=>e.matches(':hover'))).toBe(false);
    await page.locator('#compact').hover();await page.waitForSelector('#details:not([hidden])');
    const settingsButton=await page.locator('#settings-button').boundingBox(),expandedWarning=await page.locator('#health').boundingBox();
    // Collector warning stays on the OLED, controls stay on the separate wing.
    expect(expandedWarning!.height).toBeGreaterThan(0);expect(settingsButton!.height).toBeGreaterThan(0);
    expect(settingsButton!.x+settingsButton!.width<=expandedWarning!.x||expandedWarning!.x+expandedWarning!.width<=settingsButton!.x).toBe(true);
    await page.locator('#settings-button').click();
    await page.waitForSelector('#retry-collector',{timeout:4000});await page.locator('#retry-collector').click();await expect.poll(threadId,{timeout:12000}).toBeGreaterThan(0);
  }finally{await app.close();await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},60000);

test('overlapping explicit collector reconnects leave only one live writer thread',async()=>{
  const d=await isolatedProfile('schedule-reconnect-ui-'),app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',d],timeout:15000});
  try{
    const page=await app.firstWindow();await page.waitForSelector('#compact');
    await app.evaluate(()=>{
      const {Worker}=process.getBuiltinModule('node:worker_threads'),on=Worker.prototype.on;
      const observed=new Set<import('node:worker_threads').Worker>();
      (globalThis as unknown as {observedCollectors:Set<import('node:worker_threads').Worker>}).observedCollectors=observed;
      Worker.prototype.on=function(name,listener){observed.add(this);return on.call(this,name,listener);};
    });
    await page.evaluate(()=>Promise.all(Array.from({length:4},()=>window.schedule.dispatchUiCommand({type:'retryCollector'}))));
    const live=await app.evaluate(()=>[...(globalThis as unknown as {observedCollectors:Set<import('node:worker_threads').Worker>}).observedCollectors].filter(w=>w.threadId>0).length);
    expect(live).toBe(1);
  }finally{await app.close();await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},30000);
