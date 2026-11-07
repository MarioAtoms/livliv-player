@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on PATH.
  exit /b 1
)
node server.mjs --stop
exit /b %errorlevel%
