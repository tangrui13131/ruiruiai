@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if %errorlevel% neq 0 (
    echo.
    echo Platform exited with code %errorlevel%.
    pause
)