@echo off
set NODE_OPTIONS=--no-warnings
chcp 65001 >nul
title OpenCode Launcher
cd /d "%~dp0\.."
call ocl %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [OpenCode Launcher] 进程已退出，按任意键关闭窗口...
    pause >nul
)
