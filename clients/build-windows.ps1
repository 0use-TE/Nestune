param([string]$Compiler = "$PSScriptRoot/../work/packaging-tools/inno/tools/ISCC.exe")
$ErrorActionPreference = 'Stop'
Push-Location "$PSScriptRoot/windows"
try {
  dotnet publish Nestune.csproj -c Release -o bin/publish-1.0.0
  if ($LASTEXITCODE -ne 0) { throw 'Windows publish failed' }
  & $Compiler installer.iss
  if ($LASTEXITCODE -ne 0) { throw 'Windows installer compilation failed' }
} finally { Pop-Location }
