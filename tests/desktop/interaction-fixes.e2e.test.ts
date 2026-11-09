import {_electron} from '@playwright/test';
import {expect,test} from 'vitest';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {THEMES,type WidgetTheme} from '../../src/shared/themes.js';

test('an expanded widget retracts outside its real surfaces even when no mouseleave event or cursor change arrives',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'schedule-outside-'));await writeFile(join(dir,'position.json'),JSON.stringify({anchor:{x:800,y:420}}));await writeFile(join(dir,'edge.json'),JSON.stringify({enabled:false}));
 const app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#compact');await page.mouse.move(-20,-20);
  await app.evaluate(({screen})=>{let p={x:-10000,y:-10000};screen.getCursorScreenPoint=()=>p;(globalThis as unknown as {fixtureCursor:(v:{x:number;y:number})=>void}).fixtureCursor=value=>{p=value;};});
  for(const theme of Object.keys(THEMES) as WidgetTheme[])for(const scale of [.35,1]){
   await page.evaluate(scale=>window.schedule.dispatchUiCommand({type:'appearanceSet',scale,commit:true}),scale);
   await page.evaluate(async value=>{await window.schedule.dispatchUiCommand({type:'themeSet',value});await window.schedule.dispatchUiCommand({type:'hover',inside:false});await window.schedule.dispatchUiCommand({type:'expand'});},theme);
   await expect.poll(()=>page.locator('#details').isHidden(),{timeout:1800}).toBe(true);
   await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'hover',inside:true}));await page.waitForTimeout(350);expect(await page.locator('#details').isHidden()).toBe(true);
   await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'expand'}));
   await app.evaluate(({BrowserWindow})=>{const b=BrowserWindow.getAllWindows()[0]!.getBounds();(globalThis as unknown as {fixtureCursor:(v:{x:number;y:number})=>void}).fixtureCursor({x:b.x+2,y:b.y+2});});
   await expect.poll(()=>page.locator('#details').isHidden(),{timeout:1800}).toBe(true);
   await app.evaluate(()=>(globalThis as unknown as {fixtureCursor:(v:{x:number;y:number})=>void}).fixtureCursor({x:-10000,y:-10000}));
  }
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'pinExpanded',value:true}));await page.waitForTimeout(800);expect(await page.locator('#details').isVisible()).toBe(true);
  await page.evaluate(async()=>{await window.schedule.dispatchUiCommand({type:'closeSettings'});await window.schedule.dispatchUiCommand({type:'openSettings'});});await page.waitForSelector('#widget-theme');await page.waitForTimeout(800);expect(await page.locator('#settings').isVisible()).toBe(true);
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},30000);

test('the disc remains circular and readable through every density tier',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'schedule-disc-shape-'));await writeFile(join(dir,'position.json'),JSON.stringify({anchor:{x:800,y:420}}));await writeFile(join(dir,'theme.json'),JSON.stringify({theme:'disc'}));await writeFile(join(dir,'edge.json'),JSON.stringify({enabled:false}));
 const app=await _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#compact');await page.mouse.move(-20,-20);await page.waitForFunction(()=>document.querySelector<HTMLElement>('#health')?.hidden);await mkdir(resolve('.artifacts/interaction'),{recursive:true});
  for(const scale of [.35,.49,.5,.74,.75,1]){
   await page.evaluate(scale=>window.schedule.dispatchUiCommand({type:'appearanceSet',scale,commit:true}),scale);
   const shape=await page.locator('#compact').evaluate(e=>({width:e.clientWidth,height:e.clientHeight,radius:parseFloat(getComputedStyle(e).borderTopLeftRadius)}));expect(shape.width).toBe(shape.height);expect(shape.radius).toBeCloseTo(shape.width/2,0);
   const content=await page.locator('#screen-content').evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight}));expect(content.scroll).toBeLessThanOrEqual(content.height+1);
   expect(await page.locator('#screen-eta').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
   await page.waitForFunction(()=>document.querySelector<HTMLElement>('#appearance-feedback')?.hidden);await page.screenshot({path:resolve('.artifacts/interaction/disc-'+Math.round(scale*100)+'.png')});
  }
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},20000);
