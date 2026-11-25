# Release patches (must ship in every latest pack)

Every `npm run pack` / GitHub Release **must** include all entries below.
Do not ship a “partial” teacher zip or student Setup that omits older patches.

| Patch | Artifact | Why |
| --- | --- | --- |
| Local API /health | `Service-Fix.exe` (`ClassroomDesk-Service-Fix-*-x64.exe`) | Teacher PC API not listening; also rejects Mac Node and re-downloads win-x64 |
| Windows Node only | `ensure-windows-node.ps1` — MSI (or user `node.exe` / `node-path.txt`); never zip; Setup wizard is the entry | Auto MSI or pick existing Node; Start reuses `node-path.txt` |
| Win deps / no Mac esbuild | `pack:teacher-host` + Dist `npm install --os=win32 --cpu=x64`; server starts from `dist/index.mjs` (no `tsx`) | Mac-packed `node_modules` crashed Windows with missing `@esbuild/win32-x64` |
| Default login teacher/admin | `Reset-Teacher-Login.bat` (+ `reset-teacher-login.ps1` / `.mjs`) | New installs default to `teacher`/`admin`; double-click bat on old installs to reset; Admin forces change in 设置 |
| Daily start (exe) | `ClassroomDesk.exe` | One double-click: force Windows Node + start API + open Admin; Setup creates Desktop **Classroom Desk.lnk** |
| Teacher repair (exe) | `Teacher-Fix.exe` | One double-click: force Windows Node + reset `teacher`/`admin`; Desktop **Classroom Desk Fix.lnk** |

Teacher-facing EXE guide (GitHub): [`docs/TEACHER_EXES.md`](../docs/TEACHER_EXES.md).

## Pack guarantees

1. `Service-Fix.exe` / `ClassroomDesk.exe` / `Teacher-Fix.exe` are built **before** Teacher-Setup and copied into:
   - `ClassroomDesk/patches/` (inside Teacher-Setup payload)
   - `Give-To-Teacher/Advanced/` (IT only — **not** uploaded to GitHub Release)
2. Pack **fails** if required patches are missing (no warn-and-skip).
3. GitHub Release publishes **only** Teacher-Setup + Student-Setup (see `docs/RELEASE_BUNDLE.md`).
4. Student `ClassroomDesk-Setup-*.exe` version matches root `package.json`; **`npm run pack` hard-fails** if that Setup is missing.
5. Teacher-Setup payload embeds `IT-ONLY-REPAIR.txt` — Bootstrap / Dist zip are **not** on GitHub Release.

When you add a new fix: put a row here, wire it into `scripts/pack.mjs` `REQUIRED_PATCHES`, and rebuild teacher + student for that version.

## Reset-Teacher-Login (standalone drop-in)

Copy `Reset-Teacher-Login.bat`, `reset-teacher-login.ps1`, and `reset-teacher-login.mjs` into `C:\ClassroomDesk`, then double-click the bat. Details: [`docs/RESET_TEACHER_LOGIN.md`](../docs/RESET_TEACHER_LOGIN.md).
