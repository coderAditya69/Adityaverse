$ErrorActionPreference = "Stop"

$appRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $appRoot
$toolsRoot = Join-Path $projectRoot "android-tools"
$jdkHome = (Get-ChildItem (Join-Path $toolsRoot "jdk") -Directory | Where-Object { $_.Name -like "jdk-17*" } | Select-Object -First 1).FullName
if (-not $jdkHome) {
    throw "Portable JDK was not found. Run setup_android_toolchain.ps1 first."
}

$signingDir = Join-Path $appRoot "signing"
$keystorePath = Join-Path $signingDir "moleculebuilder-release.jks"
$propertiesPath = Join-Path $signingDir "keystore.properties"
$alias = "moleculebuilder"
$dname = "CN=Molecule Builder, OU=Codex Work, O=Personal, L=Kolkata, ST=West Bengal, C=IN"
$keytool = Join-Path $jdkHome "bin\\keytool.exe"

New-Item -ItemType Directory -Force -Path $signingDir | Out-Null

if ((Test-Path $keystorePath) -and (Test-Path $propertiesPath)) {
    Write-Host "Existing release signing files found."
    Write-Host "KEYSTORE=$keystorePath"
    Write-Host "PROPERTIES=$propertiesPath"
    exit 0
}

$storePassword = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")).Substring(0, 32)
$keyPassword = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")).Substring(0, 32)

& $keytool `
    -genkeypair `
    -v `
    -keystore $keystorePath `
    -storetype JKS `
    -storepass $storePassword `
    -keypass $keyPassword `
    -alias $alias `
    -keyalg RSA `
    -keysize 4096 `
    -validity 36500 `
    -dname $dname

$properties = @"
storeFile=signing/moleculebuilder-release.jks
storePassword=$storePassword
keyAlias=$alias
keyPassword=$keyPassword
"@

Set-Content -Path $propertiesPath -Value $properties -Encoding ASCII

Write-Host "Created release signing files."
Write-Host "KEYSTORE=$keystorePath"
Write-Host "PROPERTIES=$propertiesPath"
