import {spawn} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {expect,test} from 'vitest';import {openStore} from '../../src/storage/repository.js';import {startIngest} from '../../src/ingestion/server.js';import {createCredential} from '../../src/bridge/credential.js';
import {source,clock,key,event,NOW} from '../helpers.js';
import {previewIntegration} from '../../src/integration/config-patch.js';
function invoke(script:string,args:string[],body:unknown){return new Promise<{code:number|null;out:string;err:string}>(resolve=>{const child=spawn(process.execPath,[script,...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('exit',code=>resolve({code,out,err}));child.stdin.end(JSON.stringify(body));});}
for(const provider of ['codex','claude'] as const)test(provider+' asynchronous Hook retrieves only a precisely linked task question without chat/control output',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'eta-hook-')),reporter={...source(),provider},native={...source('native','transcript'),provider,nativeSessionId:'session'},store=await openStore(join(dir,'db'),()=>clock());
 const credential=await createCredential(dir,provider+'-hook',provider,'hook'),server=await startIngest(store,{userDataDir:dir,clock:()=>clock()});
 try{
  const h=await store.begin({idempotencyKey:key(),title:'task'},reporter),n=await store.resolveNative(native,'turn');
  await store.commit({events:[event({type:'activity.updated',activity:'implementing'},{run:{runId:n.runId,generation:n.generation},provider,sourceKind:'transcript',nativeSessionId:'session',turnId:'turn',nativeCallId:'known',seq:2})]},native);
  const args=['--credential',credential,'--endpoint',join(dir,'endpoint.json'),'--estimate'],body={session_id:'session',turn_id:'turn',tool_use_id:'known',tool_name:'Bash',hook_event_name:'PostToolUse'},script=resolve('integrations/hooks/'+provider+'.cjs');
  expect((await invoke(script,args,body)).out).toBe('');
  await store.linkNative(h,{provider,nativeSessionId:'session'},['turn']);
  for(const bad of [{...body,tool_use_id:'unknown'},{...body,agent_id:'child'},{...body,turn_id:'unrelated'},{...body,tool_name:'mcp__codingSchedule__progress_context'}])expect((await invoke(script,args,bad)).out).toBe('');
  const child=await invoke(script,args,body);expect(child.code).toBe(0);expect(child.err).toBe('');
  const output=JSON.parse(child.out);expect(Object.keys(output)).toEqual(['hookSpecificOutput']);expect(output.hookSpecificOutput.hookEventName).toBe('PostToolUse');
  const context=await store.context(h,reporter);expect(output.hookSpecificOutput.additionalContext).toContain(context.etaQuestion!.requestId);expect(output.hookSpecificOutput.additionalContext).not.toContain(h.resumeHandle);
  expect(child.out.trim().split('\n')).toHaveLength(1);expect(context.snapshot.etaInquiry).toMatchObject({state:'sent',channel:'hook'});
  expect((await invoke(script,args,body)).out).toBe('');
  expect((await invoke(script,args.filter(a=>a!=='--estimate'),body)).out).toBe('');
  expect((await store.context(h,reporter)).snapshot.lastWorkAt).toBe(NOW);
  if(process.platform==='win32'){
   const shellNative={...native,nativeSessionId:'shell-session'},shellTask=await store.begin({idempotencyKey:key(),title:'independent shell task'},reporter),shellRun=await store.resolveNative(shellNative,'shell-turn');
   await store.commit({events:[event({type:'activity.updated',activity:'shell work'},{run:{runId:shellRun.runId,generation:shellRun.generation},provider,sourceKind:'transcript',nativeSessionId:'shell-session',turnId:'shell-turn',nativeCallId:'shell-known',seq:2})]},shellNative);
   await store.linkNative(shellTask,{provider,nativeSessionId:'shell-session'},['shell-turn']);
   const packaged=process.env.SCHEDULE_TEST_PACKAGE_DIR;
   const configured=(await previewIntegration({host:provider==='codex'?'codex-hooks':'claude-hooks',configPath:join(dir,'config.json'),nodePath:packaged?resolve(packaged,'codingSchedule.exe'):process.execPath,runAsNode:!!packaged,bridgePath:packaged?resolve(packaged,'resources/integrations/hooks',provider+'.cjs'):script,connectorId:provider+'-hook',credentialPath:credential,endpointPath:join(dir,'endpoint.json')})).ownedAfter;
   if('args' in configured)throw new Error('Expected hook');
   const shell=provider==='codex'?process.env.ComSpec||'cmd.exe':'powershell.exe',shellArgs=provider==='codex'?['/d','/s','/c','"'+configured.commandWindows+'"']:['-NoProfile','-NonInteractive','-Command',configured.command];
   const viaShell=await new Promise<string>((resolve,reject)=>{const c=spawn(shell,shellArgs,{windowsHide:true,windowsVerbatimArguments:provider==='codex',stdio:['pipe','pipe','pipe']});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('exit',code=>code===0?resolve(out):reject(new Error(err)));c.stdin.end(JSON.stringify({...body,session_id:'shell-session',turn_id:'shell-turn',tool_use_id:'shell-known'}));});
   expect(JSON.parse(viaShell).hookSpecificOutput.additionalContext).toContain((await store.context(shellTask,reporter)).etaQuestion!.requestId);
  }
 }finally{await server.close();await store.close();await rm(dir,{recursive:true,force:true});}
});
