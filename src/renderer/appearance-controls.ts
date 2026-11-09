import type {UiCommand,LayoutUpdate} from '../shared/ui-contract.js';
import {DEFAULT_APPEARANCE,normalizeAppearance,densityLabel,MIN_SCALE,MAX_SCALE,type Appearance} from '../shared/appearance.js';
import {OpacityWheel} from './opacity-wheel.js';
export function syncAppearanceSettings(root:ParentNode,value:Appearance,effective:number){
 const scale=root.querySelector<HTMLInputElement>('#appearance-scale'),opacity=root.querySelector<HTMLInputElement>('#appearance-opacity');
 if(scale&&scale!==document.activeElement)scale.value=String(Math.round(value.scale*100));
 if(opacity&&opacity.dataset.editing!=='true')opacity.value=String(Math.round(value.opacity*100));
 const output=root.querySelector('#appearance-opacity-value');if(output)output.textContent=Math.round(value.opacity*100)+'%';
 const fit=root.querySelector('#appearance-fit');if(fit)fit.textContent=(effective<value.scale-.005?'受当前工作区限制，实际尺寸 '+Math.round(effective*100)+'%。':`尺寸 ${MIN_SCALE*100}%–${MAX_SCALE*100}%。`)+densityLabel(effective)+'屏；小尺寸展开详情保持可读。';
}
export function installAppearanceControls(dispatch:(c:UiCommand)=>Promise<unknown>){
 const feedback=document.getElementById('appearance-feedback')!,widget=document.getElementById('widget')!;
 let current:Appearance={...DEFAULT_APPEARANCE},initialized=false,feedbackTimer:ReturnType<typeof setTimeout>|undefined;
 let gesture:{id:number;element:HTMLElement;point:{x:number;y:number};pending:{x:number;y:number}|null;frame:number|null}|null=null;
 function show(text:string){feedback.textContent=widget.dataset.density!=='normal'?text.match(/\d+%/)?.[0]??text:text;feedback.title=text;feedback.setAttribute('aria-label',text);feedback.hidden=false;clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>{feedback.hidden=true;},1200);}
 function move(){if(!gesture)return;if(gesture.frame!==null)cancelAnimationFrame(gesture.frame);gesture.frame=null;const point=gesture.pending;gesture.pending=null;if(point)void dispatch({type:'resize',phase:'move',point});}
 function finish(cancel:boolean){if(!gesture)return false;const active=gesture;if(!cancel)move();else if(active.frame!==null)cancelAnimationFrame(active.frame);gesture=null;widget.dataset.adjusting='false';if(active.element.hasPointerCapture(active.id))active.element.releasePointerCapture(active.id);void dispatch({type:'resize',phase:cancel?'cancel':'end',point:active.point});return true;}
 for(const id of ['resize-compact','resize-details']){
  const button=document.getElementById(id)!;
  button.onpointerdown=e=>{if(e.button!==0||gesture)return;e.preventDefault();e.stopPropagation();gesture={id:e.pointerId,element:button,point:{x:e.screenX,y:e.screenY},pending:null,frame:null};button.setPointerCapture(e.pointerId);widget.dataset.adjusting='true';void dispatch({type:'resize',phase:'start',point:gesture.point});};
  button.onpointermove=e=>{if(gesture?.id!==e.pointerId)return;gesture.point={x:e.screenX,y:e.screenY};gesture.pending=gesture.point;if(gesture.frame===null)gesture.frame=requestAnimationFrame(move);};
  button.onpointerup=e=>{if(gesture?.id!==e.pointerId)return;gesture.point={x:e.screenX,y:e.screenY};finish(false);};
  button.onpointercancel=e=>{if(gesture?.id===e.pointerId)finish(true);};button.onlostpointercapture=e=>{if(gesture?.id===e.pointerId)finish(true);};button.onclick=e=>{e.preventDefault();e.stopPropagation();};
  button.onkeydown=e=>{let scale:number;if(['ArrowUp','ArrowRight','Enter',' '].includes(e.key))scale=current.scale+.05;else if(['ArrowDown','ArrowLeft'].includes(e.key))scale=current.scale-.05;else if(e.key==='Home')scale=1;else return;e.preventDefault();e.stopPropagation();void dispatch({type:'appearanceSet',scale:normalizeAppearance({scale}).scale,commit:true});};
 }
 const wheel=new OpacityWheel();
 for(const id of ['compact','screen-controls'])document.getElementById(id)!.addEventListener('wheel',e=>{
  e.preventDefault();if(e.ctrlKey||e.metaKey||gesture)return;const direction=wheel.consume(e.deltaY,e.deltaMode,performance.now());if(!direction)return;
  show('不透明度 '+Math.round(normalizeAppearance({...current,opacity:current.opacity+direction*.05}).opacity*100)+'%');void dispatch({type:'opacityWheel',direction});
 },{passive:false});
 return {
  cancelResize:()=>finish(true),
  update(message:LayoutUpdate){
   const next=message.appearance;
   if(initialized&&next.opacity!==current.opacity)show('不透明度 '+Math.round(next.opacity*100)+'%');
   else if(initialized&&next.scale!==current.scale)show('尺寸 '+Math.round(message.geometry.scale*100)+'% · '+densityLabel(message.geometry.scale));
   initialized=true;current={...next};syncAppearanceSettings(document,next,message.geometry.scale);
   for(const id of ['resize-compact','resize-details'])document.getElementById(id)!.setAttribute('aria-label','调整窗口大小，当前 '+Math.round(message.geometry.scale*100)+'%，拖动或方向键微调');
  }
 };
}
