@echo off
chcp 65001 >nul
title Classroom Desk - Install Teacher Host
cd /d "%~dp0"

set "LOG=%USERPROFILE%\Desktop\ClassroomDesk-Install-Log.txt"
echo.
echo  Installing Classroom Desk teacher host (needs Admin).
echo  Local unzip OK — does not need git.
echo  Log file: %LOG%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-teacher.ps1" -SkipSourceDownload
set ERR=%ERRORLEVEL%

echo.
if not "%ERR%"=="0" (
  echo ============================================================
  echo  INSTALL FAILED  (exit %ERR%)
  echo  Open the log on Desktop: ClassroomDesk-Install-Log.txt
  echo  Common causes: cannot download Node, or npm install blocked.
  echo ============================================================
  if exist "%LOG%" (
    echo.
    echo ---- last 30 log lines ----
    powershell -NoProfile -Command "Get-Content -LiteralPath $env:LOG -Tail 30 -ErrorAction SilentlyContinue"
  )
  echo.
  pause
  exit /b %ERR%
)

echo Install finished. See Desktop\ClassroomDesk-Desk-Login.txt
pause
