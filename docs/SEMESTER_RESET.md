# Semester reset (one page)

Do this **before** the next term treats the teacher PC as a fresh classroom.

1. **Backup**  
   Copy `C:\ClassroomDesk\apps\server\data\classroom.db` (and optionally the whole `data\` folder) to USB / school share.

2. **Decide: keep or clear classes**  
   - Keep: same rooms/rosters → skip wipe.  
   - Fresh term: in Admin, remove or archive old classes/rosters (or restore from an empty backup only if IT approves).

3. **Rotate passwords**  
   Change teacher / admin passwords in Admin settings (or replace `.env` and restart).  
   Delete old `Desktop\ClassroomDesk-Desk-Login.txt` and re-open Admin so a new card is not assumed current.

4. **Student Setup**  
   If the student app version changed: put new Setup under LAN `/upgrades/` (Settings → upgrades / new `Teacher-Setup` pack).  
   Students should **not** re-download from public GitHub.

5. **Smoke**  
   Run `SMOKE-CHECK.txt` again on the pilot teacher PC.
