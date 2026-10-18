$ErrorActionPreference = "SilentlyContinue"

$projectRoot = "c:\Users\PC\Desktop\Nova pasta\Projetos\AppIngles"
$backendDir  = Join-Path $projectRoot "backend"
$mobileDir   = Join-Path $projectRoot "mobile"

$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }

# 1. Inicia o Backend Gateway (Porta 3001) de forma independente em background
$port3001 = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if (-not $port3001) {
    $cmdBackend = "cmd.exe /c node dist/index.js > server.log 2> server-error.log"
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = $cmdBackend
        CurrentDirectory = $backendDir
        ProcessStartupInformation = $si
    } | Out-Null
}

# 2. Inicia o Servidor Expo (Porta 8081) de forma independente em background
$port8081 = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
if (-not $port8081) {
    $cmdMobile = "cmd.exe /c npx expo start --lan > expo.log 2> expo-error.log"
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = $cmdMobile
        CurrentDirectory = $mobileDir
        ProcessStartupInformation = $si
    } | Out-Null
}

# 3. Inicia o Túnel Público Cloudflare (para acesso externo 4G/5G/outras redes sem servidor próprio)
$cfRunning = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue
$cfExe = Join-Path $backendDir "cloudflared.exe"
if ((-not $cfRunning) -and (Test-Path $cfExe)) {
    $cmdTunnel = "`"$cfExe`" tunnel --url http://localhost:3001 --no-autoupdate --logfile `"$backendDir\tunnel.log`""
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = $cmdTunnel
        CurrentDirectory = $backendDir
        ProcessStartupInformation = $si
    } | Out-Null
}
