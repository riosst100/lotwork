$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "lotwork.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $root "node_modules\electron\dist\lotwork.exe"
$shortcut.Arguments = "`"$root`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$root\lotwork.ico"
$shortcut.Description = "lotwork - Local Project Manager"
$shortcut.Save()

Write-Output "Shortcut created at $shortcutPath"
