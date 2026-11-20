@echo off
chcp 65001 >nul
title Classroom Desk — Service Fix
cd /d "%~dp0"

echo.
echo  Classroom Desk — Service Fix Patch
echo  Fixes: http://127.0.0.1:8787/health and /admin/ not opening
echo  (local API restart — no manual commands needed)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -Force -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

if not exist "%~dp0fix-classroom-service.ps1" (
  echo ERROR: fix-classroom-service.ps1 missing
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-classroom-service.ps1" -InstallRoot "C:\ClassroomDesk" -ChinaMirrorsFirst
set ERR=%ERRORLEVEL%
echo.
if "%ERR%"=="0" (
  echo OK — Admin should open. Desktop\ClassroomDesk-Service-OK.txt
) else (
  echo FAILED — see Desktop\ClassroomDesk-Service-Fix-Log.txt
  if exist "%USERPROFILE%\Desktop\ClassroomDesk-Service-Fix-Log.txt" (
    start "" notepad "%USERPROFILE%\Desktop\ClassroomDesk-Service-Fix-Log.txt"
  )
  pause
)
exit /b %ERR%
