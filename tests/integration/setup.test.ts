import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {expect,test,vi} from 'vitest';
import {installSetup,removeSetup,setupStatus,setupTargets,type SetupRuntime} from '../../src/integration/setup.js';
import {applyIntegration,previewTextIntegration} from '../../src/integration/config-patch.js';
import {applyRecordedIntegrations,readReceipts,recoverIntegrations} from '../../src/integration/receipts.js';
import {prepareRemoval} from '../../src/integration/removal.js';import * as credentials from '../../src/bridge/credential.js';
async function fixture(){
 const home=await mkdtemp(join(tmpdir(),'一键接入 空白-')),dir=join(home,'data');await mkdir(dir);
 const runtime:SetupRuntime={home,env:{},dir,nodePath:process.execPath,bridgePath:resolve('dist/bridge/main.cjs'),relayPath:resolve('dist/bridge/mcp-relay.exe'),integrationsPath:resolve('integrations')};
 return {home,runtime,close:()=>rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:100})};
}
test('empty profile installs eight components for both hosts, is idempotent, repairs a missing file and uninstalls all without deleting user data',async()=>{
 const f=await fixture();try{
  expect((await setupStatus(f.runtime)).ready).toBe(false);expect((await installSetup(f.runtime)).status.ready).toBe(true);
  const targets=await setupTargets(f.runtime);expect(targets).toHaveLength(8);for(const target of targets)await access(target.path);
  const records=await readReceipts(f.runtime.dir);expect(Object.keys(records)).toHaveLength(8);
  expect((await installSetup(f.runtime)).applied).toBe(true);expect(Object.keys(await readReceipts(f.runtime.dir))).toEqual(Object.keys(records));
  const skill=targets.find(t=>t.kind==='skill')!;await rm(skill.path);expect((await installSetup(f.runtime)).status.ready).toBe(true);
  await writeFile(join(f.runtime.dir,'source.jsonl'),'keep');await writeFile(join(f.runtime.dir,'schedule.db'),'keep');
  expect((await prepareRemoval(f.runtime.dir,false)).ok).toBe(true);for(const target of targets)await expect(access(target.path)).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(join(f.runtime.dir,'source.jsonl'),'utf8')).toBe('keep');expect(await readFile(join(f.runtime.dir,'schedule.db'),'utf8')).toBe('keep');
 }finally{await f.close();}
},30000);
test('existing comments, other servers, permissions and rules survive install, later edits, reapply and grouped undo; Codex override and custom Claude home are honored',async()=>{
 const f=await fixture();try{
  const codex=join(f.home,'codex-profile'),claude=join(f.home,'claude-profile');await mkdir(codex);await mkdir(claude);f.runtime.env={CODEX_HOME:codex,CLAUDE_CONFIG_DIR:claude};
  const targets=await setupTargets(f.runtime),config=join(codex,'config.toml'),override=join(codex,'AGENTS.override.md'),claudeConfig=join(claude,'.claude.json'),settings=join(claude,'settings.json');
  await writeFile(config,'# keep\nmodel="example"\n[mcp_servers.other]\ncommand="keep"\n');await writeFile(override,'# 我的默认规则\n不要提交\n');await writeFile(join(codex,'AGENTS.md'),'base unchanged');
  await writeFile(claudeConfig,'{\n// keep comment\n"mcpServers":{"other":{"command":"keep"}}\n}');await writeFile(settings,'{"permissions":{"allow":["Read"]},"hooks":{"Stop":[]}}');
  expect((await installSetup(f.runtime)).applied).toBe(true);expect(await readFile(override,'utf8')).toContain('codingSchedule auto-report begin');expect(await readFile(join(codex,'AGENTS.md'),'utf8')).toBe('base unchanged');
  await writeFile(config,(await readFile(config,'utf8'))+'\n# later edit\n');await writeFile(override,(await readFile(override,'utf8'))+'\n# later rules\n');
  expect((await installSetup(f.runtime)).applied).toBe(true);expect((await removeSetup(f.runtime)).applied).toBe(true);
  expect(await readFile(config,'utf8')).toContain('# later edit');expect(await readFile(override,'utf8')).toContain('# later rules');expect(await readFile(override,'utf8')).not.toContain('codingSchedule auto-report');
  expect(await readFile(claudeConfig,'utf8')).toContain('// keep comment');expect(JSON.parse(await readFile(settings,'utf8'))).toEqual({permissions:{allow:['Read']},hooks:{Stop:[]}});
  expect(targets.find(t=>t.kind==='claude')!.path).toBe(claudeConfig);
 }finally{await f.close();}
},30000);
test('unrecognized same-name skill blocks the whole setup before any host configuration is changed',async()=>{
 const f=await fixture();try{
  const path=(await setupTargets(f.runtime)).find(t=>t.kind==='skill')!.path;await mkdir(join(path,'..'),{recursive:true});await writeFile(path,'user customized skill');
  const result=await installSetup(f.runtime);expect(result).toMatchObject({applied:false,reason:'conflict'});expect(await readFile(path,'utf8')).toBe('user customized skill');
  await expect(access(join(f.home,'.codex/config.toml'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await f.close();}
});
test('changed owned rule prevents grouped undo without partially removing MCP; a malformed document prevents installation',async()=>{
 const f=await fixture();try{
  expect((await installSetup(f.runtime)).applied).toBe(true);const rules=(await setupTargets(f.runtime)).find(t=>t.kind==='rules')!;await writeFile(rules.path,(await readFile(rules.path,'utf8')).replace('Reporting is enabled','Reporting is disabled'));
  expect((await removeSetup(f.runtime)).applied).toBe(false);expect(await readFile(join(f.home,'.codex/config.toml'),'utf8')).toContain('codingSchedule');
  expect((await installSetup(f.runtime)).applied).toBe(false);
 }finally{await f.close();}
});
test('receipt persistence failure rolls back already written files; unfinished journal recovers on next load',async()=>{
 const f=await fixture();try{
  const paths=[join(f.home,'a.md'),join(f.home,'b.md')],patches=await Promise.all(paths.map(p=>previewTextIntegration(p,'skill','skill'))),original=credentials.atomicJson;
  let fail=true;const spy=vi.spyOn(credentials,'atomicJson').mockImplementation(async(path,value,privateFile)=>{if(path===join(f.runtime.dir,'receipts.json')&&fail){fail=false;throw new Error('disk failure');}return original(path,value,privateFile);});
  try{expect((await applyRecordedIntegrations(f.runtime.dir,patches)).applied).toBe(false);}finally{spy.mockRestore();}
  for(const p of paths)await expect(access(p)).rejects.toMatchObject({code:'ENOENT'});
  await writeFile(join(f.runtime.dir,'integration-transaction.json'),JSON.stringify({version:1,committed:false,before:{},patches}));expect((await applyIntegration(patches[0]!)).applied).toBe(true);
  await recoverIntegrations(f.runtime.dir);for(const p of paths)await expect(access(p)).rejects.toMatchObject({code:'ENOENT'});expect(await readReceipts(f.runtime.dir)).toEqual({});
 }finally{await f.close();}
});
test('interrupted recovery preserves later outside edits, and refuses changed owned content without deleting its journal',async()=>{
 const f=await fixture();try{
  const path=join(f.home,'AGENTS.md'),rule='<!-- codingSchedule auto-report begin -->\nowned rule\n<!-- codingSchedule auto-report end -->',patch=await previewTextIntegration(path,'rules',rule),journal=join(f.runtime.dir,'integration-transaction.json');
  await writeFile(journal,JSON.stringify({version:1,committed:false,before:{},patches:[patch]}));await applyIntegration(patch);await writeFile(path,(await readFile(path,'utf8'))+'\nUser rule\n');
  await recoverIntegrations(f.runtime.dir);expect(await readFile(path,'utf8')).toContain('User rule');expect(await readFile(path,'utf8')).not.toContain('owned rule');
  const again=await previewTextIntegration(path,'rules',rule);await writeFile(journal,JSON.stringify({version:1,committed:false,before:{},patches:[again]}));await applyIntegration(again);await writeFile(path,(await readFile(path,'utf8')).replace('owned rule','edited rule'));
  await expect(recoverIntegrations(f.runtime.dir)).rejects.toThrow('recovery conflict');expect(await readFile(path,'utf8')).toContain('edited rule');await access(journal);
 }finally{await f.close();}
});
