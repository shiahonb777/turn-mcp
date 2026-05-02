@echo off
setlocal enabledelayedexpansion
title Turn MCP Web Console

echo.
echo   Turn MCP Web  --  Starting up...
echo.

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

echo.
echo   +------------------------------------------------+
echo   ^|  Web Console    http://127.0.0.1:3737/         ^|
echo   ^|  MCP Endpoint   http://127.0.0.1:3737/mcp      ^|
echo   +------------------------------------------------+
echo.
echo   Press  Ctrl+C  to stop the server.
echo.

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3737 " ^| findstr "LISTENING"') do (
    echo   Stopping old server on port 3737 (PID %%p)...
    taskkill /PID %%p /F >nul 2>&1
    timeout /t 1 /nobreak >nul
)

start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:3737/"

node dist\server.js
pause
