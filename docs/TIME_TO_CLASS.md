# Time to first class (SLA)

**Requirement:** configure Classroom Desk in **under 5 minutes**. Best effort **~1 minute**.

## Paths that meet the SLA

### A) USB / school share (preferred)

Clock starts when **`Teacher-Setup.exe` is already on the teacher PC**.  
**0 public download** at class time. Typical **~1–2 min**.

GitHub Release → download Teacher-Setup once to USB/IT share → classrooms stay offline for install.

### B) School net blocks Node MSI

Still use **Teacher-Setup.exe**. In the wizard choose **Use Node already on this PC** (Detect / Browse), or install Node 22 LTS from [nodejs.org](https://nodejs.org/en/download) on a working link / USB, then Browse to `node.exe`.

### C) IT thin bootstrap (Advanced only — not on GitHub Release)

`Give-To-Teacher/Advanced/Teacher-Bootstrap.exe` pulls **one** Dist zip that **IT built** with `npm run pack` and hosts themselves.  
**Dist zip and Bootstrap are not GitHub Release assets** — see [IT_REPAIR_CHAIN.md](./IT_REPAIR_CHAIN.md).

## Day-1 teacher + student

1. Teacher: Teacher-Setup → Admin → **import roster**  
2. Students: Public Desktop install card → install → **open app** → **tap your name**

## Must / must-not

- **Must:** ship matching student `ClassroomDesk-Setup-<ver>-x64.exe` inside every Teacher-Setup pack (`npm run pack` hard-fails if missing).  
- **Must:** students install from teacher LAN `/upgrades/` (not public CDN).  
- **Must not:** tell teachers to download Dist zip / Bootstrap from GitHub Release.  
- **Must not:** require DeskDNS / Shield / AA for ordinary first class.
