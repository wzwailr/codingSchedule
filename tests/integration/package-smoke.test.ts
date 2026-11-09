import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {expect,test} from 'vitest';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
const packageDir=process.env.SCHEDULE_TEST_PACKAGE_DIR||'release/win-unpacked';
test.skipIf(!existsSync(join(packageDir,'codingSchedule.exe')))('packaged Windows binary reports in Chinese paths without system Node; exit leaves no collector',async()=>{
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/package-smoke.mjs','--dir='+packageDir],{timeout:90000,windowsHide:true,maxBuffer:1024*1024});
 const result=JSON.parse(stdout.trim());expect(result).toMatchObject({ok:true,remainingProcesses:0});expect(result.tools).toContain('progress_report');
},95000);
