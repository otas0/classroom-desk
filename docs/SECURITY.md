# Security & Compliance Notes

Classroom Desk is a school-deployed classroom tool. Students are informed of its purpose.

## Allowed

- Visible Electron process (`skipTaskbar: false`)
- Always-on-top small widget (not fullscreen)
- Login-item autostart via Electron APIs
- In-app presence heartbeat for attendance (login + online in this app only)
- Admin password (bcrypt in settings) for quit / uninstall guidance / disable autostart

## Forbidden

- Hidden or disguised processes
- Keylogging / clipboard monitoring
- Screenshot or camera surveillance
- Blocking Task Manager
- Privilege escalation
- Anti-uninstall / anti-kill persistence tricks
- Bypassing OS permissions

## Admin password

Store only a bcrypt hash in `settings.admin_password_hash` (or env override). Never hardcode plaintext passwords in source.
