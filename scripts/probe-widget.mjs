import {v8MemoryArgs} from '../src/shared/runtime-memory.ts';
import {_electron} from '@playwright/test';
import {mkdir,writeFile,mkdtemp} from 'node:fs/promises';import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import electron from 'electron';
const root=resolve('.artifacts/widget');await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'run-'));
const exe=process.argv.find(a=>a.startsWith('--exe='))?.slice(6),native=process.argv.includes('--native');
const args=exe?['--data-dir',dir]:[resolve('dist/desktop/main.cjs'),'--data-dir',dir];
const app=await _electron.launch({...(exe?{executablePath:exe}:{}),args,timeout:20000});
const errors=[];const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
try{
  await page.waitForSelector('#compact');
  const runtime=exe?resolve(exe):electron;
  const bridge=exe?resolve(dirname(exe),'resources/bridge/main.cjs'):resolve('dist/bridge/main.cjs');
  const {createHash,randomBytes}=await import('node:crypto');
  const key=()=>{const b=randomBytes(16);b.writeUIntBE(Date.now(),0,6);b[6]=(b[6]&15)|112;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
  const credential=join(dir,'connectors',createHash('sha256').update('codex-reporter').digest('hex')+'.json');
  const fs=await import('node:fs/promises');for(let i=0;i<100;i++){try{await fs.access(credential);await fs.access(join(dir,'endpoint.json'));break;}catch{await new Promise(r=>setTimeout(r,100));}}
  const client=new Client({name:'production-probe',version:'1'}),transport=new StdioClientTransport({command:runtime,args:[...v8MemoryArgs,bridge,'--mcp','--connector','codex-reporter','--credential',credential,'--endpoint',join(dir,'endpoint.json')],env:{SystemRoot:process.env.SystemRoot||'C:\\Windows',PATH:dirname(runtime),ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
  await client.connect(transport);
  try{
    const result=await client.callTool({name:'progress_begin',arguments:{idempotencyKey:key(),title:'验证任务：检查报告到悬浮框',plan:{revision:1,complete:true,schedule:'serial',steps:[{id:'a',title:'接入后台报告',weight:1,status:'completed',evidence:'declared'},{id:'b',title:'验证悬浮框更新',weight:1,status:'running',estimate:{minSec:60,maxSec:180,version:1},evidence:'declared'}]}}});
    if(result.isError)throw new Error('Begin failed');const handle=JSON.parse(result.content[0].text).handle;
    const reported=await client.callTool({name:'progress_report',arguments:{handle,reportId:key(),seq:2,changes:[{type:'activity.updated',activity:'运行报告、窗口和恢复验证'}]}});if(reported.isError)throw new Error('Report failed');
    await page.waitForFunction(()=>document.querySelector('#summary')?.textContent?.includes('50%'));
  }finally{await client.close();}
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'hover',inside:false}));
  await page.waitForFunction(()=>innerHeight===48);
  await page.screenshot({path:join(root,exe?'packaged-compact.png':'compact.png')});
  let focus=null;
  if(native){const meta=await app.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows()[0];return {id:w.getNativeWindowHandle().readBigUInt64LE().toString(),bounds:w.getBounds(),displays:screen.getAllDisplays().map(d=>({workArea:d.workArea,scaleFactor:d.scaleFactor}))};});
    focus=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-STA','-File',resolve('tests/fixtures/native-focus.ps1'),'-WidgetHandle',meta.id,'-TargetX',String(meta.bounds.x+meta.bounds.width-100),'-TargetY',String(meta.bounds.y+meta.bounds.height-24),'-ExpandedHeight','420',...(process.argv.includes('--input')?['-WithInput']:[])],{encoding:'utf8',windowsHide:true,timeout:40000}));focus.displays=meta.displays;
  }
  await page.locator('#compact').hover();await page.waitForSelector('#details:not([hidden])');await page.screenshot({path:join(root,exe?'packaged-expanded.png':'expanded.png')});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.screenshot({path:join(root,'dark-expanded.png')});
  if(process.argv.includes('--settings')){await page.locator('#settings-button').click();await page.waitForSelector('#login-startup');await page.screenshot({path:join(root,'settings.png')});}
  const report={verifiedAt:new Date().toISOString(),packaged:!!exe,sharedElectronNode:true,planVisible:Number(await page.locator('#track').getAttribute('aria-valuenow'))>=50&&Number(await page.locator('#track').getAttribute('aria-valuenow'))<100,errors,focus,scope:'synthetic MCP task; not live AI generation or physical IME/DPI acceptance'};
  await writeFile(join(root,exe?'packaged.json':'development.json'),JSON.stringify(report,null,2));if(errors.length)throw new Error('Renderer errors');console.log(JSON.stringify(report));
}finally{await app.close();}
