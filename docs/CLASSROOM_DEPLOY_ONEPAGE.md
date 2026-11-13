# Classroom deploy (short)

## 1. Teacher PC

**Admin PowerShell:**

```powershell
irm https://raw.githubusercontent.com/otas0/classroom-desk/v0.1.10/install-teacher.ps1 -OutFile $env:TEMP\install-teacher.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\install-teacher.ps1
```

Or double-click **`Install-Teacher.bat`** in the repo.

Then: Desktop **`ClassroomDesk-Desk-Login.txt`** → `http://127.0.0.1:8787/admin/`.  
Details: [TEACHER_EASY_SETUP.md](./TEACHER_EASY_SETUP.md).

## 2. Student PCs

1. Install `ClassroomDesk-Setup-<version>.exe` from [Releases](https://github.com/otas0/classroom-desk/releases) (ARM: `*-arm64.exe`).  
2. Do **not** turn off Defender / SmartScreen.  
3. Teacher enables one-click join → students **Find classroom**.

## 3. Later updates

Settings → **One-click update (teacher host + student packages)** (x64 + arm64 Setup + teacher host restart).

### Acceptance (version lock + hardening)

- [ ] Teacher install opens `/admin/`; Desktop login card exists  
- [ ] Force same version after Setup pull; old clients upgrade  
- [ ] Freeze: fullscreen, secondary black, refocus ≤0.6s  
- [ ] Exam shell blocks non-allowlist URLs  
- [ ] Freeze kills Chrome/Edge/WeChat/QQ ≤1s  
- [ ] **L3 required:** Assigned Access + Intune trial → Alt+Tab/Win dead; Task Manager end denied; evidence videos; rollback XML. No AA = incomplete deploy ([SECURITY.md](./SECURITY.md))  
- [ ] [C2_OPERATOR_RUNBOOK.md](./C2_OPERATOR_RUNBOOK.md) → `npm run verify:c2-evidence`  
- [ ] Real Shield connector → `shield/health`  
- [ ] Offline unlock after cached code  
- [ ] DHCP → teacher :5353 blocks resolve to `0.0.0.0`

---

| Need | Doc |
|---|---|
| Teacher one-click | [TEACHER_EASY_SETUP.md](./TEACHER_EASY_SETUP.md) |
| Manual cold start | [SETUP_FROM_GITHUB.md](./SETUP_FROM_GITHUB.md) |
| Desk card print | [PRINT_DESK_CARD.md](./PRINT_DESK_CARD.md) |
| USB | [LOCAL_USB_CHECKLIST.md](./LOCAL_USB_CHECKLIST.md) |
| AA / C2 | [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md) |
| Security | [SECURITY.md](./SECURITY.md) |
| Join / TLS | [CLASSROOM_JOIN_SECURITY.md](./CLASSROOM_JOIN_SECURITY.md) |
| Release sync | [RELEASE_SYNC.md](./RELEASE_SYNC.md) |
