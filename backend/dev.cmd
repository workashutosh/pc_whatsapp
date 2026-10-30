@echo off
cd /d "%~dp0"
set "NODE_OPTIONS=--experimental-sqlite"
npx tsx watch src/index.ts
