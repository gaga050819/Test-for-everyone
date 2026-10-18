[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "SecureExam - Сервер тестування"

# Увімкнення сучасних протоколів безпеки TLS 1.2 / TLS 1.3 (критично для Windows 10 PowerShell 5.1)
try {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls11 -bor [System.Net.SecurityProtocolType]::Tls
} catch {}

# Вимикаємо інтерактивний прогрес-бар PowerShell, що гальмує або заморожує завантаження у консолі
$ProgressPreference = 'SilentlyContinue'

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
Set-Location -LiteralPath $scriptDir

# Надійне універсальне завантаження файлів з кількох джерел з перевіркою
function Download-FileWithFallbacks {
    param(
        [Parameter(Mandatory=$true)][string[]]$Urls,
        [Parameter(Mandatory=$true)][string]$OutFile,
        [Parameter(Mandatory=$false)][int]$MinBytes = 50000
    )

    $parentDir = Split-Path -Parent $OutFile
    if ($parentDir -and -not (Test-Path -LiteralPath $parentDir)) {
        New-Item -ItemType Directory -LiteralPath $parentDir -Force | Out-Null
    }

    if (Test-Path -LiteralPath $OutFile) {
        Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
    }

    $curlPath = $null
    $sysCurl = Join-Path $env:windir "System32\curl.exe"
    if (Test-Path -LiteralPath $sysCurl) {
        $curlPath = $sysCurl
    } else {
        $cCmd = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($cCmd) { $curlPath = $cCmd.Source }
    }

    foreach ($url in $Urls) {
        Write-Host "   -> Завантаження: $url" -ForegroundColor Gray

        # Спосіб 1: curl.exe (вбудований у Windows 10, нативний TLS, без IE)
        if ($curlPath) {
            try {
                & $curlPath -fSL --retry 2 --connect-timeout 15 -o "$OutFile" "$url" 2>$null
                if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $OutFile)) {
                    if ((Get-Item -LiteralPath $OutFile).Length -ge $MinBytes) {
                        return $true
                    }
                }
            } catch {}
        }

        # Спосіб 2: .NET System.Net.WebClient (працює без IE-движка)
        try {
            $wc = New-Object System.Net.WebClient
            $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            $wc.DownloadFile($url, $OutFile)
            $wc.Dispose()
            if ((Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -ge $MinBytes)) {
                return $true
            }
        } catch {}

        # Спосіб 3: Invoke-WebRequest з -UseBasicParsing (обов'язково для Windows 10)
        try {
            Invoke-WebRequest -Uri $url -OutFile $OutFile -UseBasicParsing -UserAgent "Mozilla/5.0" -TimeoutSec 60 -ErrorAction Stop
            if ((Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -ge $MinBytes)) {
                return $true
            }
        } catch {}

        # Спосіб 4: BITS Transfer
        try {
            $bitsCmd = Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue
            if ($bitsCmd) {
                Start-BitsTransfer -Source $url -Destination $OutFile -ErrorAction Stop
                if ((Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -ge $MinBytes)) {
                    return $true
                }
            }
        } catch {}
    }

    return $false
}

# Надійне розпакування zip-архівів (сумісне з Windows 10 та FAT32/exFAT)
function Extract-ArchiveWithFallbacks {
    param(
        [Parameter(Mandatory=$true)][string]$ZipPath,
        [Parameter(Mandatory=$true)][string]$DestinationPath,
        [Parameter(Mandatory=$false)][string]$ExpectedFileName = "ngrok.exe"
    )

    if (-not (Test-Path -LiteralPath $ZipPath)) { return $false }
    if (-not (Test-Path -LiteralPath $DestinationPath)) {
        New-Item -ItemType Directory -LiteralPath $DestinationPath -Force | Out-Null
    }

    $targetFile = Join-Path $DestinationPath $ExpectedFileName

    # Спосіб 1: Expand-Archive (стандартний для PowerShell, стабільний на FAT32/exFAT)
    try {
        Expand-Archive -LiteralPath $ZipPath -DestinationPath $DestinationPath -Force -ErrorAction Stop
        if (Test-Path -LiteralPath $targetFile) {
            return $true
        }
    } catch {}

    # Спосіб 2: tar.exe з параметром -m (без відновлення часу модифікації, що усуває помилки FAT32)
    $tarPath = Join-Path $env:windir "System32\tar.exe"
    if (Test-Path -LiteralPath $tarPath) {
        try {
            & $tarPath -xf "$ZipPath" -m -C "$DestinationPath" 2>$null
            if (Test-Path -LiteralPath $targetFile) {
                return $true
            }
        } catch {}
    }

    # Спосіб 3: .NET ZipFile
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
        [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $DestinationPath)
        if (Test-Path -LiteralPath $targetFile) {
            return $true
        }
    } catch {}

    # Спосіб 4: Shell.Application COM-об'єкт
    try {
        $shell = New-Object -ComObject Shell.Application
        $zipFolder = $shell.Namespace((Resolve-Path -LiteralPath $ZipPath).Path)
        $destFolder = $shell.Namespace((Resolve-Path -LiteralPath $DestinationPath).Path)
        if ($zipFolder -and $destFolder) {
            $destFolder.CopyHere($zipFolder.Items(), 16)
            if (Test-Path -LiteralPath $targetFile) {
                return $true
            }
        }
    } catch {}

    return (Test-Path -LiteralPath $targetFile)
}

