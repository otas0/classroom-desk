@echo off
setlocal EnableExtensions
REM Same GUI wizard as Teacher-Setup.exe.
cd /d "%~dp0"
call "%~dp0setup-wizard.cmd"
exit /b %ERRORLEVEL%
