import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {expect,test} from 'vitest';
import {applyIntegration,previewIntegration} from '../../src/integration/config-patch.js';
import {prepareRemoval} from '../../src/integration/removal.js';

test('removal reverts only owned entries and keeps progress and source logs by default',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-remove-')),config=join(d,'host.json');
 try{
  await writeFile(config,'{"mcpServers":{"other":{"command":"keep"}}}');
  const installed=await applyIntegration(await previewIntegration({host:'claude',configPath:config,nodePath:'n',bridgePath:'b',connectorId:'x',credentialPath:'c',endpointPath:'e'}));
  await writeFile(join(d,'receipts.json'),JSON.stringify({a:installed.receipt}));await writeFile(join(d,'schedule.db'),'progress');await writeFile(join(d,'source.jsonl'),'source');
  expect(await prepareRemoval(d,false)).toMatchObject({ok:true,progressDeleted:false,conflicts:[]});
  expect(await readFile(config,'utf8')).toContain('other');expect(await readFile(config,'utf8')).not.toContain('codingSchedule');
  expect(await readFile(join(d,'schedule.db'),'utf8')).toBe('progress');expect(await readFile(join(d,'source.jsonl'),'utf8')).toBe('source');
 }finally{await rm(d,{recursive:true,force:true});}
});
test('changed owned entry blocks removal and data deletion; explicit deletion never removes logs',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-remove-conflict-')),config=join(d,'host.json');
 try{
  const installed=await applyIntegration(await previewIntegration({host:'claude',configPath:config,nodePath:'n',bridgePath:'b',connectorId:'x',credentialPath:'c',endpointPath:'e'}));
  await writeFile(join(d,'receipts.json'),JSON.stringify({a:installed.receipt}));await writeFile(config,'{"mcpServers":{"codingSchedule":{"command":"user-edited"}}}');await writeFile(join(d,'schedule.db'),'progress');
  expect(await prepareRemoval(d,true)).toMatchObject({ok:false,progressDeleted:false,conflicts:[config]});expect(await readFile(join(d,'schedule.db'),'utf8')).toBe('progress');
  await writeFile(config,JSON.stringify({mcpServers:{codingSchedule:installed.receipt!.ownedAfter}}));await mkdir(join(d,'backups'));await writeFile(join(d,'backups','before-v2-test.sqlite'),'backup');await writeFile(join(d,'backups','notes.jsonl'),'log');
  expect(await prepareRemoval(d,true)).toMatchObject({ok:true,progressDeleted:true});await expect(readFile(join(d,'schedule.db'))).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(join(d,'backups','notes.jsonl'),'utf8')).toBe('log');
 }finally{await rm(d,{recursive:true,force:true});}
});
test('removal refuses a live collector before changing any configuration or progress data',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-remove-live-'));
 try{await writeFile(join(d,'endpoint.json'),JSON.stringify({pid:process.pid,port:12345}));await writeFile(join(d,'schedule.db'),'keep');await expect(prepareRemoval(d,true)).rejects.toThrow('still running');expect(await readFile(join(d,'schedule.db'),'utf8')).toBe('keep');}
 finally{await rm(d,{recursive:true,force:true});}
});
