$ErrorActionPreference = "SilentlyContinue"

$conns = Get-NetTCPConnection -LocalPort 3001,8081 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        Write-Host "Processo $p encerrado."
    }
}

Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Servidores e túnel público em segundo plano encerrados."
