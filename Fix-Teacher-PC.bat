@echo off
setlocal EnableExtensions
REM One-click for old teacher PCs: force Windows Node + reset teacher/admin.
cd /d "%~dp0"

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" (
  echo ERROR: Windows PowerShell missing on this PC.
  pause
  exit /b 90
)

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "C:\ClassroomDesk\Install.bat" set "ROOT=C:\ClassroomDesk"
if exist "C:\ClassroomDesk\.env" set "ROOT=C:\ClassroomDesk"

echo.
echo  ========================================
echo   Classroom Desk — Fix Teacher PC
echo   1^) Force Windows Node
echo   2^) Reset login to teacher / admin
echo  Root: %ROOT%
echo  ========================================
echo.

set "ENSURE=%~dp0ensure-windows-node.ps1"
if not exist "%ENSURE%" set "ENSURE=%ROOT%\ensure-windows-node.ps1"
if not exist "%ENSURE%" (
  echo ERROR: ensure-windows-node.ps1 missing in this folder.
  pause
  exit /b 1
)

echo [1/2] Force Windows Node…
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ENSURE%" -InstallRoot "%ROOT%" -ChinaMirrorsFirst -Force
if errorlevel 1 (
  echo NODE FAILED — check network / firewall.
  pause
  exit /b 1
)

set "RESET=%~dp0reset-teacher-login.ps1"
if not exist "%RESET%" set "RESET=%ROOT%\reset-teacher-login.ps1"
if not exist "%RESET%" (
  echo ERROR: reset-teacher-login.ps1 missing.
  pause
  exit /b 1
)

echo [2/2] Reset login…
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%RESET%" -InstallRoot "%ROOT%"
if errorlevel 1 (
  echo RESET FAILED
  pause
  exit /b 1
)

echo.
echo ALL DONE — login teacher / admin, then change password in Settings.
echo Start API: double-click Start-ClassroomDesk.cmd
echo.
pause
endlocal
