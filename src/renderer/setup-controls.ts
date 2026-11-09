import type {SettingsCommand} from '../shared/ui-contract.js';
import type {SetupStatus} from '../integration/setup.js';

export async function mountSetup(container:HTMLElement,dispatch:(command:SettingsCommand)=>Promise<unknown>){
 const section=document.createElement('section');section.id='quick-setup';
 section.innerHTML='<h2>让 AI 自动汇报</h2><p>一次配置 Codex 和 Claude Code 的 MCP、汇报 Skill、默认规则与异步估时 Hook。</p><div id="setup-hosts"></div><button id="setup-install" class="setup-primary">一键配置 Codex 与 Claude</button><p id="setup-result" role="status" aria-live="polite">正在检查接入…</p><p class="muted">保留已有配置并自动备份。不会重启 AI 工具，也不修改审批权限。</p><details id="setup-details"><summary>查看路径与撤销</summary><ul id="setup-files"></ul><div class="setup-actions"><button id="setup-check">重新检查</button><button id="setup-remove">撤销一键接入</button></div></details>';
 container.prepend(section);
 const q=<T extends HTMLElement=HTMLElement>(id:string)=>section.querySelector<T>('#'+id)!;
 const install=q<HTMLButtonElement>('setup-install'),check=q<HTMLButtonElement>('setup-check'),remove=q<HTMLButtonElement>('setup-remove'),result=q('setup-result');
 function show(status:SetupStatus){
  q('setup-hosts').replaceChildren();q('setup-files').replaceChildren();
  for(const provider of ['codex','claude'] as const){const items=status.items.filter(i=>i.provider===provider),row=document.createElement('p'),name=document.createElement('strong'),state=document.createElement('span');name.textContent=provider==='codex'?'Codex':'Claude Code';state.textContent=items.every(i=>i.state==='ready')?'配置齐全':items.some(i=>i.state==='conflict')?'需要核对':'待配置';row.append(name,state);q('setup-hosts').append(row);}
  for(const item of status.items){const li=document.createElement('li');li.dataset.state=item.state;li.textContent=`${item.provider==='codex'?'Codex':'Claude'} · ${item.name} · ${item.state==='ready'?'已配置':item.state==='conflict'?'需要核对':'待配置'}\n${item.path}${item.message?'\n'+item.message:''}`;q('setup-files').append(li);}
  install.textContent=status.ready?'重新检查并修复':'一键配置 Codex 与 Claude';remove.disabled=!status.managed;
  section.dataset.state=status.ready?'ready':status.items.some(i=>i.state==='conflict')?'conflict':'missing';
  result.textContent=status.ready?'配置已就绪。请在方便时重新连接或重开 AI 工具，再开始任务；宿主加载与实际汇报仍需确认。':status.items.some(i=>i.state==='conflict')?'发现配置冲突，未覆盖内容。展开下方路径，核对后重新检查。':'配置后，多步骤任务可自动汇报工作事项、计划进度和预计时间。';
 }
 async function run(type:'setupRead'|'setupInstall'|'setupRemove'){
  install.disabled=check.disabled=remove.disabled=true;section.setAttribute('aria-busy','true');result.textContent=type==='setupRead'?'正在检查接入…':type==='setupInstall'?'正在配置并校验两种 AI 工具…':'正在撤销本工具接入…';
  try{const value=await dispatch({type}) as SetupStatus|{applied:boolean;status:SetupStatus};if('status' in value){show(value.status);if(!value.applied)result.textContent='接入未完成，已回滚可恢复的变更；如有冲突，保留现场。核对下方路径后重试。';else if(type==='setupRemove')result.textContent='已撤销本次管理的接入；原有内容已保留。';}else show(value);}
  catch{result.textContent='接入未完成。请检查路径、格式和访问权限，再点击“重新检查”；已有内容不会被强制覆盖。';}
  finally{install.disabled=check.disabled=false;section.setAttribute('aria-busy','false');}
 }
 install.onclick=()=>{void run('setupInstall');};check.onclick=()=>{void run('setupRead');};remove.onclick=()=>{void run('setupRemove');};
 await run('setupRead');
}
