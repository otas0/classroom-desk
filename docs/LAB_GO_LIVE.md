# Lab go-live (one page)

Print or keep beside **`Give-To-Teacher`**. Do this **before** copying the pack to every classroom.

Product UI: 上课页 **机房上线门禁（最高保密级）** → `GET /api/v1/ops/lab-go-live`.  
Without a green gate, the product **refuses to claim sealed custody**:

- **「一键武装最高保密级」** / 全班连坐 offline policy → `403 lab_go_live_blocked`
- **深锁** first transition to freeze / exam_net / kick / deny patch → same `403` (re-assert while already locked is allowed)
- Schedule quiz deep-lock apply is **skipped** (audit `deep_lock.schedule_blocked`) until the gate is green
- Saving Shield `mock` is rejected unless `CLASSROOM_DESK_ALLOW_SHIELD_MOCK=1`; env `CLASSROOM_DESK_SHIELD=mock` falls back to **off** without that flag

## 0. Five gaps that unblock real custody

| Gap | Why | What “done” means |
|-----|-----|-------------------|
| **AA + Intune (L3)** | Alt+Tab / Task Manager still escape app custody | IT configures Assigned Access; teacher declares on red banner; online students report `hardened` |
| **DeskDNS / firewall on path** | Checkbox alone does not filter DNS | DeskDNS **listening** + DHCP DNS → teacher (or campus deny). Probe: 部署 DeskDNS → 检测 |
| **Windows :53** | System DNS often owns UDP/53 | Prefer **5353** + router non-standard DNS, or **Linux / Exam Box** on 53 — see [DESKDNS_PORT53.md](./DESKDNS_PORT53.md) |
| **Shield real gateway** | `off` / `mock` never cut the wire | Settings → Shield = `opnsense` / `unifi` / `http`. Saving `mock` is rejected unless `CLASSROOM_DESK_ALLOW_SHIELD_MOCK=1` |
| **Ops baseline** | Flaky IP / AV / guest Wi‑Fi / no backup | Fixed teacher IP · AV allowlist (do **not** turn Defender off) · DB backup · no guest isolation |

## 1. Pilot one teacher PC first

1. Install with `Teacher-Setup.exe` on **one** machine.
2. Run every box in `SMOKE-CHECK.txt`.
3. Only then copy `Give-To-Teacher` to other rooms.

## 2. Fixed LAN IP on the teacher PC

Student `/upgrades/` links and “Find classroom” break when DHCP changes the teacher IP.

- Prefer **Ethernet** on the teacher PC.
- Set a **static IPv4** on that NIC, **or** a DHCP reservation on the router.
- Helper (IT): `scripts/windows-set-fixed-ip.ps1` on a machine that already has the product pack.
- After changing IP: re-open / re-share `ClassroomDesk-Student-Install.txt`.
- Tick **教师机已固定 IP** on the lab go-live panel (and set advertise LAN IP in settings).

## 3. Antivirus allowlist (do not turn Defender off)

Allow (or “exclude from scan”) at least:

- `C:\ClassroomDesk\`
- `Teacher-Setup.exe` / `Student-Setup.exe` (the copies you distribute)

Unsigned builds may still show **SmartScreen → More info → Run anyway**. That is expected until binaries are Authenticode-signed. Never instruct staff to disable Defender/SmartScreen globally.

Tick **杀软已放行** on the lab go-live panel after IT does this.

## 4. Backup the classroom database

Re-install keeps data on disk; a dead disk does not.

Copy on a schedule (USB / school share):

`C:\ClassroomDesk\apps\server\data\classroom.db`

(Optional: whole `apps\server\data\` folder.)  
Or 设置 → **立即备份**. Gate requires a backup file ≤ 7 days old.

## 5. Updates

| Change | How |
|--------|-----|
| New major teacher host | New `Teacher-Setup.exe` from release / `npm run pack` |
| Student app | Publish Setup to teacher LAN `/upgrades/` — students download **from the teacher PC**, not public GitHub |
| Day-to-day class | LAN only after install |

## 6. Code signing (when you have a cert)

Sign `Teacher-Setup.exe` and `Student-Setup.exe` in release CI (`signtool` / existing workflow secrets).  
**Until then:** do not promise “no SmartScreen”. Use More info → Run anyway, or `Unblock-ClassroomDesk.bat`.

## 7. Wi‑Fi client isolation / guest VLAN

Many school guest SSIDs **block device-to-device** traffic. Then “Find classroom” and LAN Setup links fail.

- Teacher PC: **wired** when possible.
- Or confirm with IT that student ↔ teacher (TCP **8787**) is allowed on that VLAN/SSID.
- Tick **非访客隔离 Wi‑Fi** on the lab go-live panel.

## 8. Do not use a teacher laptop hotspot for real classes

Phone/PC hotspots change IP, sleep, and drop students mid-lesson. Use classroom Ethernet or a fixed AP.

## 9. Image / ghost install (IT silent)

On the golden image machine (elevated PowerShell), after files are at `C:\ClassroomDesk`:

```text
powershell -NoProfile -ExecutionPolicy Bypass -File C:\ClassroomDesk\install-teacher.ps1 -InstallRoot C:\ClassroomDesk -SkipSourceDownload -ChinaMirrorsFirst -SkipStart
```

`-SkipStart` installs firewall + autostart (SYSTEM @ boot) but does not start the API yet — good for sysprep/ghost. After imaging, reboot or run the scheduled task `ClassroomDeskServer`.

## 10. Semester turn-over

See [SEMESTER_RESET.md](./SEMESTER_RESET.md) / `SEMESTER-RESET.txt` in `Give-To-Teacher`.

## Related

- [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md) — Assigned Access / Intune L3  
- [DESKDNS_PORT53.md](./DESKDNS_PORT53.md) — DeskDNS bind / Windows :53  
- [NETWORK.md](./NETWORK.md) — Shield adapters  
- [EXAM_BOX.md](./EXAM_BOX.md) — Linux side-box on UDP/53  
