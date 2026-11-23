@echo off
chcp 65001 >nul 2>&1
title Classroom Desk — start API
setlocal EnableExtensions

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"

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

if not exist "%PS%" (
  echo ERROR: Windows PowerShell not found — cannot auto-install Node.
  pause
  exit /b 90
)

set "ENSURE=%ROOT%\ensure-windows-node.ps1"
if not exist "%ENSURE%" set "ENSURE=%~dp0ensure-windows-node.ps1"
if not exist "%ENSURE%" (
  echo ERROR: ensure-windows-node.ps1 missing
  pause
  exit /b 1
)

echo  Ensuring Windows Node ^(wipe + CN/overseas download^)…
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ENSURE%" -InstallRoot "%ROOT%" -ChinaMirrorsFirst -Force
if errorlevel 1 (
  echo NODE AUTO-INSTALL FAILED — check network ^(npmmirror / nodejs.org^)
  pause
  exit /b 1
)

set "NODE="
for /d %%D in ("%ROOT%\runtime\node-v*-win-*") do (
  if exist "%%~D\node.exe" set "NODE=%%~D\node.exe"
)
if not defined NODE (
  echo ERROR: Windows portable node.exe missing after auto-install
  pause
  exit /b 1
)

REM PE check without Get-NetTCPConnection / fancy modules
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p=$env:NODE; if(-not $p){$p='%NODE%'}; $b=[IO.File]::ReadAllBytes($p)[0..1]; if(-not($b[0]-eq0x4D -and $b[1]-eq0x5A)){ Write-Host 'ERROR: node.exe is not Windows PE (MZ)'; exit 2 }; exit 0"
if errorlevel 1 (
  pause
  exit /b 2
)

echo  Node: %NODE%
echo  Stopping old listener on 8787 ^(if any^)…
REM Prefer netstat+taskkill — Get-NetTCPConnection often missing on locked images
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8787 .*LISTENING"') do (
  taskkill /F /PID %%P >nul 2>&1
)

cd /d "%ROOT%"
set CLASSROOM_DESK_BUNDLED=1
set CLASSROOM_DESK_OFFLINE=1
set ELECTRON_SKIP_BINARY_DOWNLOAD=1

echo  Starting… ^(keep this window open^)
echo  Health: http://127.0.0.1:8787/health
echo  Admin:  http://127.0.0.1:8787/admin/
echo.

start "" cmd /c "ping -n 4 127.0.0.1 >nul & start http://127.0.0.1:8787/health & ping -n 3 127.0.0.1 >nul & start http://127.0.0.1:8787/admin/"

"%NODE%" "%ROOT%\apps\server\dist\index.mjs"
set ERR=%ERRORLEVEL%
echo.
echo  Server exited code %ERR%
if not "%ERR%"=="0" (
  echo  If MODULE_NOT_FOUND / EADDRINUSE, copy this window text.
  echo  Or run Force-Windows-Node.bat then retry.
)
pause
exit /b %ERR%
