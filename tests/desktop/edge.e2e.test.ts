import {_electron} from '@playwright/test';import {expect,test} from 'vitest';import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
test('a shaped 32px edge tab restores its OLED anchor, honors pin/settings and persists opt-out',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'edge-e2e-'));await writeFile(join(dir,'appearance.json'),JSON.stringify({scale:.5,opacity:.85}));await writeFile(join(dir,'position.json'),JSON.stringify({anchor:{x:2,y:400}}));let app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]});
 try{
  let page=await app.firstWindow();await page.waitForSelector('#edge-tab');await page.mouse.move(-20,-20);
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'closeSettings'}));
  await app.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows()[0]!,area=screen.getPrimaryDisplay().workArea,p=screen.getCursorScreenPoint(),b=w.getBounds();w.setPosition(p.x<area.x+area.width/2?area.x+area.width-b.width:area.x,area.y+200);});
  // A captured drag can leave a stale DOM hover flag. Native position must win.
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'hover',inside:true}));
  const bounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.getBounds());
  await expect.poll(()=>page.locator('#widget').getAttribute('data-edge-hidden'),{timeout:5000}).toBe('true');expect((await bounds()).width).toBeLessThanOrEqual(32);expect((await bounds()).height).toBe(64);expect(await page.locator('#edge-tab').evaluate(e=>e.getBoundingClientRect().width)).toBe(32);expect(await page.locator('#compact').isVisible()).toBe(false);
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'hover',inside:true}));await expect.poll(async()=>(await bounds()).width).toBeGreaterThan(8);const anchor=await page.locator('#compact').boundingBox();
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'pinExpanded',value:true}));await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'hover',inside:false}));await page.waitForTimeout(1000);expect((await bounds()).width).toBeGreaterThan(100);
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'closeSettings'}));await expect.poll(()=>page.locator('#widget').getAttribute('data-edge-hidden')).toBe('true');
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'expand'}));const restored=await page.locator('#compact').boundingBox();expect(restored!.width).toBeCloseTo(anchor!.width,0);
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'openSettings'}));await page.waitForSelector('#edge-auto-hide');await page.locator('#edge-auto-hide').uncheck();await expect.poll(async()=>JSON.parse(await readFile(join(dir,'edge.json'),'utf8')).enabled).toBe(false);await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'closeSettings'}));await page.waitForTimeout(1100);expect((await bounds()).width).toBe(92);
  await app.close();app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]});page=await app.firstWindow();await page.waitForTimeout(1100);expect((await bounds()).width).toBe(92);expect(await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'edgeRead'}))).toEqual({enabled:false});
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},25000);
