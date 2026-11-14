# Deploy

`npm run pack` → folder **`Give-To-Teacher`**

## Time SLA

**Under 5 minutes** to first class after Setup is on the teacher PC; **~1–2 minutes** typical on SSD.  
See [TIME_TO_CLASS.md](./TIME_TO_CLASS.md). Worldwide classrooms: distribute by **USB/LAN** — do not download ~300 MB Teacher-Setup on a slow school link during the lesson.

## Day-1

1. Double-click **`Teacher-Setup.exe`**
2. Desktop **`ClassroomDesk-Desk-Login.txt`** → log in (Admin opens)
3. Import roster into pre-created **本教室** (easy-join already on)
4. Students: Public Desktop **`ClassroomDesk-Student-Install.txt`** → Find classroom

| File | Who |
|------|-----|
| `Teacher-Setup.exe` | Teacher PC |
| `Student-Setup.exe` | USB fallback (prefer install-card LAN link) |
| `START-HERE.txt` | Steps above |
| `SMOKE-CHECK.txt` | Optional check |
| `LAB-GO-LIVE.txt` | Exam / max-secrecy only |
| `SEMESTER-RESET.txt` | End of term |

## Hot update

- Students auto-follow teacher `/upgrades/` (force same version on)
- New build: Admin → sync/upload Setup (offline: USB Setup.exe)

## Code signing

Unsigned Setup may show SmartScreen → **More info → Run anyway**. Do **not** turn off Defender.
