param(
    [Parameter(Mandatory = $true)][string]$UnsignedApk,
    [string]$JavaPath = 'C:/Program Files/Android/openjdk/jdk-21.0.8',
    [string]$BuildTools = "$env:LOCALAPPDATA/Android/Sdk/build-tools/36.0.0"
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$credentialsPath = Join-Path $env:USERPROFILE '.nestune/signing/android-release.json'
if (!(Test-Path -LiteralPath $credentialsPath)) {
    throw 'Existing Android release credentials are required. Do not replace the release key.'
}
$credentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
if (!(Test-Path -LiteralPath $credentials.keystore)) { throw 'Release keystore is missing.' }
$inputApk = (Resolve-Path -LiteralPath $UnsignedApk).Path
$outputDirectory = Join-Path $repo 'releases/1.0.0-tauri/android'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$aligned = Join-Path $outputDirectory 'Nestune-1.0.0-Android-Tauri-aligned.apk'
$output = Join-Path $outputDirectory 'Nestune-1.0.0-Android-Tauri.apk'
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
    if (!(($badging -join "`n") -match "package: name='net.ouse.nestune' versionCode='2' versionName='1.0.0'")) {
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
