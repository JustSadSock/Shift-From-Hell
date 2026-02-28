@echo off
setlocal EnableExtensions EnableDelayedExpansion

chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

if not exist "logs" mkdir "logs"

set "TS=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TS=%TS: =0%"
set "MAIN_LOG=logs\start_%TS%.log"
set "SERVER_OUT_LOG=logs\server_out_%TS%.log"
set "SERVER_ERR_LOG=logs\server_err_%TS%.log"
set "TUNNEL_LOG=logs\tunnel_%TS%.log"
set "PID_FILE=logs\server_pid_%TS%.txt"

call :log "════════ Shift From Hell launch started ════════"
call :log "Рабочая директория: %SCRIPT_DIR%"
call :log "Основной лог: %MAIN_LOG%"

call :require_command node || goto :fatal
call :require_command npm || goto :fatal
call :require_command cloudflared || goto :fatal
call :require_command powershell || goto :fatal

if not exist "node_modules" (
    call :log "[setup] node_modules не найден. Выполняю npm install..."
    call :run_and_log "npm install" || goto :fatal
) else (
    call :log "[setup] Зависимости уже установлены."
)

call :log "[server] Запускаю Shift From Hell на http://localhost:3000 ..."
if exist "%PID_FILE%" del /f /q "%PID_FILE%" >nul 2>&1
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $p = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%SCRIPT_DIR%' -RedirectStandardOutput '%SCRIPT_DIR%%SERVER_OUT_LOG%' -RedirectStandardError '%SCRIPT_DIR%%SERVER_ERR_LOG%' -PassThru; Set-Content -Path '%SCRIPT_DIR%%PID_FILE%' -Value $p.Id -Encoding ascii" >> "%MAIN_LOG%" 2>&1
if errorlevel 1 (
    call :log "[error] Не удалось запустить server.js через PowerShell."
    call :show_tail "%MAIN_LOG%"
    goto :fatal
)

if not exist "%PID_FILE%" (
    call :log "[error] Не удалось получить PID сервера (файл PID не создан)."
    goto :fatal
)

set /p SERVER_PID=<"%PID_FILE%"
set "PID_BAD="
for /f "delims=0123456789" %%A in ("%SERVER_PID%") do set "PID_BAD=%%A"
if not defined SERVER_PID (
    call :log "[error] PID сервера пустой."
    goto :fatal
)
if defined PID_BAD (
    call :log "[error] Получен некорректный PID: %SERVER_PID%"
    call :show_tail "%MAIN_LOG%"
    goto :fatal
)

call :log "[server] PID=%SERVER_PID%"
timeout /t 2 /nobreak >nul
call :ensure_server_alive || goto :fatal

echo.
echo   ⚙  SHIFT FROM HELL  ⚙
echo   Локальная игра: http://localhost:3000
echo.

call :log "[tunnel] Запускаю cloudflared tunnel run irgri-tunnel ..."
cloudflared tunnel run irgri-tunnel >> "%TUNNEL_LOG%" 2>&1
if errorlevel 1 (
    call :log "[error] cloudflared завершился с ошибкой (код !errorlevel!)."
    call :show_tail "%TUNNEL_LOG%"
    goto :fatal
)

call :log "[shutdown] Тоннель завершён. Останавливаю сервер..."
call :stop_server
call :log "Готово."
exit /b 0

:require_command
where %~1 >nul 2>&1
if errorlevel 1 (
    call :log "[error] Команда '%~1' не найдена в PATH."
    exit /b 1
)
call :log "[check] Найдена команда: %~1"
exit /b 0

:run_and_log
set "STEP_CMD=%~1"
call :log "[run] !STEP_CMD!"
cmd /c "!STEP_CMD!" >> "%MAIN_LOG%" 2>&1
if errorlevel 1 (
    call :log "[error] Ошибка на шаге: !STEP_CMD! (код !errorlevel!)."
    call :show_tail "%MAIN_LOG%"
    exit /b 1
)
call :log "[ok] Шаг успешно завершён: !STEP_CMD!"
exit /b 0

:ensure_server_alive
tasklist /FI "PID eq %SERVER_PID%" | find "%SERVER_PID%" >nul
if errorlevel 1 (
    call :log "[error] Сервер завершился сразу после запуска. Проверяю логи сервера..."
    call :show_tail "%SERVER_OUT_LOG%"
    call :show_tail "%SERVER_ERR_LOG%"
    exit /b 1
)
exit /b 0

:show_tail
set "LOG_TO_SHOW=%~1"
if not exist "%LOG_TO_SHOW%" (
    call :log "[warn] Лог не найден: %LOG_TO_SHOW%"
    exit /b 0
)
call :log "[debug] Последние строки из %LOG_TO_SHOW%:"
powershell -NoProfile -Command "Get-Content -Path '%LOG_TO_SHOW%' -Tail 40"
exit /b 0

:stop_server
if defined SERVER_PID (
    taskkill /PID %SERVER_PID% /T /F >nul 2>&1
    if errorlevel 1 (
        call :log "[warn] Не удалось остановить сервер PID=%SERVER_PID% (возможно уже завершён)."
    ) else (
        call :log "[shutdown] Сервер остановлен (PID=%SERVER_PID%)."
    )
)
exit /b 0

:fatal
call :log "[fatal] Запуск завершён с ошибкой."
call :stop_server

echo.
echo [ERROR] Запуск не удался. Подробности:
echo   - %MAIN_LOG%
echo   - %SERVER_OUT_LOG%
echo   - %SERVER_ERR_LOG%
echo   - %TUNNEL_LOG%
echo.
echo Нажмите любую клавишу, чтобы закрыть окно...
pause >nul
exit /b 1

:log
set "STAMP=%date% %time%"
echo %STAMP% %~1
echo %STAMP% %~1>> "%MAIN_LOG%"
exit /b 0
