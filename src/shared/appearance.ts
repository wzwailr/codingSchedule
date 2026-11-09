import {DEFAULT_THEME,THEMES,type WidgetTheme} from './themes.js';
export type Appearance={scale:number;opacity:number};
export const MIN_SCALE=.35,MAX_SCALE=2,MIN_OPACITY=.4,MAX_OPACITY=1;
export type ScreenDensity='normal'|'compact'|'micro';
export function densityForScale(scale:number):ScreenDensity{return scale<.5?'micro':scale<.75?'compact':'normal';}
export const densityLabel=(scale:number)=>({normal:'完整',compact:'紧凑',micro:'微型'}[densityForScale(scale)]);
// Physical sizes interpolate at each tier boundary. Content below 75% uses its
// own readable typography instead of shrinking a complete 248px-tall screen.
export function screenMetrics(scale:number,theme:WidgetTheme=DEFAULT_THEME){
 const density=densityForScale(scale),mix=(a:number,b:number,t:number)=>Math.round(a+(b-a)*t);
 if(theme==='disc'&&scale<.75){const diameter=Math.max(80,Math.round(THEMES.disc.screen.width*scale));return {density,width:diameter,height:diameter,margin:scale<.5?mix(6,8,(scale-MIN_SCALE)/(.5-MIN_SCALE)):mix(8,9,(scale-.5)/.25),contentScale:1};}
 if(scale<.5){const t=(scale-MIN_SCALE)/(.5-MIN_SCALE);return {density,width:mix(56,76,t),height:mix(80,124,t),margin:mix(6,8,t),contentScale:1};}
 const base=THEMES[theme].screen;
 if(scale<.75){const t=(scale-.5)/.25;return {density,width:mix(76,Math.round(base.width*.75),t),height:mix(124,Math.round(base.height*.75),t),margin:mix(8,9,t),contentScale:1};}
 return {density,width:Math.round(base.width*scale),height:Math.round(base.height*scale),margin:Math.round(12*scale),contentScale:scale};
}
export const DEFAULT_APPEARANCE:Appearance={scale:1,opacity:1};
const value=(raw:unknown,fallback:number,min:number,max:number)=>typeof raw==='number'&&Number.isFinite(raw)?Math.round(Math.max(min,Math.min(max,raw))*100)/100:fallback;
export function normalizeAppearance(raw:unknown):Appearance{
 const data=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 return {scale:value(data.scale,1,MIN_SCALE,MAX_SCALE),opacity:value(data.opacity,1,MIN_OPACITY,MAX_OPACITY)};
}
// Screen coordinates are captured with each pointer event; IPC latency must not
// turn a fast gesture's start and end into the same later OS cursor position.
export function resizedScale(scale:number,anchor:{x:number;y:number},start:{x:number;y:number},point:{x:number;y:number}):number{
 const x=start.x-anchor.x,y=start.y-anchor.y,length=x*x+y*y;
 if(length<16)return scale;
 return normalizeAppearance({scale:scale*((point.x-anchor.x)*x+(point.y-anchor.y)*y)/length}).scale;
}
