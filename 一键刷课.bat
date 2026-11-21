@echo off
REM ---------------------------------------------------------------
REM  This file is intentionally ASCII-only.
REM  Chinese text in a .bat gets mangled because cmd tracks byte
REM  offsets line by line: a multi-byte char shifts the pointer and
REM  the next line starts mid-way ("'et' is not recognized").
REM  All user-facing Chinese lives in src\wizard.mjs instead.
REM ---------------------------------------------------------------
chcp 65001 >nul 2>nul
setlocal EnableExtensions
title Unipus Runner
cd /d "%~dp0"

echo.
echo  ============================================================
echo     U Campus  -  Auto Runner
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
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-node.ps1"
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

if not exist "src\wizard.mjs" (
    echo  [x] Missing src\wizard.mjs - this folder is incomplete.
    echo      Please extract the release package again.
    echo.
    pause
    exit /b 1
)

REM ---------------------------------------------------------------
REM  Launch node in its OWN console and exit this batch immediately.
REM
REM  Why: if cmd.exe runs node directly, pressing Ctrl+C makes cmd
REM  sit on its "Terminate batch job (Y/N)?" prompt and it stops
REM  executing the rest of this file. The window stays open forever
REM  and the program looks unstoppable - node itself already exited.
REM
REM  With start, node gets a fresh console with no cmd in between.
REM  Ctrl+C then goes straight to node, which exits cleanly.
REM ---------------------------------------------------------------

"%NODE_EXE%" --version >nul 2>nul
if errorlevel 1 goto :noenv

start "Unipus Runner" "%NODE_EXE%" "src\wizard.mjs"
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