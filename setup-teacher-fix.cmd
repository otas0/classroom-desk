@echo off
setlocal EnableExtensions
title Classroom Desk — Teacher Fix
cd /d "%~dp0"

REM Used by Teacher-Fix.exe SFX. Repairs Node + resets login on C:\ClassroomDesk.

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" (
  echo ERROR: Windows PowerShell missing.
  pause
  exit /b 90
)

set "ROOT=C:\ClassroomDesk"
if exist "%~dp0apps\server\dist\index.mjs" (
  set "ROOT=%~dp0"
  if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
)

echo.
echo  Classroom Desk — Teacher Fix
echo  Target: %ROOT%
echo  1^) Force Windows Node
echo  2^) Reset login to teacher / admin
echo.

if not exist "%ROOT%\apps\server\dist\index.mjs" if not exist "%ROOT%\Install.bat" if not exist "%ROOT%\.env" (
  echo ERROR: No install found at %ROOT%
  echo Install with Teacher-Setup.exe first.
  pause
  exit /b 1
)

mkdir "%ROOT%" 2>nul
mkdir "%ROOT%\patches" 2>nul

REM Copy repair files into the real install tree
for %%F in (
  ensure-windows-node.ps1
  reset-teacher-login.ps1
  reset-teacher-login.mjs
  Force-Windows-Node.bat
  Fix-Teacher-PC.bat
  Reset-Teacher-Login.bat
  Start-ClassroomDesk.cmd
  launch-classroom-desk.cmd
) do (
  if exist "%~dp0%%F" (
    copy /y "%~dp0%%F" "%ROOT%\%%F" >nul
    copy /y "%~dp0%%F" "%ROOT%\patches\%%F" >nul
  )
)

if exist "%~dp0ClassroomDesk.exe" copy /y "%~dp0ClassroomDesk.exe" "%ROOT%\ClassroomDesk.exe" >nul
if exist "%~dp0ClassroomDesk.exe" copy /y "%~dp0ClassroomDesk.exe" "%USERPROFILE%\Desktop\ClassroomDesk.exe" >nul

echo [1/2] Windows Node…
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ensure-windows-node.ps1" -InstallRoot "%ROOT%" -ChinaMirrorsFirst -Force
if errorlevel 1 (
  echo NODE FAILED
  pause
  exit /b 1
)

echo [2/2] Reset login…
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\reset-teacher-login.ps1" -InstallRoot "%ROOT%"
if errorlevel 1 (
  echo RESET FAILED
  pause
  exit /b 1
)

echo.
echo OK — login teacher / admin, then change password in Settings.
echo Daily start: Desktop\ClassroomDesk.exe  ^(or Teacher-Setup again if missing^)
echo.
pause
endlocal
