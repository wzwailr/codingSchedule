import {_electron} from '@playwright/test';import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {parse as toml} from 'smol-toml';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {existsSync} from 'node:fs';import {join,resolve,dirname} from 'node:path';import {tmpdir} from 'node:os';import {expect,test} from 'vitest';
import {key} from '../helpers.js';
const uuidv7=()=>key(Date.now());
const exe=resolve(process.env.SCHEDULE_TEST_PACKAGE_DIR||'release/win-unpacked','codingSchedule.exe');
const packagedTest=test.skipIf(process.platform!=='win32'||(!process.env.SCHEDULE_TEST_PACKAGE_DIR&&!existsSync(exe)));
async function profile(){
 const home=await mkdtemp(join(tmpdir(),'干净接入 测试-')),data=join(home,'.coding-schedule');await mkdir(data);const env={...process.env,USERPROFILE:home,HOME:home,APPDATA:join(home,'AppData/Roaming'),LOCALAPPDATA:join(home,'AppData/Local'),CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),PATH:join(process.env.SystemRoot||'C:/Windows','System32')};
 await mkdir(env.APPDATA,{recursive:true});await mkdir(env.LOCALAPPDATA,{recursive:true});return {home,data,env,close:()=>rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:100})};
}
packagedTest('fresh profile uses the packaged installer setup entry, then both installed MCP entries report real progress and ETA without system Node',async()=>{
 const f=await profile(),resources=join(dirname(exe),'resources'),clients:Client[]=[];let app:Awaited<ReturnType<typeof _electron.launch>>|undefined;
 try{
  const setup=()=>promisify(execFile)(exe,[join(resources,'integration/setup-cli.cjs')],{env:{...f.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:30000});
  expect(JSON.parse((await setup()).stdout).applied).toBe(true);expect(JSON.parse((await setup()).stdout).applied).toBe(true);
  const receipts=JSON.parse(await readFile(join(f.data,'receipts.json'),'utf8'));expect(Object.keys(receipts)).toHaveLength(8);
  expect(await readFile(join(f.home,'.agents/skills/coding-schedule-report/SKILL.md'),'utf8')).toContain('progress_begin');expect(await readFile(join(f.home,'.claude/skills/coding-schedule-report/SKILL.md'),'utf8')).toContain('progress_begin');
  expect(await readFile(join(f.home,'.codex/AGENTS.md'),'utf8')).toContain('Reporting is enabled by default');expect(await readFile(join(f.home,'.claude/CLAUDE.md'),'utf8')).toContain('Reporting is enabled by default');
  app=await _electron.launch({executablePath:exe,args:['--data-dir',f.data],env:f.env});const page=await app.firstWindow();await page.waitForSelector('#compact');await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'pinExpanded',value:true}));await page.waitForFunction(()=>document.querySelector<HTMLElement>('#health')?.hidden);
  for(const provider of ['codex','claude']){
   const root=provider==='codex'?toml(await readFile(join(f.home,'.codex/config.toml'),'utf8')):JSON.parse(await readFile(join(f.home,'.claude/.claude.json'),'utf8'));
   const entry=(root[provider==='codex'?'mcp_servers':'mcpServers'] as Record<string,{command:string;args:string[]}>).codingSchedule!;
   expect(entry.command).toBe(join(resources,'bridge/mcp-relay.exe'));const client=new Client({name:'clean-setup-'+provider,version:'1'});clients.push(client);await client.connect(new StdioClientTransport({...entry,env:f.env,stderr:'pipe'}));
   expect((await client.listTools()).tools.map(t=>t.name).sort()).toEqual(['progress_begin','progress_context','progress_finish','progress_report']);
   const call=async(name:string,args:Record<string,unknown>)=>{const reply=await client.callTool({name,arguments:args});if(reply.isError)throw new Error('MCP rejected clean-profile call');return JSON.parse((reply.content[0] as {text:string}).text);};
   const began=await call('progress_begin',{idempotencyKey:uuidv7(),title:provider+' 干净接入任务',plan:{revision:1,complete:true,schedule:'serial',steps:[{id:'a',title:'检查接入',status:'running',evidence:'declared',weight:1}]}}),handle=began.handle;
   const context=await call('progress_context',{handle});await call('progress_report',{handle,seq:context.nextSeq,reportId:uuidv7(),changes:[{type:'activity.updated',activity:provider+' 正在校验配置与计时'},{type:'eta.answered',requestId:context.etaQuestion.requestId,planRevision:1,range:{minSec:120,maxSec:180},reason:'隔离验收计时样本'}]});
   await expect.poll(()=>page.locator('#activity').textContent()).toBe(provider+' 正在校验配置与计时');await expect.poll(()=>page.locator('#eta').textContent()).not.toContain('不能估时');expect(await page.locator('#eta').textContent()).toMatch(/[0-9]/);
   const next=await call('progress_context',{handle});await call('progress_report',{handle,seq:next.nextSeq,reportId:uuidv7(),changes:[{type:'step.updated',revision:1,step:{id:'a',title:'检查接入',status:'completed',evidence:'verified',weight:1}}]});const end=await call('progress_context',{handle});expect((await call('progress_finish',{handle,seq:end.nextSeq,reportId:uuidv7(),summary:'干净接入验证完成'})).accepted).toBe(true);
  }
 }finally{await Promise.allSettled(clients.map(c=>c.close()));await app?.close();await f.close();}
},80000);
packagedTest('portable first setup is one focused action with clear results, persisted configuration, themes, conflict feedback and safe grouped undo',async()=>{
 const f=await profile(),artifacts=resolve(process.env.SCHEDULE_UI_ARTIFACT_DIR||'.artifacts/onboarding/screens');await mkdir(artifacts,{recursive:true});const app=await _electron.launch({executablePath:exe,args:['--data-dir',f.data],env:f.env});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#compact');await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'openSettings'}));await page.waitForSelector('#setup-install');await expect.poll(()=>page.locator('#quick-setup').getAttribute('aria-busy')).toBe('false');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.focus());await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isFocused())).toBe(true);await page.locator('#setup-check').evaluate(e=>e.closest('details')!.setAttribute('open',''));await page.locator('#setup-check').click();await expect.poll(()=>page.locator('#quick-setup').getAttribute('data-state')).toBe('missing');await page.locator('#setup-details').evaluate(e=>e.removeAttribute('open'));
  await page.locator('#quick-setup').scrollIntoViewIfNeeded();await page.screenshot({path:join(artifacts,'first-run.png')});await page.locator('#setup-install').focus();await page.keyboard.press('Enter');await expect.poll(()=>page.locator('#quick-setup').getAttribute('data-state'),{timeout:20000}).toBe('ready');expect(await page.locator('#setup-result').textContent()).toContain('宿主加载');expect(await page.locator('#monitor-mode').textContent({timeout:5000})).toContain('当前未开启监测');
  for(const colorScheme of ['light','dark'] as const){await page.emulateMedia({colorScheme});await page.screenshot({path:join(artifacts,'configured-'+colorScheme+'.png')});}
  await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'closeSettings'}));await expect(page.evaluate(()=>window.schedule.dispatchUiCommand({type:'setupInstall'}))).rejects.toThrow('focused');await page.evaluate(()=>window.schedule.dispatchUiCommand({type:'openSettings'}));await page.waitForSelector('#setup-install');await expect.poll(()=>page.locator('#quick-setup').getAttribute('data-state')).toBe('ready');
  const skill=join(f.home,'.claude/skills/coding-schedule-report/SKILL.md'),text=await readFile(skill,'utf8');await writeFile(skill,text+'\nUser addition');await page.locator('#setup-details').evaluate(e=>e.setAttribute('open',''));await page.locator('#setup-check').scrollIntoViewIfNeeded();await page.locator('#setup-check').click();await expect.poll(()=>page.locator('#quick-setup').getAttribute('data-state')).toBe('conflict');await page.locator('#quick-setup').scrollIntoViewIfNeeded();await page.screenshot({path:join(artifacts,'conflict.png')});
  await writeFile(skill,text);await page.locator('#setup-details').evaluate(e=>e.setAttribute('open',''));await page.locator('#setup-check').click();await expect.poll(()=>page.locator('#quick-setup').getAttribute('data-state')).toBe('ready');await page.locator('#setup-remove').click();await expect.poll(()=>page.locator('#setup-result').textContent()).toContain('已撤销');expect(Object.keys(JSON.parse(await readFile(join(f.data,'receipts.json'),'utf8')))).toHaveLength(0);
 }finally{await app.close();await f.close();}
},80000);
