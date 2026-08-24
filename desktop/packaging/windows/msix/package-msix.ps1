[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ReleaseDir,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Architecture,
  [Parameter(Mandatory = $true)][string]$OutputDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-Tool([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $candidate = Get-ChildItem -Path $kits -Filter "$Name.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (-not $candidate) { throw "$Name.exe is unavailable in the Windows SDK" }
  return $candidate.FullName
}

$source = (Resolve-Path $ReleaseDir).Path
$gui = @('UniClipboard.exe', 'uniclipboard.exe') |
  ForEach-Object { Join-Path $source $_ } |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1
$daemon = Join-Path $source 'uniclipd.exe'
if (-not $gui) { throw "UniClipboard executable is missing from $source" }
if (-not (Test-Path $daemon)) { throw "uniclipd.exe is missing from $source" }

$parts = [regex]::Matches($Version, '\d+') | ForEach-Object { [int]$_.Value }
while ($parts.Count -lt 4) { $parts += 0 }
$parts = $parts[0..3] | ForEach-Object { [Math]::Min($_, 65535) }
$packageVersion = $parts -join '.'

$stage = Join-Path $env:RUNNER_TEMP "uniclipboard-msix-$Architecture"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'Assets') -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
Copy-Item $gui (Join-Path $stage 'UniClipboard.exe')
Copy-Item $daemon (Join-Path $stage 'uniclipd.exe')

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
foreach ($asset in @('StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png')) {
  Copy-Item (Join-Path $repoRoot "src-tauri\icons\$asset") (Join-Path $stage "Assets\$asset")
}

$manifest = Get-Content (Join-Path $PSScriptRoot 'AppxManifest.xml') -Raw
$manifest = $manifest.Replace('__PACKAGE_VERSION__', $packageVersion).Replace('__ARCHITECTURE__', $Architecture)
Set-Content -Path (Join-Path $stage 'AppxManifest.xml') -Value $manifest -Encoding utf8

$makeappx = Resolve-Tool 'makeappx'
$signtool = Resolve-Tool 'signtool'
$artifact = Join-Path $OutputDir "UniClipboard_${Version}_${Architecture}-test-signed.msix"
& $makeappx pack /d $stage /p $artifact /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed with exit code $LASTEXITCODE" }

$certificate = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject 'CN=UniClipboard FullMesh Testing' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -NotAfter (Get-Date).AddDays(30)
$password = ConvertTo-SecureString ([Guid]::NewGuid().ToString('N')) -AsPlainText -Force
$pfx = Join-Path $env:RUNNER_TEMP "uniclipboard-msix-$Architecture.pfx"
$certificatePath = Join-Path $OutputDir "UniClipboard_${Version}_${Architecture}-testing.cer"
$rootInstalled = $false
try {
  Export-PfxCertificate -Cert $certificate -FilePath $pfx -Password $password | Out-Null
  Export-Certificate -Cert $certificate -FilePath $certificatePath | Out-Null
  # signtool /pa performs a full chain validation. The ephemeral self-signed
  # test certificate is its own root. Import-Certificate may display an
  # interactive root-trust confirmation on a hosted runner, so use certutil's
  # explicit force/non-interactive path and remove the root in finally. End
  # users still import the public certificate into TrustedPeople for sideloading.
  & certutil.exe -user -f -silent -addstore Root $certificatePath
  if ($LASTEXITCODE -ne 0) { throw "certutil root import failed with exit code $LASTEXITCODE" }
  $rootInstalled = $true
  & $signtool sign /fd SHA256 /f $pfx /p ([System.Net.NetworkCredential]::new('', $password).Password) $artifact
  if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE" }
  & $signtool verify /pa /v $artifact
  if ($LASTEXITCODE -ne 0) { throw "signtool verification failed with exit code $LASTEXITCODE" }
} finally {
  Remove-Item $pfx -Force -ErrorAction SilentlyContinue
  Remove-Item "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
  if ($rootInstalled) {
    & certutil.exe -user -f -silent -delstore Root $certificate.Thumbprint | Out-Null
  }
}

Write-Host "Created test-signed MSIX: $artifact"
Write-Host "Install the companion testing certificate before sideloading: $certificatePath"
