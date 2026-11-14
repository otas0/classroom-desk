@echo off
chcp 65001 >nul
title Classroom Desk Install
cd /d "%~dp0"

echo.
echo  Classroom Desk — teacher install
echo.
echo  Network minimum:
echo    - Complete pack present  = ZERO public internet
echo    - Incomplete pack        = ONE resumable Dist zip (mirrors), then zero
echo    - After install          = LAN only (students ^<^> teacher)
echo.
echo  Log: Desktop\ClassroomDesk-Install-Log.txt
echo.

if not exist "%~dp0install-teacher.ps1" (
  echo ERROR: install-teacher.ps1 missing.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -Force -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-teacher.ps1" -SkipSourceDownload -ChinaMirrorsFirst
set ERR=%ERRORLEVEL%

echo.
if not "%ERR%"=="0" (
  echo INSTALL FAILED
  echo See Desktop\ClassroomDesk-Install-Log.txt and ClassroomDesk-Network-Minimum.txt
  set "LOG=%USERPROFILE%\Desktop\ClassroomDesk-Install-Log.txt"
  if not exist "%LOG%" set "LOG=%PUBLIC%\Desktop\ClassroomDesk-Install-Log.txt"
  if exist "%LOG%" (
    powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG%' -Tail 30 -ErrorAction SilentlyContinue"
  )
  set "HELP=%USERPROFILE%\Desktop\ClassroomDesk-Network-Minimum.txt"
  if not exist "%HELP%" set "HELP=%PUBLIC%\Desktop\ClassroomDesk-Network-Minimum.txt"
  if exist "%HELP%" start "" notepad "%HELP%"
  pause
  exit /b %ERR%
)

echo Done. Login: Desktop\ClassroomDesk-Desk-Login.txt ^(teacher account only^)
echo Students: Desktop\ClassroomDesk-Student-Install.txt
if exist "%USERPROFILE%\Desktop\ClassroomDesk-Desk-Login.txt" (
  start "" notepad "%USERPROFILE%\Desktop\ClassroomDesk-Desk-Login.txt"
)
pause
