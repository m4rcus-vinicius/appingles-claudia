$logFile = "c:\Users\PC\Desktop\Nova pasta\Projetos\AppIngles\backend\tunnel.log"
if (Test-Path $logFile) {
    $match = Select-String -Path $logFile -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -Last 1
    if ($match) {
        $httpUrl = $match.Matches[0].Value
        $wsUrl = $httpUrl.Replace("https://", "wss://") + "/ws/tutor"
        $apkUrl = $httpUrl + "/download-apk"
        Write-Host "`n=======================================================" -ForegroundColor Cyan
        Write-Host "TUNEL PUBLICO DA CLAUDIA ATIVO!" -ForegroundColor Green
        Write-Host "=======================================================" -ForegroundColor Cyan
        Write-Host "URL WebSocket (Configuracoes do App em 4G / outra rede):"
        Write-Host "  $wsUrl" -ForegroundColor Yellow
        Write-Host "`nLink Publico para baixar o APK em qualquer celular:"
        Write-Host "  $apkUrl" -ForegroundColor Yellow
        Write-Host "=======================================================`n" -ForegroundColor Cyan
    } else {
        Write-Host "Aguardando geracao do link no tunnel.log..."
    }
} else {
    Write-Host "Arquivo tunnel.log ainda nao encontrado. Execute start-background.ps1 primeiro."
}
