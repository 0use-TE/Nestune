param(
  [string]$JavaPath = 'C:/Program Files/Android/openjdk/jdk-21.0.8',
  [string]$SdkPath = "$env:LOCALAPPDATA/Android/Sdk",
  [string]$GradlePath = "$PSScriptRoot/../work/packaging-tools/gradle-8.13/bin/gradle.bat"
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/..").Path
$signing = Join-Path $env:USERPROFILE '.nestune/signing'
$credentialsFile = Join-Path $signing 'android-release.json'
$keystore = Join-Path $signing 'nestune-release.keystore'
New-Item -ItemType Directory -Force $signing | Out-Null
& icacls.exe $signing /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if (!(Test-Path $credentialsFile)) {
  if (Test-Path $keystore) { throw 'Existing signing key has no credentials. Restore its credentials; do not replace the key.' }
  $password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  $env:NESTUNE_KEYSTORE_PASSWORD = $password
  & "$JavaPath/bin/keytool.exe" -genkeypair -keystore $keystore -storetype PKCS12 -alias nestune -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Nestune' -storepass:env NESTUNE_KEYSTORE_PASSWORD -keypass:env NESTUNE_KEYSTORE_PASSWORD
  if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed' }
  @{ keystore = $keystore; alias = 'nestune'; password = $password } | ConvertTo-Json | Set-Content -LiteralPath $credentialsFile -Encoding utf8
}
$credentials = Get-Content -LiteralPath $credentialsFile -Raw | ConvertFrom-Json
$env:NESTUNE_KEYSTORE = $credentials.keystore
$env:NESTUNE_KEYSTORE_PASSWORD = $credentials.password
$env:JAVA_HOME = $JavaPath
$env:ANDROID_HOME = $SdkPath
$env:ANDROID_SDK_ROOT = $SdkPath
try {
  Push-Location "$repo/clients/android"
  try {
    & $GradlePath --no-daemon --max-workers=4 --console=plain '-Dorg.gradle.internal.http.connectionTimeout=15000' '-Dorg.gradle.internal.http.socketTimeout=30000' :app:assembleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
    $certificate = Join-Path $signing 'nestune-public.cer'
    & "$JavaPath/bin/keytool.exe" -exportcert -keystore $keystore -alias nestune -storepass:env NESTUNE_KEYSTORE_PASSWORD -file $certificate
    if ($LASTEXITCODE -ne 0) { throw 'Certificate export failed' }
    $hash = (Get-FileHash -LiteralPath $certificate -Algorithm SHA256).Hash
    $fingerprint = [regex]::Replace($hash, '(..)(?!$)', '$1:')
    $assetDir = "$repo/web/public/.well-known"
    New-Item -ItemType Directory -Force $assetDir,"$repo/releases/1.0.0" | Out-Null
    $assetLinks = @(@{ relation = @('delegate_permission/common.handle_all_urls'); target = @{ namespace = 'android_app'; package_name = 'net.ouse.nestune'; sha256_cert_fingerprints = @($fingerprint) } })
    ConvertTo-Json -InputObject $assetLinks -Depth 6 | Set-Content "$assetDir/assetlinks.json" -Encoding utf8
    Copy-Item app/build/outputs/apk/release/app-release.apk "$repo/releases/1.0.0/Nestune-1.0.0-Android.apk" -Force
    & "$SdkPath/build-tools/36.0.0/apksigner.bat" verify --verbose --print-certs "$repo/releases/1.0.0/Nestune-1.0.0-Android.apk"
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
  } finally { Pop-Location }
} finally { Remove-Item Env:/NESTUNE_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue }
