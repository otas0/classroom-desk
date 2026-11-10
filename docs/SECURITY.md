# Security & Compliance Notes

Classroom Desk is a school-deployed classroom tool. Students are informed of its purpose.

## Allowed

- Visible Electron process (`skipTaskbar: false`)
- Always-on-top small widget (not fullscreen) — **except** teacher-armed deep-lock freeze / exam shell (fullscreen, visible banners)
- Login-item autostart via Electron APIs
- In-app presence heartbeat for attendance (login + online in this app only)
- Admin password (bcrypt in settings) for quit / uninstall guidance / disable autostart
- Teacher-armed deep-lock on **school lab agents**: terminate common browsers/chat/game processes, focus steal, secondary-display blackout, exam-shell host allowlist (students see banners; IT-documented)

## Forbidden

- Hidden or disguised processes
- Keylogging / clipboard monitoring
- Screenshot or camera surveillance
- Blocking Task Manager
- Privilege escalation
- Anti-uninstall / anti-kill persistence tricks
- Bypassing OS permissions
- Silent OS takeover without school MDM / Assigned Access for system hotkeys

## Admin password

Store only a bcrypt hash in `settings.admin_password_hash` (or env override). Never hardcode plaintext passwords in source.
