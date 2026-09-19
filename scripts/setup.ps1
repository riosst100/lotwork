$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) {
    Write-Output ""
    Write-Output "=== $msg ==="
}

# 1. Install Caddy if missing
Write-Step "Checking Caddy"
$caddyInstalled = Get-Command caddy -ErrorAction SilentlyContinue
$caddyViaWinget = winget list --id CaddyServer.Caddy 2>$null | Select-String "CaddyServer.Caddy"
if ($caddyInstalled) {
    Write-Output "Caddy already installed: $($caddyInstalled.Source)"
} elseif ($caddyViaWinget) {
    Write-Output "Caddy is installed but not yet visible in this session's PATH."
    Write-Output "Restart lotwork (or your terminal) once for it to be detected."
} else {
    Write-Output "Caddy not found. Installing via winget..."
    try {
        winget install CaddyServer.Caddy --accept-package-agreements --accept-source-agreements
        Write-Output "Caddy installed. Restart lotwork for PATH changes to take effect."
    } catch {
        Write-Output "WARNING: Failed to install Caddy automatically ($($_.Exception.Message))."
        Write-Output "Install it manually later with: winget install CaddyServer.Caddy"
    }
}

# 2. Generate icon if missing
Write-Step "Checking icon"
$iconPath = Join-Path $root "lotwork.ico"
if (Test-Path $iconPath) {
    Write-Output "Icon already exists."
} else {
    Write-Output "Generating icon..."
    & "$PSScriptRoot\make-icon.ps1"
}

# 3. Create Desktop shortcut
Write-Step "Creating Desktop shortcut"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "lotwork.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:WINDIR\System32\wscript.exe"
$shortcut.Arguments = "`"$root\lotwork.vbs`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$root\lotwork.ico"
$shortcut.Description = "lotwork - Local Project Manager"
$shortcut.Save()
Write-Output "Shortcut created at $shortcutPath"

# 4. Set shortcut to always run as Administrator (needed to edit hosts file for custom domains)
Write-Step "Setting shortcut to run as Administrator"
$bytes = [System.IO.File]::ReadAllBytes($shortcutPath)
$bytes[0x15] = $bytes[0x15] -bor 0x20
[System.IO.File]::WriteAllBytes($shortcutPath, $bytes)
Write-Output "Done."

Write-Step "Setup complete"
Write-Output "Double-click the 'lotwork' shortcut on your Desktop to start."
Write-Output "Windows will ask for Administrator permission - this is needed for custom domains (.local) to work."
