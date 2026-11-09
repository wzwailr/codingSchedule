import type {RunSnapshot} from '../shared/contracts.js';import type {SettingsCommand} from '../shared/ui-contract.js';import {associationRuns,sessionLabel} from '../shared/sessions.js';
export type AssociationSource={run:{runId:string;generation:number};completeReplay:boolean};
export function mountAssociation(container:HTMLElement,initialSources:AssociationSource[],dispatch:(command:SettingsCommand)=>Promise<unknown>,status:(message:string)=>void){
 const advanced=container.querySelector<HTMLDetailsElement>('#advanced-settings')!,target=container.querySelector<HTMLSelectElement>('#reporter-run')!,native=container.querySelector<HTMLSelectElement>('#native-run')!,link=container.querySelector<HTMLButtonElement>('#link-source')!,unlink=container.querySelector<HTMLButtonElement>('#unlink-source')!;
 let sources=initialSources,latest:RunSnapshot[]=[],targets:RunSnapshot[]=[],natives:RunSnapshot[]=[],requested='',loading=false,busy=false;
 const ref=(s:{run:{runId:string;generation:number}})=>JSON.stringify(s.run);
 function options(select:HTMLSelectElement,items:RunSnapshot[],empty:string){
  const key=JSON.stringify(items.map(s=>[ref(s),sessionLabel(s)]));if(select.dataset.options===key)return;const old=select.value;select.dataset.options=key;
  const fragment=document.createDocumentFragment();for(const s of items){const option=document.createElement('option');option.value=ref(s);option.textContent=sessionLabel(s);fragment.append(option);}
  if(!items.length){const option=document.createElement('option');option.textContent=empty;option.value='';fragment.append(option);}
  select.replaceChildren(fragment);if(items.some(s=>ref(s)===old))select.value=old;select.disabled=!items.length;
 }
 async function reload(key:string){
  if(loading||!container.isConnected)return;loading=true;requested=key;
  try{sources=await dispatch({type:'associationRead'}) as AssociationSource[];}catch{status('活动会话读取失败，可收起后重新展开高级设置重试。');}
  finally{loading=false;if(container.isConnected)update(latest);}
 }
 function update(snapshots:RunSnapshot[],now=Date.now()){
  latest=snapshots;const active=associationRuns(snapshots,now);targets=active.targets;natives=active.natives.filter(s=>sources.some(source=>source.completeReplay&&ref(source)===ref(s)));
  options(target,targets,'暂无活动的汇报任务');options(native,natives,'暂无可关联的活动会话');link.disabled=unlink.disabled=busy||!targets.length||!natives.length;
  const key=JSON.stringify(active.natives.map(ref));if(advanced.open&&key!==requested)void reload(key);
 }
 advanced.ontoggle=()=>{if(advanced.open){requested='';void reload(JSON.stringify(associationRuns(latest).natives.map(ref)));}};
 for(const [button,type] of [[link,'linkSource'],[unlink,'unlinkSource']] as const)button.onclick=()=>{
  const intendedTarget=target.value,intendedNative=native.value;update(latest);const a=targets.find(s=>ref(s)===intendedTarget),b=natives.find(s=>ref(s)===intendedNative);if(!a||!b){status('所选会话已不再活动，请重新选择。');return;}
  busy=true;update(latest);void dispatch({type,run:a.run,nativeRun:b.run}).then(()=>status(type==='linkSource'?'已关联所选活动会话。':'已解除关联，原生会话继续独立显示。')).catch(()=>status('会话可能已结束或更新，请重新选择当前活动项。')).finally(()=>{busy=false;update(latest);});
 };
 return update;
}
