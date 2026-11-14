@echo off
chcp 65001 >nul
title Classroom Desk — Unblock (unsigned builds)
cd /d "%~dp0"

echo.
echo  Clear Windows "downloaded from internet" mark on this folder.
echo  Helps unsigned Setup.exe show fewer SmartScreen blocks.
echo  Does NOT turn off Defender / SmartScreen.
echo.
echo  If SmartScreen still appears: More info → Run anyway
echo  (Chinese: 更多信息 → 仍要运行)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -Force -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue; if (Test-Path '%~dp0..\students') { Get-ChildItem -LiteralPath '%~dp0..\students' -Recurse -Force -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue }; Write-Host 'Done. Unblocked files under this pack.'"

echo.
pause
