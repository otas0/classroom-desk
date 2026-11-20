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
if not defined NODE (
  where node >nul 2>&1 && for /f "delims=" %%N in ('where node') do set "NODE=%%N"
)
if not defined NODE (
  echo ERROR: node.exe not found under %ROOT%\runtime\
  echo Re-run Teacher-Setup.exe (needs portable Node).
  pause
  exit /b 1
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
