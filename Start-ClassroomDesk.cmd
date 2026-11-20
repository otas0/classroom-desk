@echo off
chcp 65001 >nul
title Classroom Desk — start API
setlocal EnableExtensions

rem Prefer install root next to this script, else C:\ClassroomDesk
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if not exist "%ROOT%\apps\server\dist\index.mjs" (
  if exist "C:\ClassroomDesk\apps\server\dist\index.mjs" set "ROOT=C:\ClassroomDesk"
)

echo.
echo  Classroom Desk — start local API
echo  Folder: %ROOT%
echo.

if not exist "%ROOT%\apps\server\dist\index.mjs" (
  echo ERROR: missing apps\server\dist\index.mjs
  echo Run Teacher-Setup.exe / Install.bat first.
  pause
  exit /b 1
)

set "NODE="
for /d %%D in ("%ROOT%\runtime\node-v*-win-*") do (
  if exist "%%~D\node.exe" set "NODE=%%~D\node.exe"
)
rem Never fall back to PATH node — Mac/host Node has broken many classrooms.
if not defined NODE (
  echo ERROR: Windows portable node.exe missing under %ROOT%\runtime\node-v*-win-*\
  echo Double-click Service-Fix.exe / Desktop\ClassroomDesk-Fix-Service.cmd
  echo Do NOT copy Mac Node into this folder.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$b=[IO.File]::ReadAllBytes('%NODE%')[0..1]; if(-not($b[0]-eq0x4D -and $b[1]-eq0x5A)){ Write-Host 'ERROR: node.exe is not a Windows PE (MZ). Likely a Mac binary.'; Write-Host 'Run Service-Fix.exe to re-download win-x64 Node.'; exit 2 }; exit 0"
if errorlevel 1 (
  pause
  exit /b 2
)

echo  Node: %NODE%
echo  Stopping old listener on 8787 (if any)…
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

cd /d "%ROOT%"
set CLASSROOM_DESK_BUNDLED=1
set CLASSROOM_DESK_OFFLINE=1
set ELECTRON_SKIP_BINARY_DOWNLOAD=1

echo  Starting… (keep this window open)
echo  Health: http://127.0.0.1:8787/health
echo  Admin:  http://127.0.0.1:8787/admin/
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:8787/health & timeout /t 2 /nobreak >nul & start http://127.0.0.1:8787/admin/"

"%NODE%" "%ROOT%\apps\server\dist\index.mjs"
set ERR=%ERRORLEVEL%
echo.
echo  Server exited code %ERR%
if not "%ERR%"=="0" (
  echo  If you see MODULE_NOT_FOUND / EADDRINUSE, copy this window text.
  echo  Or re-run: Teacher-Setup.exe / Install.bat as Administrator.
)
pause
exit /b %ERR%
