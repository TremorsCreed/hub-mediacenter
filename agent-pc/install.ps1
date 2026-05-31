# Hub MediaCenter Agent PC - Windows installer
#
# Steps:
#   1. Copies hub-agent.exe to %LOCALAPPDATA%\hub-mediacenter\
#   2. Creates a VBS launcher that starts the exe in a hidden window
#   3. Adds a shortcut to the Startup folder (auto-start at logon)
#   4. Launches the agent immediately
#
# Usage:
#   Right-click > Run with PowerShell
#   or CLI:  powershell -ExecutionPolicy Bypass -File install.ps1
#
# Options:
#   -HubUrl     "ws://192.168.1.15:8020"   # Hub backend URL (default value shown)
#   -DeviceName "Salon"                    # Device name (default: hostname)
#   -Uninstall                             # Uninstall (kill + remove everything)
#   -NoStart                               # Install without starting

param(
    [string]$HubUrl = "ws://192.168.1.15:8020",
    [string]$DeviceName = $env:COMPUTERNAME,
    [switch]$Uninstall,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

# Paths
$InstallDir   = Join-Path $env:LOCALAPPDATA 'hub-mediacenter'
$ExeTarget    = Join-Path $InstallDir 'hub-agent.exe'
$VbsTarget    = Join-Path $InstallDir 'hub-agent-hidden.vbs'
$ConfigPath   = Join-Path $env:APPDATA 'hub-mediacenter\config.json'
$StartupDir   = [Environment]::GetFolderPath('Startup')
$ShortcutPath = Join-Path $StartupDir 'Hub MediaCenter Agent.lnk'

function Kill-Agent {
    Get-Process -Name 'hub-agent' -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "  Killing PID $($_.Id)" -ForegroundColor Yellow
        $_ | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*hub-agent-hidden.vbs*"
    } | ForEach-Object {
        Write-Host "  Killing wscript PID $($_.ProcessId)" -ForegroundColor Yellow
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
}

if ($Uninstall) {
    Write-Host "=== Uninstall Hub MediaCenter Agent ===" -ForegroundColor Cyan
    Kill-Agent
    if (Test-Path $ShortcutPath) { Remove-Item $ShortcutPath -Force; Write-Host "  Startup shortcut removed" -ForegroundColor Green }
    if (Test-Path $InstallDir)   { Remove-Item $InstallDir -Recurse -Force; Write-Host "  Install dir $InstallDir removed" -ForegroundColor Green }
    Write-Host "  Config kept at $ConfigPath (remove manually if needed)" -ForegroundColor Yellow
    Write-Host "Done." -ForegroundColor Green
    exit 0
}

Write-Host "=== Install Hub MediaCenter Agent ===" -ForegroundColor Cyan
Write-Host "  Hub URL    : $HubUrl"
Write-Host "  Device name: $DeviceName"
Write-Host "  Install dir: $InstallDir"
Write-Host ""

# 1. Find source exe
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExeSource = Join-Path $ScriptDir 'dist\hub-agent.exe'
if (-not (Test-Path $ExeSource)) {
    $ExeSource = Join-Path $ScriptDir 'hub-agent.exe'
}
if (-not (Test-Path $ExeSource)) {
    Write-Host "ERROR: hub-agent.exe not found. Put it next to install.ps1 or in dist\." -ForegroundColor Red
    exit 1
}

# 2. Stop any running instance
Kill-Agent

# 3. Create install dir + copy exe
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path $ExeSource -Destination $ExeTarget -Force
Write-Host "  hub-agent.exe copied to $InstallDir" -ForegroundColor Green

# 4. Create VBS launcher that runs the exe in a hidden window
$q = [char]34  # double quote
$vbsLines = @(
    "' Hub MediaCenter Agent - Hidden window launcher",
    "Set objShell = CreateObject(${q}WScript.Shell${q})",
    "objShell.Environment(${q}Process${q}).Item(${q}HUB_AGENT_URL${q})  = ${q}$HubUrl${q}",
    "objShell.Environment(${q}Process${q}).Item(${q}HUB_AGENT_NAME${q}) = ${q}$DeviceName${q}",
    "' 0 = hidden window, False = don't wait",
    "objShell.Run ${q}${q}${q}$ExeTarget${q}${q}${q}, 0, False"
)
Set-Content -Path $VbsTarget -Value $vbsLines -Encoding ASCII
Write-Host "  VBS launcher created: $VbsTarget" -ForegroundColor Green

# 5. Startup shortcut -> runs the VBS
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath       = 'wscript.exe'
$Shortcut.Arguments        = "`"$VbsTarget`""
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.IconLocation     = "$ExeTarget,0"
$Shortcut.Description      = 'Hub MediaCenter Agent (autostart)'
$Shortcut.Save()
Write-Host "  Startup shortcut created: $ShortcutPath" -ForegroundColor Green

# 6. Start now (unless -NoStart)
if (-not $NoStart) {
    Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$VbsTarget`"" -WindowStyle Hidden
    Start-Sleep -Seconds 2
    $proc = Get-Process -Name 'hub-agent' -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "  Agent started (PID $($proc.Id))" -ForegroundColor Green
    } else {
        Write-Host "  Agent not detected after start - check by running the VBS manually" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=== Install complete ===" -ForegroundColor Cyan
Write-Host "To uninstall: .\install.ps1 -Uninstall"
Write-Host "Config file:  $ConfigPath"
Write-Host "Logs:         no file logs - run hub-agent.exe manually (without VBS) to see console output"
