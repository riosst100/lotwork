$root = Split-Path -Parent $PSScriptRoot
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
