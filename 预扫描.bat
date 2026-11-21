@echo off
REM ---------------------------------------------------------------
REM  Pre-scan launcher. ASCII-only on purpose - same reason as the main launcher.
REM  Crawls the task list for one or more courses and saves it, so
REM  later runs skip the slow crawl and read the saved result.
REM ---------------------------------------------------------------
chcp 65001 >nul 2>nul
setlocal EnableExtensions
title Unipus Prescan
cd /d "%~dp0"

echo.
echo  ============================================================
echo     U Campus  -  Pre-scan (save task list ahead of time)
echo  ============================================================
echo.

set "NODE_EXE="
set "NODE_SRC="

if exist "runtime\node\node.exe" (
    set "NODE_EXE=runtime\node\node.exe"
    set "NODE_SRC=bundled"
    goto :ready
)

where node >nul 2>nul
if not errorlevel 1 (
    set "NODE_EXE=node"
    set "NODE_SRC=system"
    goto :ready
)

echo  Node.js not found. Downloading a portable copy (one time only)...
echo  No action needed. This may take a few minutes on slow networks.
echo.
REM Use the full path: some machines have a trimmed PATH where plain
REM "powershell" is not resolvable, and then the installer never runs.
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" set "PS_EXE=powershell"
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "scripts\install-node.ps1"
echo.

if exist "runtime\node\node.exe" (
    set "NODE_EXE=runtime\node\node.exe"
    set "NODE_SRC=bundled"
    goto :ready
)
where node >nul 2>nul
if not errorlevel 1 (
    set "NODE_EXE=node"
    set "NODE_SRC=system"
    goto :ready
)
goto :noenv

:ready
if exist "%~dp0runtime\node" set "PATH=%~dp0runtime\node;%PATH%"

if not exist "src\prescan.mjs" (
    echo  [x] Missing src\prescan.mjs - this folder is incomplete.
    echo      Please extract the release package again.
    echo.
    pause
    exit /b 1
)

REM Same reason as the main launcher: start node in its own console so
REM Ctrl+C reaches node directly instead of getting stuck in cmd.
"%NODE_EXE%" --version >nul 2>nul
if errorlevel 1 goto :noenv

start "Unipus Prescan" "%NODE_EXE%" "src\prescan.mjs"
exit /b 0

:noenv
echo.
echo  [x] Node.js is not usable.
echo.
echo      Install it manually, then run this file again:
echo        1. Open  https://nodejs.org/en/download
echo        2. Download the Windows Installer (.msi, LTS)
echo        3. Click Next until it finishes
echo.
pause
exit /b 1