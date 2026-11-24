@echo off
chcp 65001 >nul 2>&1
title Classroom Desk
setlocal EnableExtensions

REM Daily one-click launcher (used by ClassroomDesk.exe SFX).
REM Does not rely on PATH: uses System32 PowerShell + C:\ClassroomDesk.

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"

set "ROOT=C:\ClassroomDesk"
if exist "%~dp0apps\server\dist\index.mjs" (
  set "ROOT=%~dp0"
  if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
)
if not exist "%ROOT%\apps\server\dist\index.mjs" (
  echo.
  echo  ERROR: Classroom Desk not installed at:
  echo    %ROOT%
  echo  Double-click Teacher-Setup.exe first, then run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo  Classroom Desk
echo  %ROOT%
echo.

if not exist "%PS%" (
  echo ERROR: Windows PowerShell missing.
  pause
  exit /b 90
)

REM Keep repair scripts next to the install (SFX may extract to TEMP).
for %%F in (ensure-windows-node.ps1 Start-ClassroomDesk.cmd Force-Windows-Node.bat) do (
  if exist "%~dp0%%F" if not exist "%ROOT%\%%F" copy /y "%~dp0%%F" "%ROOT%\%%F" >nul
)

set "ENSURE=%ROOT%\ensure-windows-node.ps1"
if not exist "%ENSURE%" set "ENSURE=%~dp0ensure-windows-node.ps1"
if not exist "%ENSURE%" (
  echo ERROR: ensure-windows-node.ps1 missing
  pause
  exit /b 1
)

echo  [1/2] Windows Node...
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ENSURE%" -InstallRoot "%ROOT%" -ChinaMirrorsFirst
if errorlevel 1 (
  echo NODE FAILED - re-run Teacher-Setup.exe and pick node.exe
  pause
  exit /b 1
)

set "NODE="
if exist "%ROOT%\node-path.txt" (
  set /p NODE=<"%ROOT%\node-path.txt"
)
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE (
  for /d %%D in ("%ROOT%\runtime\node-v*-win-*") do (
    if exist "%%~D\node.exe" set "NODE=%%~D\node.exe"
  )
)
if not defined NODE (
  echo ERROR: node.exe missing - re-run Teacher-Setup.exe
  pause
  exit /b 1
)

"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%NODE%'; $b=[IO.File]::ReadAllBytes($p)[0..1]; if(-not($b[0]-eq0x4D -and $b[1]-eq0x5A)){ Write-Host 'ERROR: node.exe is not Windows PE'; exit 2 }; exit 0"
if errorlevel 1 (
  pause
  exit /b 2
)

echo  [2/2] Start API...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8787 .*LISTENING"') do (
  taskkill /F /PID %%P >nul 2>&1
)

cd /d "%ROOT%"
set CLASSROOM_DESK_BUNDLED=1
set CLASSROOM_DESK_OFFLINE=1
set ELECTRON_SKIP_BINARY_DOWNLOAD=1

echo  Health  http://127.0.0.1:8787/health
echo  Admin   http://127.0.0.1:8787/admin/
echo  Keep this window open.
echo.

start "" cmd /c "ping -n 4 127.0.0.1 >nul & start http://127.0.0.1:8787/admin/"

"%NODE%" "%ROOT%\apps\server\dist\index.mjs"
set ERR=%ERRORLEVEL%
echo.
echo  Stopped ^(code %ERR%^)
pause
exit /b %ERR%
