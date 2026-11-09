const { app, BrowserWindow, utilityProcess, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const outDir = process.env.PROBE_OUTPUT_DIR || path.resolve('.artifacts/probe');
const interactive = process.argv.includes('--interactive');
app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: 320, height: 48, frame: false, show: false, focusable: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  const area = screen.getPrimaryDisplay().workArea;
  win.setPosition(area.x + area.width - 336, area.y + area.height - 64);
  ipcMain.on('probe:hover', (event, expanded) => {
    if (event.sender !== win.webContents) return;
    const height = expanded ? 220 : 48;
    const width = expanded ? 360 : 320;
    win.setBounds({ x: area.x + area.width - width - 16, y: area.y + area.height - height - 16, width, height });
  });
  await win.loadFile(path.join(__dirname, 'widget.html'));
  const worker = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [path.join(outDir, 'probe.db')], { stdio: 'pipe' });
  const sqlite = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SQLite worker timeout')), 10_000);
    worker.once('message', (message) => { clearTimeout(timer); resolve(message); });
    worker.once('exit', (code) => { if (code) reject(new Error('SQLite worker exit ' + code)); });
  });
  const prefs = win.webContents.getLastWebPreferences();
  const report = { electron: process.versions.electron, node: process.versions.node, utilityProcess: true, sqlite, nativeWindowId: win.getNativeWindowHandle().readBigUInt64LE().toString(), bounds: win.getBounds(), window: { nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, focusable: win.isFocusable(), alwaysOnTop: win.isAlwaysOnTop() }, displays: screen.getAllDisplays().map((d) => ({ scaleFactor: d.scaleFactor, workArea: d.workArea })), metrics: app.getAppMetrics().map((m) => ({ type: m.type, memory: m.memory, cpu: m.cpu })) };
  fs.writeFileSync(path.join(outDir, 'electron.json'), JSON.stringify(report, null, 2));
  worker.kill();
  if (interactive) win.showInactive();
  else { win.destroy(); app.quit(); }
}).catch((error) => { console.error(error); app.exit(1); });
