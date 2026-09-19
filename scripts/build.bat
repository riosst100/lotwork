@echo off
cd /d "%~dp0.."
echo Building lotwork-server.exe ...
call npm run build
echo.
echo Selesai. File ada di dist\lotwork-server.exe
pause
