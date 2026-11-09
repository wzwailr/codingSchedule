import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {expect,test} from 'vitest';
import {previewIntegration,applyIntegration,revertIntegration} from '../../src/integration/config-patch.js';
test('Windows native relay entry contains only pipe routing args and remains reversible',async()=>{
 const d=await mkdtemp(join(tmpdir(),'native-config-')),path=join(d,'config.json');
 try{
  const patch=await previewIntegration({host:'generic',configPath:path,nodePath:'D:\\node.exe',bridgePath:'D:\\bridge.cjs',relayPath:'D:\\中文 路径\\mcp-relay.exe',connectorId:'generic-reporter',credentialPath:'private.json',endpointPath:'endpoint.json'});
  expect(patch.ownedAfter).toEqual({command:'D:\\中文 路径\\mcp-relay.exe',args:['--connector','generic-reporter','--credential','private.json','--endpoint','endpoint.json']});
  const result=await applyIntegration(patch);expect(result.applied).toBe(true);expect((await revertIntegration(result.receipt!)).applied).toBe(true);
 }finally{await rm(d,{recursive:true,force:true});}
});
test('JSONC apply preserves comments/other entries; revert preserves later edits and refuses changed owned entry',async()=>{
  const d=await mkdtemp(join(tmpdir(),'schedule-config-')),path=join(d,'中文 settings.json');
  try{
    await writeFile(path,'{\n // keep comment\n "mcpServers":{"other":{"command":"other"}},"hooks":{}\n}\n');
    const patch=await previewIntegration({host:'claude',configPath:path,bridgePath:'D:\\中文 路径\\bridge.cjs',nodePath:'D:\\中文 路径\\node.exe',connectorId:'claude-reporter',credentialPath:'private.json',endpointPath:'endpoint.json'});
    expect(patch.afterText).toContain('// keep comment');expect(patch.afterText).toContain('other');expect(patch.afterText).not.toContain('token');
    const applied=await applyIntegration(patch);expect(applied.applied).toBe(true);
    await writeFile(path,(await readFile(path,'utf8')).replace(/"hooks"\s*:\s*\{\s*\}/,'"hooks":{"later":true}'));
    expect((await revertIntegration(applied.receipt!)).applied).toBe(true);
    const restored=await readFile(path,'utf8');expect(restored).toMatch(/"later"\s*:\s*true/);expect(restored).not.toContain('codingSchedule');
    const again=await applyIntegration(await previewIntegration({host:'claude',configPath:path,bridgePath:'b',nodePath:'n',connectorId:'x',credentialPath:'c',endpointPath:'e'}));
    await writeFile(path,(await readFile(path,'utf8')).replace('"command": "n"','"command": "user-edited"'));
    expect((await revertIntegration(again.receipt!)).reason).toBe('conflict');
  }finally{await rm(d,{recursive:true,force:true});}
});
test('Codex TOML uses argv strings, preserves comments and detects preview concurrency; missing config reversible',async()=>{
  const d=await mkdtemp(join(tmpdir(),'schedule-toml-')),path=join(d,'config.toml');
  const input={host:'codex' as const,configPath:path,bridgePath:'D:\\空 格\\"bridge".cjs',nodePath:'D:\\node.exe',connectorId:'codex-reporter',credentialPath:'private.json',endpointPath:'endpoint.json'};
  try{
    const missing=await applyIntegration(await previewIntegration(input));expect(missing.applied).toBe(true);expect((await revertIntegration(missing.receipt!)).applied).toBe(true);
    await expect(readFile(path)).rejects.toMatchObject({code:'ENOENT'});
    const original='# keep\nmodel="test"\n[mcp_servers.other]\ncommand="other"\n';await writeFile(path,original);
    const stale=await previewIntegration(input);await writeFile(path,original+'# host changed\n');expect((await applyIntegration(stale)).reason).toBe('conflict');
    const applied=await applyIntegration(await previewIntegration(input));expect(applied.applied).toBe(true);expect(await readFile(path,'utf8')).toContain('# keep');
    expect((await revertIntegration(applied.receipt!)).applied).toBe(true);expect(await readFile(path,'utf8')).toBe(original+'# host changed\n');
    await writeFile(path,'broken = [');await expect(previewIntegration(input)).rejects.toThrow();
  }finally{await rm(d,{recursive:true,force:true});}
});
