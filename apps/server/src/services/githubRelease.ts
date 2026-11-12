/**
 * GitHub Releases check + pull into local upgrades dir (store-style self-check).
 * "Delta" = skip assets already present with matching size (and sha when .sha256 exists).
 * Does not invent releases; fails closed when GitHub unreachable.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GITHUB_API_RELEASES_LATEST, GITHUB_RELEASES_BASE } from '@classroom-desk/shared';
import { getDataDir, openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { createRequire } from 'node:module';
import { upsertSetting } from './exitLock.js';

const requireJson = createRequire(import.meta.url);
function packageVersion(): string {
  try {
    const pkg = requireJson('../../../../package.json') as { version?: string };
    return String(pkg.version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

export type ReleaseAsset = {
  name: string;
  size: number;
  browserDownloadUrl: string;
  contentType?: string;
};

export type LatestReleaseInfo = {
  tag: string;
  name: string;
  htmlUrl: string;
  publishedAt: string | null;
  assets: ReleaseAsset[];
  checkedAt: string;
};

const CACHE_KEY = 'release_latest_cache_json';
const CHECKED_KEY = 'release_latest_checked_at';
const AVAILABLE_KEY = 'release_update_available';

let pollTimer: ReturnType<typeof setInterval> | null = null;

function upgradesDir(): string {
  return process.env.CLASSROOM_DESK_UPGRADES_DIR
    ? path.resolve(process.env.CLASSROOM_DESK_UPGRADES_DIR)
    : path.join(getDataDir(), 'upgrades');
}

function normalizeTag(tag: string): string {
  return String(tag ?? '')
    .trim()
    .replace(/^v/i, '');
}

export function compareSemver(a: string, b: string): number {
  const pa = normalizeTag(a)
    .split('.')
    .map((x) => Number(x) || 0);
  const pb = normalizeTag(b)
    .split('.')
    .map((x) => Number(x) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function isSetupAssetName(name: string): boolean {
  return /\.exe$/i.test(name) && (/Setup/i.test(name) || /ClassroomDesk/i.test(name));
}

export function isReleaseSideAsset(name: string): boolean {
  if (/\.sha256$/i.test(name)) return true;
  if (/\.blockmap$/i.test(name)) return true; // electron-builder blockmap (future delta)
  if (/\.exe\.sha256$/i.test(name)) return true;
  return false;
}

export async function fetchLatestGithubRelease(): Promise<LatestReleaseInfo> {
  const url = process.env.CLASSROOM_DESK_RELEASE_API_URL || GITHUB_API_RELEASES_LATEST;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'classroom-desk-server',
  };
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`github_release_http_${res.status}`);
  }
  const body = (await res.json()) as {
    tag_name?: string;
    name?: string;
    html_url?: string;
    published_at?: string;
    assets?: Array<{
      name?: string;
      size?: number;
      browser_download_url?: string;
      content_type?: string;
    }>;
  };
  const tag = String(body.tag_name ?? '').trim();
  if (!tag) throw new Error('github_release_missing_tag');
  const assets: ReleaseAsset[] = (body.assets ?? [])
    .map((a) => ({
      name: String(a.name ?? '').trim(),
      size: Number(a.size ?? 0),
      browserDownloadUrl: String(a.browser_download_url ?? '').trim(),
      contentType: a.content_type,
    }))
    .filter((a) => a.name && a.browserDownloadUrl);

  const info: LatestReleaseInfo = {
    tag,
    name: String(body.name ?? tag).trim(),
    htmlUrl: String(body.html_url ?? `${GITHUB_RELEASES_BASE}/tag/${tag}`).trim(),
    publishedAt: body.published_at ? String(body.published_at) : null,
    assets,
    checkedAt: new Date().toISOString(),
  };
  return info;
}

export function cacheLatestRelease(info: LatestReleaseInfo, db = openDb()): void {
  upsertSetting(db, CACHE_KEY, JSON.stringify(info));
  upsertSetting(db, CHECKED_KEY, info.checkedAt);
  const local = packageVersion();
  const newer = compareSemver(info.tag, local) > 0;
  upsertSetting(db, AVAILABLE_KEY, newer ? '1' : '0');
}

export function readCachedRelease(db = openDb()): LatestReleaseInfo | null {
  const raw = getSetting(db, CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LatestReleaseInfo;
  } catch {
    return null;
  }
}

export async function checkLatestRelease(opts?: { force?: boolean }): Promise<{
  localVersion: string;
  latest: LatestReleaseInfo;
  updateAvailable: boolean;
  fromCache: boolean;
}> {
  const db = openDb();
  const localVersion = packageVersion();
  const checkedAt = getSetting(db, CHECKED_KEY);
  const cached = readCachedRelease(db);
  const maxAgeMs = Number(process.env.CLASSROOM_DESK_RELEASE_CHECK_MS ?? 6 * 60 * 60 * 1000);
  const ageOk =
    !opts?.force &&
    cached &&
    checkedAt &&
    Date.now() - new Date(checkedAt).getTime() < maxAgeMs;

  let latest = cached;
  let fromCache = false;
  if (ageOk && latest) {
    fromCache = true;
  } else {
    latest = await fetchLatestGithubRelease();
    cacheLatestRelease(latest, db);
  }

  const updateAvailable = compareSemver(latest.tag, localVersion) > 0;
  upsertSetting(db, AVAILABLE_KEY, updateAvailable ? '1' : '0');
  return { localVersion, latest, updateAvailable, fromCache };
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const headers: Record<string, string> = {
    Accept: 'application/octet-stream',
    'User-Agent': 'classroom-desk-server',
  };
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download_http_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
}

function localSha256(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseShaFile(text: string): string | null {
  const first = text.trim().split(/\s+/)[0];
  return first ? first.toLowerCase() : null;
}

export type PullReleaseResult = {
  tag: string;
  downloaded: string[];
  skipped: Array<{ name: string; reason: string }>;
  pruned: string[];
  studentAutoUpdate: boolean;
  preferredLan: { x64: string | null; arm64: string | null };
};

/**
 * Pull Setup (+ .sha256 / .blockmap) from latest Release into upgrades/.
 * Skips files that already exist with same size (and matching .sha256 when present).
 */
