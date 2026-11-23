# Deploy

`npm run pack` → folder **`Give-To-Teacher`**

**Which exe is which?** → **[TEACHER_EXES.md](./TEACHER_EXES.md)**（GitHub 说明用这一页）

## Time SLA

**Under 5 minutes.** See [TIME_TO_CLASS.md](./TIME_TO_CLASS.md).

## Day-1

### Offline (USB / LAN — preferred)

1. Double-click **`Teacher-Setup.exe`** → Admin logged in → import roster  
2. Setup finishes → Desktop gets shortcuts: **Classroom Desk** · **Classroom Desk Admin** · **Classroom Desk Fix**  
3. Every day: double-click Desktop **Classroom Desk**  
4. Students: Public Desktop install card → open app → **tap your name**

### Online (slow public network)

1. Double-click **`Teacher-Bootstrap.exe`** (few MB) — downloads product zip via mirrors (resumable)  
2. Same student path as above

Full table: [TEACHER_EXES.md](./TEACHER_EXES.md).

Default login (new install): **`teacher` / `admin`** — change in Admin → **设置**.  
Forgot password / Mac Node: Desktop **Classroom Desk Fix** / **`Teacher-Fix.exe`**.  
Backup card: Desktop **`ClassroomDesk-Desk-Login.txt`**

## Hot update

Students auto-follow teacher `/upgrades/`. New build: Admin sync/upload Setup.

## Code signing

Unsigned → SmartScreen → **More info → Run anyway**. Do not turn off Defender.
