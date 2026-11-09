import type { SetupRuntime } from '../integration/setup.js';
import type { DesktopUpdate, WidgetRect } from '../shared/ui-contract.js';
import type { LoginApi } from './login.js';

export type Point = { x: number; y: number };
export type Display = { bounds: WidgetRect; workArea: WidgetRect };
export interface WindowSurface {
  getBounds(): WidgetRect;
  setBounds(bounds: WidgetRect): void;
  setShape(rectangles: WidgetRect[]): void;
  setOpacity(opacity: number): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
  isFocused(): boolean;
  setFocusable(value: boolean): void;
  show(): void;
  hide(): void;
  focus(): void;
}

export interface DesktopPlatform {
  dir: string;
  legacyDir: string;
  autoDetect: boolean;
  executable: string;
  collectorPath: string;
  setup: SetupRuntime;
  login: LoginApi;
  loginAvailable: boolean;
  screen: {
    getPrimaryDisplay(): Display;
    getDisplayNearestPoint(point: Point): Display;
    getDisplayMatching(bounds: WidgetRect): Display;
    getCursorScreenPoint(): Point;
  };
  open(bounds: WidgetRect, listeners: {
    ready(): void;
    move(): void;
    command(command: unknown): Promise<unknown>;
  }): WindowSurface;
  load(): Promise<void>;
  send(message: DesktopUpdate): void;
  reveal(): void;
  tray(actions: { label: string; action(): void }[]): void;
  onSecondInstance(reveal: () => void): void;
  onDisplayChange(recover: () => void): void;
  onQuit(close: () => void): void;
  exit(code: number): void;
  error(title: string, message: string): void;
}
