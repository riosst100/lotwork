@echo off
cd /d "%~dp0"
echo Running lotwork setup...
echo (This will install Caddy if needed and create a Desktop shortcut)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
echo.
pause
