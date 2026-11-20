@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the LTS version from https://nodejs.org/
  pause
  exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js LTS.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo Installing dependencies...
  call npm.cmd ci
  if errorlevel 1 (
    echo Installation failed. Check your internet connection.
    pause
    exit /b 1
  )
)
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:3000"
node server.js
echo Server stopped.
pause
