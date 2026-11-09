// Read-only format compatibility probe. Persist aggregate counts, never native content/IDs/paths.
import {build} from 'esbuild';import {mkdir,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';import {homedir} from 'node:os';
const dir=resolve('.artifacts/live-format');await mkdir(dir,{recursive:true});
const entry=join(dir,'entry.ts');await writeFile(entry,`export {createAdapter} from ${JSON.stringify(resolve('src/adapters/registry.ts'))};\nexport {readTail} from ${JSON.stringify(resolve('src/adapters/common/tail-reader.ts'))};\nexport {emptyParser} from ${JSON.stringify(resolve('src/adapters/types.ts'))};\n`);
await build({entryPoints:[entry],outfile:join(dir,'entry.mjs'),bundle:true,platform:'node',format:'esm',target:'node24'});
const {createAdapter,readTail,emptyParser}=await import(pathToFileURL(join(dir,'entry.mjs')).href);
const result={verifiedAt:new Date().toISOString(),scope:'existing local JSONL read-only compatibility; not new AI execution or live UI acceptance',providers:[]};
for(const [provider,root] of [['codex',join(process.env.CODEX_HOME||join(homedir(),'.codex'),'sessions')],['claude',join(homedir(),'.claude','projects')]]){
  const adapter=createAdapter(provider,root),files=await adapter.discover(),sampled=files.slice(0,3),counts={},diagnostics={};let records=0,bytes=0,plans=0;
  for(const file of sampled){const batch=await readTail(file.path,null);bytes+=batch.bytesRead;records+=batch.lines.length;
    const parsed=adapter.parse(batch.lines,{source:{provider,connectorId:'probe',sourceInstanceId:'probe',kind:'transcript',nativeSessionId:file.nativeSessionId},fileGeneration:batch.nextCursor.fileGeneration,previous:emptyParser()});
    for(const observation of parsed.observations){counts[observation.payload.type]=(counts[observation.payload.type]||0)+1;if(observation.payload.type==='plan.replaced')plans++;}
    for(const diagnostic of parsed.diagnostics)diagnostics[diagnostic]=(diagnostics[diagnostic]||0)+1;
  }
  result.providers.push({provider,discovered:files.length,sampledFiles:sampled.length,records,bytes,plans,observations:counts,diagnostics});
}
await writeFile(join(dir,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
