@echo off
chcp 65001 >nul
title Classroom Desk — online bootstrap
cd /d "%~dp0"

rem Thin public download: scripts only. Pulls ClassroomDesk-*-win-x64.zip via mirrors (resumable).
set "ROOT=C:\ClassroomDesk"
echo.
echo  Classroom Desk — online bootstrap
echo  Target: %ROOT%
echo  Will download the product zip once (mirrors + resume), then install.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -Force -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

mkdir "%ROOT%" 2>nul
rem Keep live data across re-runs
set "KEEP=%TEMP%\cd-keep-%RANDOM%%RANDOM%"
mkdir "%KEEP%" 2>nul
if exist "%ROOT%\.env" copy /y "%ROOT%\.env" "%KEEP%\.env" >nul
if exist "%ROOT%\apps\server\data" (
  mkdir "%KEEP%\data" 2>nul
  robocopy "%ROOT%\apps\server\data" "%KEEP%\data" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
)

robocopy "%~dp0." "%ROOT%" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
if errorlevel 8 (
  echo ERROR: copy bootstrap files failed
  pause
  exit /b 1
)

if exist "%KEEP%\.env" copy /y "%KEEP%\.env" "%ROOT%\.env" >nul
if exist "%KEEP%\data" (
  mkdir "%ROOT%\apps\server\data" 2>nul
  robocopy "%KEEP%\data" "%ROOT%\apps\server\data" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
)
rmdir /s /q "%KEEP%" 2>nul

if not exist "%ROOT%\install-teacher.ps1" (
  echo ERROR: install-teacher.ps1 missing
  pause
  exit /b 1
)

echo  Ensuring Windows Node (auto-download CN + overseas mirrors)…
if exist "%ROOT%\ensure-windows-node.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ensure-windows-node.ps1" -InstallRoot "%ROOT%" -ChinaMirrorsFirst -Force
) else if exist "%~dp0ensure-windows-node.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-windows-node.ps1" -InstallRoot "%ROOT%" -ChinaMirrorsFirst -Force
) else (
  echo ERROR: ensure-windows-node.ps1 missing
  pause
  exit /b 1
)
if errorlevel 1 (
  echo NODE AUTO-INSTALL FAILED
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\install-teacher.ps1" -InstallRoot "%ROOT%" -BootstrapOnline -ChinaMirrorsFirst -ForceNodeReinstall
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo BOOTSTRAP FAILED — see Desktop\ClassroomDesk-Install-Log.txt
  echo Also: Desktop\ClassroomDesk-Network-Minimum.txt
  pause
  exit /b %ERR%
)

echo.
echo Done. Admin should open logged in — import roster.
echo Students: Public Desktop install card → open app → tap your name.
exit /b 0
