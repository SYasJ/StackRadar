@echo off
rem Double-click me (Windows). Opens StackRadar in your default browser.
cd /d "%~dp0"
set PORT=8765
set ROOT=%USERPROFILE%
echo StackRadar starting... scanning %ROOT% (port %PORT%)
echo Then open http://localhost:%PORT%  - closing this window stops the app.
python stackradar.py --port %PORT% --root %ROOT% --open
echo.
pause
