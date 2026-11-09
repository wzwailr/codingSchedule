import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { runDesktop } from '../desktop/controller.js';
import { assertProfileIdle } from '../desktop/profile.js';
import type { DesktopPlatform, Display, Point } from '../desktop/platform.js';
import type { WidgetRect } from '../shared/ui-contract.js';

process.env.UV_THREADPOOL_SIZE = '1';
const executable = process.argv[2];
const dir = process.argv[3];
if (!executable || !dir || !isAbsolute(executable) || !isAbsolute(dir)) process.exit(2);
const autoDetect = !process.argv.includes('--isolated');
const root = resolve(__dirname, '..');
const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const loginName = 'codingSchedule';
const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');

function existingLogin(): string | undefined {
  try {
    return execFileSync(reg, ['query', runKey, '/v', loginName], { windowsHide: true, encoding: 'utf8', timeout: 1500 })
      .match(/^\s*codingSchedule\s+REG_SZ\s+(.+)$/mi)?.[1]?.trim();
  } catch { return undefined; }
}

function send(type: string, payload?: unknown, extra: object = {}) {
  const line = JSON.stringify({ type, payload, ...extra });
  if (Buffer.byteLength(line) <= 2 * 1024 * 1024) process.stdout.write(`${line}\n`);
}

let displays: (Display & { primary: boolean })[] = [];
let cursor: Point = { x: 0, y: 0 };
let bounds: WidgetRect = { x: 0, y: 0, width: 148, height: 272 };
let visible = false, focused = false, domReady = false, started = false, exiting = false;
let listeners: Parameters<DesktopPlatform['open']>[1] | undefined;
let onDisplayChange: (() => void) | undefined;
let onQuit: (() => void) | undefined;
let tray: Parameters<DesktopPlatform['tray']>[0] = [];
const trayCommands = ['reveal', 'showFocused', 'openSettings', 'appearanceReset', 'retryCollector', 'hide'];

const show = () => { visible = true; send('show'); };
const hide = () => { visible = false; send('hide'); };
function primary() { return displays.find(display => display.primary) ?? displays[0]!; }
function nearest(point: Point) {
  let best = primary(), minimum = Infinity;
  for (const display of displays) {
    const b = display.bounds;
    const dx = Math.max(b.x - point.x, point.x - b.x - b.width + 1, 0);
    const dy = Math.max(b.y - point.y, point.y - b.y - b.height + 1, 0);
    const distance = dx * dx + dy * dy;
    if (distance < minimum) { best = display; minimum = distance; }
  }
  return best;
}
const platform: DesktopPlatform = {
  dir, legacyDir: join(process.env.APPDATA || join(homedir(), 'AppData/Roaming'), 'coding-schedule'), autoDetect, executable,
  collectorPath: join(root, 'collector/main.cjs'),
  setup: {
    dir, nodePath: process.execPath, bridgePath: join(root, 'bridge/main.cjs'),
    relayPath: join(root, 'bridge/mcp-relay.exe'), integrationsPath: join(root, 'integrations'), installRoot: dirname(executable)
  },
  loginAvailable: autoDetect,
  login: {
    getLoginItemSettings({ path }) { return { openAtLogin: existingLogin() === `"${path}"` }; },
    setLoginItemSettings({ path, openAtLogin }) {
      if (openAtLogin) execFileSync(reg, ['add', runKey, '/v', loginName, '/t', 'REG_SZ', '/d', `"${path}"`, '/f'], { windowsHide: true, timeout: 1500 });
      else if (existingLogin() === `"${path}"`) execFileSync(reg, ['delete', runKey, '/v', loginName, '/f'], { windowsHide: true, timeout: 1500 });
    }
  },
  screen: {
    getPrimaryDisplay: primary, getDisplayNearestPoint: nearest,
    getDisplayMatching(b) { return nearest({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); },
    getCursorScreenPoint() { return cursor; }
  },
  open(initialBounds, actions) {
    listeners = actions;
    bounds = initialBounds;
    send('bounds', bounds);
    return {
      getBounds: () => bounds,
      setBounds(value) { bounds = value; send('bounds', value); },
      setShape(value) { send('shape', value); },
      setOpacity(value) { send('opacity', value); },
      isVisible: () => visible, isDestroyed: () => exiting, isFocused: () => focused,
      setFocusable(value) { send('focusable', value); },
      focus() { send('focus'); }, show, hide
    };
  },
  async load() { if (domReady) { listeners?.ready(); send('ready'); } },
  send(update) { send('emit', update); },
  reveal: show,
  tray(actions) { tray = actions; },
  onSecondInstance() {},
  onDisplayChange(recover) { onDisplayChange = recover; },
  onQuit(close) { onQuit = close; },
  exit(code) {
    exiting = true;
    process.stdout.write(`${JSON.stringify({ type: 'exit', code })}\n`, () => process.exit(code));
  },
  error(title, message) { send('error', { title, message }); }
};

async function start() {
  try { await assertProfileIdle(dir!); await runDesktop(platform); }
  catch {
    platform.error('无法启动悬浮框', '请先退出使用同一数据目录的旧版悬浮框。若没有运行中的旧版，请核对数据目录和安装文件。');
    platform.exit(1);
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  if (exiting || line.length > 2 * 1024 * 1024) return;
  let incoming;
  try { incoming = JSON.parse(line); } catch { return; }
  switch (incoming.type) {
    case 'screens':
      if (!Array.isArray(incoming.displays) || !incoming.displays.length) return;
      displays = incoming.displays;
      if (!started) { started = true; void start(); }
      else onDisplayChange?.();
      break;
    case 'cursor': cursor = { x: incoming.x, y: incoming.y }; break;
    case 'tray': tray[trayCommands.indexOf(incoming.action)]?.action(); break;
    case 'quit': if (onQuit) onQuit(); else platform.exit(0); break;
    case 'web': {
      const msg = incoming.payload;
      if (msg?.type === 'ready') {
        domReady = true;
        if (listeners) { listeners.ready(); send('ready'); }
      } else if (msg?.type === 'command' && listeners && Number.isSafeInteger(msg.id) && msg.id > 0) {
        const id = msg.id;
        focused = incoming.focused === true;
        const reply = listeners.command(msg.command);
        focused = false;
        void reply.then(value => send('reply', value, { id }), () => send('reply', null, { id, error: true }));
      }
      break;
    }
  }
});
lines.once('close', () => { if (!exiting) { if (onQuit) onQuit(); else process.exit(1); } });
