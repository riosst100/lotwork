Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# background rounded square, dark
$bgColor = [System.Drawing.Color]::FromArgb(255, 23, 26, 33)
$g.Clear($bgColor)

$rectSize = $size - 20
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$radius = 48
$rect = New-Object System.Drawing.Rectangle(10, 10, $rectSize, $rectSize)
$d = $radius * 2
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
$path.CloseFigure()
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 23, 26, 33))
$g.FillPath($bgBrush, $path)

# accent border
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 91, 140, 255), 6)
$g.DrawPath($pen, $path)

# letter L in accent color
$font = New-Object System.Drawing.Font("Segoe UI", 130, [System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 91, 140, 255))
$text = "L"
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF(0, -6, $size, $size)), $sf)

$g.Dispose()

$iconPath = Join-Path $root "lotwork.ico"

# Convert bitmap to real multi-format .ico via Icon handle
$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = New-Object System.IO.FileStream($iconPath, [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp.Dispose()

Write-Output "Icon saved to $iconPath"
