import { open,stat } from 'node:fs/promises';
import type { ProviderId } from '../shared/contracts.js';
import { discoverCandidates } from './common/discovery.js';
import { parseCodex } from './codex/parse.js';
import { parseClaude } from './claude/parse.js';
import { obj, clean } from './common/parse.js';
import type { ProviderAdapter, SourceFile } from './types.js';
import {sessionNames} from './codex/session-names.js';
import {claudeSessionName} from './claude/session-name.js';
export function createAdapter(provider: ProviderId, root: string,options:{optionalRoot?:boolean}={}): ProviderAdapter {
  if (provider !== 'codex' && provider !== 'claude') throw new Error('Unsupported native provider');
  type Identity={mtimeMs:number;nativeSessionId:string;nativeProject?:string;nativeSessionName?:string};
  const identities=new Map<string,Identity>();
  const readNames=provider==='codex'?sessionNames(root):async()=>new Map<string,string>();
  return { provider, parse:provider==='codex'?parseCodex:parseClaude, async discover() {
    const found = await discoverCandidates([root],Date.now(),provider==='claude'?['subagents']:[]), result: SourceFile[] = [],names=await readNames();
    if(found.unavailable.includes(root)){
      if(options.optionalRoot)try{await stat(root);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];}
      throw new Error('Source unavailable');
    }
    for (const source of found.active) {
      const cached=identities.get(source.path);if(cached?.mtimeMs===source.mtimeMs){const name=provider==='codex'?names.get(cached.nativeSessionId):cached.nativeSessionName;result.push({...source,provider,...cached,...(name?{nativeSessionName:name}:{})});continue;}
      const file = await open(source.path,'r').catch(()=>null);if(!file)continue;
      try {
        const b=Buffer.alloc(65536), read=await file.read(b,0,b.length,0),head=b.subarray(0,read.bytesRead).toString('utf8');let identity:Identity|undefined;
        for (const line of head.split('\n')) {
          try {
            const r=obj(JSON.parse(line)),header=provider==='codex'?obj(r.payload):r,id=clean(provider==='codex'&&r.type==='session_meta'?header.id:provider==='claude'&&r.isSidechain!==true?r.sessionId:undefined,256);
            if(!id||identity&&id!==identity.nativeSessionId)continue;
            const project=clean(header.cwd,1024).replace(/\\/g,'/').split('/').filter(Boolean).at(-1)?.slice(0,40)||(cached?.nativeSessionId===id?cached.nativeProject:undefined);
            identity={mtimeMs:source.mtimeMs,nativeSessionId:id,...(project?{nativeProject:project}:{})};if(provider==='codex'||project)break;
          }catch{/* Header may end mid-record. */}
        }
        if(identity){const name=provider==='claude'?await claudeSessionName(file,identity.nativeSessionId,head,cached?.nativeSessionId===identity.nativeSessionId?cached.nativeSessionName:undefined):names.get(identity.nativeSessionId);if(name)identity.nativeSessionName=name;identities.set(source.path,identity);result.push({...source,provider,...identity});}
      } finally { await file.close(); }
    }
    if(identities.size>200){const keep=new Set(found.candidates.map(s=>s.path));for(const path of identities.keys())if(!keep.has(path))identities.delete(path);}
    return result;
  } };
}
