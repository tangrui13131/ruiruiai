@echo off
setlocal

title Future Cup Local Demo
cd /d "%~dp0"

set "PS_SCRIPT=%~dp0start-future-cup-local.ps1"

if not exist "%PS_SCRIPT%" (
  echo [ERROR] PowerShell launcher not found:
  echo %PS_SCRIPT%
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Future Cup local demo exited with code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
