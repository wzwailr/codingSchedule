import {expect,test} from 'vitest';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {resolve} from 'node:path';
test.skipIf(process.platform!=='win32')('endurance launcher verifies a scheduler-owned interactive process with no recurring triggers',async()=>{
 const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/start-endurance.ps1'),'-Executable',process.execPath,'-ValidateOnly'],{windowsHide:true,timeout:10000});
 expect(JSON.parse(stdout)).toMatchObject({serviceOwned:true,validationOnly:true,interactiveSession:true,triggers:0,nodeExecutableExists:true,nodeVersion:expect.stringMatching(/^v24\./)});
},15000);
