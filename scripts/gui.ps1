Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if ($PSScriptRoot) {
    # running as gui.ps1 from scripts\ folder
    $root = Split-Path -Parent $PSScriptRoot
} else {
    # running as compiled lotwork-control.exe placed in the project root
    $root = Split-Path -Parent ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
}
$pidFile = Join-Path $root "data\server.pid"
$logFile = Join-Path $root "data\server.log"
$errLogFile = Join-Path $root "data\server.err.log"
$dataDir = Join-Path $root "data"

if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

function Is-Running {
    if (-not (Test-Path $pidFile)) { return $false }
    $procId = Get-Content $pidFile -ErrorAction SilentlyContinue
    if (-not $procId) { return $false }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    return $null -ne $proc
}

function Start-Lotwork {
    Push-Location $root
    Start-Process -FilePath "node" -ArgumentList "server.js" -WindowStyle Hidden `
        -RedirectStandardOutput $logFile -RedirectStandardError $errLogFile
    Pop-Location
    Start-Sleep -Milliseconds 800
}

function Stop-Lotwork {
    if (Test-Path $pidFile) {
        $procId = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($procId) {
            taskkill /pid $procId /T /F 2>$null | Out-Null
        }
        Remove-Item $pidFile -ErrorAction SilentlyContinue
    }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "lotwork"
$form.Size = New-Object System.Drawing.Size(280, 180)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 17, 21)

$iconPath = Join-Path $root "lotwork.ico"
if (Test-Path $iconPath) {
    $form.Icon = New-Object System.Drawing.Icon($iconPath)
}

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "Checking..."
$statusLabel.ForeColor = [System.Drawing.Color]::White
$statusLabel.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$statusLabel.AutoSize = $false
$statusLabel.TextAlign = "MiddleCenter"
$statusLabel.Size = New-Object System.Drawing.Size(260, 30)
$statusLabel.Location = New-Object System.Drawing.Point(10, 15)
$form.Controls.Add($statusLabel)

$toggleButton = New-Object System.Windows.Forms.Button
$toggleButton.Text = "..."
$toggleButton.Size = New-Object System.Drawing.Size(180, 45)
$toggleButton.Location = New-Object System.Drawing.Point(50, 55)
$toggleButton.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$toggleButton.FlatStyle = "Flat"
$toggleButton.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($toggleButton)

$openLink = New-Object System.Windows.Forms.LinkLabel
$openLink.Text = "Open Dashboard"
$openLink.AutoSize = $false
$openLink.TextAlign = "MiddleCenter"
$openLink.Size = New-Object System.Drawing.Size(260, 25)
$openLink.Location = New-Object System.Drawing.Point(10, 110)
$openLink.LinkColor = [System.Drawing.Color]::FromArgb(91, 140, 255)
$openLink.Add_LinkClicked({ Start-Process "http://localhost:4400" })
$form.Controls.Add($openLink)

function Refresh-UI {
    if (Is-Running) {
        $statusLabel.Text = "● Running"
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(52, 199, 123)
        $toggleButton.Text = "STOP"
        $toggleButton.BackColor = [System.Drawing.Color]::FromArgb(239, 90, 90)
    } else {
        $statusLabel.Text = "○ Stopped"
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(139, 146, 163)
        $toggleButton.Text = "START"
        $toggleButton.BackColor = [System.Drawing.Color]::FromArgb(91, 140, 255)
    }
}

$toggleButton.Add_Click({
    $toggleButton.Enabled = $false
    if (Is-Running) {
        Stop-Lotwork
    } else {
        Start-Lotwork
    }
    Start-Sleep -Milliseconds 500
    Refresh-UI
    $toggleButton.Enabled = $true
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Refresh-UI })
$timer.Start()

Refresh-UI
[System.Windows.Forms.Application]::Run($form)
