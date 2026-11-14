@echo off
chcp 65001 >nul
title Classroom Desk Setup
cd /d "%~dp0"

set "ROOT=C:\ClassroomDesk"
echo.
echo  Classroom Desk Setup
echo  Target: %ROOT%
echo.

rem Clear Zone.Identifier so unsigned files are less likely to trip SmartScreen mid-copy.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -Force -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

if /I not "%~dp0"=="%ROOT%\" if /I not "%~dp0"=="%ROOT%" (
  echo  Copying files…
  mkdir "%ROOT%" 2>nul

  rem Preserve live teacher data across re-install / Teacher-Setup re-runs.
  set "KEEP=%TEMP%\cd-keep-%RANDOM%%RANDOM%"
  mkdir "%KEEP%" 2>nul
  if exist "%ROOT%\.env" copy /y "%ROOT%\.env" "%KEEP%\.env" >nul
  if exist "%ROOT%\apps\server\data" (
    mkdir "%KEEP%\data" 2>nul
    robocopy "%ROOT%\apps\server\data" "%KEEP%\data" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
  )

  robocopy "%~dp0." "%ROOT%" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
  if errorlevel 8 (
    echo ERROR: copy failed
    pause
    exit /b 1
  )

  if exist "%KEEP%\.env" (
    copy /y "%KEEP%\.env" "%ROOT%\.env" >nul
    echo  Kept existing .env
  )
  if exist "%KEEP%\data" (
    mkdir "%ROOT%\apps\server\data" 2>nul
    robocopy "%KEEP%\data" "%ROOT%\apps\server\data" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
    echo  Kept existing classroom data
  )
  rem Prefer Setup binaries from this pack for LAN /upgrades/
  if exist "%~dp0apps\server\data\upgrades" (
    mkdir "%ROOT%\apps\server\data\upgrades" 2>nul
    robocopy "%~dp0apps\server\data\upgrades" "%ROOT%\apps\server\data\upgrades" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
  )
  rmdir /s /q "%KEEP%" 2>nul
)

if not exist "%ROOT%\install-teacher.ps1" (
  echo ERROR: install-teacher.ps1 missing at %ROOT%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\install-teacher.ps1" -InstallRoot "%ROOT%" -SkipSourceDownload -ChinaMirrorsFirst
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo INSTALL FAILED — see ClassroomDesk-Install-Log.txt on your Desktop
  if exist "%USERPROFILE%\Desktop\ClassroomDesk-Network-Minimum.txt" (
    echo Also see Desktop\ClassroomDesk-Network-Minimum.txt
  ) else if exist "%PUBLIC%\Desktop\ClassroomDesk-Network-Minimum.txt" (
    echo Also see Public Desktop\ClassroomDesk-Network-Minimum.txt
  )
  pause
  exit /b %ERR%
)

echo.
echo Done. Opening login card on your Desktop…
rem Passwords are on the teacher user Desktop only — never Public Desktop.
if exist "%USERPROFILE%\Desktop\ClassroomDesk-Desk-Login.txt" (
  start "" notepad "%USERPROFILE%\Desktop\ClassroomDesk-Desk-Login.txt"
) else (
  echo Login card: Desktop\ClassroomDesk-Desk-Login.txt
  echo ^(If missing, check the account that was logged in during Setup.^)
)
exit /b 0
