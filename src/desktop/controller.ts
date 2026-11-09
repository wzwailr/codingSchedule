import type { DesktopPlatform,Point } from './platform.js';
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { mkdir,readFile } from 'node:fs/promises';
import { atomicJson } from '../bridge/credential.js';
import { createCredential } from '../bridge/credential.js';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { previewIntegration } from '../integration/config-patch.js';
import {applyRecordedIntegration,revertRecordedIntegration} from '../integration/receipts.js';
import {setupStatus,installSetup,removeSetup} from '../integration/setup.js';
import {associationRuns} from '../shared/sessions.js';
import type { ConfigPatch,InstallReceipt,IntegrationRequest } from '../integration/config-patch.js';
import type { SnapshotUpdate,HealthUpdate,FoldGeometry,ActivityView } from '../shared/ui-contract.js';
import { foldLayout,foldShape,scaleLimit } from './geometry.js';
import {readAppearance} from './appearance.js';
import {dockEdge,edgeBounds,edgeShape,type DockEdge} from './edge.js';
import {DEFAULT_APPEARANCE,normalizeAppearance,resizedScale,type Appearance} from '../shared/appearance.js';
import { RestartPolicy,collectorHealth } from '../collector/supervisor.js';
import {loginState,setLogin} from './login.js';
import {configuredSources} from '../collector/sources.js';
import {prepareProfile} from './profile.js';
import {DEFAULT_THEME,THEMES,isWidgetTheme,normalizeTheme,type WidgetTheme} from '../shared/themes.js';
export async function runDesktop(platform:DesktopPlatform){
const {screen,dir,legacyDir,autoDetect,setup:setupRuntime}=platform;
let worker:Worker|undefined,expanded=false,pinned=false,settings=false,closing=false,restarting=false,hoverTimer:ReturnType<typeof setTimeout>|undefined;
let geometry:FoldGeometry,lastShapeKey='',hoverBlocked=false;
let appearance:Appearance={...DEFAULT_APPEARANCE},pointerInside=false;
let edgeHidden:{edge:DockEdge;bounds:import('../shared/ui-contract.js').WidgetRect}|null=null,edgeTimer:ReturnType<typeof setTimeout>|undefined,edgeEnabled=true;
let drag:{start:Point;anchor:Point;moving:boolean}|null=null;
let resizing:{start:Point;anchor:Point;scale:number;before:Appearance}|null=null;
let appearanceTimer:ReturnType<typeof setTimeout>|undefined,appearanceWrite:Promise<void>=Promise.resolve();
let activityView:ActivityView='work',activityViewWrite:Promise<void>=Promise.resolve();
let theme:WidgetTheme=DEFAULT_THEME,themeWrite:Promise<void>=Promise.resolve();
function themedLayout(point:Point,area:import('../shared/ui-contract.js').WidgetRect,value:boolean,scale=appearance.scale){return foldLayout(point,area,value,scale,theme);}
const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const previews=new Map<string,ConfigPatch>();
async function workerRequest(operation:string,body:unknown={}):Promise<unknown>{
  if(!worker)throw new Error('Collector unavailable');const id=randomUUID();
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Collector timeout'));},3000);pending.set(id,{resolve,reject,timer});worker!.postMessage({type:'command',id,operation,body});});
}
let restartOperation:Promise<void>|undefined;
function restartCollection():Promise<void>{
  if(!restartOperation)restartOperation=(async()=>{
    restarting=true;clearTimeout(restartTimer);const child=worker;
    try{
      if(child)await new Promise<void>(resolve=>{const timer=setTimeout(()=>{void child.terminate().then(()=>resolve(),()=>resolve());},2000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.postMessage({type:'stop'});});
      if(!closing){restartPolicy.reset();startWorker();}
    }finally{restarting=false;}
  })().finally(()=>{restartOperation=undefined;});
  return restartOperation;
}
let latest:SnapshotUpdate={version:1,type:'snapshots',snapshots:[]}, health:HealthUpdate={version:1,type:'health',status:'offline',message:'正在连接采集器'};
const restartPolicy=new RestartPolicy();let restartTimer:ReturnType<typeof setTimeout>|undefined,lastHealth=0;
function send(message:import('../shared/ui-contract.js').DesktopUpdate){if(window&&!window.isDestroyed())platform.send(message);}
function revealWidget(){
  if(!window||window.isDestroyed())return;
  restoreEdge();
  platform.reveal();
}
function sendLayout(){send({type:'layout',expanded,settings,geometry,appearance:{...appearance},activityView,resizing:!!resizing,edgeHidden});}
let edgeRegion:ReturnType<typeof edgeShape>=[],windowRegion:ReturnType<typeof foldShape>=[];
function cursorInsideWindow(){const p=screen.getCursorScreenPoint(),b=window.getBounds(),x=p.x-b.x,y=p.y-b.y;return (edgeHidden?edgeRegion:windowRegion).some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);}
function restoreEdge(){clearTimeout(edgeTimer);edgeTimer=undefined;if(!edgeHidden)return;edgeHidden=null;edgeRegion=[];lastShapeKey='';applyGeometry(geometry);}
function scheduleEdge(){
 clearTimeout(edgeTimer);edgeTimer=undefined;
 if(!edgeEnabled||edgeHidden||settings||pinned||drag||resizing||pointerInside)return;
 const area=screen.getDisplayNearestPoint(geometry.anchor).workArea,closed=themedLayout(geometry.anchor,area,false,appearance.scale),edge=dockEdge(closed,area);if(!edge)return;
 edgeTimer=setTimeout(()=>{
  edgeTimer=undefined;
  if(settings||pinned||drag||resizing||pointerInside||!edgeEnabled)return;
  expanded=false;geometry=closed;edgeHidden={edge,bounds:edgeBounds(closed,area,edge)};window.setBounds(edgeHidden.bounds);
  edgeRegion=edgeShape(edgeHidden.bounds,theme);if(['win32','linux'].includes(process.platform))window.setShape(edgeRegion);sendLayout();
 },800);
}
function uiPoint(raw:unknown):Point{
 const point=raw as Point|undefined;
 if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>1000000||Math.abs(point.y)>1000000)throw new Error('Invalid pointer point');
 return {x:Math.round(point.x),y:Math.round(point.y)};
}
function persistAppearance():Promise<void>{
 clearTimeout(appearanceTimer);const value={...appearance};
 appearanceWrite=appearanceWrite.catch(()=>{}).then(()=>atomicJson(join(dir,'appearance.json'),value));return appearanceWrite;
}
async function persistPosition(){const closed=themedLayout(geometry.anchor,screen.getDisplayNearestPoint(geometry.anchor).workArea,false,appearance.scale);await atomicJson(join(dir,'position.json'),{x:closed.bounds.x,y:closed.bounds.y,anchor:closed.anchor,layout:'fold-v2'});}
function applyAppearance(value:Appearance,anchor=geometry.anchor){const changed=appearance.scale!==value.scale||anchor!==geometry.anchor;appearance=value;window.setOpacity(appearance.opacity);if(changed)applyGeometry(themedLayout(anchor,screen.getDisplayNearestPoint(anchor).workArea,expanded,appearance.scale));else sendLayout();}
function clearHover(){clearTimeout(hoverTimer);hoverTimer=undefined;}
function scheduleHover(){
 clearHover();
 if(pointerInside)restoreEdge();else scheduleEdge();
 if(!settings&&!pinned&&!drag&&!resizing&&!hoverBlocked)hoverTimer=setTimeout(()=>{
  hoverTimer=undefined;if(settings||pinned||drag||resizing||hoverBlocked)return;
  // Window changes can synthesize enter/leave for WebView2's old pointer point.
  pointerInside=cursorInsideWindow();if(expanded!==pointerInside)layout(pointerInside);
 },pointerInside?250:400);
}
function endResize(cancel:boolean){if(!resizing)return;const original=resizing;resizing=null;if(cancel)applyAppearance(original.before,original.anchor);else sendLayout();hoverBlocked=pointerInside;scheduleHover();}
async function resetAppearance(){endResize(true);applyAppearance({...DEFAULT_APPEARANCE});await persistAppearance();await persistPosition();}
function appearanceSaveFailed(){send({version:1,type:'health',status:'degraded',message:'外观未保存，请在设置中重试。'});}
function applyGeometry(next:FoldGeometry){
  if(edgeHidden)return;
  geometry=next;
  const b=window.getBounds(),n=next.bounds;
  if(!lastShapeKey||b.x!==n.x||b.y!==n.y||b.width!==n.width||b.height!==n.height)window.setBounds(n);
  const key=JSON.stringify([n.width,n.height,next.screen,next.wing,next.hinge,next.theme]);
  if(key!==lastShapeKey){windowRegion=foldShape(next);if(['win32','linux'].includes(process.platform))window.setShape(windowRegion);lastShapeKey=key;}
  sendLayout();
}
function layout(value:boolean){
  if(window.isDestroyed())return;
  if(edgeHidden&&!value)return;if(value)restoreEdge();
  expanded=value;applyGeometry(themedLayout(geometry.anchor,screen.getDisplayNearestPoint(geometry.anchor).workArea,value,appearance.scale));
}
function focusSettings(){clearHover();settings=true;window.setFocusable(true);layout(true);revealWidget();window.focus();}
function scheduleCollectorRestart(){
  if(closing)return;
  health={version:1,type:'health',status:'offline',message:'采集已断开'};send(health);
  const delay=restartPolicy.nextDelay();if(delay!==null)restartTimer=setTimeout(startWorker,delay);else {health.message='采集不可用，请重新连接';send(health);}
}
function startWorker(){
  if(closing)return;
  let spawned:Worker;
  try{spawned=new Worker(platform.collectorPath,{argv:[dir,...(autoDetect?['--auto-detect']:[])],name:'codingSchedule collector',resourceLimits:{maxYoungGenerationSizeMb:2}});}
  catch{scheduleCollectorRestart();return;}
  worker=spawned;
  // Worker errors are followed by exit; that handler owns bounded recovery.
  worker.on('error',()=>{});
  worker.on('message',(message:SnapshotUpdate|HealthUpdate|{type:'reply';id:string;result:unknown;error?:string})=>{
    if(worker!==spawned)return;
    if(message.type==='reply'){const p=pending.get(message.id);if(p){clearTimeout(p.timer);pending.delete(message.id);if(message.error)p.reject(new Error(message.error));else p.resolve(message.result);}return;}
    if(message.version!==1)return;
    if(message.type==='snapshots'){latest=message;send(latest);}else if(message.type==='health'){health=message;lastHealth=Date.now();send(health);}
  });
  worker.on('exit',()=>{if(worker!==spawned)return;worker=undefined;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Collector disconnected'));}pending.clear();if(!closing&&!restarting)scheduleCollectorRestart();});
}
  if(autoDetect)try{await prepareProfile(dir,legacyDir);}catch{
    platform.error('无法迁移进度数据','旧数据已保留。请先退出旧版悬浮框，再启动本程序重试。');
    platform.exit(1);return;
  }
  await mkdir(dir,{recursive:true});
  appearance=await readAppearance(join(dir,'appearance.json'));
  try{theme=normalizeTheme(JSON.parse(await readFile(join(dir,'theme.json'),'utf8')).theme);}catch{/* Preserve the original appearance for profiles without a theme preference. */}
  try{const saved=JSON.parse(await readFile(join(dir,'view.json'),'utf8'));if(saved.activityView==='execution')activityView='execution';}catch{/* Work view by default. */}
  try{edgeEnabled=JSON.parse(await readFile(join(dir,'edge.json'),'utf8')).enabled!==false;}catch{/* Enabled by default. */}
  const area=screen.getPrimaryDisplay().workArea;let point={x:area.x+area.width-90,y:area.y+area.height-152};
  try{const saved=JSON.parse(await readFile(join(dir,'position.json'),'utf8'));if(saved.anchor)point=uiPoint(saved.anchor);else if(Number.isFinite(saved.x)&&Number.isFinite(saved.y)){const a=screen.getDisplayMatching({x:saved.x,y:saved.y,...THEMES[theme].screen}).workArea,size=themedLayout({x:a.x+a.width/2,y:a.y+a.height/2},a,false,appearance.scale).bounds;point={x:saved.x+size.width/2,y:saved.y+size.height/2};}}catch{/* Default position. */}
  geometry=themedLayout(point,screen.getDisplayNearestPoint(point).workArea,false,appearance.scale);
  const window=platform.open(geometry.bounds,{
    ready(){sendLayout();send(latest);send(health);},
    move(){if(edgeHidden)return;const b=window.getBounds(),old=geometry.bounds;geometry={...geometry,bounds:b,anchor:{x:geometry.anchor.x+b.x-old.x,y:geometry.anchor.y+b.y-old.y}};},
    async command(command:unknown){
    if(!command||typeof command!=='object'||!('type' in command))throw new Error('Invalid command');
    const c=command as Record<string,unknown>;
    if(['setupInstall','setupRemove'].includes(String(c.type))&&!settings)throw new Error('Explicit focused settings action required');
    if(['setupInstall','setupRemove','settingsRead','loginSave','sourcesSave','integrationPreview','integrationApply','integrationRevert','linkSource','unlinkSource','confirmVerified'].includes(String(c.type))&&!window.isFocused())throw new Error('Explicit focused action required');
    switch(c.type){
      case 'setupRead':return setupStatus(setupRuntime);
      case 'associationRead':return workerRequest('sources');
      case 'setupInstall':return installSetup(setupRuntime);
      case 'setupRemove':return removeSetup(setupRuntime);
      case 'activityViewSet':{
        if(c.value!=='work'&&c.value!=='execution')throw new Error('Invalid activity view');const value=c.value;
        activityViewWrite=activityViewWrite.catch(()=>{}).then(async()=>{await atomicJson(join(dir,'view.json'),{activityView:value});activityView=value;sendLayout();});
        await activityViewWrite;return {ok:true};
      }
      case 'themeSet':{
        if(!isWidgetTheme(c.value))throw new Error('Invalid widget theme');const value=c.value;
        themeWrite=themeWrite.catch(()=>{}).then(async()=>{
          await atomicJson(join(dir,'theme.json'),{theme:value});
          endResize(true);restoreEdge();theme=value;lastShapeKey='';layout(expanded);
          try{await persistPosition();}catch{send({version:1,type:'health',status:'degraded',message:'主题已保存，窗口位置未保存；可拖动后重试。'});}
        });
        await themeWrite;return {theme};
      }
      case 'settingsRead':{
        let saved:{sources?:unknown}={};try{saved=JSON.parse(await readFile(join(dir,'settings.json'),'utf8'));}catch{/* First run. */}
        let receipts:Record<string,InstallReceipt>={};try{receipts=JSON.parse(await readFile(join(dir,'receipts.json'),'utf8'));}catch{/* No installs. */}
        const sources=configuredSources(saved,autoDetect);
        return {sources,theme,appearance:{...appearance},effectiveScale:geometry.scale,maxScale:scaleLimit(screen.getDisplayNearestPoint(geometry.anchor).workArea,theme),login:loginState(platform.login,platform.loginAvailable,platform.executable),configPaths:{codex:join(process.env.CODEX_HOME||join(homedir(),'.codex'),'config.toml'),claude:join(homedir(),'.claude.json'),generic:join(dir,'generic-mcp.json'),'codex-hooks':join(process.env.CODEX_HOME||join(homedir(),'.codex'),'hooks.json'),'claude-hooks':join(process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),'settings.json')},receipts:Object.entries(receipts).map(([id,r])=>({id,path:r.path})),nativeSources:await workerRequest('sources').catch(()=>[])};
      }
      case 'loginSave':if(typeof c.enabled!=='boolean')throw new Error('Invalid login setting');return setLogin(platform.login,platform.loginAvailable,platform.executable,c.enabled);
      case 'edgeRead':return {enabled:edgeEnabled};
      case 'edgeSave':if(typeof c.enabled!=='boolean'||!window.isFocused())throw new Error('Explicit focused action required');edgeEnabled=c.enabled;restoreEdge();await atomicJson(join(dir,'edge.json'),{enabled:edgeEnabled});return {enabled:edgeEnabled};
      case 'sourcesSave':{
        if(!Array.isArray(c.sources)||c.sources.length>2)throw new Error('Invalid sources');
        const sources=c.sources.map(s=>{if(!s||typeof s!=='object'||!['codex','claude'].includes(s.provider)||typeof s.root!=='string'||!isAbsolute(s.root)||s.root.length>1024||typeof s.enabled!=='boolean')throw new Error('Invalid source');return {provider:s.provider,root:s.root,enabled:s.enabled};});
        await atomicJson(join(dir,'settings.json'),{sources});await restartCollection();return {ok:true};
      }
      case 'integrationPreview':{
        if(!['codex','claude','generic','codex-hooks','claude-hooks'].includes(String(c.host))||typeof c.configPath!=='string'||!isAbsolute(c.configPath)||c.configPath.length>1024)throw new Error('Invalid integration');
        const host=c.host as IntegrationRequest['host'],hook=host.endsWith('-hooks'),provider=host.split('-')[0] as 'codex'|'claude'|'generic',connectorId=provider+(hook?'-hook':'-reporter');
        const credentialPath=await createCredential(dir,connectorId,provider,hook?'hook':'reporter');
        const nodePath=setupRuntime.nodePath;
        const bridgePath=hook?join(setupRuntime.integrationsPath,'hooks',provider+'.cjs'):setupRuntime.bridgePath;
        const relayPath=setupRuntime.relayPath;
        const patch=await previewIntegration({host,configPath:c.configPath,nodePath,...(setupRuntime.runAsNode?{runAsNode:true}:{}),bridgePath,...(!hook&&relayPath?{relayPath}:{}),connectorId,credentialPath,endpointPath:join(dir,'endpoint.json')});
        const id=randomUUID();previews.clear();previews.set(id,patch);return {previewId:id,path:patch.path,ownedKeys:patch.ownedKeys,text:JSON.stringify(patch.ownedAfter,null,2)};
      }
      case 'integrationApply':{
        const patch=typeof c.previewId==='string'?previews.get(c.previewId):undefined;if(!patch)throw new Error('Preview expired');previews.delete(String(c.previewId));
        return applyRecordedIntegration(dir,{...patch,...(setupRuntime.installRoot?{installRoot:setupRuntime.installRoot}:{})});
      }
      case 'integrationRevert':{
        if(typeof c.receiptId!=='string')throw new Error('Unknown receipt');return revertRecordedIntegration(dir,c.receiptId,setupRuntime.installRoot);
      }
      case 'linkSource':case 'unlinkSource':{
        const active=associationRuns(latest.snapshots),target=c.run as {runId?:unknown;generation?:unknown},native=c.nativeRun as {runId?:unknown;generation?:unknown};
        if(!target||!native||!active.targets.some(s=>s.run.runId===target.runId&&s.run.generation===target.generation)||!active.natives.some(s=>s.run.runId===native.runId&&s.run.generation===native.generation))throw new Error('Session is no longer active');
        await workerRequest(c.type==='linkSource'?'link':'unlink',{run:target,nativeRun:c.nativeRun});return {ok:true};
      }
      case 'confirmVerified':{
        const target=c.run as {runId?:unknown;generation?:unknown};if(!target||!latest.snapshots.some(s=>s.status==='reported_done'&&s.run.runId===target.runId&&s.run.generation===target.generation))throw new Error('Task not ready');
        await workerRequest('verify',{run:target});return {ok:true};
      }
      case 'hover': if(typeof c.inside!=='boolean')throw new Error('Invalid hover');pointerInside=c.inside;if(!pointerInside)hoverBlocked=false;scheduleHover();break;
      case 'expand':hoverBlocked=false;clearHover();layout(true);break;
      case 'pinExpanded':if(typeof c.value!=='boolean')throw new Error('Invalid pin');pinned=c.value;clearHover();clearTimeout(edgeTimer);layout(true);if(!pinned)scheduleHover();break;
      case 'openSettings':focusSettings();break;
      case 'closeSettings':restoreEdge();endResize(true);settings=false;pinned=false;hoverBlocked=true;clearHover();window.setFocusable(false);layout(false);scheduleEdge();break;
      case 'showFocused':window.setFocusable(true);layout(true);window.show();window.focus();break;
      case 'hide':window.hide();break;
      case 'resetPosition':{restoreEdge();const a=screen.getPrimaryDisplay().workArea;applyGeometry(themedLayout({x:a.x+a.width-90,y:a.y+a.height-152},a,expanded,appearance.scale));await persistPosition();break;}
      case 'selectRun':{const r=c.run as {runId?:unknown;generation?:unknown};if(!r||!latest.snapshots.some(s=>s.run.runId===r.runId&&s.run.generation===r.generation))throw new Error('Unknown run');return {selected:r};}
      case 'retryCollector':await restartCollection();break;
      case 'appearanceSet':{
        if(typeof c.commit!=='boolean'||c.scale===undefined&&c.opacity===undefined||c.scale!==undefined&&(typeof c.scale!=='number'||!Number.isFinite(c.scale))||c.opacity!==undefined&&(typeof c.opacity!=='number'||!Number.isFinite(c.opacity)))throw new Error('Invalid appearance');
        clearTimeout(appearanceTimer);
        applyAppearance(normalizeAppearance({...appearance,...(c.scale!==undefined?{scale:c.scale}:{}),...(c.opacity!==undefined?{opacity:c.opacity}:{})}));
        if(c.commit){await persistAppearance();if(c.scale!==undefined)await persistPosition();}return {appearance:{...appearance},effectiveScale:geometry.scale};
      }
      case 'appearanceReset':await resetAppearance();return {appearance:{...appearance},effectiveScale:geometry.scale};
      case 'opacityWheel':{
        if(c.direction!==1&&c.direction!==-1)throw new Error('Invalid wheel direction');if(resizing)break;
        applyAppearance(normalizeAppearance({...appearance,opacity:appearance.opacity+c.direction*.05}));clearTimeout(appearanceTimer);
        appearanceTimer=setTimeout(()=>{void persistAppearance().catch(appearanceSaveFailed);},400);break;
      }
      case 'resize':{
        if(!['start','move','end','cancel'].includes(String(c.phase)))throw new Error('Invalid resize phase');const point=uiPoint(c.point);
        if(c.phase==='start'){if(drag||resizing)throw new Error('Gesture already active');clearHover();clearTimeout(appearanceTimer);resizing={start:point,anchor:geometry.anchor,scale:geometry.scale,before:{...appearance}};sendLayout();}
        else if((c.phase==='move'||c.phase==='end')&&resizing){applyAppearance({...appearance,scale:resizedScale(resizing.scale,resizing.anchor,resizing.start,point)},resizing.anchor);if(c.phase==='end'){endResize(false);await persistAppearance();await persistPosition();}}
        else if(c.phase==='cancel'&&resizing){endResize(true);await persistAppearance();await persistPosition();}break;
      }
      case 'drag':{
        // IPC can be handled after a fast native gesture has already finished.
        // Use the event's DIP screen coordinates, not the later cursor position.
        if(!['start','move','end'].includes(String(c.phase)))throw new Error('Invalid drag phase');const point=uiPoint(c.point);
        if(c.phase==='start'){if(resizing)throw new Error('Resize already active');clearHover();drag={start:point,anchor:geometry.anchor,moving:false};}
        else if(c.phase==='move'&&drag){const dx=point.x-drag.start.x,dy=point.y-drag.start.y;if(Math.hypot(dx,dy)>=4)drag.moving=true;if(drag.moving)applyGeometry(themedLayout({x:drag.anchor.x+dx,y:drag.anchor.y+dy},screen.getDisplayNearestPoint(point).workArea,expanded,appearance.scale));}
        else if(c.phase==='end'&&drag){const moved=drag.moving;drag=null;if(moved)await persistPosition();scheduleEdge();return {moved};}
        break;
      }
      default:throw new Error('Unknown command');
    }
    return {ok:true};
    }
  });
  applyGeometry(geometry);
  window.setOpacity(appearance.opacity);
  platform.tray([
    {label:'显示悬浮框',action:revealWidget},
    {label:'展开并聚焦',action:()=>{window.setFocusable(true);layout(true);revealWidget();window.focus();}},
    {label:'接入 / 设置',action:focusSettings},
    {label:'恢复默认大小与不透明度',action:()=>{void resetAppearance().catch(appearanceSaveFailed);}},
    {label:'重新连接采集器',action:()=>{void restartCollection();}},
    {label:'隐藏',action:()=>window.hide()},
  ]);
  const recoverPosition=()=>{if(!window.isDestroyed()){lastShapeKey='';restoreEdge();endResize(true);layout(expanded);}};
  platform.onDisplayChange(recoverPosition);
  platform.onSecondInstance(revealWidget);
  await platform.load();revealWidget();startWorker();scheduleEdge();
  // Native bounds remain authoritative after pointer capture or shape changes.
  // Share the visible regions with native hit testing. The leave delay permits
  // crossing between wings without treating the whole transparent canvas as UI.
  const edgeWatch=setInterval(()=>{
    if(closing||!window.isVisible()||settings||pinned||drag||resizing)return;
    const area=screen.getDisplayNearestPoint(geometry.anchor).workArea;
    if(!edgeHidden&&!expanded&&(!edgeEnabled||!dockEdge(themedLayout(geometry.anchor,area,false,appearance.scale),area)))return;
    const inside=cursorInsideWindow();
    if(edgeHidden&&inside){pointerInside=true;restoreEdge();scheduleHover();}
    else if(!edgeHidden&&inside!==pointerInside){pointerInside=inside;if(!inside)hoverBlocked=false;scheduleHover();}
    else if(!inside&&!edgeHidden&&expanded&&!hoverTimer&&!hoverBlocked)scheduleHover();
    else if(!inside&&!edgeHidden&&!edgeTimer)scheduleEdge();
  },200);
  const timer=setInterval(()=>{if(lastHealth&&collectorHealth(lastHealth,Date.now())==='offline'){health={version:1,type:'health',status:'offline',message:'采集不可用，状态可能过期'};send(health);}},5000);
  platform.onQuit(()=>{if(closing)return;closing=true;clearInterval(timer);clearInterval(edgeWatch);clearHover();clearTimeout(edgeTimer);clearTimeout(restartTimer);clearTimeout(appearanceTimer);
    void (async()=>{await themeWrite.catch(()=>{});if(resizing){appearance=resizing.before;resizing=null;}await persistAppearance();
    if(worker){const child=worker;child.postMessage({type:'stop'});const force=setTimeout(()=>{void child.terminate().then(()=>platform.exit(0),()=>platform.exit(0));},2000);child.once('exit',()=>{clearTimeout(force);platform.exit(0);});}else platform.exit(0);
    })().catch(()=>platform.exit(1));
  });
}
