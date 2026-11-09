import {readFile,access} from 'node:fs/promises';
import {homedir} from 'node:os';import {join,isAbsolute} from 'node:path';
import {createCredential} from '../bridge/credential.js';
import {previewIntegration,previewTextIntegration,receiptIsCurrent} from './config-patch.js';
import type {ConfigPatch,IntegrationRequest} from './config-patch.js';
import {readReceipts,applyRecordedIntegrations,revertRecordedIntegrations} from './receipts.js';

export type SetupRuntime={dir:string;nodePath:string;runAsNode?:boolean;bridgePath:string;relayPath?:string;integrationsPath:string;installRoot?:string;home?:string;env?:NodeJS.ProcessEnv};
export type SetupItem={provider:'codex'|'claude';name:string;path:string;state:'ready'|'missing'|'conflict';message?:string};
export type SetupStatus={ready:boolean;managed:boolean;items:SetupItem[]};
type Target={provider:'codex'|'claude';name:string;path:string;kind:'skill'|'rules'|IntegrationRequest['host']};
async function exists(path:string){try{await access(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
export async function setupTargets(runtime:SetupRuntime):Promise<Target[]>{
 const home=runtime.home??homedir(),env=runtime.env??process.env,codex=env.CODEX_HOME||join(home,'.codex'),claude=env.CLAUDE_CONFIG_DIR||join(home,'.claude');
 for(const path of [home,codex,claude])if(!isAbsolute(path))throw new Error('AI 配置目录必须是绝对路径');
 // Codex loads the first nonempty global override rather than AGENTS.md.
 let rules=join(codex,'AGENTS.md');const override=join(codex,'AGENTS.override.md');
 if(await exists(override)&&(await readFile(override,'utf8')).trim())rules=override;
 return [
  {provider:'codex',name:'MCP',kind:'codex',path:join(codex,'config.toml')},
  {provider:'codex',name:'汇报 Skill',kind:'skill',path:join(home,'.agents','skills','coding-schedule-report','SKILL.md')},
  {provider:'codex',name:'默认汇报规则',kind:'rules',path:rules},
  {provider:'codex',name:'异步估时 Hook',kind:'codex-hooks',path:join(codex,'hooks.json')},
  {provider:'claude',name:'MCP',kind:'claude',path:env.CLAUDE_CONFIG_DIR?join(claude,'.claude.json'):join(home,'.claude.json')},
  {provider:'claude',name:'汇报 Skill',kind:'skill',path:join(claude,'skills','coding-schedule-report','SKILL.md')},
  {provider:'claude',name:'默认汇报规则',kind:'rules',path:join(claude,'CLAUDE.md')},
  {provider:'claude',name:'异步估时 Hook',kind:'claude-hooks',path:join(claude,'settings.json')}
 ];
}
async function prepare(runtime:SetupRuntime){
 const records=await readReceipts(runtime.dir),targets=await setupTargets(runtime),patches:ConfigPatch[]=[],items:SetupItem[]=[];
 const skill=await readFile(join(runtime.integrationsPath,'skill','SKILL.md'),'utf8'),rules=(await readFile(join(runtime.integrationsPath,'reporting-rule.md'),'utf8')).trim();
 for(const target of targets){
  try{
   const receipt=Object.values(records).find(r=>r.path.toLowerCase()===target.path.toLowerCase()&&r.host===target.kind);
   const receiptCurrent=receipt&&await receiptIsCurrent(receipt);
   let patch:ConfigPatch;
   if(target.kind==='skill'||target.kind==='rules')patch=await previewTextIntegration(target.path,target.kind,target.kind==='skill'?skill:rules);
   else{
    const hook=target.kind.endsWith('-hooks'),connectorId=target.provider+(hook?'-hook':'-reporter');
    const credentialPath=await createCredential(runtime.dir,connectorId,target.provider,hook?'hook':'reporter');
    const migrate=runtime.installRoot&&receiptCurrent&&receipt?.installRoot!==runtime.installRoot;
    patch=await previewIntegration({host:target.kind,configPath:target.path,nodePath:runtime.nodePath,runAsNode:!!runtime.runAsNode,bridgePath:hook?join(runtime.integrationsPath,'hooks',target.provider+'.cjs'):runtime.bridgePath,...(!hook&&runtime.relayPath?{relayPath:runtime.relayPath}:{}),connectorId,credentialPath,endpointPath:join(runtime.dir,'endpoint.json'),preserveCompatible:!migrate});
   }
   const preserveRule=target.kind==='rules'&&typeof patch.ownedBefore==='string'&&/^<!-- codingSchedule auto-report begin -->\s*## codingSchedule background progress\b/.test(patch.ownedBefore)&&patch.ownedBefore.includes('coding-schedule-report')&&patch.ownedBefore.includes('progress_context')&&(!receipt||receiptCurrent);
   const preserveSkill=target.kind==='skill'&&typeof patch.ownedBefore==='string'&&patch.ownedBefore.replaceAll('\r\n','\n').trim()===skill.replaceAll('\r\n','\n').trim();
   if(patch.preserved||preserveRule||preserveSkill){items.push({...target,state:'ready',message:'沿用已有接入，原有内容保持不变。'});continue;}
   // Only own receipts or byte-identical preexisting content may be adopted.
   // An unrelated same-name skill/MCP must never be overwritten by one click.
   const conflict=receipt?patch.ownedBefore!==null&&!receiptCurrent:patch.ownedBefore!==null&&JSON.stringify(patch.ownedBefore)!==JSON.stringify(patch.ownedAfter);
   items.push({...target,state:conflict?'conflict':patch.beforeText===patch.afterText?'ready':'missing',...(conflict?{message:'同名内容已被修改，请先核对或撤销旧接入。'}:{})});
   patches.push({...patch,bundle:'default-hosts',...(runtime.installRoot?{installRoot:runtime.installRoot}:{})});
  }catch{items.push({...target,state:'conflict',message:'无法读取或解析，请检查该路径的格式和访问权限。'});}
 }
 return {patches,status:{ready:items.every(i=>i.state==='ready'),managed:Object.keys(records).length>0,items}};
}
export async function setupStatus(runtime:SetupRuntime):Promise<SetupStatus>{return (await prepare(runtime)).status;}
export async function installSetup(runtime:SetupRuntime){
 for(const path of [runtime.nodePath,runtime.bridgePath,join(runtime.integrationsPath,'hooks','codex.cjs'),join(runtime.integrationsPath,'hooks','claude.cjs'),...(runtime.relayPath?[runtime.relayPath]:[])])await access(path);
 const {patches,status}=await prepare(runtime);
 if(status.items.some(i=>i.state==='conflict'))return {applied:false,reason:'conflict' as const,status};
 const result=await applyRecordedIntegrations(runtime.dir,patches);
 return {...result,status:await setupStatus(runtime)};
}
export async function removeSetup(runtime:SetupRuntime){
 const records=await readReceipts(runtime.dir),paths=new Set((await setupTargets(runtime)).map(t=>t.path.toLowerCase()));
 const ids=Object.entries(records).filter(([,r])=>(r.bundle==='default-hosts'||paths.has(r.path.toLowerCase()))&&r.installRoot===runtime.installRoot).map(([id])=>id);
 const result=await revertRecordedIntegrations(runtime.dir,ids.reverse(),runtime.installRoot);
 return {...result,status:await setupStatus(runtime)};
}
