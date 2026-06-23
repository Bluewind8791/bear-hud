@echo off
chcp 65001 >nul
REM bluewind-statusline installer (double-click launcher)
REM Runs setup.ps1 in the same folder, bypassing the execution policy.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"

echo.
pause
