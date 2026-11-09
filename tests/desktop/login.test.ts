import {expect,test} from 'vitest';import {loginState,setLogin} from '../../src/desktop/login.js';
test('login opt-in targets the same executable and is disabled outside an installed package',()=>{
 let state=false;const calls:unknown[]=[];
 const api={getLoginItemSettings:()=>({openAtLogin:state}),setLoginItemSettings:(s:{openAtLogin:boolean;path:string;name:string;args:string[]})=>{state=s.openAtLogin;calls.push(s);}};
 expect(loginState(api,false,'D:\\开发\\app.exe')).toEqual({available:false,enabled:false});
 expect(()=>setLogin(api,false,'D:\\开发\\app.exe',true)).toThrow();expect(calls).toEqual([]);
 expect(setLogin(api,true,'D:\\软件\\codingSchedule.exe',true)).toEqual({available:true,enabled:true});expect(calls).toEqual([{openAtLogin:true,path:'D:\\软件\\codingSchedule.exe',name:'codingSchedule',args:[]}]);
 expect(setLogin(api,true,'D:\\软件\\codingSchedule.exe',false).enabled).toBe(false);
});
