import type {RunSnapshot,RunState} from '../shared/contracts.js';
// The observed plan stays intact. Only this presentation value advances between
// reports, using both ends of the last accepted active-time estimate.
export function displayedProgress(s:RunSnapshot,now=Date.now()):number|null{
 const display=s.displayProgress;if(!display)return s.progress.value;
 const anchor=display.anchor;if(!anchor||s.status!=='active')return display.value;
 const elapsed=anchor.elapsedSec+Math.max(0,(now-anchor.asOf)/1000);
 const fraction=(Math.min(1,elapsed/Math.max(1,anchor.range.maxSec))+Math.min(1,elapsed/Math.max(1,anchor.range.minSec||anchor.range.maxSec)))/2;
 return Math.max(display.value,Math.min(99,Math.floor(anchor.value+(100-anchor.value)*fraction)));
}
export function refreshProgress(state:RunState,asOf:number,revisedEta=false):void{
 const {snapshot:s,timing:t}=state,real=s.progress.value,active=t.taskActiveMs||0;
 const previous=displayedProgress({...s,status:'paused'},asOf);
 if(real!==null&&real!==t.lastReliableProgress||revisedEta||!t.progressAnchor&&real!==null&&!!s.eta.range){
  if(real!==null)t.lastReliableProgress=real;
  const base=real===100?100:Math.max(real??t.lastReliableProgress??0,previous??0);
  if((real!==null||t.lastReliableProgress!==undefined)&&s.eta.range)t.progressAnchor={value:base,range:{...s.eta.range},anchorActiveMs:active};
  else delete t.progressAnchor;
 }
 const value=t.lastReliableProgress;if(value===undefined){delete s.displayProgress;return;}
 const a=t.progressAnchor;
 if(!a||value===100){s.displayProgress={value};return;}
 s.displayProgress={value:Math.min(99,a.value),anchor:{value:a.value,range:{...a.range},elapsedSec:Math.max(0,(active-a.anchorActiveMs)/1000),asOf}};
 // Use accumulated active time even while waiting; future wall time is frozen.
 s.displayProgress.value=displayedProgress({...s,status:'active'},asOf)??value;
}
