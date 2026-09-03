@echo off
cd /d "%~dp0"
set "NODE_DIR=%USERPROFILE%\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64"
set "PATH=%NODE_DIR%;%PATH%"
set "VITE_DATA_SOURCE=local"

where wmic >nul 2>nul
if not errorlevel 1 (
  wmic process where name="electron.exe" call terminate >nul 2>nul
)

taskkill /F /IM electron.exe >nul 2>nul
call "%NODE_DIR%\npm.cmd" run desktop:dev
