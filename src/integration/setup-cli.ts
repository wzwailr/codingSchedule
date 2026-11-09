import {homedir} from 'node:os';import {join,resolve,isAbsolute} from 'node:path';import {mkdir} from 'node:fs/promises';
import {installSetup} from './setup.js';
import {assertProfileIdle} from '../desktop/profile.js';
async function main(){
const root=resolve(__dirname,'..'),index=process.argv.indexOf('--data-dir'),dir=index<0?join(homedir(),'.coding-schedule'):process.argv[index+1];
if(!dir||!isAbsolute(dir)){console.error('Absolute data directory required');process.exitCode=2;}
else if(process.argv.includes('--check-profile')){
 try{await assertProfileIdle(dir);}catch{console.error('Progress profile in use or invalid.');process.exitCode=3;}
}
else{
 try{
  await mkdir(dir,{recursive:true});const result=await installSetup({dir,nodePath:process.execPath,runAsNode:!!process.versions.electron,bridgePath:join(root,'bridge','main.cjs'),relayPath:join(root,'bridge','mcp-relay.exe'),integrationsPath:join(root,'integrations'),...(process.argv.includes('--webview2')?{installRoot:resolve(root,'..')}:{})});
  // No configuration bodies, credentials or private task handles in logs.
  console.log(JSON.stringify({applied:result.applied,reason:result.reason,items:result.status.items.map(i=>({provider:i.provider,name:i.name,state:i.state}))}));process.exitCode=result.applied?0:2;
 }catch{console.error('Setup incomplete; open codingSchedule settings to check paths and repair. Existing files and recovery journal were preserved.');process.exitCode=3;}
}
}
void main();
