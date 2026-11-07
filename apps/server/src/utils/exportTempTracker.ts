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
  tmpDir: string;
};

function listLeakedExportTemps(minAgeMs = 30_000): string[] {
  const leaked: string[] = [];
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(PREFIX)) continue;
      const full = path.join(os.tmpdir(), name);
      try {
        const st = fs.statSync(full);
        if (Date.now() - st.mtimeMs < minAgeMs) continue;
        leaked.push(full);
      } catch {
        /* gone */
      }
    }
  } catch {
    /* tmp unreadable */
  }
  return leaked;
}

/** Count cd-export-* files left in os.tmpdir (possible leaks if >0 after requests settle). */
export function exportTempStats(): ExportTempStats {
  const leaked = listLeakedExportTemps();
  return {
    trackedOpen: tracked.size,
    tmpLeaked: leaked.length,
    tmpLeakedSample: leaked.slice(0, 5).map((p) => path.basename(p)),
    tmpDir: os.tmpdir(),
  };
}

/** Unlink stale cd-export-* files (age ≥ minAgeMs). Does not touch in-flight tracked paths younger than threshold. */
export function cleanupExportTemps(minAgeMs = 30_000): {
  removed: number;
  failed: number;
  tmpDir: string;
  removedSample: string[];
} {
  const leaked = listLeakedExportTemps(minAgeMs);
  let removed = 0;
  let failed = 0;
  const removedSample: string[] = [];
  for (const full of leaked) {
    try {
      fs.unlinkSync(full);
      untrackExportTemp(full);
      removed += 1;
      if (removedSample.length < 8) removedSample.push(path.basename(full));
    } catch {
      failed += 1;
    }
  }
  return { removed, failed, tmpDir: os.tmpdir(), removedSample };
}
