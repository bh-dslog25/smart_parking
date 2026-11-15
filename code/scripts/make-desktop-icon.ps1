# Rasterize the simple native traffic-light geometry for the Windows executable.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'Desktop/assets'
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#123d32'))
$scale = 256.0 / 108
$graphics.ScaleTransform($scale, $scale)
$shellBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#d3e8b4'))
$graphics.FillRectangle($shellBrush, 36,19,36,63)
$graphics.FillRectangle($shellBrush, 50,82,8,13)
$lampColors = @('#d95b4a','#e5b843','#36764b')
for ($i = 0; $i -lt 3; $i++) {
    $lampBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($lampColors[$i]))
    $graphics.FillEllipse($lampBrush, 47, (28 + $i * 16),14,14)
    $lampBrush.Dispose()
}
$bitmap.Save((Join-Path $iconRoot 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create((Join-Path $iconRoot 'icon.ico'))
$icon.Save($stream)
$stream.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
$shellBrush.Dispose()
