# Time to first class (SLA)

**Requirement:** configure Classroom Desk in **under 5 minutes**. Best effort **~1 minute** after Setup is already on the teacher PC.

## What “configure” means

Clock starts when **`Teacher-Setup.exe` is already on the teacher PC** (USB / LAN share / pre-copied).  
Clock ends when: teacher is in Admin, class exists, students can **Find classroom** (easy-join on).

Roster import time depends on the school CSV — keep a short list ready.

## Budget (USB / local copy — global schools)

| Step | Typical | Notes |
|------|---------|--------|
| Double-click Setup → copy to `C:\ClassroomDesk` | 20–60 s | SSD faster; ~300 MB unpack |
| Offline install (portable Node, no npm) | 5–15 s | Pack must be complete |
| API `/health` + open Admin | 3–10 s | Poll ≤ ~20 s worst case |
| Login (card password) | 15–30 s | No forced password change when installer set `TEACHER_PASSWORD` |
| Class already seeded as **本教室** + easy-join | 0 s | Created at first boot |
| Import roster | 30–90 s | Teacher action; use small CSV for smoke |
| Student opens install-card link (LAN) | 30–90 s | **LAN**, not public internet |
| **Total** | **~1–4 min** | Must stay **&lt; 5 min** |

## Global network download (NOT in the 5‑minute SLA)

| Artifact | Size (approx.) | 10 Mbps | 50 Mbps |
|----------|----------------|---------|---------|
| `Teacher-Setup.exe` | ~300 MB | ~4 min | ~50 s |
| `Student-Setup.exe` | ~120 MB | ~1.5 min | ~20 s |

Public CDN download of Teacher-Setup **alone** can exceed 5 minutes on slow international links.  

**For worldwide school fleets:** IT downloads **once**, then distributes **USB / school share**. Classroom PCs stay on the &lt;5 min local path (zero public network when the pack is complete).

## Must / must-not

- **Must:** complete product pack (`Test-ProductReady`) so install sets `CLASSROOM_DESK_OFFLINE=1` and never hits npm/GitHub mid-class.
- **Must:** students install from teacher LAN `/upgrades/` (pre-seeded).
- **Must not:** count GitHub Release pulls or `npm ci` into day-1 configure time.
- **Must not:** require DeskDNS / Shield / AA for first ordinary class (those are exam / max-secrecy).

## Verify

1. Copy `Give-To-Teacher` to a USB stick.  
2. On a clean teacher PC (no prior `C:\ClassroomDesk`), run `Teacher-Setup.exe` and time with a stopwatch.  
3. Log in → import a 5-row roster → one student Find classroom.  
4. Target: **&lt; 5:00**; stretch **~1:00–2:00** on SSD + ready CSV.
