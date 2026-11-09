import { mkdtemp, writeFile, rm,appendFile,utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { discoverCandidates } from '../../src/adapters/common/discovery.js';
import {createAdapter} from '../../src/adapters/registry.js';
import {mkdir} from 'node:fs/promises';
test('missing root is unavailable; candidates and active sources are bounded', async () => {
  const d = await mkdtemp(join(tmpdir(), 'schedule-discovery-'));
  try {
    await Promise.all(Array.from({ length: 220 }, (_, i) => writeFile(join(d, `${i}.jsonl`), '{}\n')));
    const result = await discoverCandidates([d, join(d, 'missing')], Date.now());
    expect(result.candidates.length).toBeLessThanOrEqual(200); expect(result.active.length).toBe(20);
    expect(result.unavailable).toContain(join(d, 'missing')); expect(result.active[0]).not.toHaveProperty('alive');
  } finally { await rm(d, { recursive: true, force: true }); }
});
test('missing automatic root is normal and later creation is discovered; explicit invalid root still rejects',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'optional-root-')),root=join(dir,'not-installed'),adapter=createAdapter('claude',root,{optionalRoot:true});
 try{expect(await adapter.discover()).toEqual([]);await expect(createAdapter('claude',root).discover()).rejects.toThrow();await mkdir(root);await writeFile(join(root,'s.jsonl'),JSON.stringify({type:'user',sessionId:'s',cwd:dir})+'\n');expect(await adapter.discover()).toHaveLength(1);}finally{await rm(dir,{recursive:true,force:true});}
});

test('Codex uses its saved session name and observes renames even when the transcript did not change',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'session-name-')),root=join(dir,'sessions');await mkdir(root);
 try{
  await writeFile(join(root,'s.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'saved-session',cwd:'D:/work/project'}})+'\n');
  const index=join(dir,'session_index.jsonl');await writeFile(index,JSON.stringify({id:'saved-session',thread_name:'敏感性预警功能开发'})+'\n');
  const adapter=createAdapter('codex',root);expect((await adapter.discover())[0]?.nativeSessionName).toBe('敏感性预警功能开发');
  await writeFile(index,JSON.stringify({id:'saved-session',thread_name:'更新后的会话标题'})+'\n');expect((await adapter.discover())[0]?.nativeSessionName).toBe('更新后的会话标题');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Claude reads explicit titles, keeps the project when title metadata comes first, and follows renames',async()=>{
 const root=await mkdtemp(join(tmpdir(),'claude-name-')),file=join(root,'s.jsonl'),stamp=(r:object)=>JSON.stringify(r)+'\n';
 try{
  await writeFile(file,stamp({type:'custom-title',sessionId:'s',customTitle:'Claude任务'})+stamp({type:'user',sessionId:'s',uuid:'turn',cwd:'D:/work/项目A',message:{content:'go'}}));
  const adapter=createAdapter('claude',root);expect((await adapter.discover())[0]).toMatchObject({nativeSessionId:'s',nativeProject:'项目A',nativeSessionName:'Claude任务'});
  await appendFile(file,stamp({type:'custom-title',sessionId:'s',customTitle:'改名后的任务'}));expect((await adapter.discover())[0]?.nativeSessionName).toBe('改名后的任务');
  await appendFile(file,stamp({type:'custom-title',sessionId:'other',customTitle:'不能覆盖'}));expect((await adapter.discover())[0]?.nativeSessionName).toBe('改名后的任务');
  await appendFile(file,stamp({type:'assistant',sessionId:'s',message:{content:'x'.repeat(300000)}})+stamp({type:'custom-title',sessionId:'s',customTitle:'尾部的新标题'}));expect((await adapter.discover())[0]?.nativeSessionName).toBe('尾部的新标题');
  await appendFile(file,stamp({type:'assistant',sessionId:'s',message:{content:'y'.repeat(300000)}}));expect((await adapter.discover())[0]?.nativeSessionName).toBe('尾部的新标题');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Claude child transcript files do not crowd the active parent out of its bounded discovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'claude-parent-')),children=join(root,'parent','subagents');await mkdir(children,{recursive:true});
 try{
  const parent=join(root,'parent.jsonl');await writeFile(parent,JSON.stringify({type:'user',sessionId:'parent',uuid:'t',cwd:'D:/project',message:{content:'go'}})+'\n');await utimes(parent,new Date(),new Date(Date.now()-1000));
  for(let i=0;i<25;i++)await writeFile(join(children,'child-'+i+'.jsonl'),JSON.stringify({type:'assistant',sessionId:'child-'+i,isSidechain:true})+'\n');
  const files=await createAdapter('claude',root).discover();expect(files).toHaveLength(1);expect(files[0]?.nativeSessionId).toBe('parent');
 }finally{await rm(root,{recursive:true,force:true});}
});