export async function pullLatestReleaseToUpgrades(opts?: {
  arches?: Array<'x64' | 'arm64'>;
}): Promise<PullReleaseResult> {
  const { latest } = await checkLatestRelease({ force: true });
  const dir = upgradesDir();
  fs.mkdirSync(dir, { recursive: true });

  const arches = opts?.arches?.length ? opts.arches : (['x64', 'arm64'] as const);
  const want = (name: string) => {
    if (isSetupAssetName(name)) {
      if (arches.includes('arm64') && /arm64/i.test(name)) return true;
      if (arches.includes('x64') && (/x64|amd64/i.test(name) || /ClassroomDesk-Setup-[\d.]+\.exe$/i.test(name)))
        return true;
      // unnamed arch setup: treat as x64 if x64 wanted
      if (arches.includes('x64') && !/arm64/i.test(name)) return true;
      return false;
    }
    if (isReleaseSideAsset(name)) {
      // keep side files for wanted setups
      return arches.some((a) => {
        if (a === 'arm64') return /arm64/i.test(name);
        return /x64|amd64/i.test(name) || (!/arm64/i.test(name) && /\.(sha256|blockmap)$/i.test(name));
      });
    }
    return false;
  };

  const candidates = latest.assets.filter((a) => want(a.name));
  const downloaded: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const asset of candidates) {
    const dest = path.join(dir, path.basename(asset.name));
    if (fs.existsSync(dest)) {
      const st = fs.statSync(dest);
      if (st.size === asset.size && asset.size > 0) {
        const shaSide = `${dest}.sha256`;
        if (/\.exe$/i.test(asset.name) && fs.existsSync(shaSide)) {
          const expected = parseShaFile(fs.readFileSync(shaSide, 'utf8'));
          const actual = localSha256(dest);
          if (expected && expected === actual) {
            skipped.push({ name: asset.name, reason: 'same_size_and_sha' });
            continue;
          }
        } else if (!/\.exe$/i.test(asset.name)) {
          skipped.push({ name: asset.name, reason: 'same_size' });
          continue;
        } else {
          skipped.push({ name: asset.name, reason: 'same_size' });
          continue;
        }
      }
    }
    await downloadFile(asset.browserDownloadUrl, dest);
    downloaded.push(asset.name);
    if (/\.exe$/i.test(asset.name) && !fs.existsSync(`${dest}.sha256`)) {
      const hash = localSha256(dest);
      fs.writeFileSync(`${dest}.sha256`, `${hash}  ${path.basename(dest)}\n`, 'utf8');
    }
  }

  // Ensure sha256 for any exe without side file
  for (const name of fs.readdirSync(dir)) {
    if (!/\.exe$/i.test(name)) continue;
    const full = path.join(dir, name);
    const side = `${full}.sha256`;
    if (!fs.existsSync(side)) {
      fs.writeFileSync(side, `${localSha256(full)}  ${name}\n`, 'utf8');
    }
  }

  const db = openDb();
  upsertSetting(db, 'student_auto_update', '1');
  const { pruneOldSetupExes } = await import('../routes/upgrades.js');
  const pruned = pruneOldSetupExes();

  const setups = fs
    .readdirSync(dir)
    .filter((n) => isSetupAssetName(n))
    .sort();
  const pick = (arch: 'x64' | 'arm64') =>
    setups.find((n) => (arch === 'arm64' ? /arm64/i.test(n) : /x64|amd64/i.test(n) || !/arm64/i.test(n))) ??
    null;

  return {
    tag: latest.tag,
    downloaded,
    skipped,
    pruned,
    studentAutoUpdate: true,
    preferredLan: { x64: pick('x64'), arm64: pick('arm64') },
  };
}

export function getReleaseStatusSummary(db = openDb()) {
  const cached = readCachedRelease(db);
  const localVersion = packageVersion();
  const checkedAt = getSetting(db, CHECKED_KEY);
  const updateAvailable = (getSetting(db, AVAILABLE_KEY) ?? '0') === '1';
  return {
    localVersion,
    checkedAt,
    updateAvailable,
    latest: cached
      ? {
          tag: cached.tag,
          name: cached.name,
          htmlUrl: cached.htmlUrl,
          publishedAt: cached.publishedAt,
          setupAssets: cached.assets
            .filter((a) => isSetupAssetName(a.name))
            .map((a) => ({ name: a.name, size: a.size })),
        }
      : null,
  };
}

export function startReleaseCheckScheduler() {
  if (pollTimer) return;
  const ms = Number(process.env.CLASSROOM_DESK_RELEASE_CHECK_MS ?? 6 * 60 * 60 * 1000);
  const tick = () => {
    void checkLatestRelease({ force: false }).catch((err) => {
      console.warn('[release-check]', err instanceof Error ? err.message : err);
    });
  };
  // defer first check so boot isn't blocked on GitHub
  setTimeout(tick, 15_000);
  pollTimer = setInterval(tick, Math.max(60_000, ms));
}

export function stopReleaseCheckScheduler() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
