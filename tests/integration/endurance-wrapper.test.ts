import {expect,test} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';
const execute=promisify(execFile),onWindows=process.platform==='win32';
async function fixture(program:string,options:{missingResources?:boolean;startupDelay?:boolean}={}){
 await mkdir('.artifacts',{recursive:true});const dir=await mkdtemp(resolve('.artifacts/endurance-wrapper-')),scripts=join(dir,'scripts'),candidate=join(dir,'candidate'),bin=join(dir,'bin');
 await Promise.all([mkdir(scripts),mkdir(join(dir,'.artifacts')),mkdir(join(candidate,'resources/bridge'),{recursive:true}),mkdir(bin)]);
 let wrapper=await readFile(process.env.SCHEDULE_TEST_CONTROLLER||resolve('scripts/run-endurance.ps1'),'utf8');
 if(options.startupDelay)wrapper=wrapper.replace('$ownsRun=$true','Start-Sleep -Milliseconds 600\n $ownsRun=$true');
 await writeFile(join(scripts,'run-endurance.ps1'),wrapper);
 await Promise.all([writeFile(join(candidate,'codingSchedule.exe'),'not executed'),copyFile(process.execPath,join(bin,'node.exe')),writeFile(join(scripts,'bench.mjs'),program)]);
 if(!options.missingResources)await Promise.all([writeFile(join(candidate,'resources/app.asar'),'fixture'),writeFile(join(candidate,'resources/bridge/mcp-relay.exe'),'fixture')]);
 const statePath=join(dir,'.artifacts/endurance-current.json'),exitPath=join(dir,'.artifacts/endurance-exit.json');
 return {dir,statePath,exitPath,run(taskName?:string){return execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(scripts,'run-endurance.ps1'),'-Executable',join(candidate,'codingSchedule.exe'),...(taskName?['-SchedulerTaskName',taskName]:[])],{env:{...process.env,PATH:bin+';'+process.env.PATH},windowsHide:true,timeout:20000}).then(r=>({...r,code:0}),e=>e as {code:number;stderr:string});},async state(){return JSON.parse(await readFile(statePath,'utf8'));},async exit(){return JSON.parse(await readFile(exitPath,'utf8'));},async close(){await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});}};
}
async function task(name:string,operation:'create'|'exists'|'delete'){
 const script=[
 "$ErrorActionPreference='Stop';$s=New-Object -ComObject Schedule.Service;$s.Connect();$f=$s.GetFolder('\\');$name='__TASK__';",
 "if('__OP__' -eq 'create'){$d=$s.NewTask(0);$d.Principal.UserId=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$d.Principal.LogonType=3;$d.Settings.Enabled=$false;$a=$d.Actions.Create(0);$a.Path=Join-Path $env:SystemRoot 'System32\\cmd.exe';$a.Arguments='/c exit 0';$null=$f.RegisterTaskDefinition($name,$d,6,$d.Principal.UserId,$null,3,$null)}",
 "elseif('__OP__' -eq 'delete'){try{$f.DeleteTask($name,0)}catch{}}else{try{$null=$f.GetTask($name);'true'}catch{'false'}}"
 ].join('\n').replaceAll('__TASK__',name).replaceAll('__OP__',operation)+';exit 0';
 const result=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000});return result.stdout.trim()==='true';
}
test.skipIf(!onWindows)('wrapper rejects a live owner, preserves stderr/exit23, and releases the temporary power request',async()=>{
 const f=await fixture("process.stderr.write('harmless-native-diagnostic\\n');setTimeout(()=>process.exit(23),4000);"),first=f.run();
 try{
  await expect.poll(async()=>{try{return (await f.state()).temporarySystemAwake;}catch{return false;}},{timeout:7000}).toBe(true);
  const owner=(await f.state()).wrapperPid,second=await f.run();expect(second.code).toBe(1);expect((await f.state()).wrapperPid).toBe(owner);
  expect((await first).code).toBe(23);expect(await f.exit()).toMatchObject({exitCode:23,temporarySystemAwakeReleased:true});expect(await f.state()).toMatchObject({status:'failed',exitCode:23,temporarySystemAwakeReleased:true});
 }finally{await first;await f.close();}
},25000);
test.skipIf(!onWindows)('native exit0 cannot pass a malformed verdict',async()=>{
 const f=await fixture("import fs from 'node:fs';import path from 'node:path';const p=process.env.SCHEDULE_BENCH_STATE,s=JSON.parse(fs.readFileSync(p,'utf8'));s.verdictFile=path.join(path.dirname(p),'verdict.json');fs.writeFileSync(s.verdictFile,'{');fs.writeFileSync(p,JSON.stringify(s));");
 try{expect((await f.run()).code).toBe(1);expect(await f.exit()).toMatchObject({exitCode:1});expect(await f.state()).toMatchObject({status:'failed',exitCode:1});}finally{await f.close();}
},20000);
test.skipIf(!onWindows)('initial resource failure still unregisters its scheduler task and writes a failed terminal state',async()=>{
 const f=await fixture("process.exit(0);",{missingResources:true}),name='codingSchedule-endurance-'+randomUUID();await task(name,'create');
 try{expect((await f.run(name)).code).toBe(1);expect(await task(name,'exists')).toBe(false);expect(await f.state()).toMatchObject({status:'failed',exitCode:1});expect(await f.exit()).toMatchObject({temporarySystemAwakeReleased:true});}finally{await task(name,'delete');await f.close();}
},20000);
test.skipIf(!onWindows)('terminal state I/O failure cannot bypass task cleanup or yield exit0',async()=>{
 const f=await fixture("import fs from 'node:fs';const p=process.env.SCHEDULE_BENCH_STATE;fs.unlinkSync(p);fs.mkdirSync(p);"),name='codingSchedule-endurance-'+randomUUID();await task(name,'create');
 try{expect((await f.run(name)).code).toBe(1);expect(await task(name,'exists')).toBe(false);expect(await f.exit()).toMatchObject({exitCode:1,temporarySystemAwakeReleased:true});}finally{await task(name,'delete');await f.close();}
},20000);
test.skipIf(!onWindows)('simultaneous starters launch exactly one workload and keep one owner manifest',async()=>{
 const f=await fixture("import fs from 'node:fs';fs.appendFileSync('.artifacts/invocations.txt',process.pid+'\\n');setTimeout(()=>process.exit(23),1500);",{startupDelay:true});
 try{const results=await Promise.all([f.run(),f.run()]);expect(results.map(r=>r.code).sort((a,b)=>a-b)).toEqual([1,23]);expect((await readFile(join(f.dir,'.artifacts/invocations.txt'),'utf8')).trim().split(/\r?\n/)).toHaveLength(1);expect(await f.exit()).toMatchObject({exitCode:23,temporarySystemAwakeReleased:true});}finally{await f.close();}
},25000);
