param(
  [switch]$SkipInstall,
  [ValidateSet('x64', 'arm64', 'both')][string]$Architecture = 'x64'
)
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'desktop'
$version = (Get-Content -LiteralPath (Join-Path $project 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid client version.' }
$output = Join-Path $PSScriptRoot "../releases/$version-tauri"
if ($env:OS -ne 'Windows_NT') { throw 'Build the Windows installer on Windows.' }
$toolchain = & rustc -vV
if ($LASTEXITCODE -ne 0 -or !($toolchain -match 'host: x86_64-pc-windows-msvc')) {
  throw 'An x86_64-pc-windows-msvc Rust toolchain is required.'
}
Push-Location $project
try {
  if (!$SkipInstall) {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Installing the Tauri CLI failed.' }
  }
  $architectures = if ($Architecture -eq 'both') { @('x64', 'arm64') } else { @($Architecture) }
  New-Item -ItemType Directory -Force -Path $output | Out-Null
  foreach ($arch in $architectures) {
    if ($arch -eq 'arm64') {
      & npm.cmd run tauri -- build --target aarch64-pc-windows-msvc --bundles nsis -- --locked
      $targetDirectory = Join-Path $project 'src-tauri/target/aarch64-pc-windows-msvc/release'
    } else {
      & npm.cmd run build
      $targetDirectory = Join-Path $project 'src-tauri/target/release'
    }
    if ($LASTEXITCODE -ne 0) { throw "The $arch Tauri build failed." }
    $binary = Join-Path $targetDirectory 'Nestune.exe'
    $installer = Join-Path $targetDirectory "bundle/nsis/Nestune_${version}_${arch}-setup.exe"
    if (!(Test-Path -LiteralPath $binary) -or !(Test-Path -LiteralPath $installer)) {
      throw "The $arch executable or installer was not generated."
    }
    $bytes = [IO.File]::ReadAllBytes($binary)
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
    $machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
    $expected = if ($arch -eq 'arm64') { 0xaa64 } else { 0x8664 }
    if ($machine -ne $expected) { throw "Unexpected PE architecture in $binary" }
    if ((Get-Item -LiteralPath $binary).VersionInfo.ProductVersion -ne $version) { throw 'Unexpected executable version.' }
    $portable = Join-Path $output "Nestune-$version-Windows-$arch-Tauri.exe"
    $setup = Join-Path $output "Nestune-$version-Windows-$arch-Tauri-Setup.exe"
    Copy-Item -LiteralPath $binary -Destination $portable -Force
    Copy-Item -LiteralPath $installer -Destination $setup -Force
  }
  Get-ChildItem -LiteralPath $output -File -Filter '*.exe' | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    '{0}  {1}' -f $hash, $_.Name
  } | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ascii
  Get-ChildItem -LiteralPath $output -File | Select-Object Name, Length
} finally { Pop-Location }
