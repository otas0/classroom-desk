@echo off
setlocal
REM Reset teacher login → username teacher / password admin
REM Drop this folder into C:\ClassroomDesk (or run from an installed tree), then double-click.
cd /d "%~dp0"
echo.
echo  Classroom Desk — reset teacher login to teacher / admin
echo  After login, change the password in Admin → 设置.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reset-teacher-login.ps1" -InstallRoot "%~dp0"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo FAILED — see message above. Common fix: run Service-Fix / Install.bat first.
  pause
  exit /b %ERR%
)
echo.
pause
endlocal
