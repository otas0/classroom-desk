@echo off
setlocal EnableExtensions
REM Wipe runtime Node + download official Windows Node (CN + overseas).
REM Copy into C:\ClassroomDesk with ensure-windows-node.ps1, then double-click.
cd /d "%~dp0"

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" (
  echo ERROR: Windows PowerShell not found at System32.
  echo This PC image is missing PowerShell — ask IT to enable it.
  pause
  exit /b 90
)

REM Prefer real install root; strip trailing backslash (breaks PowerShell "C:\path\")
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if exist "C:\ClassroomDesk\Install.bat" set "ROOT=C:\ClassroomDesk"
if exist "C:\ClassroomDesk\.env" set "ROOT=C:\ClassroomDesk"
if exist "%~dp0Install.bat" (
  set "ROOT=%~dp0"
  if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
)

echo.
echo  Classroom Desk — force Windows Node
echo  PowerShell: %PS%
echo  Install root: %ROOT%
echo.

set "ENSURE=%~dp0ensure-windows-node.ps1"
if not exist "%ENSURE%" set "ENSURE=%ROOT%\ensure-windows-node.ps1"
if not exist "%ENSURE%" (
  echo ERROR: ensure-windows-node.ps1 missing
  echo Put this bat and ensure-windows-node.ps1 into C:\ClassroomDesk together.
  pause
  exit /b 1
)

"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ENSURE%" -InstallRoot "%ROOT%" -ChinaMirrorsFirst -Force
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo FAILED exit %ERR% — check network ^(npmmirror / nodejs.org^) or firewall.
  pause
  exit /b %ERR%
)

echo.
echo OK — Windows Node under %ROOT%\runtime\
dir /b "%ROOT%\runtime\node-v*-win-*\node.exe" 2>nul
echo.
echo Next: Start-ClassroomDesk.cmd   or   Reset-Teacher-Login.bat
echo.
pause
endlocal
