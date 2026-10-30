@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo  Starting Inbox...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not on PATH.
  echo Install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js and tick "Add to PATH".
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)"
if errorlevel 1 (
  echo This project needs Node.js 22 or newer. You have:
  node -v
  pause
  exit /b 1
)

set "NODE_OPTIONS=--experimental-sqlite"
set "CORS_ORIGIN=http://localhost:5173"
set "DEMO_MODE="

if exist ".evolution\dist\main.js" (
  echo Starting Evolution API...
  start "Evolution API" /D "%~dp0.evolution" cmd /k node dist/main
  echo.
) else (
  set "DEMO_MODE=true"
  echo Evolution API is not installed. Inbox will start in demo mode ^(no live WhatsApp QR^).
  echo To install it, start PostgreSQL and run infra/evolution/setup.sh from Git Bash.
  echo.
)

if not exist "backend\.env" (
  echo Creating backend\.env for this machine...
  (
    echo DEMO_MODE=%DEMO_MODE%
    echo EVOLUTION_API_URL=http://localhost:18080
    echo EVOLUTION_API_KEY=your-secret-key-here
    echo WEBHOOK_URL=http://localhost:3001/webhook/whatsapp
    echo WEBHOOK_SECRET=dev-webhook-secret
    echo ASSIGNMENT_MODE=manual
    echo CORS_ORIGIN=http://localhost:5173
  ) > "backend\.env"
)

if not exist "backend\node_modules\" (
  echo Installing backend packages...
  pushd backend
  call npm install
  if errorlevel 1 (
    echo Backend npm install failed.
    popd
    pause
    exit /b 1
  )
  popd
)

if not exist "frontend\node_modules\" (
  echo Installing frontend packages...
  pushd frontend
  call npm install
  if errorlevel 1 (
    echo Frontend npm install failed.
    popd
    pause
    exit /b 1
  )
  popd
)

echo Starting API on http://127.0.0.1:3001
start "Inbox API" /D "%~dp0backend" cmd /k npx tsx watch src/index.ts

echo Starting UI on http://localhost:5173
start "Inbox UI" /D "%~dp0frontend" cmd /k npm run dev

echo Waiting for the API to listen on port 3001...
set "API_READY="
for /l %%i in (1,1,40) do (
  curl -sf http://127.0.0.1:3001/health >nul 2>&1
  if not errorlevel 1 (
    set "API_READY=1"
    goto :api_ready
  )
  timeout /t 1 /nobreak >nul
)

:api_ready
echo.
if not defined API_READY (
  echo  The UI is up, but the API is NOT running on port 3001.
  echo  That is why login fails with ECONNREFUSED.
  echo.
  echo  Open the window titled "Inbox API" and read the error.
  echo  Typical fix: in that window run:
  echo    npx tsx watch src/index.ts
  echo.
) else (
  echo  API is ready.
)
echo  Inbox:  http://localhost:5173
echo  API:    http://127.0.0.1:3001/health
echo.
echo  alice@acme.test / AcmeAdmin!1
echo  bob@acme.test   / AcmeManager!1
echo  riya@acme.test  / AcmeAgent!1
echo.
echo  Leave the Inbox API and Inbox UI windows open.
echo.
pause