# Якщо .env немає — пробуємо скопіювати з .env.flash
$envFile = Join-Path $scriptDir ".env"
$envFlash = Join-Path $scriptDir ".env.flash"
if (-not (Test-Path -LiteralPath $envFile) -and (Test-Path -LiteralPath $envFlash)) {
    Copy-Item -LiteralPath $envFlash -Destination $envFile -Force
    Write-Host "[+] Файл .env скопійовано автоматично." -ForegroundColor Green
}

# Зчитування конфігурації .env для токена ngrok
$envNgrokToken = $null
if (Test-Path -LiteralPath $envFile) {
    try {
        $lines = Get-Content -LiteralPath $envFile -Encoding UTF8 -ErrorAction SilentlyContinue
        foreach ($l in $lines) {
            $trimmed = $l.Trim()
            if ($trimmed -and -not $trimmed.StartsWith("#")) {
                $idx = $trimmed.IndexOf("=")
                if ($idx -gt 0) {
                    $k = $trimmed.Substring(0, $idx).Trim()
                    $v = $trimmed.Substring($idx + 1).Trim()
                    if ($k -eq "NGROK_AUTHTOKEN" -or $k -eq "NGROK_TOKEN") {
                        $envNgrokToken = $v
                    }
                }
            }
        }
    } catch {}
}

