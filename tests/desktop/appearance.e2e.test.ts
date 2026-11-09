import {_electron} from '@playwright/test';import {expect,test} from 'vitest';import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
async function launch(dir:string){return _electron.launch({args:['dist/desktop/main.cjs','--data-dir',dir]});}
test('size gestures preview without writes, keep fold state and fonts proportional, persist once and survive source save/relaunch',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'appearance-ui-'));await writeFile(join(dir,'position.json'),JSON.stringify({x:400,y:220}));let app=await launch(dir);
 try{
  let page=await app.firstWindow();await page.waitForSelector('#resize-compact');await page.mouse.move(-20,-20);
  const before=await page.locator('#screen-progress').boundingBox();
  const point={x:524,y:464};await page.evaluate(p=>window.schedule.dispatchUiCommand({type:'resize',phase:'start',point:p}),point);
  await page.evaluate(async()=>{for(const point of [{x:529,y:475},{x:534,y:486},{x:544,y:507}])await window.schedule.dispatchUiCommand({type:'resize',phase:'move',point});await window.schedule.dispatchUiCommand({type:'hover',inside:true});});
  await page.waitForTimeout(300);expect(await page.locator('#details').isHidden()).toBe(true);expect(await access(join(dir,'appearance.json')).then(()=>true).catch(()=>false)).toBe(false);
  const after=await page.locator('#screen-progress').boundingBox();expect(after!.height/before!.height).toBeGreaterThan(1.35);expect(after!.height/before!.height).toBeLessThan(1.45);
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'resize',phase:'end',point:{x:544,y:507}}));
  expect(JSON.parse(await readFile(join(dir,'appearance.json'),'utf8')).scale).toBe(1.4);
  await page.waitForTimeout(350);expect(await page.locator('#details').isHidden()).toBe(true);
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'expand'}));expect(await page.locator('#widget').getAttribute('data-scale')).toBe('1.4');
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.getBounds().width)).toBe(638);
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'openSettings'}));await page.waitForSelector('#appearance-scale');
  await page.evaluate(root=>window.schedule.dispatchUiCommand({type:'sourcesSave',sources:[{provider:'codex',root,enabled:false},{provider:'claude',root,enabled:false}]}),dir);
  expect(JSON.parse(await readFile(join(dir,'appearance.json'),'utf8'))).toEqual({scale:1.4,opacity:1});
  await app.close();app=await launch(dir);page=await app.firstWindow();await page.waitForSelector('#compact');expect(await page.locator('#widget').getAttribute('data-scale')).toBe('1.4');
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'resize',phase:'start',point:{x:544,y:508}}));await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'resize',phase:'move',point:{x:574,y:600}}));await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'resize',phase:'cancel',point:{x:574,y:600}}));expect(await page.locator('#widget').getAttribute('data-scale')).toBe('1.4');
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},30000);
test('both mouse resize handles preview continuously, flush fast final points and cancel lost pointer capture without folding',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'appearance-pointer-'));await writeFile(join(dir,'position.json'),JSON.stringify({x:400,y:220}));const app=await launch(dir);
 try{
  const page=await app.firstWindow();await page.waitForSelector('#resize-compact');const bounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.getBounds());
  const initial=await bounds(),box=await page.locator('#resize-compact').boundingBox(),anchor={x:initial.x+74,y:initial.y+136},start={x:initial.x+box!.x+box!.width/2,y:initial.y+box!.y+box!.height/2};
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();
  const target={x:anchor.x+(start.x-anchor.x)*1.3,y:anchor.y+(start.y-anchor.y)*1.3};
  // CDP inputs are client-relative, so preserve the same absolute screen point
  // while the native window bounds change under the captured pointer.
  for(let n=0;n<3;n++){const b=await bounds();await page.mouse.move(target.x-b.x,target.y-b.y);await page.waitForTimeout(45);}
  await page.mouse.up();await expect.poll(()=>page.locator('#widget').getAttribute('data-scale')).toBe('1.3');expect(await page.locator('#details').isHidden()).toBe(true);
  await expect.poll(async()=>JSON.parse(await readFile(join(dir,'appearance.json'),'utf8')).scale).toBe(1.3);
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'expand'}));await page.waitForSelector('#resize-details');
  const wingBox=await page.locator('#resize-details').boundingBox(),beforeCancel=await bounds();
  await page.evaluate(()=>document.getElementById('resize-details')!.addEventListener('pointerdown',e=>(globalThis as unknown as {resizePointerId:number}).resizePointerId=e.pointerId,{once:true}));
  await page.mouse.move(wingBox!.x+wingBox!.width/2,wingBox!.y+wingBox!.height/2);await page.mouse.down();await page.mouse.move(wingBox!.x+wingBox!.width/2+15,wingBox!.y+wingBox!.height/2+15);await page.waitForTimeout(60);
  await page.evaluate(()=>document.getElementById('resize-details')!.releasePointerCapture((globalThis as unknown as {resizePointerId:number}).resizePointerId));
  await page.mouse.move(wingBox!.x+wingBox!.width/2+16,wingBox!.y+wingBox!.height/2+16);await page.mouse.up();
  await expect.poll(()=>page.locator('#widget').getAttribute('data-scale')).toBe('1.3');expect((await bounds()).width).toBe(beforeCancel.width);
  expect(JSON.parse(await readFile(join(dir,'appearance.json'),'utf8')).scale).toBe(1.3);
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},30000);
test('OLED-only wheel changes actual window opacity with bounds, settings slider and reset restore persistent defaults',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opacity-ui-'));await writeFile(join(dir,'position.json'),JSON.stringify({x:100,y:100}));const app=await launch(dir);
 try{
  const page=await app.firstWindow();await page.waitForSelector('#compact');const opacity=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.getOpacity());
  await page.locator('#compact').dispatchEvent('wheel',{deltaY:100,deltaMode:0});await expect.poll(opacity).toBeCloseTo(.95,2);await expect.poll(()=>page.locator('#appearance-feedback').textContent()).toContain('不透明度 95%');
  await page.waitForTimeout(90);await page.locator('#compact').dispatchEvent('wheel',{deltaY:-3,deltaMode:1});await expect.poll(opacity).toBe(1);
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'expand'}));await page.locator('#task-scroll').dispatchEvent('wheel',{deltaY:1000,deltaMode:0});expect(await opacity()).toBe(1);
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'appearanceSet',opacity:-5,commit:true}));expect(await opacity()).toBeCloseTo(.4,2);await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'appearanceSet',opacity:8,commit:true}));expect(await opacity()).toBe(1);
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'openSettings'}));await page.waitForSelector('#appearance-opacity');await page.locator('#appearance-opacity').fill('65');await page.locator('#appearance-opacity').dispatchEvent('input');await page.locator('#appearance-opacity').dispatchEvent('change');await expect.poll(opacity).toBeCloseTo(.65,2);
  await expect.poll(async()=>JSON.parse(await readFile(join(dir,'appearance.json'),'utf8')).opacity).toBe(.65);
  await page.locator('#settings').dispatchEvent('wheel',{deltaY:-1000,deltaMode:0});expect(await opacity()).toBeCloseTo(.65,2);
  await page.locator('#appearance-scale').fill('150');await page.locator('#appearance-scale').dispatchEvent('change');await expect.poll(()=>page.locator('#widget').getAttribute('data-scale')).toBe('1.5');
  await page.locator('#appearance-default').click();await expect.poll(opacity).toBe(1);expect(await page.locator('#widget').getAttribute('data-scale')).toBe('1');await expect.poll(async()=>JSON.parse(await readFile(join(dir,'appearance.json'),'utf8'))).toEqual({scale:1,opacity:1});
  await expect(page.evaluate(()=>window.schedule.dispatchUiCommand({type:'appearanceSet',opacity:NaN,commit:true}))).rejects.toThrow('Invalid appearance');
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},30000);
