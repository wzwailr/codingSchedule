import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {existsSync} from 'node:fs';import {expect,test} from 'vitest';import {getMakeNsisPath} from 'app-builder-lib/out/toolsets/windows.js';
test.skipIf(process.platform!=='win32'||(!process.env.SCHEDULE_TEST_PACKAGE_DIR&&!existsSync('release/win-unpacked/codingSchedule.exe')))('actual NSIS init macro rejects recursive delete switch before executing any uninstall body',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-nsis-guard-')),exe=join(d,'guard.exe'),script=join(d,'guard.nsi');
 try{
  // Compile our real init macro in a harmless harness: no files, registry edits,
  // default builder uninstall body or uninstall actions exist in this binary.
  await writeFile(script,`Unicode true\nRequestExecutionLevel user\nSilentInstall silent\n!include LogicLib.nsh\n!include FileFunc.nsh\n!define BUILD_UNINSTALLER\n!include "${resolve('build/installer.nsh')}"\nOutFile "${exe}"\nFunction .onInit\n!insertmacro customUnInit\nSetErrorLevel 0\nQuit\nFunctionEnd\nSection\nSectionEnd\n`);
  const compiler=await getMakeNsisPath(undefined);
  await promisify(execFile)(compiler.path,['/V2','/INPUTCHARSET','UTF8',script],{env:{...process.env,...compiler.env},windowsHide:true}).catch((e:{stdout:string;stderr:string})=>{throw new Error(e.stdout+e.stderr);});
  const code=await promisify(execFile)(exe,['/S','--delete-app-data'],{windowsHide:true}).then(()=>0,(e:{code:number})=>e.code);expect(code).toBe(2);
  await expect(promisify(execFile)(exe,['/S'],{windowsHide:true})).resolves.toBeDefined();
 }finally{await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},20000);
