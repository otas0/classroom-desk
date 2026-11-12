@echo off
title Classroom Desk - Install Teacher Host
cd /d "%~dp0"
echo.
echo  Installing / starting Classroom Desk teacher host (admin).
echo  Needs network access to GitHub + nodejs.org.
echo  Login card: Desktop\ClassroomDesk-Desk-Login.txt
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-teacher.ps1"
if errorlevel 1 (
  echo.
  echo Install failed. Check network, then run Install-Teacher.bat again.
  pause
)
