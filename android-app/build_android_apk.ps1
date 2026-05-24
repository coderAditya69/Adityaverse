$ErrorActionPreference = "Stop"

$appRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $appRoot
$toolsRoot = Join-Path $projectRoot "android-tools"
$publishDir = Join-Path $projectRoot "static\downloads"
$publishedDebugApk = Join-Path $publishDir "MoleculeBuilder-android-debug.apk"
$publishedReleaseApk = Join-Path $publishDir "MoleculeBuilder-android-release.apk"
$publishedDefaultApk = Join-Path $publishDir "MoleculeBuilder-android.apk"
$jdkHome = (Get-ChildItem (Join-Path $toolsRoot "jdk") -Directory | Where-Object { $_.Name -like "jdk-17*" } | Select-Object -First 1).FullName
$gradleHome = (Get-ChildItem (Join-Path $toolsRoot "gradle") -Directory | Where-Object { $_.Name -like "gradle-*" } | Sort-Object Name -Descending | Select-Object -First 1).FullName
$sdkRoot = Join-Path $toolsRoot "sdk"

if (-not $jdkHome -or -not $gradleHome -or -not (Test-Path (Join-Path $sdkRoot "platforms\android-35"))) {
    throw "Toolchain is incomplete. Run setup_android_toolchain.ps1 first."
}

$localProperties = @"
sdk.dir=$($sdkRoot.Replace('\', '\\'))
"@
Set-Content -Path (Join-Path $appRoot "local.properties") -Value $localProperties -Encoding ASCII

$env:JAVA_HOME = $jdkHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:Path = "$jdkHome\bin;$gradleHome\bin;$sdkRoot\platform-tools;$env:Path"

python (Join-Path $appRoot "prepare_offline_bundle.py")
& (Join-Path $appRoot "generate_release_signing.ps1")

Push-Location $appRoot
try {
    & (Join-Path $gradleHome "bin\gradle.bat") assembleDebug assembleRelease
}
finally {
    Pop-Location
}

$builtDebugApk = Join-Path $appRoot "app\build\outputs\apk\debug\app-debug.apk"
$builtReleaseApk = Join-Path $appRoot "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $builtDebugApk)) {
    throw "APK build finished, but the debug APK was not found."
}
if (-not (Test-Path $builtReleaseApk)) {
    throw "APK build finished, but the release APK was not found."
}

New-Item -ItemType Directory -Force -Path $publishDir | Out-Null
Copy-Item $builtDebugApk $publishedDebugApk -Force
Copy-Item $builtReleaseApk $publishedReleaseApk -Force
Copy-Item $builtReleaseApk $publishedDefaultApk -Force
Write-Host "PUBLISHED_DEBUG_APK=$publishedDebugApk"
Write-Host "PUBLISHED_RELEASE_APK=$publishedReleaseApk"
Write-Host "PUBLISHED_DEFAULT_APK=$publishedDefaultApk"
