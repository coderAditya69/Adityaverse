$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $projectRoot "android-tools"
$downloadsDir = Join-Path $toolsRoot "downloads"
$jdkDir = Join-Path $toolsRoot "jdk"
$sdkRoot = Join-Path $toolsRoot "sdk"
$gradleDir = Join-Path $toolsRoot "gradle"

New-Item -ItemType Directory -Force -Path $downloadsDir, $jdkDir, $sdkRoot, $gradleDir | Out-Null

$jdkApiUrl = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
$jdkZip = Join-Path $downloadsDir "temurin17.zip"
if (-not (Get-ChildItem $jdkDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "jdk-17*" })) {
    if (-not (Test-Path $jdkZip)) {
        curl.exe -L --fail --output $jdkZip $jdkApiUrl
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to download JDK."
        }
    }
    Expand-Archive -LiteralPath $jdkZip -DestinationPath $jdkDir -Force
}

$javaHome = (Get-ChildItem $jdkDir -Directory | Where-Object { $_.Name -like "jdk-17*" } | Select-Object -First 1).FullName
if (-not $javaHome) {
    throw "Portable JDK was not found."
}

$cmdToolsZip = Join-Path $downloadsDir "commandlinetools-win.zip"
$cmdToolsUrl = "https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip"
$sdkManager = Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkManager)) {
    if (-not (Test-Path $cmdToolsZip)) {
        curl.exe -L --fail --output $cmdToolsZip $cmdToolsUrl
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to download Android command-line tools."
        }
    }

    $tempDir = Join-Path $sdkRoot "cmdline-tools-temp"
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tempDir, (Join-Path $sdkRoot "cmdline-tools\latest") | Out-Null
    Expand-Archive -LiteralPath $cmdToolsZip -DestinationPath $tempDir -Force
    Copy-Item (Join-Path $tempDir "cmdline-tools\*") (Join-Path $sdkRoot "cmdline-tools\latest") -Recurse -Force
    Remove-Item -Recurse -Force $tempDir
}

$gradleVersion = "8.10.2"
$gradleZip = Join-Path $downloadsDir "gradle-$gradleVersion-bin.zip"
$gradleUrl = "https://services.gradle.org/distributions/gradle-$gradleVersion-bin.zip"
$gradleHome = Join-Path $gradleDir "gradle-$gradleVersion"
if (-not (Test-Path $gradleHome)) {
    if (-not (Test-Path $gradleZip)) {
        curl.exe -L --fail --output $gradleZip $gradleUrl
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to download Gradle."
        }
    }
    Expand-Archive -LiteralPath $gradleZip -DestinationPath $gradleDir -Force
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:Path = "$javaHome\bin;$sdkRoot\cmdline-tools\latest\bin;$sdkRoot\platform-tools;$env:Path"

1..25 | ForEach-Object { "y" } | & $sdkManager "--sdk_root=$sdkRoot" --licenses | Out-Null
& $sdkManager "--sdk_root=$sdkRoot" "platform-tools" "build-tools;35.0.0" "platforms;android-35"

Write-Host "JAVA_HOME=$javaHome"
Write-Host "ANDROID_SDK_ROOT=$sdkRoot"
Write-Host "GRADLE_HOME=$gradleHome"
