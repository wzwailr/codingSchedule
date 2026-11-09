import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ProviderId, SourceKind } from '../shared/contracts.js';
export type Credential = { connectorId:string; token:string; provider:ProviderId; kind:SourceKind };
export async function atomicJson(path:string, value:unknown, privateFile=false):Promise<void> {
  const temp=path+'.'+randomBytes(8).toString('hex')+'.tmp';
  await writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});
  if (privateFile && process.platform==='win32') {
    const identity=execFileSync('whoami',[],{encoding:'utf8',windowsHide:true}).trim();
    execFileSync('icacls',[temp,'/inheritance:r','/grant:r',identity+':F'],{windowsHide:true,stdio:'pipe'});
  }
  await rename(temp,path);
}
export async function createCredential(dir:string, connectorId:string, provider:ProviderId, kind:SourceKind):Promise<string> {
  const root=join(dir,'connectors');await mkdir(root,{recursive:true});
  const path=join(root,createHash('sha256').update(connectorId).digest('hex')+'.json');
  try {const old=await readCredential(path);if(old.connectorId!==connectorId||old.provider!==provider||old.kind!==kind)throw new Error('Credential mismatch');return path;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await atomicJson(path,{connectorId,provider,kind,token:randomBytes(32).toString('base64url')},true);return path;
}
export async function readCredential(path:string):Promise<Credential> {
  const value=JSON.parse(await readFile(path,'utf8')) as Credential;
  if(!value||typeof value.connectorId!=='string'||typeof value.token!=='string'||value.token.length<32||!['codex','claude','generic'].includes(value.provider)||!['reporter','hook'].includes(value.kind))throw new Error('Invalid credential');
  return value;
}
