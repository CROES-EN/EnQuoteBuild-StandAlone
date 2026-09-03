@echo off
cd /d "%~dp0"
set "NODE_DIR=%USERPROFILE%\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64"
set "PATH=%NODE_DIR%;%PATH%"
set "VITE_DATA_SOURCE=base44"
call "%NODE_DIR%\npm.cmd" run desktop
