import { contextBridge,ipcRenderer } from 'electron';
import type { UiCommand, SettingsCommand, DesktopUpdate } from '../shared/ui-contract.js';
contextBridge.exposeInMainWorld('schedule',Object.freeze({
  subscribeSnapshots(listener:(message:DesktopUpdate)=>void){
    const handler=(_event:Electron.IpcRendererEvent,message:Parameters<typeof listener>[0])=>listener(message);
    ipcRenderer.on('schedule:update',handler);ipcRenderer.send('schedule:ready');
    return ()=>ipcRenderer.removeListener('schedule:update',handler);
  },
  dispatchUiCommand(command:UiCommand|SettingsCommand){return ipcRenderer.invoke('schedule:command',command);}
}));
