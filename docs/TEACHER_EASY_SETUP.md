# Teacher host — easiest install (Windows)

One admin step. No git. Portable Node is downloaded into the install folder.

## Fastest (copy-paste)

**Right-click Start → Windows PowerShell (Admin)**, paste:

```powershell
irm https://raw.githubusercontent.com/otas0/classroom-desk/v0.1.10/install-teacher.ps1 -OutFile $env:TEMP\install-teacher.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\install-teacher.ps1
```

Or `main` after merge:

```powershell
irm https://raw.githubusercontent.com/otas0/classroom-desk/main/install-teacher.ps1 -OutFile $env:TEMP\install-teacher.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\install-teacher.ps1
```

## Or double-click (unzip — no git)

1. Download https://github.com/otas0/classroom-desk/archive/refs/tags/v0.1.10.zip (or newer tag).  
2. Unzip; open the folder that contains **`Install-Teacher.bat`**.  
3. Right-click **`Install-Teacher.bat`** → **Run as administrator**.  
4. If it fails: open Desktop **`ClassroomDesk-Install-Log.txt`** (last lines show the real error).  
5. On success: Desktop **`ClassroomDesk-Desk-Login.txt`** → `http://127.0.0.1:8787/admin/`.

Local unzip **skips re-downloading source** and **does not call GitHub API**. It still needs network for portable Node + `npm install` (uses **npmmirror** fallbacks).

Default folder for the *online* installer (no prior zip): **`C:\ClassroomDesk`**.

## What it does

1. Portable **Node 22** (nodejs.org → npmmirror fallback) into `runtime\`  
2. If folder already has source: use it; else download Release source zip  
3. `.env` + **`ClassroomDesk-Desk-Login.txt`** + install log on Desktop  
4. `npm install` (registry.npmmirror.com) → optional fonts → build teacher UI  
5. Firewall **8787**, logon autostart, start API, open `/admin/`

Needs network for Node/npm mirrors (optional `GITHUB_TOKEN` only if downloading source from GitHub).

## After install

| Step | Action |
|------|--------|
| Login | `teacher` + password in `ClassroomDesk-Desk-Login.txt` |
| Class | Create class / roster / assign seats |
| Students | [Releases](https://github.com/otas0/classroom-desk/releases) `ClassroomDesk-Setup-*.exe` → Find classroom |
| Updates | Settings → **One-click update (teacher host + student packages)** |

## Safety

This installer is **additive**: it does not change student/teacher app source. It downloads Release source + portable Node, then runs the same `npm run start:classroom` path as a manual install.

Repo check (CI/dev): `npm run verify:install-teacher` — English entrypoint names, required script markers, Node/GitHub zip URLs reachable, no `apps/`/`packages/` drift vs `origin/main` on this branch.

## If it still fails

- GitHub blocked → IT allowlist / `GITHUB_TOKEN` / USB pre-built folder  
- nodejs.org blocked → IT allowlist (script needs the portable zip)  
- Students cannot connect → [NETWORK.md](./NETWORK.md)  
- Manual / fixed IP: [CLASSROOM_TEACHER_HOST.md](./CLASSROOM_TEACHER_HOST.md)

One-pager: [CLASSROOM_DEPLOY_ONEPAGE.md](./CLASSROOM_DEPLOY_ONEPAGE.md)
