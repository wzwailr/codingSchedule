import type { RunRef,RunSnapshot } from '../shared/contracts.js';
import type { DesktopUpdate,FoldGeometry,FoldSurface,WidgetRect,UiCommand,SettingsCommand,ActivityView } from '../shared/ui-contract.js';
import {mountSettings,syncAssociations} from './settings.js';
import {installAppearanceControls} from './appearance-controls.js';
import {chooseRun,etaText,screenEta,shortScreenEta,shortScreenState,inquiryText,progressText,sameRun,statusText,visibleSessions,sessionLabel,activityContent} from './widget.js';
import type {ScreenDensity} from '../shared/appearance.js';
import {displayedProgress} from '../domain/display-progress.js';
import {edgeRadius,DEFAULT_THEME,type WidgetTheme} from '../shared/themes.js';
declare global{interface Window{schedule:{subscribeSnapshots(listener:(message:DesktopUpdate)=>void):()=>void;dispatchUiCommand(command:UiCommand|SettingsCommand):Promise<unknown>}}}
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
let snapshots:RunSnapshot[]=[],selected:RunRef|null=null,hovered=false,pinned=false,manual=false,expanded=false,inSettings=false,healthMessage='';
let notice:{snapshot:RunSnapshot;until:number}|null=null;
let lastRenderKey='',lastStepsKey='',lastOptionsKey='';
let density:ScreenDensity='normal';
let activityView:ActivityView='work';
let theme:WidgetTheme=DEFAULT_THEME;
const raster=Array.from({length:32},()=>document.createElement('span'));el('terminal-raster').replaceChildren(...raster);
const dispatch=(c:UiCommand)=>window.schedule.dispatchUiCommand(c).catch(()=>{healthMessage='操作未完成，请重试';render();});
const appearanceUI=installAppearanceControls(dispatch);
function updatePin(value:boolean){pinned=value;el('pin').setAttribute('aria-pressed',String(pinned));el('pin').textContent=pinned?'取消固定':'固定展开';}
function position(element:HTMLElement,rect:WidgetRect){Object.assign(element.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});}
function surface(element:HTMLElement,value:FoldSurface){position(element,value);element.style.transform='rotate('+value.angle+'deg)';element.style.borderRadius=value.radii.map(r=>r+'px').join(' ');}
function content(element:HTMLElement,rect:WidgetRect,scale:number){Object.assign(element.style,{width:rect.width/scale+'px',height:rect.height/scale+'px',transform:'scale('+scale+')'});}
function applyLayout(value:FoldGeometry){
 density=value.density;theme=value.theme;Object.assign(el('widget').dataset,{side:value.side,placement:value.placement,theme,scale:String(value.scale),density});
 Object.assign(el('widget').style,{width:value.bounds.width+'px',height:value.bounds.height+'px'});
 el('widget').style.setProperty('--minimum-eta-size',10/value.screenScale+'px');
 surface(el('compact'),value.screen);surface(el('screen-controls'),value.screen);content(el('screen-content'),value.screen,value.screenScale);
 el('screen-controls').style.setProperty('--handle-scale',String(Math.max(1,value.screenScale)));
 el('hinge').hidden=!value.hinge;if(value.hinge)surface(el('hinge'),value.hinge);
 el('wing-controls').hidden=!value.wing;if(value.wing){surface(el('details'),value.wing);surface(el('wing-controls'),value.wing);content(el('wing-content'),value.wing,value.wingScale);el('wing-controls').style.setProperty('--handle-scale',String(value.wingScale));}
}
function updateScreenEta(value:string,label:string){
 const eta=el('screen-eta');
 if(theme==='porthole'&&density==='normal'){
  const range=value.indexOf('–'),overtime=value.startsWith('超时 '),main=range>=0?value.slice(0,range):overtime?'超时':value,tail=range>=0?value.slice(range):overtime?' '+value.slice(3):'';
  const first=document.createElement('span'),last=document.createElement('span');first.className='porthole-eta-main';last.className='porthole-eta-tail';first.textContent=main;last.textContent=tail;eta.replaceChildren(first,last);
  eta.dataset.mode=overtime?'overtime':'normal';eta.dataset.long=String(!tail&&main.length>5);eta.dataset.wide=String(!!tail&&main.length>5);
 }else eta.textContent=value;
 el('screen-eta-label').textContent=label;
 el('porthole-caption').textContent=value.startsWith('超时 ')?'已超原估计':label.startsWith('计时暂停')?'计时暂停':label.startsWith('预计剩余')?'预计剩余':value==='—'?'等待估时':'任务状态';
}
function render(){
 if(inSettings)syncAssociations(snapshots);
  const live=visibleSessions(snapshots);
  if(!live.some(s=>sameRun(s.run,selected)))manual=false;
  selected=chooseRun(live,selected,hovered||pinned,manual);
  const s=live.find(s=>sameRun(s.run,selected))??(!live.length&&notice&&performance.now()<notice.until?notice.snapshot:undefined);
  const warning=[healthMessage,s?.sourcePartial?'部分记录未解析，计划范围不完整':''].filter(Boolean).join(' · ');
  const seconds=s?.lastWorkAt==null?null:Math.max(0,Math.floor((Date.now()-s.lastWorkAt)/1000));
  const optionsKey=JSON.stringify([selected,live.map(x=>[x.run,sessionLabel(x)])]);
  const renderKey=JSON.stringify([s??null,optionsKey,expanded,inSettings,manual,warning,density,theme,activityView,expanded?seconds:null,s?etaText(s):null]);
  if(renderKey===lastRenderKey)return;lastRenderKey=renderKey;
  Object.assign(el('widget').dataset,{expanded:String(expanded),empty:String(!s),status:s?.status??'idle',freshness:s?.freshness??'fresh',warning:String(!!warning),overdue:String(!!s&&etaText(s).startsWith('已超时'))});
  el('compact').setAttribute('aria-expanded',String(expanded));el('screen-toggle-hint').textContent=expanded?'点击收起':'点击展开';
  el('activity-work').setAttribute('aria-pressed',String(activityView==='work'));el('activity-execution').setAttribute('aria-pressed',String(activityView==='execution'));
  el('screen-short-state').textContent=warning?'注意':s?shortScreenState(s):'空闲';el('screen-short-state').title=warning|| (s?statusText(s)+(s.freshness==='stale'?' · 状态可能过期':''):'暂无活动会话');
  for(const id of ['health','health-detail']){el(id).hidden=!warning;el(id).textContent=warning;el(id).title=warning;}
  el('count').textContent=live.length>1?'+'+(live.length-1):'';
  el('follow').hidden=!manual;el<HTMLSelectElement>('tasks').disabled=!live.length;
  const value=s?displayedProgress(s):null,width=(value??0)+'%';el('fill').style.width=width;el('compact-fill').style.width=width;
  const porthole=el('screen-porthole');porthole.dataset.known=String(value!==null);porthole.style.setProperty('--screen-progress',String(value??0));
  el('widget').dataset.progressKnown=String(value!==null);el('widget').style.setProperty('--screen-progress',String(value??0));
  raster.forEach((cell,i)=>{const filled=String(value!==null&&i<Math.round(value/100*32));if(cell.dataset.filled!==filled)cell.dataset.filled=filled;});
  const progress=s?progressText(s):'进度未知';el('track').setAttribute('aria-valuetext',progress);
  const edgeTab=el('edge-tab');Object.assign(edgeTab.dataset,{known:String(value!==null),value:String(value??0)});
  el('edge-value').textContent=value===null?'—':String(value);edgeTab.style.setProperty('--edge-progress',String(value??0));
  edgeTab.title=(s?sessionLabel(s)+' · '+statusText(s)+' · '+progress+' · '+etaText(s):'暂无活动会话')+'\n悬停或点击恢复悬浮框';
  edgeTab.setAttribute('aria-label',edgeTab.title.replace('\n','，'));
  if(value===null)el('track').removeAttribute('aria-valuenow');else el('track').setAttribute('aria-valuenow',String(value));
  if(!s){
    lastStepsKey=lastOptionsKey='';
    el('compact-title').textContent=el('title').textContent='暂无活动会话';el('compact-title').title=el('title').title='';
    el('compact').title='点击或悬停展开；拖动角标改大小；滚轮上滚更实、下滚更透（40%–100%）';el('compact').setAttribute('aria-label','暂无活动会话，点击展开，正在自动检测');
    el('summary').textContent='自动检测中 · 开始任务后显示';el('screen-provider').textContent='本机';el('screen-project').textContent='codingSchedule';el('screen-session').textContent='暂无活动会话';
    el('screen-progress').textContent='—';el('screen-progress-label').textContent='等待任务';updateScreenEta(density==='normal'?'—':'待任务','暂无估时');el('porthole-caption').textContent='等待任务';el('screen-state').textContent='自动检测中';el('screen-freshness').textContent='';
    el('provider-label').textContent='本机会话';el('status').textContent='';el('task-title').hidden=true;el('activity-label').textContent='等待任务开始';
    el('activity').textContent='开始 Codex 或 Claude 任务后自动显示。已结束和空闲会话不会出现在列表中。';
    el('activity-source').textContent='开始会话后显示';
    el('progress').textContent=progress;el('eta').textContent='暂不能估时';el('eta-inquiry').hidden=true;el('eta-inquiry').textContent='';el('basis').textContent='';el('freshness').textContent='';el('steps').replaceChildren();el('steps-empty').hidden=true;el('tasks').replaceChildren();return;
  }
  const provider=s.provider==='codex'?'Codex':s.provider==='claude'?'Claude':'AI',title=sessionLabel(s),eta=screenEta(s);
  const summary=provider+' · '+progress+' · '+etaText(s);
  el('summary').textContent=summary;el('compact-title').textContent=title;el('compact-title').title=title;
  el('compact').title=title+'\n'+statusText(s)+' · '+summary+'\n滚轮上滚更实、下滚更透（40%–100%）';el('compact').setAttribute('aria-label',title+'，'+statusText(s)+'，'+summary+'，点击'+(expanded?'收起':'展开')+'详情');
  el('screen-provider').textContent=provider;el('screen-project').textContent=s.nativeSession?.project??'当前任务';el('screen-project').title=s.nativeSession?.project??'当前任务';
  el('screen-session').textContent=s.nativeSession?.name??s.title;el('screen-session').title=title;
  el('screen-progress').textContent=value===null?'—':value+'%';
  el('screen-progress-label').textContent=value===null?'计划未知':value===100&&s.status==='active'?'待收尾':'任务进度';
  updateScreenEta(density==='normal'?eta.value:shortScreenEta(s),eta.label);el('screen-eta').title=etaText(s);
  el('screen-state').textContent=statusText(s)+(s.freshness==='stale'?' · 过期':'');el('screen-state').title=statusText(s)+(s.freshness==='stale'?' · 更新可能过期':'');el('screen-freshness').textContent=s.freshness==='stale'?'状态可能过期':'';
  el('provider-label').textContent=provider;el('title').textContent=title;el('title').title=title;
  el('task-title').hidden=!s.nativeSession||s.title===title||s.title===s.nativeSession.name;el('task-title').textContent=s.title;
  const activity=activityContent(s,activityView),activityAge=activity.at===null?null:Math.max(0,Math.floor((Date.now()-activity.at)/1000));
  el('status').textContent=statusText(s);el('activity-label').textContent=s.status==='active'?'正在做':'当前动作';el('activity').textContent=activity.text;
  el('activity-source').textContent=activity.source+(activityAge===null?'':activityAge<60?' · '+activityAge+' 秒前':' · '+Math.floor(activityAge/60)+' 分前');
  el('progress').textContent=progress;el('eta').textContent=etaText(s);
  const stepsKey=JSON.stringify([s.run,s.plan?.steps??[]]);
  if(stepsKey!==lastStepsKey){
    lastStepsKey=stepsKey;el('steps').replaceChildren(...(s.plan?.steps||[]).map(step=>{
      const li=document.createElement('li'),mark=document.createElement('span'),text=document.createElement('span');li.dataset.status=step.status;
      mark.textContent={completed:'✓',running:'●',pending:'○',failed:'!',skipped:'–'}[step.status];mark.setAttribute('role','img');mark.setAttribute('aria-label',{completed:'已完成',running:'进行中',pending:'未开始',failed:'失败',skipped:'已跳过'}[step.status]);text.textContent=step.title;li.append(mark,text);return li;
    }));
  }
  el('steps-empty').hidden=!!s.plan?.steps.length;el('eta-inquiry').textContent=inquiryText(s);el('eta-inquiry').hidden=!inquiryText(s);
  el('basis').textContent=s.progress.completed+'/'+s.progress.total+' 个计划步骤 · '+(s.scope==='turn'?'原生日志观察':'AI 主动报告')+(s.scope==='task'&&s.activitySource?.kind!=='reporter'&&s.activitySource?' + '+s.activitySource.provider+' 原生活动':'')+' · '+(s.eta.basis==='calibrated'?'按本次节奏校准':s.eta.basis==='prior'?'步骤先验粗估':s.eta.basis==='agent'?'AI 最近估时':'估时依据不足');
  el('basis').title=el('basis').textContent;
  el('freshness').textContent='工作更新：'+(seconds===null?'尚无':seconds<60?seconds+' 秒前':Math.floor(seconds/60)+' 分前')+(s.freshness==='stale'?' · 状态可能过期':'');
  if(s.reportedAt!==undefined){const age=Math.max(0,Math.floor((Date.now()-s.reportedAt)/1000));el('freshness').textContent+=' · AI 汇报：'+(age<60?age+' 秒前':Math.floor(age/60)+' 分前');}
  if(optionsKey!==lastOptionsKey){lastOptionsKey=optionsKey;el<HTMLSelectElement>('tasks').replaceChildren(...live.map(x=>{const option=document.createElement('option');option.value=x.run.runId;option.textContent=sessionLabel(x);option.selected=sameRun(x.run,selected);return option;}));}
}
window.schedule.subscribeSnapshots(message=>{
  if(message.type==='snapshots'){
    const previous=snapshots.find(s=>sameRun(s.run,selected)),next=message.snapshots.find(s=>sameRun(s.run,selected));
    // Brief feedback only for a task observed ending in this window, never old history.
    if(previous&&next&&previous.status!==next.status&&['reported_done','verified_done','failed','cancelled','paused'].includes(next.status)){
      const snapshot={...next};if(!snapshot.nativeSession&&previous.nativeSession)snapshot.nativeSession=previous.nativeSession;
      notice={snapshot,until:performance.now()+5000};
    }
    else if(notice&&performance.now()<notice.until){
      // An acceptance can follow AI completion during the same brief notice.
      // Refresh that exact run without reviving history or extending its TTL.
      const update=message.snapshots.find(s=>sameRun(s.run,notice!.snapshot.run));
      if(update&&['reported_done','verified_done','failed','cancelled','paused'].includes(update.status)){const snapshot={...update},identity=update.nativeSession??notice.snapshot.nativeSession;if(identity)snapshot.nativeSession=identity;notice.snapshot=snapshot;}
    }
    snapshots=message.snapshots;render();
  }else if(message.type==='health'){healthMessage=message.status==='ok'?'':message.message;render();}
  else{
    const edge=message.edgeHidden;activityView=message.activityView;el('widget').dataset.edgeHidden=String(!!edge);el('edge-tab').hidden=!edge;
    applyLayout(message.geometry);appearanceUI.update(message);expanded=message.expanded;if(!expanded)updatePin(false);
    if(edge){Object.assign(el('widget').style,{width:edge.bounds.width+'px',height:edge.bounds.height+'px'});el('edge-tab').dataset.edge=edge.edge;el('edge-tab').style.setProperty('--edge-radius',edgeRadius(theme,edge.bounds.width,edge.bounds.height)+'px');}
    const themeInput=document.getElementById('widget-theme') as HTMLSelectElement|null;if(themeInput&&themeInput!==document.activeElement)themeInput.value=theme;
    el('details').hidden=!expanded;el('task-view').hidden=message.settings;el('settings').hidden=!message.settings;
    if(message.settings&&!inSettings)void mountSettings(el('settings-content'),c=>window.schedule.dispatchUiCommand(c),snapshots);
    inSettings=message.settings;render();
  }
});
el('widget').addEventListener('mouseenter',()=>{hovered=true;void dispatch({type:'hover',inside:true});});
el('widget').addEventListener('mouseleave',()=>{hovered=false;void dispatch({type:'hover',inside:false});});
el('pin').onclick=()=>{updatePin(!pinned);void dispatch({type:'pinExpanded',value:pinned});};
el('edge-tab').onclick=()=>{void dispatch({type:'expand'});};
el('activity-work').onclick=()=>{void dispatch({type:'activityViewSet',value:'work'});};
el('activity-execution').onclick=()=>{void dispatch({type:'activityViewSet',value:'execution'});};
el('collapse').onclick=()=>{void dispatch({type:'closeSettings'});};
el('settings-button').onclick=()=>{void dispatch({type:'openSettings'});};
el('back').onclick=()=>{void dispatch({type:'closeSettings'});};el('reset').onclick=()=>{void dispatch({type:'resetPosition'});};
el('follow').onclick=()=>{manual=false;render();};
el<HTMLSelectElement>('tasks').onpointerdown=()=>{void dispatch({type:'showFocused'});};
el<HTMLSelectElement>('tasks').onchange=e=>{selected=snapshots.find(s=>s.run.runId===(e.target as HTMLSelectElement).value)?.run??null;manual=true;if(selected)void dispatch({type:'selectRun',run:selected});render();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();if(!appearanceUI.cancelResize())void dispatch({type:'closeSettings'});}if((e.key==='Enter'||e.key===' ')&&e.target===el('compact')){e.preventDefault();void dispatch({type:expanded?'closeSettings':'expand'});}});
const compact=el('compact');
let pointer:{id:number;x:number;y:number;moving:boolean}|null=null,ignoreClick=false;
compact.onpointerdown=e=>{if(e.button!==0)return;ignoreClick=false;pointer={id:e.pointerId,x:e.screenX,y:e.screenY,moving:false};compact.setPointerCapture(e.pointerId);void dispatch({type:'drag',phase:'start',point:{x:e.screenX,y:e.screenY}});};
compact.onpointermove=e=>{if(pointer?.id!==e.pointerId)return;if(Math.hypot(e.screenX-pointer.x,e.screenY-pointer.y)>=4)pointer.moving=true;if(pointer.moving)void dispatch({type:'drag',phase:'move',point:{x:e.screenX,y:e.screenY}});};
const endDrag=(e:PointerEvent)=>{if(pointer?.id!==e.pointerId)return;ignoreClick=pointer.moving||e.type!=='pointerup';pointer=null;if(compact.hasPointerCapture(e.pointerId))compact.releasePointerCapture(e.pointerId);void dispatch({type:'drag',phase:'end',point:{x:e.screenX,y:e.screenY}});};
compact.onpointerup=endDrag;compact.onpointercancel=endDrag;compact.onlostpointercapture=endDrag;
compact.onclick=e=>{if(!ignoreClick&&e.detail===1)void dispatch({type:expanded?'closeSettings':'expand'});};
compact.ondblclick=()=>{if(!ignoreClick)void dispatch({type:'openSettings'});};
setInterval(render,1000);
