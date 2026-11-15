$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$toolsRoot = Join-Path $taskRoot '.tools'
New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
$javaRoot = Join-Path $toolsRoot 'jdk-21'
if (!(Test-Path (Join-Path $javaRoot 'bin/java.exe'))) {
    $archive = Join-Path $toolsRoot 'jdk-21.zip'
    Invoke-WebRequest -Uri 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse' -OutFile $archive
    $extractRoot = Join-Path $toolsRoot 'jdk-download'
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot -Force
    $downloadedJdk = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    Move-Item -LiteralPath $downloadedJdk.FullName -Destination $javaRoot
}
& (Join-Path $javaRoot 'bin/java.exe') -version
