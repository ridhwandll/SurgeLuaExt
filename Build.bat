@echo off
rem Copyright (c) RidT. Licensed under the MIT License, see LICENSE.txt
rem Packs surge-lua-<version>.vsix. Arguments go to Scripts\Build.js (--install installs it into VS Code).
rem Uses Node when it is on PATH, otherwise the Node runtime inside VS Code (no separate install needed).
setlocal
set "SCRIPT=%~dp0Scripts\Build.js"

where node >nul 2>nul
if %errorlevel%==0 (
    node "%SCRIPT%" %*
    exit /b %errorlevel%
)

set "CODE_EXE=%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"
if not exist "%CODE_EXE%" set "CODE_EXE=%ProgramFiles%\Microsoft VS Code\Code.exe"
if not exist "%CODE_EXE%" (
    echo [Surge] Neither Node nor VS Code was found. Install one of them and run this again.
    exit /b 1
)

set ELECTRON_RUN_AS_NODE=1
"%CODE_EXE%" "%SCRIPT%" %*
exit /b %errorlevel%
