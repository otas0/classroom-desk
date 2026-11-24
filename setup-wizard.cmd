@echo off
setlocal EnableExtensions
REM Teacher-Setup.exe entry: open the GUI wizard (one place, no bat hunting).
cd /d "%~dp0"

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" (
  echo ERROR: Windows PowerShell missing.
  pause
  exit /b 90
)

set "WIZ=%~dp0setup-wizard.ps1"
if not exist "%WIZ%" (
  echo ERROR: setup-wizard.ps1 missing
  pause
  exit /b 1
)

"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%WIZ%" -PayloadRoot "%~dp0"
exit /b %ERRORLEVEL%
