# Optional post-build Authenticode sign for ClassroomDesk-Setup-*.exe
# Skips (exit 0) when WINDOWS_CERT_PFX_BASE64 / WINDOWS_CERT_PASSWORD are unset.
param(
  [string]$ReleaseDir = 'apps/student-desktop/release'
)

if (-not $env:WINDOWS_CERT_PFX_BASE64 -or -not $env:WINDOWS_CERT_PASSWORD) {
  Write-Host '::notice::WINDOWS_CERT_PFX_BASE64 / WINDOWS_CERT_PASSWORD unset — skipping Authenticode sign (CSC_LINK may still sign via electron-builder)'
  exit 0
}

$pfxPath = Join-Path $env:RUNNER_TEMP 'classroom-desk-codesign.pfx'
try {
  [IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($env:WINDOWS_CERT_PFX_BASE64))
} catch {
  Write-Error "Failed to decode WINDOWS_CERT_PFX_BASE64: $_"
  exit 1
}

$signtool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $signtool) {
  Write-Error 'signtool.exe not found (install Windows SDK on runner)'
  exit 1
}

$exes = Get-ChildItem -Path $ReleaseDir -Filter 'ClassroomDesk-Setup-*.exe' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike '*.sha256' }

if (-not $exes) {
  Write-Host "::notice::No Setup exe under $ReleaseDir — nothing to sign"
  exit 0
}

foreach ($exe in $exes) {
  Write-Host "Signing $($exe.Name) with signtool"
  & $signtool sign /v /fd SHA256 /f $pfxPath /p $env:WINDOWS_CERT_PASSWORD /tr http://timestamp.digicert.com /td SHA256 $exe.FullName
  if ($LASTEXITCODE -ne 0) {
    Write-Error "signtool failed for $($exe.Name)"
    exit $LASTEXITCODE
  }
}

Write-Host 'Authenticode sign complete'
