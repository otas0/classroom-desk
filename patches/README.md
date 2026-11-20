# Release patches (must ship in every latest pack)

Every `npm run pack` / GitHub Release **must** include all entries below.
Do not ship a “partial” teacher zip or student Setup that omits older patches.

| Patch | Artifact | Why |
| --- | --- | --- |
| Local API /health | `Service-Fix.exe` (`ClassroomDesk-Service-Fix-*-x64.exe`) | Teacher PC API not listening; also rejects Mac Node and re-downloads win-x64 |
| Windows Node only | Embedded in `install-teacher.ps1`, `fix-classroom-service.ps1`, `Start-ClassroomDesk.cmd`, `scripts/pack.mjs` | Never ship host Mac/Linux `node.exe` into teacher packs |

## Pack guarantees

1. `Service-Fix.exe` is built **before** Teacher-Setup and copied into:
   - `ClassroomDesk/patches/Service-Fix.exe` (inside Teacher-Setup + Dist zip)
   - `Give-To-Teacher/Service-Fix.exe`
   - `ClassroomDesk-Dist/ClassroomDesk-Service-Fix-*.exe`
2. Pack **fails** if Service-Fix is missing (no warn-and-skip).
3. Student `ClassroomDesk-Setup-*.exe` version matches root `package.json` when rebuilt for the same release.

When you add a new fix: put a row here, wire it into `scripts/pack.mjs` `REQUIRED_PATCHES`, and rebuild teacher + student for that version.
