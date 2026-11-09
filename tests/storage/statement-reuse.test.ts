import {DatabaseSync} from 'node:sqlite';
import {expect,test,vi} from 'vitest';
import {openStore} from '../../src/storage/repository.js';
import {clock,event,key,source} from '../helpers.js';

test('repeated real commits reuse compiled SQL instead of allocating a statement set per report',async()=>{
  const compiled=vi.spyOn(DatabaseSync.prototype,'prepare');
  const store=await openStore(':memory:',clock),owner=source();
  try{
    const handle=await store.begin({idempotencyKey:key(),title:'Statement reuse'},owner);
    for(let i=0;i<100;i++)await store.commit({handle,events:[event({type:'activity.updated',activity:'activity '+i},{run:{runId:handle.runId,generation:handle.generation},seq:i+2})]},owner);
    expect((await store.context(handle,owner)).snapshot.activity).toBe('activity 99');
    expect((await store.context(handle,owner)).nextSeq).toBe(102);
    // A generous bound on actual native prepare calls, independent of the
    // number of statements in today's implementation. No mocked SQL execution.
    expect(compiled.mock.calls.length).toBeLessThan(100);
  }finally{await store.close();compiled.mockRestore();}
});
