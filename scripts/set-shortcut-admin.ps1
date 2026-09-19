$shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "lotwork.lnk"
$bytes = [System.IO.File]::ReadAllBytes($shortcutPath)
$bytes[0x15] = $bytes[0x15] -bor 0x20  # set "Run as administrator" flag
[System.IO.File]::WriteAllBytes($shortcutPath, $bytes)
Write-Output "Shortcut updated to always run as Administrator: $shortcutPath"
