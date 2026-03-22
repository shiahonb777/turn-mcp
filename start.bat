@echo off
setlocal enabledelayedexpansion
title Turn MCP Web Console

echo.
echo   Turn MCP Web  --  Starting up...
echo.

:: ── 1. Check Node.js ─────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo   [ERROR] Node.js not found.
    echo.
    echo   Install Node.js ^>= 18 from https://nodejs.org
    echo   Or via winget:  winget install OpenJS.NodeJS
    echo.
    pause
    exit /b 1
)

:: Check version >= 18
for /f "tokens=*" %%v in ('node -e "process.exit(+process.versions.node.split('.')[0] < 18)"') do (
    if errorlevel 1 (
        echo   [WARN] Node.js is too old. Required: ^>= 18.17
        for /f %%i in ('node --version') do echo   Current: %%i
        echo   Please upgrade from https://nodejs.org
        echo.
        pause
        exit /b 1
    )
)

for /f "tokens=*" %%i in ('node --version') do echo   OK  Node.js %%i

:: ── 2. Install dependencies if absent ────────────────────────
if not exist "node_modules\@modelcontextprotocol" (
    echo.
    echo   Installing dependencies (first run only)...
    call npm install
    if errorlevel 1 (
        echo   [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo   OK  Dependencies installed
)

:: ── 3. Build TypeScript if dist\ is missing ───────────────────
if not exist "dist\server.js" (
    echo.
    echo   Building project...
    call npm run build
    if errorlevel 1 (
        echo   [ERROR] Build failed.
        pause
        exit /b 1
    )
    echo   OK  Build complete
)

:: ── 4. Print info banner ──────────────────────────────────────
echo.
echo   +------------------------------------------------+
echo   ^|  Web Console    http://127.0.0.1:3737/         ^|
echo   ^|  MCP Endpoint   http://127.0.0.1:3737/mcp      ^|
echo   +------------------------------------------------+
echo.
echo   Press  Ctrl+C  to stop the server.
echo.

:: ── 5. Open browser after 2 seconds ──────────────────────────
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:3737/"

:: ── 6. Run server ─────────────────────────────────────────────
node dist\server.js
pause
