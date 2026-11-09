import {homedir} from 'node:os';
import {isAbsolute,join} from 'node:path';
type SourceSetting={provider:'codex'|'claude';root:string;enabled:boolean;automatic?:boolean};
export function configuredSources(saved:unknown,automatic:boolean):SourceSetting[]{
 const defaults:SourceSetting[]=[
  {provider:'codex',root:join(process.env.CODEX_HOME||join(homedir(),'.codex'),'sessions'),enabled:automatic,automatic},
  {provider:'claude',root:join(process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),'projects'),enabled:automatic,automatic}
 ];
 const list=saved&&typeof saved==='object'&&'sources' in saved&&Array.isArray(saved.sources)?saved.sources:[];
 return defaults.map(d=>{
  const s=list.find((v:unknown)=>v&&typeof v==='object'&&'provider' in v&&v.provider===d.provider) as Partial<SourceSetting>|undefined;
  return s&&typeof s.root==='string'&&isAbsolute(s.root)&&typeof s.enabled==='boolean'?{provider:d.provider,root:s.root,enabled:s.enabled}:d;
 });
}
