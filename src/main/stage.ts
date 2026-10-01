import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { STAGE_H, STAGE_W } from '../shared/types';

/**
 * The stage window (PLAN.md 3.1).
 *
 * One transparent, always-on-top, non-focusable window holds the cat and all its
 * UI furniture. One window, not several, so a speech bubble and the cat are
 * composited in the same pass and cannot z-fight.
 *
 * `focusable: false` is the important one: the cat must never steal focus from a
 * window the user is typing in. It also means we cannot rely on keyboard input
 * reaching the window, which is why the hook lives in main.
 */
export function createStageWindow(options: { position: { x: number; y: number } }): BrowserWindow {
  const win = new BrowserWindow({
    ...options.position,
    width: STAGE_W,
    height: STAGE_H,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: true,
    // Above fullscreen apps, which is what makes the cat visible while watching
    // a video.
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    // macOS: without this the first click on a non-focusable window is eaten.
    acceptFirstMouse: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A hidden offscreen-ish window should never be throttled into 1 Hz, which
      // would stall the animation loop even though the window is "visible".
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Click-through is the resting state: the window covers 320x240 of screen and
  // must not eat clicks meant for what is underneath. The renderer tells us when
  // the cursor is actually over the cat.
  //
  // `forward: true` is mandatory in both directions (PLAN.md 3.2): without it,
  // ignoring events would also stop `mousemove` from reaching the renderer, and
  // hover detection would be impossible while click-through.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(join(__dirname, '../renderer/pet.html'));
  return win;
}

/** Working area of the display the given point is on, in physical px. */
export function workAreaFor(point: { x: number; y: number }) {
  const display = screen.getDisplayNearestPoint(point);
  return display.workArea;
}

/** Clamp a position so the cat cannot be dragged off into unreachable space. */
export function clampToWorkArea(
  pos: { x: number; y: number },
  work: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  return {
    // Leave the whole window on-screen: a partly-off-screen window cannot be
    // clicked on the visible side only, and a fully-off-screen one is a lost pet.
    x: clamp(pos.x, work.x, work.x + work.width - STAGE_W),
    y: clamp(pos.y, work.y, work.y + work.height - STAGE_H),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  // If the work area is smaller than the stage (rare, but possible on a tiny
  // display or a scaled-down virtual desktop) the bounds cross over.
  return hi < lo ? lo : v < lo ? lo : v > hi ? hi : v;
}
