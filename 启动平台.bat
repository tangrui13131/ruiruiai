@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" (
    echo.
    echo Platform exited with code %EXIT_CODE%. Check the messages above for details.
    pause
)
exit /b %EXIT_CODE%
