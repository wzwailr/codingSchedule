import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {existsSync} from 'node:fs';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {expect,test} from 'vitest';import {getMakeNsisPath} from 'app-builder-lib/out/toolsets/windows.js';
const root=resolve(process.env.SCHEDULE_TEST_PACKAGE_DIR||'release/win-unpacked');
test.skipIf(process.platform!=='win32'||(!process.env.SCHEDULE_TEST_PACKAGE_DIR&&!existsSync(join(root,'resources/integration/setup-cli.cjs'))))('real NSIS installation macro configures both hosts in an empty HOME and honors the skip choice without registry or real-profile writes',async()=>{
 const base=await mkdtemp(join(tmpdir(),'schedule-setup-nsis-')),exe=join(base,'macro.exe'),script=join(base,'macro.nsi');
 try{
  const restored=join(base,'restored.txt');
  const {writeFile,mkdir}=await import('node:fs/promises');await writeFile(script,`Unicode true\nRequestExecutionLevel user\nSilentInstall silent\n!include LogicLib.nsh\n!include FileFunc.nsh\n!define APP_EXECUTABLE_FILENAME "codingSchedule.exe"\n!include "${resolve('build/installer.nsh')}"\nOutFile "${exe}"\nFunction .onInit\nStrCpy $INSTDIR "${root}"\n!insertmacro customInit\nFunctionEnd\nSection\n!insertmacro customInstall\nReadEnvStr $R0 "ELECTRON_RUN_AS_NODE"\nFileOpen $R1 "${restored}" w\nFileWrite $R1 $R0\nFileClose $R1\nSectionEnd\n`);
  const compiler=await getMakeNsisPath(undefined);
  await promisify(execFile)(compiler.path,['/V2','/INPUTCHARSET','UTF8',script],{env:{...process.env,...compiler.env},windowsHide:true}).catch((e:{stdout:string;stderr:string})=>{throw new Error(e.stdout+e.stderr);});
  for(const mode of ['configured','skipped','previous','failed']){
   const skip=mode==='skipped',home=join(base,mode);await mkdir(home);const env={...process.env,HOME:home,USERPROFILE:home,APPDATA:join(home,'AppData/Roaming'),LOCALAPPDATA:join(home,'AppData/Local'),CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),PATH:join(process.env.SystemRoot||'C:/Windows','System32'),ELECTRON_RUN_AS_NODE:mode==='previous'?'previous':undefined};
   if(mode==='failed'){await mkdir(env.CODEX_HOME);await writeFile(join(env.CODEX_HOME,'config.toml'),'[broken');}
   await promisify(execFile)(exe,skip?['/S','--skip-integrations']:['/S'],{env,windowsHide:true,timeout:30000});
   const receipt=join(home,'.coding-schedule/receipts.json');if(skip||mode==='failed')expect(existsSync(receipt)).toBe(false);else expect(Object.keys(JSON.parse(await readFile(receipt,'utf8')))).toHaveLength(8);
   if(mode==='failed')expect(await readFile(join(env.CODEX_HOME,'config.toml'),'utf8')).toBe('[broken');
   expect(await readFile(restored,'utf8')).toBe(mode==='previous'?'previous':'');
  }
 }finally{await rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},50000);
