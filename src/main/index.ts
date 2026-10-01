import {
  app,
  type BrowserWindow,
  ipcMain,
  Menu,
  MessageChannelMain,
  type MessagePortMain,
  nativeImage,
  screen,
  Tray,
} from 'electron';
import { InputSampler } from '../shared/sampler';
import { STAGE_H, STAGE_W, type PetCommand, type PetSnapshot } from '../shared/types';
import { SettingsStore } from './settings';
import { clampToWorkArea, createStageWindow, workAreaFor } from './stage';

/**
 * Main process (PLAN.md 3).
 *
 * Owns three things the renderer cannot: input (the hook is a Node addon and the
 * cursor point comes from Electron's screen module), time (a hidden renderer's
 * timers are unreliable and reminders have to fire regardless), and persistence.
 *
 * The renderer gets a read-only view of input and sends commands. That is the
 * whole contract.
 */

const FRAME_MS = 1000 / 60;
/** Cursor position bottom-right of the work area, nudged in from the edges. */
const EDGE_MARGIN = 24;

let store: SettingsStore;
let sampler: InputSampler;
let stage: BrowserWindow;
let tray: Tray | null = null;
let channel: MessagePortMain | null = null;
let timer: NodeJS.Timeout | null = null;

/** Physical screen position of the stage window's top-left. */
let windowPos: { x: number; y: number } = { x: 0, y: 0 };
let lastFrame = 0;

/** Set while the user is holding the cat: cursor-to-window grab offset. */
let dragGrab: { dx: number; dy: number } | null = null;

/** Latest snapshot, kept so a late-loading renderer can be primed. */
let latest: PetSnapshot;

if (!app.requestSingleInstanceLock()) {
  // Two cats on one desktop would fight each other for clicks.
  app.quit();
} else {
  void main();
}

