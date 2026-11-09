import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {expect,test} from 'vitest';
import {previewIntegration,applyIntegration} from '../../src/integration/config-patch.js';import {applyRecordedIntegration,revertRecordedIntegration} from '../../src/integration/receipts.js';import {prepareRemoval} from '../../src/integration/removal.js';
test('identical re-apply keeps one receipt and one revoke removes the integration',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-receipt-')),path=join(d,'host.json');const request={host:'claude' as const,configPath:path,nodePath:'node',bridgePath:'bridge',connectorId:'a',credentialPath:'c',endpointPath:'e'};
 try{
  expect((await applyRecordedIntegration(d,await previewIntegration(request))).applied).toBe(true);const first=Object.keys(JSON.parse(await readFile(join(d,'receipts.json'),'utf8')))[0]!;
  expect((await applyRecordedIntegration(d,await previewIntegration(request))).applied).toBe(true);expect(Object.keys(JSON.parse(await readFile(join(d,'receipts.json'),'utf8')))).toEqual([first]);
  expect((await revertRecordedIntegration(d,first)).applied).toBe(true);await expect(readFile(path)).rejects.toMatchObject({code:'ENOENT'});expect((await prepareRemoval(d,false)).ok).toBe(true);
 }finally{await rm(d,{recursive:true,force:true});}
});
test('reconfiguration retains host edits made after initial install; legacy receipt stack is revoked as one group',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-receipt-rebase-')),path=join(d,'host.json');const request={host:'claude' as const,configPath:path,nodePath:'node',bridgePath:'bridge',connectorId:'a',credentialPath:'c',endpointPath:'e'};
 try{
  await writeFile(path,'{"other":1}');await applyRecordedIntegration(d,await previewIntegration(request));await writeFile(path,(await readFile(path,'utf8')).replace(/"other"\s*:\s*1/,'"other":2'));
  expect((await applyRecordedIntegration(d,await previewIntegration({...request,bridgePath:'new-bridge'}))).applied).toBe(true);const ids=Object.keys(JSON.parse(await readFile(join(d,'receipts.json'),'utf8')));expect(ids).toHaveLength(1);
  expect((await revertRecordedIntegration(d,ids[0]!)).applied).toBe(true);expect(JSON.parse(await readFile(path,'utf8'))).toMatchObject({other:2});expect(await readFile(path,'utf8')).not.toContain('codingSchedule');
  const a=await applyIntegration(await previewIntegration(request)),b=await applyIntegration(await previewIntegration(request));await writeFile(join(d,'receipts.json'),JSON.stringify({old:a.receipt,new:b.receipt}));
  expect((await revertRecordedIntegration(d,'old')).applied).toBe(true);expect(await readFile(path,'utf8')).not.toContain('codingSchedule');expect((await prepareRemoval(d,false)).ok).toBe(true);
 }finally{await rm(d,{recursive:true,force:true});}
});
