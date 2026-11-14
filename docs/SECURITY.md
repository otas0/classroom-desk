# Security & Compliance Notes

Classroom Desk is a **school-deployed** classroom tool on **school-owned lab PCs** (not student BYOD). Students and school IT are informed of its purpose. Visible locks and banners are intentional.

## Allowed

- Visible Electron process (`skipTaskbar: false`)
- Always-on-top small widget (not fullscreen) — **except** teacher-armed deep-lock freeze / exam shell (fullscreen, visible banners)
- Login-item autostart via Electron APIs
- In-app presence heartbeat for attendance (login + online in this app only)
- Admin password (bcrypt in settings) for quit / uninstall guidance / disable autostart
- Teacher-armed deep-lock on **school lab agents**: terminate common browsers/chat/game processes, focus steal, secondary-display blackout, exam-shell host allowlist (students see banners; IT-documented)
- **OS-level** kiosk lockdown via school **Assigned Access / Intune / GPO** (hide Task Manager, block Alt+Tab / Win, USB deny) — required for production exam lock on lab PCs

## School lab production (required)

Exam / freeze lock on school machines is incomplete without L3:

| Control | Who | How |
|---|---|---|
| Alt+Tab / Win / desktop switch | School IT | Assigned Access single-app kiosk |
| Task Manager end-task / HideTaskManager | School IT | AA + Intune trial XML (`docs/intune-student-kiosk.example.xml`) |
| USB write/execute deny (optional) | School IT | Same Intune profile; rollback with `intune-student-kiosk.rollback.xml` |

Evidence: `npm run init:c2-evidence` → fill on Windows samples → `npm run verify:c2-evidence`. See [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md), [C2_EVIDENCE_ARCHIVE.md](./C2_EVIDENCE_ARCHIVE.md).

Without AA/Intune, students can still Alt+Tab or kill the process — that is an **incomplete school deployment**, not a supported production posture.

「最高保密级」= **L3 Assigned Access（单应用→学生端）** → **DeskDNS/防火墙 deny** → **拉黑 + 一键武装** →（考场需要时）**考试壳 allowlist**。详见 [SECURITY_CUSTODY.md](./SECURITY_CUSTODY.md) 官方加固阶梯。The product will not add keyloggers, anti-kill drivers, or hidden processes to fake OS lockdown.

## Forbidden (even on school-owned PCs)

School ownership does **not** authorize covert spyware. Still forbidden:

- Hidden or disguised processes
- Keylogging / clipboard monitoring / silent screenshot or camera surveillance
- Undisclosed screen / keyboard / mic capture
- App-level Task Manager blocking hooks, anti-kill drivers, or privilege-escalation tricks
- Anti-uninstall / anti-kill persistence that bypasses OS / Defender
- Silent OS takeover **without** school MDM / Assigned Access
- Bypass SmartScreen / Defender as a product “feature”
- Undisclosed backdoor unlock codes

System hotkeys and Task Manager must be constrained by **MDM / Assigned Access** (L3), not by injecting into other processes from this app.

## Admin password

Store only a bcrypt hash in `settings.admin_password_hash` (or env override). Never hardcode plaintext passwords in source.
