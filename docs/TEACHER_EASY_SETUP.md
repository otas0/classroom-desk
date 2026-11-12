# Teacher host — easiest install (Windows)

One admin step. No git. Portable Node is downloaded into the install folder.

## Fastest (copy-paste)

**Right-click Start → Windows PowerShell (Admin)**, paste:

```powershell
irm https://raw.githubusercontent.com/otas0/classroom-desk/main/install-teacher.ps1 -OutFile $env:TEMP\install-teacher.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\install-teacher.ps1
```

Until `main` has this file, use the release tag (example):

```powershell
irm https://raw.githubusercontent.com/otas0/classroom-desk/v0.1.8/install-teacher.ps1 -OutFile $env:TEMP\install-teacher.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\install-teacher.ps1
```

(If that 404s, this branch is not released yet — use the bat from a repo checkout below.)

## Or double-click

1. Get the repo folder (clone, or unzip a GitHub tag source).
2. Double-click **`Install-Teacher.bat`** (allow Admin).
3. Open **`Desktop\ClassroomDesk-Desk-Login.txt`** → browser `/admin/`.

Default folder for the online installer: **`C:\ClassroomDesk`**.

## What it does

1. Portable **Node 22** → `C:\ClassroomDesk\runtime\…`  
2. Latest GitHub Release **source zip** (no git)  
3. `.env` + **`ClassroomDesk-Desk-Login.txt`** on the Desktop  
4. `npm install` → fonts → build teacher UI  
5. Firewall **8787**, logon autostart, start API, open `/admin/`

Needs access to **GitHub** and **nodejs.org** (optional `GITHUB_TOKEN`).

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
