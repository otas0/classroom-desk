import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PREFIX = 'cd-export-';
const tracked = new Set<string>();

/** Register a temp export path while streaming; unlink removes it. */
export function trackExportTemp(filePath: string): void {
  tracked.add(path.resolve(filePath));
}

export function untrackExportTemp(filePath: string): void {
  tracked.delete(path.resolve(filePath));
}

export type ExportTempStats = {
  trackedOpen: number;
  tmpLeaked: number;
  tmpLeakedSample: string[];
};

/** Count cd-export-* files left in os.tmpdir (possible leaks if >0 after requests settle). */
export function exportTempStats(): ExportTempStats {
  let tmpLeaked = 0;
  const sample: string[] = [];
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(PREFIX)) continue;
      const full = path.join(os.tmpdir(), name);
      try {
        const st = fs.statSync(full);
        // Ignore brand-new files (<30s) that may still be in flight
        if (Date.now() - st.mtimeMs < 30_000) continue;
        tmpLeaked += 1;
        if (sample.length < 5) sample.push(name);
      } catch {
        /* gone */
      }
    }
  } catch {
    /* tmp unreadable */
  }
  return {
    trackedOpen: tracked.size,
    tmpLeaked,
    tmpLeakedSample: sample,
  };
}
