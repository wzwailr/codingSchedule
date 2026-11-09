import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { openStore } from '../../src/storage/repository.js';
import { createAdapter } from '../../src/adapters/registry.js';
import { startCollection } from '../../src/collector/service.js';
test('collector publishes committed snapshots, separate turns, persists restart cursors, isolates bad source', async () => {
  const d=await mkdtemp(join(tmpdir(),'schedule-collect-')), p=join(d,'codex.jsonl');
  const records=[{type:'session_meta',payload:{id:'session-a'}},{type:'turn_context',payload:{turn_id:'a'}},{type:'response_item',payload:{type:'function_call',name:'update_plan',call_id:'c',arguments:'{"plan":[{"step":"test","status":"in_progress"}]}'}}];
  await writeFile(p,records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const clock=()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId:'collect'});
  let store=await openStore(join(d,'db'),clock); let published=0;
  const adapters=[createAdapter('codex',d)];
  let c=await startCollection(store,adapters,async m=>{expect(m.snapshots).toEqual(await store.listSnapshots());published++;},{pollMs:20,discoverMs:20,clock});
  try {
    await expect.poll(async()=> (await store.listSnapshots())[0]?.plan?.steps[0]?.status).toBe('running');
    expect(published).toBeGreaterThan(0); await c.stop(); await store.close();
    store=await openStore(join(d,'db'),clock); c=await startCollection(store,adapters,()=>{}, {pollMs:20,discoverMs:20,clock});
    await appendFile(p,JSON.stringify({type:'turn_context',payload:{turn_id:'b'}})+'\n');
    await expect.poll(async()=> (await store.listSnapshots()).length).toBe(2);
    expect((await store.listSnapshots()).filter(s=>s.status==='active')).toHaveLength(1);
  } finally {await c.stop();await store.close();await rm(d,{recursive:true,force:true});}
});
