@echo off
setlocal EnableExtensions
REM Reset login → teacher / admin. Safe on locked school PATH.
cd /d "%~dp0"

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" (
  echo ERROR: Windows PowerShell not found.
  pause
  exit /b 90
)

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "C:\ClassroomDesk\.env" set "ROOT=C:\ClassroomDesk"
if exist "C:\ClassroomDesk\Install.bat" set "ROOT=C:\ClassroomDesk"

echo.
echo  Classroom Desk — reset teacher login to teacher / admin
echo  Root: %ROOT%
echo.

REM Ensure Windows Node first (old rooms often have Mac/broken node)
set "ENSURE=%~dp0ensure-windows-node.ps1"
if not exist "%ENSURE%" set "ENSURE=%ROOT%\ensure-windows-node.ps1"
if exist "%ENSURE%" (
  echo  Step 1/2: force Windows Node…
  "%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ENSURE%" -InstallRoot "%ROOT%" -ChinaMirrorsFirst -Force
  if errorlevel 1 (
    echo WARNING: Node auto-install failed — will still try .env reset.
  )
) else (
  echo WARNING: ensure-windows-node.ps1 missing — skipping Node repair.
)

echo  Step 2/2: reset username/password…
set "SCRIPT=%~dp0reset-teacher-login.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%ROOT%\reset-teacher-login.ps1"
if not exist "%SCRIPT%" (
  echo ERROR: reset-teacher-login.ps1 missing next to this bat
  pause
  exit /b 1
)

"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -InstallRoot "%ROOT%"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo FAILED exit %ERR%
  pause
  exit /b %ERR%
)
echo.
pause
endlocal
