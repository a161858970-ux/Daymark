@echo off
title CourseManager API (watchdog)
rem Health-based watchdog for the local API.
rem The old loop waited for `pnpm ... tsx src/main.ts` to return, but pnpm can
rem hang forever after its child dies (or after a mid-tree taskkill), which
rem left the service down silently. This version never waits on the child:
rem it launches it, then polls health and restarts by killing whatever still
rem claims to run src/main.ts.
set LOG=C:\Users\LIU\AppData\Local\Temp\cm-api.log
set HEALTH_URL=http://127.0.0.1:3100/api/v1/health

:loop
cd /d E:\CUFE\vibecoding\course-manager\course-manager
echo [%date% %time%] watchdog: launching api>> "%LOG%"
start "cm-api-run" /b cmd /c "pnpm --filter @course-manager/api exec tsx src/main.ts >> ""%LOG%"" 2>&1"

:check
ping -n 11 127.0.0.1 >nul
curl.exe -s -o NUL -f --max-time 5 "%HEALTH_URL%"
if not errorlevel 1 goto check

echo [%date% %time%] watchdog: health check failed - restarting>> "%LOG%"
call :kill_run
ping -n 4 127.0.0.1 >nul
goto loop

rem Kills the listener on 3100 and any leftover process still claiming to
rem run the API (pnpm/tsx that never returned after a hung child). The
rem match string is assembled from pieces so this command line does not
rem contain the very substring it hunts for, otherwise PowerShell would kill
rem itself first and skip the leftovers.
:kill_run
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3100 "') do taskkill /F /PID %%p >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like ('*'+'src'+'/main'+'.ts*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
exit /b
