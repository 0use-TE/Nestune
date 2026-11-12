param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'desktop'
$output = Join-Path $PSScriptRoot '../releases/1.0.0-tauri'
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
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'The Tauri build failed.' }
  $binary = Join-Path $project 'src-tauri/target/release/Nestune.exe'
  $installer = Join-Path $project 'src-tauri/target/release/bundle/nsis/Nestune_1.0.0_x64-setup.exe'
  if (!(Test-Path -LiteralPath $binary) -or !(Test-Path -LiteralPath $installer)) {
    throw 'The executable or installer was not generated.'
  }
  New-Item -ItemType Directory -Force -Path $output | Out-Null
  $portable = Join-Path $output 'Nestune-1.0.0-Windows-x64-Tauri.exe'
  $setup = Join-Path $output 'Nestune-1.0.0-Windows-x64-Tauri-Setup.exe'
  Copy-Item -LiteralPath $binary -Destination $portable -Force
  Copy-Item -LiteralPath $installer -Destination $setup -Force
  @($portable, $setup) | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
    '{0}  {1}' -f $hash, [IO.Path]::GetFileName($_)
  } | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ascii
  Get-ChildItem -LiteralPath $output -File | Select-Object Name, Length
} finally { Pop-Location }
