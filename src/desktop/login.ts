export type LoginApi={getLoginItemSettings(options:{path:string;args:string[]}):{openAtLogin:boolean};setLoginItemSettings(settings:{openAtLogin:boolean;path:string;name:string;args:string[]}):void};
export function loginState(api:LoginApi,available:boolean,path:string):{available:boolean;enabled:boolean}{
 return {available,enabled:available&&api.getLoginItemSettings({path,args:[]}).openAtLogin};
}
export function setLogin(api:LoginApi,available:boolean,path:string,enabled:boolean){
 if(!available)throw new Error('Login startup requires a packaged app without a custom data directory');
 api.setLoginItemSettings({openAtLogin:enabled,path,name:'codingSchedule',args:[]});return loginState(api,available,path);
}
