import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, screen, Tray } from 'electron';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDesktop } from './controller.js';
import { profileDirectory } from './profile.js';
import { v8MemoryArgs } from '../shared/runtime-memory.js';
import type { DesktopPlatform } from './platform.js';

process.env.UV_THREADPOOL_SIZE = '1';
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('js-flags', v8MemoryArgs.join(' '));
protocol.registerSchemesAsPrivileged([{ scheme: 'schedule', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const widgetUrl = 'schedule://widget/index.html';
const dataArg = process.argv.indexOf('--data-dir');
const autoDetect = dataArg < 0;
const legacyDir = app.getPath('userData');
const dir = autoDetect ? profileDirectory(legacyDir, homedir(), process.platform) : resolve(process.argv[dataArg + 1]!);
const resource = (name: string) => app.isPackaged ? join(process.resourcesPath, name) : join(__dirname, '..', name);
const integrationsPath = app.isPackaged ? resource('integrations') : join(__dirname, '../../integrations');
let window: BrowserWindow;
let tray: Tray;

function start() {
  protocol.handle('schedule', request => {
    const url = new URL(request.url);
    const file = url.pathname.slice(1) || 'index.html';
    if (url.host !== 'widget' || !['index.html', 'app.js', 'styles.css', 'themes.css'].includes(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(join(__dirname, '../renderer', file)).toString());
  });
  const platform: DesktopPlatform = {
    dir, legacyDir, autoDetect, executable: process.execPath, collectorPath: join(__dirname, '../collector/main.cjs'),
    setup: {
      dir, nodePath: process.execPath, runAsNode: true, bridgePath: resource('bridge/main.cjs'), integrationsPath,
      ...(process.platform === 'win32' ? { relayPath: resource('bridge/mcp-relay.exe') } : {})
    },
    login: app,
    loginAvailable: app.isPackaged && autoDetect,
    screen,
    open(bounds, listeners) {
      window = new BrowserWindow({
        ...bounds, frame: false, transparent: true, resizable: false, alwaysOnTop: true,
        skipTaskbar: true, focusable: false, show: false,
        webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
      });
      window.on('move', listeners.move);
      window.setMenu(null);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => { if (url !== widgetUrl) event.preventDefault(); });
      ipcMain.on('schedule:ready', event => {
        if (event.sender === window.webContents && event.senderFrame?.url === widgetUrl) listeners.ready();
      });
      ipcMain.handle('schedule:command', (event, command: unknown) => {
        if (event.sender !== window.webContents || event.senderFrame?.url !== widgetUrl) throw new Error('Invalid command origin');
        return listeners.command(command);
      });
      return window;
    },
    async load() { await window.loadURL(widgetUrl); },
    send(message) { window.webContents.send('schedule:update', message); },
    reveal() {
      window.showInactive();
      window.setAlwaysOnTop(true, process.platform === 'win32' ? 'screen-saver' : 'floating');
      window.moveTop();
    },
    tray(actions) {
      const bitmap = Buffer.alloc(16 * 16 * 4);
      for (let i = 0; i < bitmap.length; i += 4) {
        bitmap[i] = 125; bitmap[i + 1] = 173; bitmap[i + 2] = 49; bitmap[i + 3] = 255;
      }
      tray = new Tray(nativeImage.createFromBitmap(bitmap, { width: 16, height: 16 }));
      tray.setToolTip('codingSchedule · AI 任务进度');
      tray.setContextMenu(Menu.buildFromTemplate([
        ...actions.map(({ label, action }) => ({ label, click: action })),
        { type: 'separator' }, { label: '退出', click: () => app.quit() }
      ]));
      tray.on('click', () => window.isVisible() ? window.hide() : actions[0]?.action());
    },
    onSecondInstance(reveal) { app.on('second-instance', reveal); },
    onDisplayChange(recover) {
      screen.on('display-removed', recover);
      screen.on('display-metrics-changed', recover);
    },
    onQuit(close) { app.once('before-quit', event => { event.preventDefault(); tray.destroy(); close(); }); },
    exit(code) { app.exit(code); },
    error(title, message) { dialog.showErrorBox(title, message); }
  };
  return runDesktop(platform);
}

mkdirSync(dir, { recursive: true });
app.setPath('userData', dir);
if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(start).catch(() => {
  console.error('codingSchedule failed to start');
  app.exit(1);
});
