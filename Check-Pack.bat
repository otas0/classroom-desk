@echo off
chcp 65001 >nul
title Classroom Desk — Check Pack
cd /d "%~dp0"

echo.
echo  Checking product pack (will report missing pieces; Install.bat auto-repairs them).
echo.

if not exist "%~dp0install-teacher.ps1" (
  echo ERROR: install-teacher.ps1 missing.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-teacher.ps1" -CheckOnly
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo Pack incomplete — run Install.bat as Administrator to repair via network.
  pause
  exit /b %ERR%
)
echo Pack OK.
pause
exit /b 0
