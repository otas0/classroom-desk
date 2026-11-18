# Time to first class (SLA)

**Requirement:** configure Classroom Desk in **under 5 minutes**. Best effort **~1 minute**.

## Paths that meet the SLA

### A) USB / school share (preferred worldwide)

Clock starts when **`Teacher-Setup.exe` is already on the teacher PC**.  
**0 public download** at class time. Typical **~1–2 min**.

### B) Public / slow link — **Teacher-Bootstrap.exe** (in SLA)

Clock starts when teacher downloads the **thin bootstrap** (few MB) from GitHub Release.  
Bootstrap pulls **one** `ClassroomDesk-*-win-x64.zip` via **mirrors + resume** (`curl -C -`), then installs.

| Link | Zip ~after slim | Expectation |
|------|-----------------|-------------|
| ≥10 Mbps | product zip | usually **&lt;5 min** end-to-end (resume if interrupted) |
| USB already staged zip | — | same as offline after copy |

Do **not** download the full ~300 MB `Teacher-Setup.exe` on a slow classroom link — use **Bootstrap** or USB.

## Day-1 teacher + student

1. Teacher: Setup/Bootstrap → Admin auto-login → **import roster**  
2. Students: Public Desktop install card → install → **open app** (auto-joins) → **tap your name**  
   - Resume days: one button **继续：姓名**

## Must / must-not

- **Must:** ship `Teacher-Bootstrap.exe` + Dist zip on Release for online schools.  
- **Must:** students install from teacher LAN `/upgrades/` (not public CDN).  
- **Must not:** require DeskDNS / Shield / AA for ordinary first class.
