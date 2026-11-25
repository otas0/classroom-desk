# Deploy

`npm run pack` → folder **`Give-To-Teacher`**

对外和学生一样：**教师只给 / 只下 `Teacher-Setup.exe`**。  
细节：[TEACHER_EXES.md](./TEACHER_EXES.md)

## Time SLA

**Under 5 minutes.** See [TIME_TO_CLASS.md](./TIME_TO_CLASS.md).

## Day-1

1. Double-click **`Teacher-Setup.exe`** → GUI wizard (install folder, auto Node MSI **or** pick existing `node.exe`) → Admin logged in → import roster  
   - School net blocks MSI: wizard switches to **Use Node already on this PC** → Detect / Browse (`C:\Program Files\nodejs\node.exe`) or install LTS from [nodejs.org](https://nodejs.org/en/download) then Install again. Desktop card: `ClassroomDesk-Node-Manual.txt`.  
2. Desktop shortcuts appear: **Classroom Desk** · **Classroom Desk Admin** · **Classroom Desk Fix**  
3. Every day: Desktop **Classroom Desk**  
4. Students: Public Desktop install card → open app → **tap your name**

Default login: **`teacher` / `admin`** → change in Admin → **设置**.  
Broken: Desktop **Classroom Desk Fix**.  
Backup card: Desktop **`ClassroomDesk-Desk-Login.txt`**

`Give-To-Teacher/Advanced/` is IT-only (Bootstrap / Service-Fix / …). Teachers ignore it.  
Bootstrap needs an IT-built Dist zip — **not** on GitHub Release; see `IT-ONLY-REPAIR.txt` inside Teacher-Setup.

## Hot update

Students auto-follow teacher `/upgrades/`. New build: Admin sync/upload Setup.

## Code signing

Unsigned → SmartScreen → **More info → Run anyway**. Do not turn off Defender.
