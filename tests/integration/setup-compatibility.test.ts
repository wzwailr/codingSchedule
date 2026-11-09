import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {expect,test} from 'vitest';
import {installSetup,removeSetup,setupStatus,setupTargets,type SetupRuntime} from '../../src/integration/setup.js';import {previewIntegration,applyIntegration} from '../../src/integration/config-patch.js';import {createCredential} from '../../src/bridge/credential.js';
import {prepareRemoval} from '../../src/integration/removal.js';
import {readReceipts} from '../../src/integration/receipts.js';
async function fixture(){const home=await mkdtemp(join(tmpdir(),'保留旧接入-')),dir=join(home,'data'),old=join(home,'old-package');await mkdir(dir);await mkdir(old);await copyFile('dist/bridge/mcp-relay.exe',join(old,'mcp-relay.exe'));for(const name of ['claude.cjs','codex.cjs','common.cjs'])await copyFile(join('integrations/hooks',name),join(old,name));const runtime:SetupRuntime={home,env:{},dir,nodePath:process.execPath,bridgePath:resolve('dist/bridge/main.cjs'),relayPath:resolve('dist/bridge/mcp-relay.exe'),integrationsPath:resolve('integrations')};return {runtime,old,close:()=>rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:100})};}
test('compatible unmanaged MCP entries, approval fields, old hook paths and legacy rules are preserved byte-for-byte for Codex and Claude',async()=>{
 const f=await fixture();try{
  const originals=new Map<string,string>();
  for(const target of await setupTargets(f.runtime)){
   if(target.kind==='rules'){
    await mkdir(join(target.path,'..'),{recursive:true});const text='# user content\r\n<!-- codingSchedule auto-report begin -->\r\n## codingSchedule background progress\r\nUse coding-schedule-report and read progress_context before meaningful updates.\r\n<!-- codingSchedule auto-report end -->\r\n# keep extra rules';await writeFile(target.path,text);originals.set(target.path,text);
   }else if(target.kind!=='skill'){
    const hook=target.kind.endsWith('-hooks'),connectorId=target.provider+(hook?'-hook':'-reporter'),credentialPath=await createCredential(f.runtime.dir,connectorId,target.provider,hook?'hook':'reporter');
    const patch=await previewIntegration({host:target.kind,configPath:target.path,nodePath:f.runtime.nodePath,bridgePath:hook?join(f.old,target.provider+'.cjs'):f.runtime.bridgePath,...(!hook?{relayPath:join(f.old,'mcp-relay.exe')}:{}),connectorId,credentialPath,endpointPath:join(f.runtime.dir,'endpoint.json')});expect((await applyIntegration(patch)).applied).toBe(true);
    let text=await readFile(target.path,'utf8');if(target.kind==='codex')text=text.replace(/^# codingSchedule (?:begin|end)\r?\n/gm,'').replace('[mcp_servers.codingSchedule]','[mcp_servers.codingSchedule]\ndefault_tools_approval_mode="approve"');if(target.kind==='claude')text=text.replace('"command":','"timeout": 30, "command":');await writeFile(target.path,text);originals.set(target.path,text);
   }
  }
  const status=await setupStatus(f.runtime);expect(status.items.filter(i=>i.name!=='汇报 Skill').every(i=>i.state==='ready')).toBe(true);
  expect((await installSetup(f.runtime)).status.ready).toBe(true);expect((await installSetup(f.runtime)).applied).toBe(true);
  for(const [path,text] of originals)expect(await readFile(path,'utf8')).toBe(text);
  expect((await removeSetup(f.runtime)).applied).toBe(true);for(const [path,text] of originals)expect(await readFile(path,'utf8')).toBe(text);
 }finally{await f.close();}
},30000);
test('an existing foreign credential route or disabled MCP is not silently adopted or overwritten',async()=>{
 const f=await fixture();try{
  const target=(await setupTargets(f.runtime))[0]!;await mkdir(join(target.path,'..'),{recursive:true});
  const text=`[mcp_servers.codingSchedule]\ncommand=${JSON.stringify(f.runtime.relayPath)}\nargs=["--connector","codex-reporter","--credential","foreign.json","--endpoint","foreign-endpoint.json"]\n`;
  await writeFile(target.path,text);expect((await installSetup(f.runtime)).applied).toBe(false);expect(await readFile(target.path,'utf8')).toBe(text);
  const credential=await createCredential(f.runtime.dir,'codex-reporter','codex','reporter'),disabled=`[mcp_servers.codingSchedule]\nenabled=false\ncommand=${JSON.stringify(f.runtime.relayPath)}\nargs=${JSON.stringify(['--connector','codex-reporter','--credential',credential,'--endpoint',join(f.runtime.dir,'endpoint.json')])}\n`;
  await writeFile(target.path,disabled);expect((await installSetup(f.runtime)).applied).toBe(false);expect(await readFile(target.path,'utf8')).toBe(disabled);
 }finally{await f.close();}
});

test('owned hooks migrate from standalone Node to shared Electron without changing other host settings, then grouped undo retains later user edits',async()=>{
 const f=await fixture();try{
  expect((await installSetup(f.runtime)).status.ready).toBe(true);
  const target=(await setupTargets(f.runtime)).find(t=>t.kind==='claude-hooks')!;
  await writeFile(target.path,(await readFile(target.path,'utf8')).replace('{','{"userPreference":"keep",'));
  const next={...f.runtime,runAsNode:true};
  expect((await setupStatus(next)).items.filter(i=>i.state==='missing').map(i=>[i.provider,i.name])).toEqual([['codex','异步估时 Hook'],['claude','异步估时 Hook']]);
  expect((await installSetup(next)).status.ready).toBe(true);
  expect(await readFile(target.path,'utf8')).toContain("$env:ELECTRON_RUN_AS_NODE='1';");
  expect(await readFile(target.path,'utf8')).toContain('"userPreference":"keep"');
  expect((await removeSetup(next)).applied).toBe(true);
  expect(JSON.parse(await readFile(target.path,'utf8'))).toMatchObject({userPreference:'keep'});
  expect(await readFile(target.path,'utf8')).not.toContain('ELECTRON_RUN_AS_NODE');
 }finally{await f.close();}
});

test('WebView2 adopts only managed commands and uninstall restores the previous installation receipts',async()=>{
 const f=await fixture();try{
  const prior={...f.runtime,runAsNode:true,relayPath:join(f.old,'mcp-relay.exe')};
  expect((await installSetup(prior)).status.ready).toBe(true);
  const before=await readReceipts(prior.dir);
  const next={...f.runtime,installRoot:join(f.runtime.home!,'WebView2')};
  expect((await installSetup(next)).status.ready).toBe(true);
  expect((await installSetup(next)).applied).toBe(true);
  const migrated=Object.values(await readReceipts(prior.dir)).filter(r=>r.installRoot===next.installRoot);
  expect(migrated.map(r=>r.host).sort()).toEqual(['claude','claude-hooks','codex','codex-hooks']);
  expect(migrated.every(r=>r.previousInstallation)).toBe(true);
  expect((await prepareRemoval(prior.dir,false,next.installRoot)).ok).toBe(true);
  expect(await readReceipts(prior.dir)).toEqual(before);
  expect((await setupStatus(prior)).ready).toBe(true);
 }finally{await f.close();}
});
