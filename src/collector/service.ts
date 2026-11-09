import { createHash } from 'node:crypto';
import {watch} from 'node:fs';
import type {FSWatcher} from 'node:fs';
import type { ClockSample, EventBatch, NormalizedEvent, Store, TrustedSource } from '../shared/contracts.js';
import type { SnapshotUpdate } from '../shared/ui-contract.js';
import type { ProviderAdapter, SourceFile } from '../adapters/types.js';
import { emptyParser } from '../adapters/types.js';
import { readTail } from '../adapters/common/tail-reader.js';
export async function startCollection(store:Store,adapters:ProviderAdapter[],publish:(message:SnapshotUpdate)=>void|Promise<void>,options:{pollMs?:number;discoverMs?:number;clock?:()=>ClockSample;onError?:(message:string)=>void}={}):Promise<{stop():Promise<void>;tick():Promise<void>}> {
  let stopped=false,running:Promise<void>|null=null,lastDiscovery=0;
  let sources:Array<{file:SourceFile;adapter:ProviderAdapter}>=[];
  const failures=new Map<string,{count:number;until:number}>();
  const watchers=new Map<string,FSWatcher>();
  const namesSeen=new Map<string,string>();
  const clock=options.clock||(()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId:'collector'}));
  async function collect() {
    if(stopped)return;
    const now=clock().wallMs;
    if(now-lastDiscovery>=(options.discoverMs??3000)) {
      lastDiscovery=now;const found:Array<{file:SourceFile;adapter:ProviderAdapter}>=[];
      for(const adapter of adapters)try{for(const file of await adapter.discover())found.push({file,adapter});}catch{options.onError?.('部分来源暂不可用');}
      sources=found.sort((a,b)=>b.file.mtimeMs-a.file.mtimeMs).slice(0,20);
      const paths=new Set(sources.map(s=>s.file.path));for(const [path,w] of watchers)if(!paths.has(path)){w.close();watchers.delete(path);}
      for(const path of namesSeen.keys())if(!paths.has(path))namesSeen.delete(path);
      for(const path of paths)if(!watchers.has(path))try{const w=watch(path,()=>{void tick();});w.on('error',()=>{w.close();watchers.delete(path);});watchers.set(path,w);}catch{/* Polling remains the bounded fallback. */}
    }
    for(const {file,adapter} of sources) {
      if(stopped)break;if(!file.nativeSessionId||now<(failures.get(file.path)?.until||0))continue;
      try {
        const pathKey=createHash('sha256').update(file.path).digest('hex'),checkpoint=await store.checkpoint(pathKey);
        const tail=await readTail(file.path,checkpoint?.cursor??null);
        const source:TrustedSource={connectorId:'native:'+file.provider,sourceInstanceId:'file:'+createHash('sha256').update(tail.nextCursor.fileGeneration).digest('hex'),provider:file.provider,kind:'transcript',nativeSessionId:file.nativeSessionId,nativeReplayComplete:!tail.partial,...(file.nativeProject?{nativeProject:file.nativeProject}:{}),...(file.nativeSessionName?{nativeSessionName:file.nativeSessionName}:{})};
        if(checkpoint && tail.bytesRead===0 && checkpoint.cursor.fileGeneration===tail.nextCursor.fileGeneration&&checkpoint.cursor.fingerprint===tail.nextCursor.fingerprint){
          if(checkpoint.parserCheckpoint?.currentTurnId&&file.nativeSessionName&&namesSeen.get(file.path)!==file.nativeSessionName){await store.resolveNative(source,checkpoint.parserCheckpoint.currentTurnId);namesSeen.set(file.path,file.nativeSessionName);await publish({version:1,type:'snapshots',snapshots:await store.listSnapshots()});}
          continue;
        }
        const previous=checkpoint?.cursor.fileGeneration===tail.nextCursor.fileGeneration?checkpoint.parserCheckpoint??emptyParser():emptyParser();
        const parsed=adapter.parse(tail.lines,{source,fileGeneration:tail.nextCursor.fileGeneration,previous});
        if(parsed.state.currentTurnId&&file.nativeSessionName&&namesSeen.get(file.path)!==file.nativeSessionName)await store.resolveNative(source,parsed.state.currentTurnId);
        if(tail.partial)parsed.state.completePlan=false;
        const batches: EventBatch[] = [];
        for(const observation of parsed.observations) {
          if(!observation.turnId)continue;
          const handle=await store.resolveNative({...source,nativeObservedAt:observation.occurredAt},observation.turnId);
          if(observation.payload.type==='run.started')continue;
          const {nativeSequence,...raw}=observation;delete raw.completePlan;
          const e:NormalizedEvent={...raw,run:{runId:handle.runId,generation:handle.generation},seq:nativeSequence,eventIndex:0,receivedAt:now};
          // One stable source sequence per observation allows replay after a crash between commits.
          batches.push({events:[e]});
        }
        if(tail.partial||parsed.diagnostics.length){
          parsed.state.completePlan=false;options.onError?.('部分记录未解析');
          if(parsed.state.currentTurnId){
            const handle=await store.resolveNative({...source,nativeReplayComplete:false},parsed.state.currentTurnId),context=await store.context(handle,source);
            const seq=Math.max(context.nextSeq,...batches.map(b=>b.events[0]!.seq+1));
            batches.push({events:[{schemaVersion:1,eventId:createHash('sha256').update(`${tail.nextCursor.fileGeneration}:partial:${tail.nextCursor.committedOffset}`).digest('hex'),provider:source.provider,sourceKind:'transcript',sourceInstanceId:source.sourceInstanceId,nativeSessionId:file.nativeSessionId,turnId:parsed.state.currentTurnId,seq,eventIndex:0,run:{runId:handle.runId,generation:handle.generation},occurredAt:now,receivedAt:now,payload:{type:'source.diagnostic',partial:true}}]});
          }
        }
        await store.commitNative(batches,{events:[],cursor:tail.nextCursor,parserCheckpoint:parsed.state,expectedCursor:checkpoint?{fileGeneration:checkpoint.cursor.fileGeneration,committedOffset:checkpoint.cursor.committedOffset}:null},source,parsed.bindings);
        await publish({version:1,type:'snapshots',snapshots:await store.listSnapshots()});if(file.nativeSessionName)namesSeen.set(file.path,file.nativeSessionName);failures.delete(file.path);
      }catch{const f=failures.get(file.path)?.count||0;failures.set(file.path,{count:f+1,until:now+[1000,2000,5000,15000][Math.min(f,3)]!});options.onError?.('部分来源读取或记录异常，稍后重试');}
    }
  }
  async function tick(){if(running)return running;running=collect().finally(()=>{running=null;});return running;}
  const timer=setInterval(()=>{void tick();},options.pollMs??1000);
  await tick();
  return {tick,async stop(){stopped=true;clearInterval(timer);for(const w of watchers.values())w.close();watchers.clear();await running;}};
}
