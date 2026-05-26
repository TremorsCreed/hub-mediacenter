param([string]$Device = "192.168.1.45:5555")

$adb = "C:\Users\david\Downloads\platform-tools-latest-windows\ADB\adb.exe"
$apk = "$PSScriptRoot\apk-output\app-debug.apk"

Write-Host "Connexion ADB à $Device..."
& $adb connect $Device | Out-Null

Write-Host "Tentative install -r (preserve data)..."
$result = & $adb -s $Device install -r $apk 2>&1
if ($result -match "Success") {
    Write-Host "OK — données préservées, device_id stable" -ForegroundColor Green
} elseif ($result -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
    Write-Host "Signature différente, désinstallation nécessaire..." -ForegroundColor Yellow
    & $adb -s $Device uninstall dev.tremors.hubagent
    Start-Sleep 1
    $result2 = & $adb -s $Device install $apk 2>&1
    if ($result2 -match "Success") {
        Write-Host "OK — nouvelle installation (device_id régénéré)" -ForegroundColor Green
    } else {
        Write-Host "Erreur: $result2" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Erreur: $result" -ForegroundColor Red
    exit 1
}

Write-Host "Lancement de l'app..."
& $adb -s $Device shell am start -n "dev.tremors.hubagent/.MainActivity"
