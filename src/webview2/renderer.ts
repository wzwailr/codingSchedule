import type { DesktopUpdate, SettingsCommand, UiCommand } from '../shared/ui-contract.js';

declare global {
  interface Window {
  chrome: { webview: {
    postMessage(value: unknown): void;
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  } };
  }
}
const channel = window.chrome.webview;
const subscribers = new Set<(update: DesktopUpdate) => void>();
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
let next = 0;

channel.addEventListener('message', event => {
  const msg = event.data;
  if (msg?.type === 'emit') {
    for (const listener of subscribers) listener(msg.payload);
  } else if (msg?.type === 'reply') {
    const request = pending.get(msg.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(msg.id);
    if (msg.error) request.reject(new Error('操作未完成，请重试'));
    else request.resolve(msg.payload);
  }
});

window.schedule = Object.freeze({
  subscribeSnapshots(listener: (update: DesktopUpdate) => void) {
    subscribers.add(listener);
    channel.postMessage({ type: 'ready' });
    return () => { subscribers.delete(listener); };
  },
  dispatchUiCommand(command: UiCommand | SettingsCommand) {
    if (pending.size >= 256) return Promise.reject(new Error('操作过于频繁，请重试'));
    const id = ++next;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('等待操作响应超时')); }, 8000);
      pending.set(id, { resolve, reject, timer });
      channel.postMessage({ type: 'command', id, command });
    });
  }
});

// Evaluate the existing UI only after its host interface is available.
void import('../renderer/app.js');
