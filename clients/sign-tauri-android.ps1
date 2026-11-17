param(
    [Parameter(Mandatory = $true)][string]$UnsignedApk,
    [string]$JavaPath = 'C:/Program Files/Android/openjdk/jdk-21.0.8',
    [string]$BuildTools = "$env:LOCALAPPDATA/Android/Sdk/build-tools/36.0.0",
    [string]$CredentialsPath = (Join-Path $env:USERPROFILE '.nestune/signing/android-release.json')
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
if (!(Test-Path -LiteralPath $CredentialsPath)) {
    throw 'Existing Android release credentials are required. Do not replace the release key.'
}
$credentials = Get-Content -LiteralPath $CredentialsPath -Raw | ConvertFrom-Json
if (!(Test-Path -LiteralPath $credentials.keystore)) { throw 'Release keystore is missing.' }
$inputApk = (Resolve-Path -LiteralPath $UnsignedApk).Path
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'desktop/src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version
$androidConfig = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'desktop/src-tauri/tauri.android.conf.json') -Raw | ConvertFrom-Json
if ($androidConfig.version) { $version = $androidConfig.version }
$versionCode = $androidConfig.bundle.android.versionCode
if ($version -notmatch '^\d+\.\d+\.\d+$' -or $versionCode -lt 1) { throw 'Invalid Android release version.' }
$outputDirectory = Join-Path $repo "releases/$version-tauri/android"
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$aligned = Join-Path $outputDirectory "Nestune-$version-Android-Tauri-aligned.apk"
$output = Join-Path $outputDirectory "Nestune-$version-Android-Tauri.apk"
$oldJava = $env:JAVA_HOME
try {
    $env:JAVA_HOME = $JavaPath
    $env:NESTUNE_ANDROID_PASSWORD = $credentials.password
    & (Join-Path $BuildTools 'zipalign.exe') -P 16 -f 4 $inputApk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    & (Join-Path $BuildTools 'apksigner.bat') sign --ks $credentials.keystore --ks-key-alias $credentials.alias --ks-pass env:NESTUNE_ANDROID_PASSWORD --key-pass env:NESTUNE_ANDROID_PASSWORD --out $output $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    $verification = & (Join-Path $BuildTools 'apksigner.bat') verify --verbose --print-certs $output
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $verification | Write-Output
    $expectedLinks = Get-Content -LiteralPath (Join-Path $repo 'web/public/.well-known/assetlinks.json') -Raw | ConvertFrom-Json
    $expected = @($expectedLinks | Where-Object { $_.target.package_name -eq 'net.ouse.nestune' } | ForEach-Object { $_.target.sha256_cert_fingerprints })
    $match = [regex]::Match(($verification -join "`n"), 'Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)')
    if (!$match.Success -or !($expected | Where-Object { ($_ -replace ':', '') -eq $match.Groups[1].Value })) {
        throw 'Signing certificate differs from the existing published Android certificate.'
    }
    $badging = & (Join-Path $BuildTools 'aapt.exe') dump badging $output
    if ($LASTEXITCODE -ne 0) { throw 'APK metadata verification failed.' }
    $expectedPackage = "package: name='net.ouse.nestune' versionCode='$versionCode' versionName='$version'"
    if (!(($badging -join "`n").Contains($expectedPackage))) {
        throw 'Unexpected APK package or version.'
    }
    $badging | Select-String 'package:|sdkVersion:|targetSdkVersion:|native-code:|application-label:' | Write-Output
    & (Join-Path $BuildTools 'zipalign.exe') -c -P 16 4 $output
    if ($LASTEXITCODE -ne 0) { throw 'Signed APK alignment verification failed.' }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
    "$hash  $(Split-Path $output -Leaf)" | Set-Content -Encoding utf8 -LiteralPath (Join-Path $outputDirectory 'SHA256SUMS.txt')
    Remove-Item -LiteralPath $aligned
    Write-Output "Signed APK: $output"
} finally {
    $env:JAVA_HOME = $oldJava
    Remove-Item Env:NESTUNE_ANDROID_PASSWORD -ErrorAction SilentlyContinue
}
