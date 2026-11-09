import {readFile,writeFile,rename,rm,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {parse as parseToml} from 'smol-toml';
import {parse as parseJson,modify,applyEdits} from 'jsonc-parser';
import type {ParseError} from 'jsonc-parser';
import {v8MemoryArgs} from '../shared/runtime-memory.js';
import {compatibleEntry} from './compatibility.js';
export type IntegrationRequest={host:'codex'|'claude'|'generic'|'codex-hooks'|'claude-hooks';configPath:string;bridgePath:string;nodePath:string;runAsNode?:boolean;relayPath?:string;connectorId:string;credentialPath:string;endpointPath:string;preserveCompatible?:boolean};
type Entry={command:string;args:string[];env?:Record<string,string>}|{type:'command';command:string;commandWindows?:string;shell?:'powershell';async:true;timeout:1};
export type IntegrationHost=IntegrationRequest['host']|'skill'|'rules';
export type ConfigPatch={path:string;beforeHash:string|null;beforeText:string|null;afterText:string;remove?:boolean;preserved?:boolean;bundle?:'default-hosts';installRoot?:string;ownedKeys:string[];host:IntegrationHost;ownedBefore:unknown;ownedAfter:Entry|string|null};
export type InstallReceipt={path:string;beforeHash:string|null;afterHash:string|null;backupPath:string|null;bundle?:'default-hosts';installRoot?:string;previousInstallation?:InstallReceipt;ownedKeys:string[];host:IntegrationHost;ownedBefore:unknown;ownedAfter:Entry|string|null;beforeText:string|null};
export type ApplyResult={applied:boolean;receipt?:InstallReceipt;reason?:'conflict'|'invalid'|'permission'};
const start='# codingSchedule begin',end='# codingSchedule end';
const hash=(v:string|null)=>v===null?null:createHash('sha256').update(v).digest('hex');
async function read(path:string){try{return await readFile(path,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
function document(text:string,host:IntegrationHost):Record<string,unknown>{
  if(host==='skill'||host==='rules')return {};
  if(host==='codex')return parseToml(text) as Record<string,unknown>;
  const errors:ParseError[]=[];const value:unknown=parseJson(text||'{}',errors,{allowTrailingComma:true});
  if(errors.length||!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid configuration');return value as Record<string,unknown>;
}
const hookMarker='--coding-schedule-eta';
type HookGroup={matcher?:string;hooks:Record<string,unknown>[]};
function hookGroups(root:Record<string,unknown>):HookGroup[]{
  if(root.hooks===undefined)return [];
  if(!root.hooks||typeof root.hooks!=='object'||Array.isArray(root.hooks))throw new Error('Invalid hooks');
  const groups=(root.hooks as Record<string,unknown>).PostToolUse;
  if(groups===undefined)return [];
  if(!Array.isArray(groups)||groups.some(g=>!g||typeof g!=='object'||!Array.isArray(g.hooks)))throw new Error('Invalid PostToolUse hooks');
  return groups;
}
function hookLocation(root:Record<string,unknown>){
  const found: Array<{group:number;handler:number;entry:Record<string,unknown>}>=[];
  hookGroups(root).forEach((g,i)=>g.hooks.forEach((h,j)=>{if(typeof h.command==='string'&&h.command.includes(hookMarker))found.push({group:i,handler:j,entry:h});}));
  if(found.length>1)throw new Error('Duplicate owned hook');return found[0];
}
const ruleStart='<!-- codingSchedule auto-report begin -->',ruleEnd='<!-- codingSchedule auto-report end -->';
function ruleBounds(text:string){
  const a=text.indexOf(ruleStart),b=text.indexOf(ruleEnd);
  if(a<0&&b<0)return null;
  if(a<0||b<a||text.indexOf(ruleStart,a+1)>=0||text.indexOf(ruleEnd,b+1)>=0)throw new Error('Invalid reporting rule block');
  return {a,b:b+ruleEnd.length};
}
function owned(text:string,host:IntegrationHost):unknown{
  if(host==='skill')return text||undefined;
  if(host==='rules'){const bounds=ruleBounds(text);return bounds?text.slice(bounds.a,bounds.b):undefined;}
  const root=document(text,host);if(host.endsWith('-hooks'))return hookLocation(root)?.entry;const servers=root[host==='codex'?'mcp_servers':'mcpServers'];return servers&&typeof servers==='object'?(servers as Record<string,unknown>).codingSchedule:undefined;
}
function change(text:string,host:IntegrationHost,value:unknown):string{
  if(host==='skill')return typeof value==='string'?value:'';
  if(host==='rules'){
    const bounds=ruleBounds(text);
    if(bounds)return text.slice(0,bounds.a)+(value??'')+text.slice(bounds.b);
    return value===undefined?text:text+(text&&!text.endsWith('\n')?'\n':'')+(text?'\n':'')+String(value)+'\n';
  }
  if(host.endsWith('-hooks')){
    const base=text||'{}',root=document(base,host),groups=hookGroups(root),location=hookLocation(root);
    const path=['hooks','PostToolUse'];
    if(location){
      if(value===undefined&&groups[location.group]!.hooks.length===1)return applyEdits(base,modify(base,[...path,location.group],undefined,{formattingOptions:{insertSpaces:true,tabSize:2}}));
      return applyEdits(base,modify(base,[...path,location.group,'hooks',location.handler],value,{formattingOptions:{insertSpaces:true,tabSize:2}}));
    }
    if(value===undefined)return base;
    const group={matcher:'.*',hooks:[value]};
    return applyEdits(base,modify(base,groups.length?[...path,groups.length]:path,groups.length?group:[group],{formattingOptions:{insertSpaces:true,tabSize:2}}));
  }
  if(host!=='codex')return applyEdits(text||'{}',modify(text||'{}',['mcpServers','codingSchedule'],value,{formattingOptions:{insertSpaces:true,tabSize:2}}));
  const a=text.indexOf(start),b=text.indexOf(end);let base=text;
  if(a>=0||b>=0){if(a<0||b<a||text.indexOf(start,a+1)>=0)throw new Error('Invalid owned block');base=text.slice(0,a)+text.slice(b+end.length).replace(/^\r?\n/,'');}
  else if(owned(text,host)!==undefined)throw new Error('Unmanaged codingSchedule entry; review manually');
  if(value===undefined)return base;
  const entry=value as {command:string;args:string[];env?:Record<string,string>};const block=`${start}\n[mcp_servers.codingSchedule]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\n${entry.env?'env = { ELECTRON_RUN_AS_NODE = "1" }\n':''}${end}\n`;
  return base+(base&&!base.endsWith('\n')?'\n':'')+block;
}
export async function previewIntegration(input:IntegrationRequest):Promise<ConfigPatch&{ownedAfter:Entry}>{
  const beforeText=await read(input.configPath);const previous=owned(beforeText||'',input.host);
  let entry:Entry;
  if(input.host.endsWith('-hooks')){
    const args=[input.nodePath,...v8MemoryArgs,input.bridgePath,'--credential',input.credentialPath,'--endpoint',input.endpointPath,hookMarker,'--estimate'];
    if(args.some(a=>/[\r\n\0]/.test(a)))throw new Error('Invalid command path');
    const posix=(s:string)=>"'"+s.replace(/\\/g,'/').replace(/'/g,"'\\''")+"'";
    const powershell=(s:string)=>"'"+s.replace(/'/g,"''")+"'";
    // Codex's Windows override uses cmd. Percent expansion happens even in
    // quotes, so such paths need manual installation rather than interpolation.
    if(input.host==='codex-hooks'&&args.some(a=>/["%!]/.test(a)))throw new Error('Unsupported cmd path');
    // PowerShell does not wait for a GUI-subsystem EXE unless it participates
    // in a pipeline. Retain its one JSON line while waiting for the helper.
    entry=input.host==='codex-hooks'?{type:'command',command:(input.runAsNode?'ELECTRON_RUN_AS_NODE=1 ':'')+args.map(posix).join(' '),commandWindows:(input.runAsNode?'set "ELECTRON_RUN_AS_NODE=1" && ':'')+args.map(a=>'"'+a.replace(/\\/g,'/')+'"').join(' '),async:true,timeout:1}:{type:'command',shell:'powershell',command:(input.runAsNode?"$env:ELECTRON_RUN_AS_NODE='1'; ":'')+'& '+args.map(powershell).join(' ')+(input.runAsNode?' | Out-String -Stream':''),async:true,timeout:1};
  }else entry=input.relayPath?{command:input.relayPath,args:['--connector',input.connectorId,'--credential',input.credentialPath,'--endpoint',input.endpointPath]}:{command:input.nodePath,args:[...v8MemoryArgs,input.bridgePath,'--mcp','--connector',input.connectorId,'--credential',input.credentialPath,'--endpoint',input.endpointPath],...(input.runAsNode?{env:{ELECTRON_RUN_AS_NODE:'1'}}:{})};
  const preserved=!!input.preserveCompatible&&await compatibleEntry(previous,entry,input.host.endsWith('-hooks'));
  if(preserved)entry=previous as Entry;
  const afterText=preserved?beforeText!:change(beforeText||'',input.host,entry);document(afterText,input.host);
  return {path:input.configPath,beforeText,beforeHash:hash(beforeText),afterText,preserved,ownedKeys:[input.host.endsWith('-hooks')?'hooks.PostToolUse: '+hookMarker:input.host==='codex'?'mcp_servers.codingSchedule':'mcpServers.codingSchedule'],host:input.host,ownedBefore:previous??null,ownedAfter:entry};
}
export async function previewTextIntegration(path:string,host:'skill'|'rules',text:string):Promise<ConfigPatch>{
  const beforeText=await read(path),ownedBefore=owned(beforeText||'',host)??null;
  if(host==='rules'&&owned(text,host)!==text)throw new Error('Invalid reporting rules');
  return {path,host,beforeText,beforeHash:hash(beforeText),afterText:change(beforeText||'',host,text),ownedBefore,ownedAfter:text,ownedKeys:[host==='skill'?'coding-schedule-report/SKILL.md':'codingSchedule auto-report']};
}
export function receiptFor(patch:ConfigPatch):InstallReceipt{return {...patch,afterHash:hash(patch.remove?null:patch.afterText),backupPath:null};}
export async function patchIsCurrent(patch:ConfigPatch){return hash(await read(patch.path))===patch.beforeHash;}
export async function receiptIsCurrent(receipt:InstallReceipt){return JSON.stringify(owned((await read(receipt.path))||'',receipt.host)??null)===JSON.stringify(receipt.ownedAfter);}
async function replace(path:string,text:string){const temp=path+'.'+randomUUID()+'.tmp';await mkdir(dirname(path),{recursive:true});try{await writeFile(temp,text,{flag:'wx',mode:0o600});await rename(temp,path);}finally{await rm(temp,{force:true});}}
export async function applyIntegration(patch:ConfigPatch):Promise<ApplyResult>{
  try{
    document(patch.afterText,patch.host);if(hash(await read(patch.path))!==patch.beforeHash)return {applied:false,reason:'conflict'};
    const backupPath=patch.beforeText===null?null:patch.path+'.codingSchedule-'+randomUUID()+'.bak';
    if(backupPath)await writeFile(backupPath,patch.beforeText!,{flag:'wx',mode:0o600});
    if(hash(await read(patch.path))!==patch.beforeHash)return {applied:false,reason:'conflict'};
    if(patch.remove)await rm(patch.path,{force:true});else await replace(patch.path,patch.afterText);const afterHash=hash(await read(patch.path));if(afterHash!==hash(patch.remove?null:patch.afterText))return {applied:false,reason:'conflict'};
    return {applied:true,receipt:{...receiptFor(patch),backupPath}};
  }catch(e){return {applied:false,reason:(e as NodeJS.ErrnoException).code==='EACCES'?'permission':'invalid'};}
}
export async function revertIntegration(receipt:InstallReceipt):Promise<ApplyResult>{
  try{
    const patch=await previewRevert(receipt);if(!patch)return {applied:true};
    if(!await patchIsCurrent(patch))return {applied:false,reason:'conflict'};
    if(patch.remove)await rm(receipt.path,{force:true});
    else await replace(receipt.path,patch.afterText);
    return {applied:true};
  }catch(e){return {applied:false,reason:e instanceof Error&&e.message==='Owned entry changed'?'conflict':'invalid'};}
}
export async function previewRevert(receipt:InstallReceipt):Promise<ConfigPatch|null>{
  const current=await read(receipt.path),value=current===null?undefined:owned(current,receipt.host);
  if((current===null||value===undefined)&&(receipt.ownedBefore===null||JSON.stringify(receipt.ownedBefore)===JSON.stringify(receipt.ownedAfter)))return null;
  if(JSON.stringify(value??null)!==JSON.stringify(receipt.ownedAfter))throw new Error('Owned entry changed');
  const afterText=hash(current)===receipt.afterHash?receipt.beforeText:change(current||'',receipt.host,receipt.ownedBefore??undefined);
  document(afterText||'',receipt.host);
  return {path:receipt.path,host:receipt.host,beforeText:current,beforeHash:hash(current),afterText:afterText??'',remove:afterText===null,ownedKeys:receipt.ownedKeys,ownedBefore:receipt.ownedAfter,ownedAfter:(receipt.ownedBefore??null) as ConfigPatch['ownedAfter']};
}
export function combineReceipts(previous:InstallReceipt,next:InstallReceipt):InstallReceipt{
  // Host edits between applies belong to the user. Rebase the rollback text on
  // that document rather than restoring a stale whole-file baseline later.
  const beforeText=next.beforeHash===previous.afterHash||next.beforeText===null?previous.beforeText:change(next.beforeText,next.host,previous.ownedBefore??undefined);
  return {...next,beforeText,beforeHash:hash(beforeText),ownedBefore:previous.ownedBefore,backupPath:previous.backupPath,...(previous.previousInstallation?{previousInstallation:previous.previousInstallation}:{})};
}
