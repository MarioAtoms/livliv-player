@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo This package expects the machine's existing Node 24.22.1. It does not install packages.
  exit /b 1
)
if "%PORT%"=="" set PORT=8877
echo.
echo Lip-sync comparison
echo   Open Edge to http://127.0.0.1:%PORT%/
echo   Leave this window open. Stop with STOP-WINDOWS.cmd or Ctrl+C.
echo   Ports 3900 and 8790 are refused.
echo.
node server.mjs
exit /b %errorlevel%
