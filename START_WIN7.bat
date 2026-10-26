@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title SecureExam - Windows 7 x64 Launcher
cd /d "%~dp0"

set NODE_SKIP_PLATFORM_CHECK=1

if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
if exist "C:\Program Files (x86)\nodejs\node.exe" set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
if exist "%APPDATA%\npm" set "PATH=%APPDATA%\npm;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
    cls
    echo =============================================================
    echo [ПОМИЛКА] Node.js не знайдено в системі!
    echo =============================================================
    echo Для роботи на Windows 7 x64 необхідно встановити Node.js.
    echo Рекомендовано версію Node.js v13.14.0 або v14.21.3 (x64):
    echo https://nodejs.org/dist/v13.14.0/node-v13.14.0-x64.msi
    echo.
    echo Встановіть Node.js та запустіть цей файл знову.
    echo =============================================================
    pause
    exit /b 1
)

if not exist ".env" (
    if exist ".env.flash" (
        copy /y ".env.flash" ".env" >nul
        echo [+] Створено файл конфігурації .env
    )
)

set "NGROK_CMD=%~dp0ngrok.exe"
if not exist "%NGROK_CMD%" (
    where ngrok >nul 2>&1
    if not errorlevel 1 (
        for /f "tokens=*" %%a in ('where ngrok') do (
            if not defined NGROK_CMD set "NGROK_CMD=%%a"
        )
    )
)

if not exist "%NGROK_CMD%" (
    cls
    echo =============================================================
    echo [ПОМИЛКА] ngrok.exe не знайдено поруч із лаунчером!
    echo =============================================================
    echo Переконайтеся, що файл ngrok.exe знаходиться в папці:
    echo %~dp0
    echo =============================================================
    pause
    exit /b 1
)

set "ENV_TOKEN="
if exist ".env" (
    for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
        set "KEY=%%A"
        set "VAL=%%B"
        if "!KEY!"=="NGROK_AUTHTOKEN" set "ENV_TOKEN=!VAL!"
        if "!KEY!"=="NGROK_TOKEN" set "ENV_TOKEN=!VAL!"
    )
)

if defined ENV_TOKEN (
    "%NGROK_CMD%" config add-authtoken !ENV_TOKEN! >nul 2>&1
)

if not exist "node_modules" (
    echo =============================================================
    echo [ВСТАНОВЛЕННЯ] Перший запуск: встановлення бібліотек...
    echo =============================================================
    call npm install
    if errorlevel 1 (
        echo [ПОМИЛКА] Не вдалося встановити бібліотеки через npm install.
        pause
        exit /b 1
    )
)

taskkill /F /IM ngrok.exe >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3500" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)

start "SecureExam Ngrok Tunnel" /min "%NGROK_CMD%" http 3500 --log=stdout

ping 127.0.0.1 -n 3 >nul

set "NGROK_URL="
for /f "tokens=*" %%u in ('node -e "const http=require('http');http.get('http://127.0.0.1:4040/api/tunnels',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const j=JSON.parse(d);if(j.tunnels^&^&j.tunnels[0])process.stdout.write(j.tunnels[0].public_url);}catch(e){}})}).on('error',()=>{});"') do (
    set "NGROK_URL=%%u"
)

set "LOCAL_IP="
for /f "tokens=*" %%i in ('node -e "const os=require('os');const ifaces=os.networkInterfaces();let ip='localhost';for(const n in ifaces){for(const a of ifaces[n]){if(a.family==='IPv4'^&^&!a.internal){ip=a.address;break;}}}process.stdout.write(ip);"') do (
    set "LOCAL_IP=%%i"
)

cls
echo =============================================================
echo          SecureExam - СИСТЕМА НЕЗАЛЕЖНОГО ТЕСТУВАННЯ
echo                   Windows 7 x64 + ngrok
echo =============================================================
echo.
echo  [1] ПАНЕЛЬ ВИКЛАДАЧА (Адміністратор):
echo      http://localhost:3500/admin.html
echo.
if defined NGROK_URL (
    echo  [2] ПУБЛІЧНЕ ПОСИЛАННЯ ДЛЯ УЧНІВ (Інтернет / ngrok):
    echo      !NGROK_URL!
    echo.
) else (
    echo  [!] Ngrok запускається або потребує токен.
    echo      Перевірте веб-інтерфейс: http://127.0.0.1:4040
    echo.
)
if defined LOCAL_IP (
    echo  [3] РЕЗЕРВНЕ ПОСИЛАННЯ (Wi-Fi / локальна мережа):
    echo      http://!LOCAL_IP!:3500
    echo.
)
echo =============================================================
echo  Браузер відкрито автоматично.
echo  Для завершення роботи натисніть Ctrl+C або закрийте вікно.
echo =============================================================
echo.

start "" "http://localhost:3500/admin.html"

node "server/index.js"

taskkill /F /IM ngrok.exe >nul 2>&1