# 1. Перевірка та встановлення Node.js
$possibleNodeDirs = @("C:\Program Files\nodejs", "$env:LOCALAPPDATA\Programs\nodejs", "$env:APPDATA\npm")
foreach ($dir in $possibleNodeDirs) {
    if ((Test-Path -LiteralPath $dir) -and ($env:PATH -notlike "*$dir*")) {
        $env:PATH = "$dir;$env:PATH"
    }
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "==========================================================" -ForegroundColor Yellow
    Write-Host "[ВСТАНОВЛЕННЯ] Node.js не знайдено. Автоматичне завантаження..." -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Yellow
    
    $nodeInstalled = $false
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        Write-Host "Спроба встановлення через winget..." -ForegroundColor Gray
        & winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -eq 0) { $nodeInstalled = $true }
    }
    
    if (-not $nodeInstalled) {
        $is64 = [Environment]::Is64BitOperatingSystem
        $nodeUrl = if ($is64) {
            "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
        } else {
            "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x86.msi"
        }
        $msiPath = Join-Path $env:TEMP "node_setup.msi"
        $downloadOk = Download-FileWithFallbacks -Urls @($nodeUrl) -OutFile $msiPath -MinBytes 10000000
        if ($downloadOk) {
            Write-Host "Встановлення Node.js через MSI..." -ForegroundColor Gray
            Start-Process msiexec.exe -ArgumentList "/i", "`"$msiPath`"", "/passive", "/norestart" -Wait
            Remove-Item -LiteralPath $msiPath -Force -ErrorAction SilentlyContinue
        }
    }
    
    foreach ($dir in $possibleNodeDirs) {
        if ((Test-Path -LiteralPath $dir) -and ($env:PATH -notlike "*$dir*")) {
            $env:PATH = "$dir;$env:PATH"
        }
    }
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
}

if (-not $nodeCmd) {
    Write-Host "[ПОМИЛКА] Не вдалося встановити Node.js. Спробуйте запустити від імені адміністратора або встановіть вручну з https://nodejs.org" -ForegroundColor Red
    Read-Host 'Натисніть Enter для виходу...'
    exit 1
}

# 2. Зупиняємо старі процеси ngrok перед перевіркою чи оновленням
Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
try {
    $occupied = Get-NetTCPConnection -LocalPort 3500 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $occupied) {
        if ($p -gt 0) {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
} catch {}


# 3. Перевірка та автоматичне завантаження ngrok
$ngrokFile = Join-Path $scriptDir "ngrok.exe"
$ngrokCmd = $null

if (Test-Path -LiteralPath $ngrokFile) {
    $ngrokCmd = $ngrokFile
} else {
    $ngrokSys = Get-Command ngrok -ErrorAction SilentlyContinue
    if ($ngrokSys) {
        $ngrokCmd = $ngrokSys.Source
    }
}

if (-not $ngrokCmd -or -not (Test-Path -LiteralPath $ngrokFile)) {
    Write-Host "==========================================================" -ForegroundColor Yellow
    Write-Host "[ВСТАНОВЛЕННЯ] Ngrok не знайдено. Автоматичне завантаження..." -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Yellow

    $is64 = [Environment]::Is64BitOperatingSystem
    $arch = if ($is64) { "amd64" } else { "386" }
    $ngrokUrls = @(
        "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-$arch.zip",
        "https://bin.ngrok.com/c/bNyj1mQVY4c/ngrok-v3-stable-windows-$arch.zip"
    )

    $zipPath = Join-Path $env:TEMP "ngrok_v3_win.zip"
    $downloadOk = Download-FileWithFallbacks -Urls $ngrokUrls -OutFile $zipPath -MinBytes 5000000

    if ($downloadOk) {
        Write-Host "Розпакування ngrok.exe у робочу директорію..." -ForegroundColor Gray
        $extractOk = Extract-ArchiveWithFallbacks -ZipPath $zipPath -DestinationPath $scriptDir -ExpectedFileName "ngrok.exe"
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
        Unblock-File -LiteralPath $ngrokFile -ErrorAction SilentlyContinue
    } else {
        Write-Host "[ПОПЕРЕДЖЕННЯ] Не вдалося завантажити архів ngrok безпосередньо." -ForegroundColor Yellow
    }

    if (Test-Path -LiteralPath $ngrokFile) {
        $ngrokCmd = $ngrokFile
        Write-Host "[УСПІХ] Ngrok успішно завантажено та встановлено!" -ForegroundColor Green
    } else {
        # Резервний спосіб через winget
        $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
        if ($wingetCmd) {
            Write-Host "Спроба встановлення ngrok через winget..." -ForegroundColor Gray
            & winget install ngrok -s msstore --accept-source-agreements --accept-package-agreements
            $ngrokSys = Get-Command ngrok -ErrorAction SilentlyContinue
            if ($ngrokSys) { $ngrokCmd = $ngrokSys.Source }
        }
    }
}

# 4. Налаштування токена ngrok, якщо він є у .env
if ($ngrokCmd -and $envNgrokToken) {
    try {
        Write-Host "[КОНФІГУРАЦІЯ] Застосування NGROK_AUTHTOKEN з .env..." -ForegroundColor Gray
        & $ngrokCmd config add-authtoken $envNgrokToken 2>$null
    } catch {}
}

# 5. Встановлення node_modules
$nodeModulesDir = Join-Path $scriptDir "node_modules"
if (-not (Test-Path -LiteralPath $nodeModulesDir)) {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "[ІНІЦІАЛІЗАЦІЯ] Встановлення залежностей пакетів (npm install)..." -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    & npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ПОМИЛКА] Не вдалося встановити бібліотеки." -ForegroundColor Red
        Read-Host 'Натисніть Enter для виходу...'
        exit 1
    }
}

# 6. Запуск тунелю ngrok
$ngrokProcess = $null
if ($ngrokCmd) {
    try {
        $ngrokProcess = Start-Process -FilePath $ngrokCmd -ArgumentList "http", "3500", "--log=stdout" -WindowStyle Minimized -PassThru -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
        if ($ngrokProcess -and $ngrokProcess.HasExited) {
            Write-Host "[УВАГА] Ngrok не зміг підключитися (код виходу: $($ngrokProcess.ExitCode))." -ForegroundColor Yellow
            Write-Host "         Для глобального доступу через інтернет потрібен безкоштовний токен:" -ForegroundColor Gray
            Write-Host "         1. Отримайте токен на https://dashboard.ngrok.com" -ForegroundColor Gray
            Write-Host "         2. Додайте у файл .env рядок: NGROK_AUTHTOKEN=ваш_токен" -ForegroundColor Gray
            Write-Host '         Локальний доступ: Wi-Fi та локальна мережа без обмежень.' -ForegroundColor Gray
            $ngrokProcess = $null
        } else {
            Write-Host "[+] Фоновий процес ngrok активний." -ForegroundColor Green
        }
    } catch {
        Write-Host "[ПОПЕРЕДЖЕННЯ] Помилка запуску ngrok: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "[УВАГА] Ngrok не знайдено. Сервер буде доступний лише по локальній мережі (Wi-Fi)." -ForegroundColor Yellow
}

# 7. Відкриття адмін-панелі у браузері
Start-Process "http://localhost:3500/admin.html"

try {
    $occupied = Get-NetTCPConnection -LocalPort 3500 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $occupied) {
        if ($p -gt 0) {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
    $portPids = netstat -ano | Select-String ":3500\s.*LISTENING" | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique
    foreach ($p in $portPids) {
        if ($p -as [int] -and [int]$p -gt 0) {
            Stop-Process -Id ([int]$p) -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Milliseconds 400
} catch {}

try {
    while ($true) {
        & node "server/index.js"
        $serverExitCode = $LASTEXITCODE
        if ($serverExitCode -eq 100) {
            Write-Host "==========================================================" -ForegroundColor Cyan
            Write-Host "[ОНОВЛЕННЯ] Сервер перезапускається після оновлення..." -ForegroundColor Cyan
            Write-Host "==========================================================" -ForegroundColor Cyan
            Start-Sleep -Seconds 1
            continue
        }
        break
    }
} catch {
    Write-Host "[ПОМИЛКА] Помилка запуску сервера: $_" -ForegroundColor Red
} finally {
    if ($ngrokProcess) {
        Stop-Process -Id $ngrokProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

if ($serverExitCode -and $serverExitCode -ne 0 -and $serverExitCode -ne 100) {
    Write-Host "[УВАГА] Сервер завершив роботу з кодом: $serverExitCode" -ForegroundColor Yellow
    Read-Host 'Натисніть Enter для завершення...'
}