async function main(): Promise<void> {
  await app.whenReady();

  store = new SettingsStore();
  sampler = new InputSampler();
  sampler.setHookActive(false);

  windowPos = restorePosition();
  stage = createStageWindow({ position: windowPos });

  const start = screen.getCursorScreenPoint();
  latest = sampler.update(0, ...toStageLocal(start));

  wireIpc();
  createTray();
  void startHook();
  startSampling();

  app.on('second-instance', () => stage.show());
  app.on('activate', () => stage.show());

  // A pet is a tray app: the stage window closing hides it rather than quitting.
  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    if (timer) clearInterval(timer);
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function wireIpc(): void {
  /**
   * The 60 Hz channel.
   *
   * A `MessageChannelMain` pair is created here and one end is transferred to the
   * renderer. Snapshots then stream over that port, so the per-frame cost is a
   * structured-clone post rather than an `invoke` round trip with its own
   * bookkeeping (PLAN.md 3).
   */
  ipcMain.on('pet:connect', (event) => {
    const { port1, port2 } = new MessageChannelMain();
    channel = port2;
    port2.start();
    event.sender.postMessage('pet:port', null, [port1]);
    port2.postMessage(latest);
  });

  ipcMain.handle('pet:init', () => ({ settings: store.current, snapshot: latest }));

  ipcMain.on('pet:command', (_event, command: PetCommand) => {
    switch (command.type) {
      case 'inputMode':
        // `forward: true` both ways. Forwarding while ignoring is what makes hover
        // detectable at all; forwarding while interactive is what makes a release
        // outside the window reach us.
        stage.setIgnoreMouseEvents(command.mode === 'passthrough', { forward: true });
        sampler.setInputMode(command.mode);
        break;
      case 'dragStart':
        // Record where inside the window the cat was grabbed, in *screen* px, so the
        // cat tracks the cursor from where it was picked up instead of jumping under
        // the pointer. The cursor arrives in stage-local coordinates, so convert back
        // through the window origin before subtracting.
        dragGrab = {
          dx: latest.cursor.x * stageScale() + stage.getContentBounds().x - windowPos.x,
          dy: latest.cursor.y * stageScale() + stage.getContentBounds().y - windowPos.y,
        };
        sampler.setDrag(true);
        break;
      case 'dragEnd':
        dragGrab = null;
        sampler.setDrag(false);
        break;
      case 'hide':
        stage.hide();
        break;
      case 'show':
        stage.show();
        break;
    }
  });
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Global input hooks, loaded lazily and optionally.
 *
 * `uiohook-napi` is a native addon: it can be missing (installed without rebuild
 * tools) or blocked by permissions (macOS Accessibility). Either way the app must
 * still run. Without it the app keeps cursor position, eye follow and local
 * dragging, and loses the system-wide reactions (typing, scroll) rather than
 * crashing (PLAN.md 3.4).
 *
 * One deliberate exception to "the hook only supplies system-wide reactions": the
 * global `mouseup` also *ends* drags. The renderer cannot see a release that
 * happens outside its window, and flicking the cat fast is exactly the case that
 * would otherwise leave the cat stuck to the cursor.
 */
async function startHook(): Promise<void> {
  try {
    const mod = (await import('uiohook-napi')) as unknown as {
      uIOhook: {
        on(event: string, cb: (arg?: { deltaY?: number }) => void): void;
        start(): void;
        stop(): void;
      };
    };
    const { uIOhook } = mod;

    // Counts only. The character never enters this process (PLAN.md 0.3).
    uIOhook.on('keydown', () => sampler.countKey());
    uIOhook.on('wheel', (e) => sampler.addWheel(e?.deltaY ?? 0));
    uIOhook.on('mouseup', () => {
      if (!dragGrab) return;
      dragGrab = null;
      sampler.setDrag(false);
    });

    uIOhook.start();
    sampler.setHookActive(true);
    app.on('before-quit', () => uIOhook.stop());
  } catch (err) {
    console.warn(
      `[input] global hook unavailable: ${(err as Error).message}. ` +
        'Running with local input only.',
    );
  }
}

// ---------------------------------------------------------------------------
// Sampling loop
// ---------------------------------------------------------------------------

function startSampling(): void {
  lastFrame = performance.now();
  timer = setInterval(tick, FRAME_MS);
}

function tick(): void {
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;

  // `getCursorScreenPoint` needs no hook, so the cursor and its speed are always
  // available. That is what keeps eye follow (02) working in degraded mode.
  const point = screen.getCursorScreenPoint();

  if (dragGrab) {
    const work = workAreaFor(point);
    const next = clampToWorkArea({ x: point.x - dragGrab.dx, y: point.y - dragGrab.dy }, work);
    const vx = (next.x - windowPos.x) / Math.max(dt, 1e-4);
    const vy = (next.y - windowPos.y) / Math.max(dt, 1e-4);
    windowPos = next;
    stage.setPosition(Math.round(next.x), Math.round(next.y), false);
    sampler.setDrag(true, vx, vy);
  }

  latest = sampler.update(dt, ...toStageLocal(point));
  channel?.postMessage(latest);
}

/** Physical px per logical px on this display. 1 unless the OS is scaling. */
function stageScale(): number {
  return stage.getContentBounds().width / STAGE_W || 1;
}

/**
 * Screen physical px -> stage-local logical px.
 *
 * This is the only place display geometry is known. The renderer receives cursor
 * coordinates it can use directly, which is why the hit test and eye direction
 * need no scale-factor arithmetic of their own.
 */
function toStageLocal(point: { x: number; y: number }): [number, number, boolean] {
  const bounds = stage.getContentBounds();
  const scale = stageScale();
  const x = (point.x - bounds.x) / scale;
  const y = (point.y - bounds.y) / scale;
  // Generous bounds: a cursor just outside the window still needs a plausible
  // position for the eyes to look at, and for the hit test to notice it leaving.
  const inside = x >= -64 && x <= STAGE_W + 64 && y >= -64 && y <= STAGE_H + 64;
  return [x, y, inside];
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function createTray(): void {
  try {
    tray = new Tray(
      nativeImage.createFromDataURL(
        // A 1x1 transparent PNG. The app ships no icon until M8 authors one; a
        // missing tray icon would leave the pet with no way back to the user.
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
          'AAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      ),
    );
  } catch {
    // Headless or sandboxed Linux session. The pet still runs from the window.
    tray = null;
    return;
  }
  refreshTray();
  tray.on('click', toggleStage);
}

function refreshTray(): void {
  const settings = store.current;
  tray?.setToolTip(`LittlePET - ${settings.petName || 'your cat'}`);
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: settings.petName || 'LittlePET', enabled: false },
      { type: 'separator' },
      { label: 'Show / hide', click: toggleStage },
      {
        label: 'Reactions',
        type: 'checkbox',
        checked: settings.reactionsEnabled,
        click: (item) => {
          store.patch({ reactionsEnabled: item.checked });
          refreshTray();
        },
      },
      { type: 'separator' },
      { label: 'Quit LittlePET', click: () => app.quit() },
    ]),
  );
}

function toggleStage(): void {
  if (stage.isVisible()) stage.hide();
  else stage.show();
}

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

function restorePosition(): { x: number; y: number } {
  // Bottom-right of the work area, sitting near the floor so the cat reads as
  // standing on something rather than floating in the middle of the screen.
  const work = screen.getPrimaryDisplay().workArea;
  return clampToWorkArea(
    {
      x: work.x + work.width - STAGE_W - EDGE_MARGIN,
      y: work.y + work.height - STAGE_H - 8,
    },
    work,
  );
}
