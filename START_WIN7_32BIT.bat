@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title SecureExam - Windows 7 (32-bit / x86 Portable)
cd /d "%~dp0"

set NODE_SKIP_PLATFORM_CHECK=1

if exist "%~dp0win7_x86\node\node.exe" (
    set "PATH=%~dp0win7_x86\node;%PATH%"
) else if exist "%~dp0node\node.exe" (
    set "PATH=%~dp0node;%PATH%"
) else (
    if exist "C:\Program Files (x86)\nodejs\node.exe" set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
    if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
)

where node >nul 2>&1
if errorlevel 1 (
    cls
    echo =============================================================
    echo [ПОМИЛКА] 32-бітний Node.js не знайдено!
    echo =============================================================
    echo Переконайтеся, що папка win7_x86\node містить node.exe
    echo або встановіть Node.js v14.21.3 (x86):
    echo https://nodejs.org/dist/v14.21.3/node-v14.21.3-x86.msi
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

set "NGROK_CMD=%~dp0win7_x86\ngrok.exe"
if not exist "%NGROK_CMD%" (
    if exist "%~dp0ngrok.exe" set "NGROK_CMD=%~dp0ngrok.exe"
)

set "NGROK_RUNNABLE=0"
if exist "%NGROK_CMD%" (
    "%NGROK_CMD%" version >nul 2>&1
    if not errorlevel 1 (
        set "NGROK_RUNNABLE=1"
    ) else (
        echo [!] Ngrok несумісний із поточною системою або вимкнено.
        echo     Сервер працюватиме в локальній мережі (Wi-Fi).
    )
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

if "!NGROK_RUNNABLE!"=="1" (
    if defined ENV_TOKEN (
        "%NGROK_CMD%" config add-authtoken !ENV_TOKEN! >nul 2>&1
    )
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

set "NGROK_URL="
if "!NGROK_RUNNABLE!"=="1" (
    start "SecureExam Ngrok Tunnel (32-bit)" /min "%NGROK_CMD%" http 3500 --log=stdout
    ping 127.0.0.1 -n 3 >nul

    for /f "tokens=*" %%u in ('node -e "require('http').get('http://127.0.0.1:4040/api/tunnels',r=>{let d='';r.on('data',c=>{d+=c});r.on('end',()=>{try{const j=JSON.parse(d);if(j.tunnels){const t=j.tunnels.find(x=>x.public_url.startsWith('https://'))||j.tunnels[0];if(t)process.stdout.write(t.public_url);}}catch(e){}});}).on('error',()=>{});"') do (
        set "NGROK_URL=%%u"
    )
)

set "LOCAL_IP="
for /f "tokens=*" %%i in ('node -e "const os=require('os');const ifs=os.networkInterfaces();let ip='localhost';for(const n in ifs){for(const a of ifs[n]){if(a.family==='IPv4'){if(!a.internal){ip=a.address;break;}}}}process.stdout.write(ip);"') do (
    set "LOCAL_IP=%%i"
)

cls
echo =============================================================
echo          SecureExam - СИСТЕМА НЕЗАЛЕЖНОГО ТЕСТУВАННЯ
echo                Windows 7 (32-бітний портативний режим)
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
    if "!NGROK_RUNNABLE!"=="1" (
        echo  [!] Ngrok запускається або очікує на токен.
        echo      Перевірте веб-інтерфейс: http://127.0.0.1:4040
        echo.
    ) else (
        echo  [i] Працює в автономному режимі локальної мережі (Wi-Fi).
        echo.
    )
)
if defined LOCAL_IP (
    echo  [3] РЕЗЕРВНЕ ПОСИЛАННЯ (Wi-Fi / локальна мережа в класі):
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
