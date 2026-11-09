import {expect,test} from 'vitest';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {previewIntegration} from '../../src/integration/config-patch.js';import {applyRecordedIntegration,revertRecordedIntegration} from '../../src/integration/receipts.js';
for(const host of ['codex-hooks','claude-hooks'] as const)test(host+' merges and revokes only its async handler, retaining other hooks and later user edits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'eta-hooks-config-')),configPath=join(dir,'hooks.json');
 const request={host,configPath,nodePath:'D:\\中文 路径\\node.exe',bridgePath:'D:\\中文 路径\\hook.cjs',connectorId:'hook',credentialPath:'D:\\private.json',endpointPath:'D:\\endpoint.json'};
 try{
  await writeFile(configPath,'{\n // retain this comment\n "hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"user-hook"}]}]},"other":1\n}');
  const patch=await previewIntegration(request);expect(patch.afterText).toContain('// retain this comment');
  const hook=JSON.parse(patch.afterText.replace('// retain this comment','')).hooks.PostToolUse.at(-1).hooks[0];expect(hook).toMatchObject({type:'command',async:true,timeout:1});expect(hook.command).toContain('--estimate');expect(hook).not.toHaveProperty('asyncRewake');
  expect((await applyRecordedIntegration(dir,patch)).applied).toBe(true);
  expect((await applyRecordedIntegration(dir,await previewIntegration(request))).applied).toBe(true);
  let text=await readFile(configPath,'utf8');text=text.replace(/"other"\s*:\s*1/,'"other":2');await writeFile(configPath,text);
  const receipts=JSON.parse(await readFile(join(dir,'receipts.json'),'utf8'));expect(Object.keys(receipts)).toHaveLength(1);
  expect((await revertRecordedIntegration(dir,Object.keys(receipts)[0]!)).applied).toBe(true);
  const final=await readFile(configPath,'utf8');expect(final).toContain('user-hook');expect(final).toContain('// retain this comment');expect(final).toMatch(/"other"\s*:\s*2/);expect(final).not.toContain('--estimate');
 }finally{await rm(dir,{recursive:true,force:true});}
});
