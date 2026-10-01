import { contextBridge, ipcRenderer } from 'electron';
import type { PetCommand, PetSnapshot, Settings } from '../shared/types';
import type { LittlePetApi } from '../shared/api';

/**
 * The only bridge between the renderer's sandbox and the main process.
 *
 * Deliberately tiny and deliberately typed: the renderer gets a read-only view of
 * input and a way to send commands, and nothing else. No `ipcRenderer` is handed
 * over, no module system, no remote object - so a bug in the pet renderer cannot
 * reach the filesystem or spawn a process.
 *
 * The 60 Hz snapshot arrives over a `MessagePort`, not `invoke`: one channel with a
 * small object beats 60 round trips a second (PLAN.md 3).
 */
const api: LittlePetApi = {
  /**
   * Ask main for the snapshot channel.
   *
   * Main answers by transferring one end of a `MessageChannelMain` back over
   * `ipcMain`, so the 60 Hz stream never touches the slower request/reply path.
   */
  connect(): void {
    ipcRenderer.on('pet:port', (event) => {
      const port = event.ports[0];
      if (!port) return;
      port.onmessage = (message: MessageEvent<PetSnapshot>) => {
        api.__deliver(message.data);
      };
      port.start();
    });
    ipcRenderer.send('pet:connect');
  },

  /** Push a snapshot into the page. Internal: wired to the port above. */
  __deliver(snapshot: PetSnapshot): void {
    window.postMessage({ type: 'littlepet:snapshot', snapshot }, '*');
  },

  /** Renderer -> main. */
  send(command: PetCommand): void {
    ipcRenderer.send('pet:command', command);
  },

  /** One-time bootstrap: settings plus a snapshot to draw before the first tick. */
  init(): Promise<{ settings: Settings; snapshot: PetSnapshot }> {
    return ipcRenderer.invoke('pet:init');
  },
};

contextBridge.exposeInMainWorld('littlepet', api);
