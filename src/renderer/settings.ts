import type {RunRef,RunSnapshot} from '../shared/contracts.js';
import type {SettingsCommand,UiCommand} from '../shared/ui-contract.js';
import {mountAssociation} from './association-controls.js';
import {normalizeAppearance,MIN_SCALE,MAX_SCALE,type Appearance} from '../shared/appearance.js';
import {syncAppearanceSettings} from './appearance-controls.js';
import {mountSetup} from './setup-controls.js';
import {THEMES,normalizeTheme,isWidgetTheme,type WidgetTheme} from '../shared/themes.js';
type Data={theme?:WidgetTheme;appearance:Appearance;effectiveScale:number;login:{available:boolean;enabled:boolean};sources:Array<{provider:'codex'|'claude';root:string;enabled:boolean}>;configPaths:Record<string,string>;receipts:Array<{id:string;path:string}>;nativeSources:Array<{run:RunRef;provider:string;nativeSessionId:string;turnId:string;completeReplay:boolean}>};
let associationUpdate:ReturnType<typeof mountAssociation>|undefined;
export function syncAssociations(snapshots:RunSnapshot[]){associationUpdate?.(snapshots);}
export async function mountSettings(container:HTMLElement,dispatch:(command:UiCommand|SettingsCommand)=>Promise<unknown>,snapshots:RunSnapshot[],preserveAdvanced=false):Promise<void>{
  const advancedOpen=preserveAdvanced&&(container.querySelector<HTMLDetailsElement>('#advanced-settings')?.open??false);
  associationUpdate=undefined;
  container.replaceChildren();
  const message=document.createElement('p');message.setAttribute('role','status');message.textContent='正在读取本地接入信息…';container.append(message);
  try{
    const data=await dispatch({type:'settingsRead'}) as Data;
    // Static markup only. Paths, titles and previews are assigned as text/value below.
    container.innerHTML=`<section><h2>启动与退出</h2><label><input type="checkbox" id="login-startup"> 登录 Windows 时启动</label><p id="login-help" class="muted"></p><p class="muted">退出：托盘菜单 → 退出。安装版卸载会先撤销本工具接入，默认保留进度记录；AI 日志不删除。</p></section><section id="source-settings"><h2>日志路径与监测开关</h2><div id="source-fields"></div><button id="save-sources">保存并检测来源</button><p class="muted">普通启动自动检测已知来源，可取消勾选。仅显示活动会话，历史记录不会占用列表；只读日志，不修改原始记录。</p></section><section id="manual-integration"><h2>手动接入配置</h2><label for="host">配置目标（仅手动维护）</label><select id="host"><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="generic">通用 MCP</option></select><label for="config-path">配置文件路径</label><input id="config-path"><button id="preview-integration">预览接入变更</button><pre id="integration-preview" hidden></pre><button id="apply-integration" hidden>确认应用以上变更</button><div id="installed"></div><p class="muted">这里只修改指定工具的接入配置，不切换监测对象。Codex / Claude 推荐一键配置；通用 MCP 可在此手动维护。</p></section><details id="advanced-settings"><summary>高级设置</summary><section><h2>手动关联活动会话</h2><p class="muted">仅自动关联失败时使用，只显示当前活动项。进度与估时保持不变。</p><label for="reporter-run">正在汇报的任务</label><select id="reporter-run"></select><label for="native-run">正在活动的会话</label><select id="native-run"></select><button id="link-source">关联所选轮次</button><button id="unlink-source">解除关联</button></section></details><button id="retry-collector">重新连接采集器</button><p id="settings-status" role="status"></p>`;
    const q=<T extends HTMLElement=HTMLElement>(id:string)=>container.querySelector('#'+id) as T;
    const advanced=q<HTMLDetailsElement>('advanced-settings');advanced.open=advancedOpen;advanced.insertBefore(q('source-settings'),advanced.children[1]??null);advanced.insertBefore(q('manual-integration'),advanced.children[2]??null);
    const monitor=document.createElement('section');monitor.id='monitor-overview';monitor.innerHTML='<h2>自动监测</h2><p id="monitor-mode"></p><div id="monitor-providers"></div><p class="muted">活动会话自动出现和跟随，没有活动时显示空闲。完整进度与估时由 AI 上报。</p><button id="manage-sources">管理日志路径与开关</button>';
    function monitorState(sources:Data['sources']){
      const enabled=sources.filter(s=>s.enabled).length;monitor.querySelector('#monitor-mode')!.textContent=enabled===2?'同时监测 Codex 和 Claude，无需选择 AI。':enabled?'自动监测已开启的来源，无需切换 AI。':'当前未开启监测，可在高级设置中启用。';
      const rows=sources.map(s=>{const row=document.createElement('p'),name=document.createElement('strong'),state=document.createElement('span');name.textContent=s.provider==='codex'?'Codex':'Claude Code';state.textContent=s.enabled?'监测已开启':'监测已关闭';state.id='monitor-'+s.provider+'-state';row.append(name,state);return row;});monitor.querySelector('#monitor-providers')!.replaceChildren(...rows);
    }
    monitorState(data.sources);monitor.querySelector<HTMLButtonElement>('#manage-sources')!.onclick=()=>{advanced.open=true;q('source-settings').scrollIntoView({block:'start'});};
    const appearanceSection=document.createElement('section');appearanceSection.id='appearance-settings';
    appearanceSection.innerHTML='<h2>尺寸与不透明度</h2><label for="appearance-scale">窗口尺寸（%）</label><div class="appearance-scale-row"><button id="appearance-smaller" aria-label="缩小5%">−</button><input id="appearance-scale" type="number" step="5" inputmode="numeric"><button id="appearance-larger" aria-label="放大5%">+</button></div><p id="appearance-fit" class="muted"></p><label for="appearance-opacity">不透明度 <output id="appearance-opacity-value" for="appearance-opacity"></output></label><input id="appearance-opacity" type="range" min="40" max="100" step="1"><p class="muted">OLED上滚更实，下滚更透；详情滚动不受影响。</p><button id="appearance-default">恢复默认外观</button>';
    const sizeInput=appearanceSection.querySelector<HTMLInputElement>('#appearance-scale')!;sizeInput.min=String(MIN_SCALE*100);sizeInput.max=String(MAX_SCALE*100);
    container.prepend(appearanceSection);container.prepend(monitor);const initial=normalizeAppearance(data.appearance);syncAppearanceSettings(container,initial,data.effectiveScale??1);
    const edgeLabel=document.createElement('label'),edgeInput=document.createElement('input');edgeInput.type='checkbox';edgeInput.id='edge-auto-hide';edgeInput.checked=(await dispatch({type:'edgeRead'}) as {enabled:boolean}).enabled;edgeLabel.append(edgeInput,' 靠近屏幕边缘时自动隐藏');appearanceSection.append(edgeLabel);edgeInput.onchange=()=>{edgeInput.disabled=true;void dispatch({type:'edgeSave',enabled:edgeInput.checked}).catch(()=>{edgeInput.checked=!edgeInput.checked;status('贴边隐藏设置未保存，请重试。');}).finally(()=>{edgeInput.disabled=false;});};
    q<HTMLInputElement>('appearance-scale').value=String(Math.round(initial.scale*100));
    const status=(text:string)=>{q('settings-status').textContent=text;};
    const themeSection=document.createElement('section');themeSection.id='theme-settings';
    themeSection.innerHTML='<h2>悬浮窗主题</h2><label for="widget-theme">显示样式</label><select id="widget-theme"></select><p id="theme-description" class="muted"></p>';
    const themeSelect=themeSection.querySelector<HTMLSelectElement>('#widget-theme')!,themeDescription=themeSection.querySelector<HTMLElement>('#theme-description')!;
    let selectedTheme=normalizeTheme(data.theme);
    for(const [id,definition] of Object.entries(THEMES)){const option=document.createElement('option');option.value=id;option.textContent=definition.label;themeSelect.append(option);}
    const syncTheme=()=>{themeSelect.value=selectedTheme;themeDescription.textContent=THEMES[selectedTheme].description+' 主题会自动记住。';};
    syncTheme();container.prepend(themeSection);
    themeSelect.onchange=()=>{const next=themeSelect.value;if(!isWidgetTheme(next))return;themeSelect.disabled=true;
      void dispatch({type:'themeSet',value:next}).then(()=>{selectedTheme=next;syncTheme();status('已切换为'+THEMES[next].label+'。');}).catch(()=>{syncTheme();status('主题未保存，请重试。');}).finally(()=>{themeSelect.disabled=false;});};
    async function action(button:HTMLButtonElement,fn:()=>Promise<void>){button.disabled=true;try{await fn();}catch{status('操作未完成，请检查路径、权限或任务状态后重试。');}finally{button.disabled=false;}}
    const scale=q<HTMLInputElement>('appearance-scale'),opacity=q<HTMLInputElement>('appearance-opacity');
    const changeAppearance=async(value:{scale?:number;opacity?:number},commit:boolean)=>{const result=await dispatch({type:'appearanceSet',...value,commit}) as {appearance:Appearance;effectiveScale:number};syncAppearanceSettings(container,result.appearance,result.effectiveScale);if(commit&&value.scale!==undefined)scale.value=String(Math.round(result.appearance.scale*100));};
    scale.onchange=()=>{const value=Number(scale.value);if(!scale.value.trim()||!Number.isFinite(value)){scale.value=String(Math.round(initial.scale*100));status(`请输入${MIN_SCALE*100}到${MAX_SCALE*100}之间的尺寸。`);return;}void changeAppearance({scale:value/100},true).catch(()=>status('尺寸未保存，请重试。'));};
    for(const [id,delta] of [['appearance-smaller',-5],['appearance-larger',5]] as const)q<HTMLButtonElement>(id).onclick=e=>{void action(e.currentTarget as HTMLButtonElement,()=>changeAppearance({scale:(Number(scale.value)+delta)/100},true));};
    opacity.oninput=()=>{opacity.dataset.editing='true';void changeAppearance({opacity:Number(opacity.value)/100},false).catch(()=>status('不透明度未更改，请重试。'));};
    opacity.onchange=()=>{opacity.dataset.editing='false';void changeAppearance({opacity:Number(opacity.value)/100},true).catch(()=>status('不透明度未保存，请重试。'));};
    q<HTMLButtonElement>('appearance-default').onclick=e=>{void action(e.currentTarget as HTMLButtonElement,async()=>{const result=await dispatch({type:'appearanceReset'}) as {appearance:Appearance;effectiveScale:number};scale.value='100';syncAppearanceSettings(container,result.appearance,result.effectiveScale);status('已恢复默认尺寸和100%不透明度。');});};
    const login=q<HTMLInputElement>('login-startup');login.checked=data.login.enabled;login.disabled=!data.login.available;
    q('login-help').textContent=data.login.available?'默认关闭。可随时取消勾选；移动便携目录后需重新启用。':'开发或隔离测试模式不可修改开机启动。正式包默认关闭。';
    login.onchange=()=>{login.disabled=true;void dispatch({type:'loginSave',enabled:login.checked}).then(value=>{login.checked=(value as {enabled:boolean}).enabled;status(login.checked?'已开启登录启动。':'已关闭登录启动。');}).catch(()=>{login.checked=!login.checked;status('启动设置未更改，请检查 Windows 权限后重试。');}).finally(()=>{login.disabled=false;});};
    const fields=data.sources.map(s=>{
      const row=document.createElement('div'),label=document.createElement('label'),check=document.createElement('input'),input=document.createElement('input');
      check.type='checkbox';check.checked=s.enabled;label.append(check,document.createTextNode(s.provider==='codex'?' Codex':' Claude Code'));input.value=s.root;input.setAttribute('aria-label',s.provider+' 日志根目录');row.append(label,input);q('source-fields').append(row);return {s,check,input};
    });
    q<HTMLButtonElement>('save-sources').onclick=e=>{void action(e.currentTarget as HTMLButtonElement,async()=>{const sources=fields.map(({s,check,input})=>({provider:s.provider,root:input.value,enabled:check.checked}));await dispatch({type:'sourcesSave',sources});monitorState(sources);status('来源已保存，采集器正在检测。');});};
    const host=q<HTMLSelectElement>('host'),path=q<HTMLInputElement>('config-path');
    for(const [value,title] of [['codex-hooks','Codex：后台估时询问 Hook'],['claude-hooks','Claude Code：后台估时询问 Hook']]){const option=document.createElement('option');option.value=value!;option.textContent=title!;host.append(option);}
    path.value=data.configPaths.codex||'';host.onchange=()=>{path.value=data.configPaths[host.value]||'';q('integration-preview').hidden=true;q('apply-integration').hidden=true;};
    let previewId='';
    q<HTMLButtonElement>('preview-integration').onclick=e=>{void action(e.currentTarget as HTMLButtonElement,async()=>{const p=await dispatch({type:'integrationPreview',host:host.value as 'codex'|'claude'|'generic'|'codex-hooks'|'claude-hooks',configPath:path.value}) as {previewId:string;path:string;ownedKeys:string[];text:string};previewId=p.previewId;q('integration-preview').textContent=`文件：${p.path}\n仅修改：${p.ownedKeys.join(', ')}\n${p.text}`;q('integration-preview').hidden=false;q('apply-integration').hidden=false;status('请核对路径和新增条目；应用后按宿主要求信任 Hook、重新连接。');});};
    q<HTMLButtonElement>('apply-integration').onclick=e=>{void action(e.currentTarget as HTMLButtonElement,async()=>{const result=await dispatch({type:'integrationApply',previewId}) as {applied:boolean;reason?:string};if(result.applied)await mountSettings(container,dispatch,snapshots,true);else status(result.reason==='conflict'?'配置已被其他程序修改，请重新预览。':'配置未应用，请检查格式或权限。');});};
    for(const receipt of data.receipts){const row=document.createElement('p'),button=document.createElement('button');row.append(document.createTextNode(receipt.path+' '));button.textContent='撤销本工具接入';button.onclick=()=>{void action(button,async()=>{const result=await dispatch({type:'integrationRevert',receiptId:receipt.id}) as {applied:boolean};if(result.applied)await mountSettings(container,dispatch,snapshots,true);else status('无法安全撤销：条目已改变，请人工核对。');});};row.append(button);q('installed').append(row);}
    associationUpdate=mountAssociation(container,data.nativeSources,dispatch,status);associationUpdate(snapshots);
    q('retry-collector').onclick=()=>{void dispatch({type:'retryCollector'}).then(()=>status('已请求重新连接。')).catch(()=>status('连接失败，请稍后重试。'));};
    const setup=mountSetup(container,dispatch);container.prepend(monitor);await setup;
  }catch{message.textContent='采集器尚未就绪。请稍后返回设置，或通过托盘重新连接。';}
}
