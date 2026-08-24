[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PackagePath,
  [Parameter(Mandatory = $true)][string]$CertificatePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$packageFile = (Resolve-Path $PackagePath).Path
$certificateFile = (Resolve-Path $CertificatePath).Path
$trustedCertificate = $null
$installedPackage = $null

try {
  $trustedCertificate = Import-Certificate `
    -FilePath $certificateFile `
    -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople'

  Add-AppxPackage -Path $packageFile -ForceApplicationShutdown
  $installedPackage = Get-AppxPackage -Name 'UniClipboard.FullMesh' |
    Sort-Object Version -Descending |
    Select-Object -First 1
  if (-not $installedPackage) {
    throw 'MSIX did not register UniClipboard.FullMesh for the current user'
  }

  $applicationUserModelId = "$($installedPackage.PackageFamilyName)!UniClipboard"
  Start-Process explorer.exe -ArgumentList "shell:AppsFolder\$applicationUserModelId"

  $deadline = (Get-Date).AddSeconds(30)
  $process = $null
  while ((Get-Date) -lt $deadline -and -not $process) {
    Start-Sleep -Milliseconds 500
    $process = Get-Process -Name 'UniClipboard' -ErrorAction SilentlyContinue |
      Select-Object -First 1
  }
  if (-not $process) {
    throw "MSIX registered, but $applicationUserModelId did not start UniClipboard.exe"
  }

  Write-Host "Started MSIX application process $($process.Id)"
  Stop-Process -Id $process.Id -Force
} finally {
  Get-Process -Name 'UniClipboard', 'uniclipd' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

  if (-not $installedPackage) {
    $installedPackage = Get-AppxPackage -Name 'UniClipboard.FullMesh' |
      Sort-Object Version -Descending |
      Select-Object -First 1
  }
  if ($installedPackage) {
    Remove-AppxPackage -Package $installedPackage.PackageFullName
  }

  if ($trustedCertificate) {
    Remove-Item "Cert:\LocalMachine\TrustedPeople\$($trustedCertificate.Thumbprint)" `
      -Force `
      -ErrorAction SilentlyContinue
  }
}

if (Get-AppxPackage -Name 'UniClipboard.FullMesh') {
  throw 'MSIX remained registered after Remove-AppxPackage'
}

Write-Host 'MSIX install, launch, and uninstall lifecycle passed'
