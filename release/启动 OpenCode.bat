@echo off
chcp 65001 >nul
title OpenCode Launcher
cd /d "%~dp0"
opencode-launcher.exe %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [OpenCode Launcher] 进程已退出，按任意键关闭...
    pause >nul
)