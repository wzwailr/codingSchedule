const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sample', { hover: (expanded) => ipcRenderer.send('probe:hover', expanded === true) });
