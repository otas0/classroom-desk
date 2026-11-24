@echo off
setlocal EnableExtensions
REM Legacy SFX entry -> GUI wizard (same as setup-wizard.cmd).
cd /d "%~dp0"
call "%~dp0setup-wizard.cmd"
exit /b %ERRORLEVEL%
