export type WidgetTheme='porthole'|'terminal'|'silver'|'disc';
export const DEFAULT_THEME:WidgetTheme='porthole';
export const THEMES={
 porthole:{label:'时光舷窗',description:'双翼折屏、窄状态屏与舷窗倒计时，保留原有外观。',screen:{width:124,height:248},wing:{width:288,height:376},arrangement:'side',radius:16,edgeRadius:null},
 terminal:{label:'像素终端',description:'深色终端、像素刻度，向上或向下展开详情。',screen:{width:360,height:176},wing:{width:360,height:376},arrangement:'stack',radius:5,edgeRadius:3},
 silver:{label:'银砂仪表',description:'冷银金属、蓝色游标，向上或向下展开详情。',screen:{width:376,height:200},wing:{width:376,height:376},arrangement:'stack',radius:13,edgeRadius:7},
 disc:{label:'冷银冰蓝',description:'冰蓝进度环、清晰数字，向侧面展开详情。',screen:{width:224,height:224},wing:{width:288,height:376},arrangement:'side',radius:112,edgeRadius:null}
} as const;
export const isWidgetTheme=(value:unknown):value is WidgetTheme=>typeof value==='string'&&Object.hasOwn(THEMES,value);
export function normalizeTheme(value:unknown):WidgetTheme{return isWidgetTheme(value)?value:DEFAULT_THEME;}
export function edgeRadius(theme:WidgetTheme,width:number,height:number):number{return Math.min(THEMES[theme].edgeRadius??Math.min(width,height)/2,width/2,height/2);}
