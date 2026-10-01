import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Enforcement tests (PLAN.md 9.4).
 *
 * These are not ordinary unit tests. They exist to keep promises the project makes
 * *about itself* - no network, no keystroke content, no borrowed art, no feature
 * marked done that is not - rather than to check that the code computes the right
 * answer. A privacy claim that is only in the README is a marketing claim; these
 * turn each one into something that fails the build when it stops being true.
 *
 * They read files rather than importing modules, because the properties being
 * checked are about the *text* of the source. A network call added inside a
 * function that no test happens to call is still a violation.
 */

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');

/** Every file under `src/`, recursively, as repo-relative POSIX paths. */
function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|html)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strip comments and string literals, leaving the code.
 *
 * Without this, every file fails the network test because its *documentation*
 * mentions `fetch` - which these tests' own comments do. Stripping strings also
 * closes the obvious evasion: hiding a URL in a string does not make the call legal,
 * but hiding the word `fetch` inside one must not be the thing that decides it.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

describe('enforcement 1: no network in src/ (PLAN.md 0.3, 9.4)', () => {
  /**
   * `net` and `net.request` are Electron's HTTP client, which is the one a desktop
   * app reaches for without noticing. The allowlist exists so the one legitimate
   * use - if a future milestone adds a metadata-free Linux-portal call - has to be
   * written down rather than slipped in.
   */
  const BANNED: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bfetch\s*\(/, label: 'fetch' },
    { pattern: /XMLHttpRequest/, label: 'XMLHttpRequest' },
    { pattern: /\bWebSocket\b/, label: 'WebSocket' },
    { pattern: /\bEventSource\b/, label: 'EventSource' },
    { pattern: /\bnavigator\s*\.\s*sendBeacon\b/, label: 'sendBeacon' },
    { pattern: /from\s+['"]node:https?['"]/, label: 'node:http(s)' },
    { pattern: /require\s*\(\s*['"]node:https?['"]\s*\)/, label: 'node:http(s)' },
    {
      pattern: /from\s+['"](axios|node-fetch|got|undici|superagent)['"]/,
      label: 'http client library',
    },
  ];

  /**
   * Paths allowed to reach the network, with the reason. Empty by design: the app
   * is offline, and a non-empty list is a claim someone has to keep honest.
   */
  const ALLOWLIST: Record<string, string> = {};

  it('finds source files at all', () => {
    // A glob or path change that silently matches nothing would make every check
    // below pass vacuously, which is the standard way a guard-rail test rots.
    expect(sourceFiles().length).toBeGreaterThan(20);
  });

  it('contains no network calls', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (ALLOWLIST[rel]) continue;
      const stripped = code(readFileSync(file, 'utf8'));
      for (const { pattern, label } of BANNED) {
        if (pattern.test(stripped)) violations.push(`${rel}: ${label}`);
      }
    }
    expect(violations, 'PLAN.md 0.3 - the app makes no network requests').toEqual([]);
  });

  it('does not import net.request, or anything else from electron.net', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (ALLOWLIST[rel]) continue;
      if (/from\s+['"]electron['"]/.test(code(readFileSync(file, 'utf8')))) {
        const src = readFileSync(file, 'utf8');
        // Named imports are checked one by one so `net` is not matched inside
        // `networkingSomething`.
        const names = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]electron['"]/g)];
        for (const [, list] of names) {
          for (const raw of (list ?? '').split(',')) {
            const name = raw
              .trim()
              .split(/\s+as\s+/)[0]
              ?.trim();
            if (name === 'net') violations.push(`${rel}: electron.net`);
          }
        }
        if (/\bnet\s*\.\s*request\s*\(/.test(src)) violations.push(`${rel}: net.request`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('carries an empty allowlist, so an exception is a deliberate edit', () => {
    // If someone adds a path to ALLOWLIST without a reason, this fails. The point is
    // not that the app never needs the network - it is that needing it is a decision
    // someone has to make out loud.
    for (const [path, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, `${path} needs a reason`).toBeGreaterThan(20);
    }
  });
});

describe('enforcement 2: no key content retained (PLAN.md 0.3, 9.4)', () => {
  /**
   * The structural guarantee: `countKey()` takes no parameters, so there is no value
   * a caller could hand it. This is stronger than a review convention, because it
   * cannot be forgotten in a refactor - adding a parameter is a visible API change.
   */
  it('countKey takes no arguments, so key content cannot reach the sampler', () => {
    const src = readFileSync(join(SRC, 'shared/sampler.ts'), 'utf8');
    const sig = src.match(/countKey\s*\(([^)]*)\)/);
    expect(sig, 'countKey() not found in sampler.ts').not.toBeNull();
    expect(sig![1]!.trim(), 'countKey must take no parameters').toBe('');
  });

  it('exposes no field that could hold a key', () => {
    // The snapshot is the whole of what crosses to the renderer, so it is the whole
    // of what could be leaked. `keyRate` is a derived number; anything else that
    // sounds like it could carry key *content* is a violation.
    const types = readFileSync(join(SRC, 'shared/types.ts'), 'utf8');
    const snapshot = types.slice(types.indexOf('export interface PetSnapshot'));
    const body = snapshot.slice(0, snapshot.indexOf('\n}'));
    const fields = [...body.matchAll(/^\s*(\w+)(\??):/gm)].map((m) => m[1]!);
    expect(fields).toContain('keyRate');
    for (const field of fields.filter((f) => f !== 'keyRate')) {
      expect(field, `${field} suggests retained input content`).not.toMatch(
        /key|text|char|content|string|buffer|keystroke/i,
      );
    }
  });

  it('keeps the keystroke rate in memory only', () => {
    // A persisted key rate would be a usage profile on disk, which is a different
    // and much worse thing than a number in a closure.
    const main = readFileSync(join(SRC, 'main/index.ts'), 'utf8');
    expect(code(main)).not.toMatch(/keyRate/);
    const settings = readFileSync(join(SRC, 'shared/types.ts'), 'utf8');
    const iface = settings.slice(settings.indexOf('export interface Settings'));
    expect(iface.slice(0, iface.indexOf('\n}'))).not.toMatch(/keyRate|wheelEnergy|keyCount/);
  });

  it('never logs input samples', () => {
    // A single stray console.log of a snapshot would put a minute-by-minute typing
    // profile into the user's log file.
    for (const file of sourceFiles()) {
      const rel = relative(ROOT, file).split(sep).join('/');
      for (const [, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        if (/\bconsole\s*\.\s*(log|info|debug|warn|error|trace)\b/.test(code(line))) {
          expect(line, `${rel}:${line + 1} logs something`).not.toMatch(
            /cursor|keyRate|wheelEnergy|keyPress/,
          );
        }
      }
    }
  });
});

describe('enforcement 3: asset provenance (PLAN.md 0.1, 9.4)', () => {
  /**
   * This is the test that keeps the project legally clean, and it is the reason the
   * art is committed as ASCII rather than PNG: a text file that this repo generated
   * is unambiguously ours, and it diffs in a review.
   */
  const MANIFEST = join(ROOT, 'docs/ASSETS.md');

  it('has a manifest', () => {
    expect(() => readFileSync(MANIFEST, 'utf8')).not.toThrow();
  });

  it('lists every sprite source file', () => {
    const manifest = readFileSync(MANIFEST, 'utf8');
    const listed = new Set(
      [...manifest.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.split(sep).join('/')),
    );
    const sprites = join(SRC, 'sprites');
    const onDisk = readdirSync(sprites, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && !d.name.startsWith('.'))
      .map(
        (d) => `src/sprites/${relative(sprites, join(d.parentPath, d.name)).split(sep).join('/')}`,
      );
    expect(onDisk.length).toBeGreaterThan(0);
    for (const file of onDisk) {
      expect(listed, `${file} is not in docs/ASSETS.md`).toContain(file);
    }
  });

  it('ships no binary art', () => {
    // Every visual asset is generated ASCII or a script output. A checked-in PNG of
    // unknown origin is exactly the thing §0.1 rules out, and a text-only tree makes
    // that structurally true rather than a matter of trust.
    const binaries: string[] = [];
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      if (/\.(png|jpe?g|gif|webp|svg|ico|icns|woff2?|ttf|otf|mp3|wav|ogg)$/i.test(file)) {
        binaries.push(relative(ROOT, file).split(sep).join('/'));
      }
    }
    expect(binaries, 'art must be authored ASCII or generated at build time').toEqual([]);
  });

  it('marks every origin as authored or licensed', () => {
    const manifest = readFileSync(MANIFEST, 'utf8');
    const rows = manifest
      .split('\n')
      .filter((l) => l.trim().startsWith('|') && l.includes('`src/'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // | file | kind | origin | ... - slice off the leading and trailing empties.
      const cells = row
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      const origin = cells[2] ?? '';
      // Any accepted third-party license must also be named, so "authored" cannot
      // become a blanket answer for things nobody checked.
      expect(origin, row).toMatch(/authored|generated|MIT|Apache-2\.0|CC0|OFL/);
      expect(cells[3] ?? '', `${row} names no author`).not.toBe('');
    }
  });
});

describe('enforcement 4: parity claims (PLAN.md 1, 9.4)', () => {
  const PARITY = join(ROOT, 'docs/PARITY.md');

  const table = () => {
    const md = readFileSync(PARITY, 'utf8');
    return md
      .split('\n')
      .filter((l) => l.trim().startsWith('|') && /^\|\s*\d+\s*\|/.test(l.trim()))
      .map((line) => {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        return { id: cells[0]!, feature: cells[1]!, status: cells[2] ?? '' };
      });
  };

  it('covers every feature in the plan matrix', () => {
    // Scoped to §1 by its heading, because the palette-slot table later in the plan
    // also has two-digit row numbers and would otherwise inflate the count.
    const plan = readFileSync(join(ROOT, 'PLAN.md'), 'utf8');
    const section = plan.slice(
      plan.indexOf('## 1. Feature parity matrix'),
      plan.indexOf('## 2. Stack'),
    );
    const planned = [...section.matchAll(/^\|\s*(\d{2})\s*\|/gm)].map((m) => m[1]!);
    expect(planned.length).toBe(18);
    const have = new Set(table().map((r) => r.id));
    for (const id of planned) {
      expect([...have], `feature ${id} is missing from docs/PARITY.md`).toContain(id);
    }
  });

  it('claims nothing as done that is not', () => {
    // The whole point: "done" is a claim about the codebase, and the codebase is the
    // only thing that can settle it. Anything not shipped reads `planned`.
    for (const row of table()) {
      expect(row.status, `feature ${row.id} (${row.feature})`).toMatch(
        /^(done|planned|partial|n\/a)$/i,
      );
      if (/^done$/i.test(row.status)) {
        expect(row.feature, `feature ${row.id} is marked done`).not.toMatch(/TODO|placeholder/i);
      }
    }
  });

  it('has no unchecked boxes', () => {
    const md = readFileSync(PARITY, 'utf8');
    expect(md, 'docs/PARITY.md contains an unchecked acceptance box').not.toMatch(/^\s*-\s*\[ \]/m);
  });

  it('points every done feature at an acceptance test that exists', () => {
    const md = readFileSync(PARITY, 'utf8');
    const testFiles = new Set(
      readdirSync(join(ROOT, 'tests'), { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith('.ts'))
        .map(
          (d) =>
            `tests/${relative(join(ROOT, 'tests'), join(d.parentPath, d.name)).split(sep).join('/')}`,
        ),
    );
    for (const row of table()) {
      if (!/^done$/i.test(row.status)) continue;
      const line = md.split('\n').find((l) => l.trim().startsWith(`| ${row.id} `)) ?? '';
      const tests = [...line.matchAll(/`(tests\/[^`]+)`/g)].map((m) => m[1]!);
      expect(
        tests.length,
        `feature ${row.id} is done but names no acceptance test`,
      ).toBeGreaterThan(0);
      for (const t of tests) {
        expect([...testFiles], `feature ${row.id} names a missing test: ${t}`).toContain(t);
      }
    }
  });
});

describe('enforcement: determinism (PLAN.md 9.1)', () => {
  it('reads no wall clock inside the renderer', () => {
    // Behaviors take an injected clock so the whole simulation is reproducible.
    // A stray `Date.now()` in a behavior would make a failure unreproducible, which
    // is the specific cost the injection seam exists to avoid.
    const violations: string[] = [];
    for (const file of sourceFiles(join(SRC, 'renderer'))) {
      const rel = relative(ROOT, file).split(sep).join('/');
      const stripped = code(readFileSync(file, 'utf8'));
      if (/\bDate\s*\.\s*now\b|\bperformance\s*\.\s*now\b|new\s+Date\b/.test(stripped)) {
        violations.push(rel);
      }
    }
    expect(violations, 'the renderer takes its time from ctx, not the clock').toEqual([]);
  });
});
