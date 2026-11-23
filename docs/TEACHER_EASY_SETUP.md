# Deploy

`npm run pack` → folder **`Give-To-Teacher`**

## Time SLA

**Under 5 minutes.** See [TIME_TO_CLASS.md](./TIME_TO_CLASS.md).

## Day-1

### Offline (USB / LAN — preferred)

1. Double-click **`Teacher-Setup.exe`** → Admin logged in → import roster  
2. Students: Public Desktop install card → open app → **tap your name**

### Online (slow public network)

1. Double-click **`Teacher-Bootstrap.exe`** (few MB) — downloads product zip via mirrors (resumable)  
2. Same student path as above

| File | Who |
|------|-----|
| `Teacher-Bootstrap.exe` | Public download / slow links |
| `Teacher-Setup.exe` | USB offline complete pack |
| `Service-Fix.exe` | **Alone:** fix `/health` & `/admin` not opening ([SERVICE_FIX.md](./SERVICE_FIX.md)) |
| `Student-Setup.exe` | USB fallback (prefer LAN install card) |
| `START-HERE.txt` | Steps |

Default login (new install): **`teacher` / `admin`** — change in Admin → **设置**.  
Forgot / old install: copy **`Reset-Teacher-Login`** into `C:\ClassroomDesk` → double-click the bat ([RESET_TEACHER_LOGIN.md](./RESET_TEACHER_LOGIN.md)).  
Backup card: Desktop **`ClassroomDesk-Desk-Login.txt`**

## Hot update

Students auto-follow teacher `/upgrades/`. New build: Admin sync/upload Setup.

## Code signing

Unsigned → SmartScreen → **More info → Run anyway**. Do not turn off Defender.
