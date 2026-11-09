import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {existsSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {expect,test} from 'vitest';
const executable=join(process.env.SCHEDULE_TEST_PACKAGE_DIR||'release/win-unpacked','codingSchedule.exe');
test.skipIf(!existsSync(executable))('waiting round trip resumes the same run and all ten reporter tasks remain active',async()=>{
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/replay.mjs','--exe',executable,'--runs','10','--rate','20','--duration','2'],{windowsHide:true,timeout:40000});const result=JSON.parse(stdout.trim()),raw=JSON.parse(await readFile(join(result.dataDir,'raw.json'),'utf8'));
 expect(raw.lostAcknowledgement).toBe(true);expect(raw.duplicates).toBe(1);
 const db=new DatabaseSync(join(result.dataDir,'schedule.db'),{readOnly:true});try{const count=Number(db.prepare("SELECT count(*) n FROM runs WHERE json_extract(state_json,'$.snapshot.scope')='task' AND json_extract(state_json,'$.snapshot.status')='active'").get()!.n);expect(count).toBe(10);expect(raw.acknowledgedEvents).toBeGreaterThanOrEqual(40);}finally{db.close();}
},45000);
