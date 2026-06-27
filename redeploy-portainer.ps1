<#
  redeploy-portainer.ps1 — Redéploiement fiable de la stack Hub MediaCenter (#30) sur Portainer.

  POURQUOI CE SCRIPT EXISTE :
  Le git/redeploy de Portainer écrase l'env du stack par ce qu'on lui envoie. Si le payload
  arrive avec Env vide (ou mal formé), DATABASE_URL disparaît → backend en crash-loop
  Postgres « SASL: client password must be a string » → plus de DB → plus de profils.
  Vécu 2x (2026-06-25). Ce script reconstruit TOUJOURS l'env complet depuis .secrets.txt,
  l'envoie via un fichier validé, puis vérifie env + logs backend.

  Usage : pwsh -File "C:\Scripts\Hub MediaCenter\redeploy-portainer.ps1"
          (lancer APRÈS git push ; le compose rebuild les images localement, PullImage=false)
#>

$ErrorActionPreference = 'Stop'
$Portainer = 'https://192.168.1.15:9443'
$StackId   = 30
$EndpointId = 3
$SecretsPath = 'C:\Users\david\.secrets.txt'

# PowerShell 7+ : ignorer le cert self-signed Portainer
$skipCert = @{ SkipCertificateCheck = $true }

function Get-Secret([string]$key) {
  $line = Select-String -Path $SecretsPath -Pattern "^$key=" | Select-Object -First 1
  if (-not $line) { throw "Secret introuvable: $key" }
  return ($line.Line -replace "^$key=", '').Trim()
}

Write-Host '== Lecture des secrets ==' -ForegroundColor Cyan
$pgPass       = Get-Secret 'PG_HUB_PASS'
$traktId      = Get-Secret 'TRAKT_CLIENT_ID'
$traktSecret  = Get-Secret 'TRAKT_CLIENT_SECRET'
$portainerPwd = Get-Secret 'PORTAINER_ADMIN_PASS'

# Env COMPLET du stack — ne JAMAIS en omettre une (sinon wipe → crash-loop)
$env4 = @(
  @{ name = 'DATABASE_URL';        value = "postgres://hub:$pgPass@192.168.1.54:5432/hub?sslmode=require" }
  @{ name = 'MARQUESAS_URL';       value = 'http://192.168.1.223:8090' }
  @{ name = 'TRAKT_CLIENT_ID';     value = $traktId }
  @{ name = 'TRAKT_CLIENT_SECRET'; value = $traktSecret }
)

Write-Host '== Auth Portainer ==' -ForegroundColor Cyan
$jwt = (Invoke-RestMethod @skipCert -Method Post -Uri "$Portainer/api/auth" `
  -ContentType 'application/json' `
  -Body (@{ username = 'admin'; password = $portainerPwd } | ConvertTo-Json)).jwt
$headers = @{ Authorization = "Bearer $jwt" }

Write-Host '== PUT git/redeploy (PullImage=false, env complet) ==' -ForegroundColor Cyan
$payload = @{ PullImage = $false; Prune = $false; Env = $env4 } | ConvertTo-Json -Depth 5
$null = Invoke-RestMethod @skipCert -Method Put `
  -Uri "$Portainer/api/stacks/$StackId/git/redeploy?endpointId=$EndpointId" `
  -Headers $headers -ContentType 'application/json' -Body $payload
Write-Host '  redeploy déclenché' -ForegroundColor Green

Write-Host '== Vérif 1/3 : env du stack persisté ==' -ForegroundColor Cyan
$stack = Invoke-RestMethod @skipCert -Uri "$Portainer/api/stacks/$StackId" -Headers $headers
$names = $stack.Env.name
if ($names.Count -lt 4) { Write-Host "  ✗ ENV INCOMPLET ($($names.Count)/4): $names" -ForegroundColor Red; exit 1 }
Write-Host "  ✓ $($names.Count) vars: $($names -join ', ')" -ForegroundColor Green

Start-Sleep -Seconds 5

Write-Host '== Vérif 2/3 : DATABASE_URL dans le conteneur + RestartCount ==' -ForegroundColor Cyan
$c = Invoke-RestMethod @skipCert -Uri "$Portainer/api/endpoints/$EndpointId/docker/containers/hub-mediacenter-backend/json" -Headers $headers
$dbUrl = ($c.Config.Env | Where-Object { $_ -like 'DATABASE_URL=*' }) -replace '^DATABASE_URL=', ''
if (-not $dbUrl) { Write-Host '  ✗ DATABASE_URL VIDE dans le conteneur' -ForegroundColor Red; exit 1 }
Write-Host "  ✓ DATABASE_URL set | State=$($c.State.Status) RestartCount=$($c.RestartCount)" -ForegroundColor Green

Write-Host '== Vérif 3/3 : logs backend (doit PAS contenir SASL) ==' -ForegroundColor Cyan
$logs = Invoke-RestMethod @skipCert -Uri "$Portainer/api/endpoints/$EndpointId/docker/containers/hub-mediacenter-backend/logs?stdout=true&stderr=true&tail=15" -Headers $headers
$logsClean = ($logs -replace '[\x00-\x1f]', ' ')
if ($logsClean -match 'SASL|client password must be a string') {
  Write-Host '  ✗ CRASH-LOOP DÉTECTÉ (SASL) — env probablement perdu' -ForegroundColor Red
  Write-Host $logsClean
  exit 1
}
Write-Host '  ✓ pas d''erreur SASL dans les logs' -ForegroundColor Green
Write-Host ''
Write-Host 'REDEPLOY OK — backend sain, env complet.' -ForegroundColor Green
