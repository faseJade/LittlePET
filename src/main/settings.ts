import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, type Settings } from '../shared/types';

/**
 * Settings persistence.
 *
 * A single JSON file, written atomically. No database, because a settings file
 * you can read and diff is worth more than query power for the four dozen values
 * this app has.
 *
 * Atomic means write-to-temp then rename: a crash mid-write leaves the previous
 * good file intact rather than a truncated one that would reset a user's pet.
 */
export class SettingsStore {
  private readonly path: string;
  private data: Settings;

  constructor(fileName = 'settings.json') {
    this.path = join(app.getPath('userData'), fileName);
    this.data = load(this.path);
  }

  get current(): Settings {
    return this.data;
  }

  /** Replace the whole object and persist. */
  set(next: Settings): void {
    this.data = { ...next, schemaVersion: SETTINGS_VERSION };
    save(this.path, this.data);
  }

  /** Patch a subset and persist. Cheaper to call than `set` for one field. */
  patch(partial: Partial<Settings>): Settings {
    this.data = { ...this.data, ...partial, schemaVersion: SETTINGS_VERSION };
    save(this.path, this.data);
    return this.data;
  }

  /** Export for the config hand-off that replaces multi-device sync (feature 17). */
  export(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /** Import a config. Unknown fields are dropped by the type, bad JSON throws. */
  import(json: string): Settings {
    const parsed = JSON.parse(json) as Partial<Settings>;
    this.data = { ...DEFAULT_SETTINGS, ...parsed, schemaVersion: SETTINGS_VERSION };
    save(this.path, this.data);
    return this.data;
  }
}

function load(path: string): Settings {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Settings>;
    // Merge over defaults so a file written by an older version - or hand-edited
    // with fields missing - still starts.
    return { ...DEFAULT_SETTINGS, ...raw, schemaVersion: SETTINGS_VERSION };
  } catch {
    // Missing or corrupt: start from defaults rather than refusing to launch.
    return { ...DEFAULT_SETTINGS };
  }
}

function save(path: string, data: Settings): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmp, path);
  } catch (err) {
    // Persistence is best-effort. Failing to write settings must never take the
    // pet off the user's desktop.
    console.error('[settings] could not persist:', (err as Error).message);
  }
}
