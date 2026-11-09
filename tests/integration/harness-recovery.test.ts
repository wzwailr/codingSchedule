import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {existsSync} from 'node:fs';
// The production acceptance driver is plain ESM and intentionally not shipped in the app.
// @ts-expect-error Node ESM verification driver has no declaration file.
import {launchHarness,key} from '../../scripts/harness.mjs';
const exe=resolve(process.env.SCHEDULE_TEST_PACKAGE_DIR||'release/win-unpacked','codingSchedule.exe');
test.skipIf(!existsSync(exe))('acceptance requests reread the endpoint after a collector restart and preserve task identity',async()=>{
 const h=await launchHarness(exe,'harness-recovery');
 try{
  const {port}=JSON.parse(await readFile(join(h.dir,'endpoint.json'),'utf8'));
  const started=await h.send('begin',{idempotencyKey:key(),title:'recover original run'});expect(started.status).toBe(200);
  await h.page.evaluate(()=>window.schedule.dispatchUiCommand({type:'retryCollector'}));
  await expect.poll(async()=>{try{return JSON.parse(await readFile(join(h.dir,'endpoint.json'),'utf8')).port;}catch{return port;}},{timeout:10000}).not.toBe(port);
  const context=await h.send('context',{handle:started.body.handle});expect(context.status).toBe(200);expect(context.body.snapshot.run.runId).toBe(started.body.handle.runId);expect(context.body.snapshot.status).toBe('paused');
  const nativeContext=await h.client.callTool({name:'progress_context',arguments:{handle:started.body.handle}});expect(nativeContext.isError).not.toBe(true);expect(JSON.parse(nativeContext.content[0].text).snapshot.run.runId).toBe(started.body.handle.runId);
 }finally{await h.close();}
},25000);
