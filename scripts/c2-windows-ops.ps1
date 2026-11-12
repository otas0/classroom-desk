#Requires -Version 5.1
<#
.SYNOPSIS
  Classroom Desk C2 / Assigned Access / Intune trial operator steps (Windows sample PC).

.DESCRIPTION
  Run on the school lab sample machine (not macOS). Does not apply Intune for you —
  prints the exact Intune + AA checklist and opens the evidence folder.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\c2-windows-ops.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\c2-windows-ops.ps1 -EvidenceDir "D:\证据\C2-20261112"
#>
param(
  [string]$EvidenceDir = "",
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"
if (-not $RepoRoot) {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
  if (-not (Test-Path (Join-Path $RepoRoot "docs\EXIT_LOCK_MDM.md"))) {
    $RepoRoot = (Get-Location).Path
  }
}

$day = Get-Date -Format "yyyyMMdd"
if (-not $EvidenceDir) {
  $EvidenceDir = Join-Path $RepoRoot "证据\C2-$day"
}
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

$exampleIntune = Join-Path $RepoRoot "docs\intune-student-kiosk.example.xml"
$rollbackIntune = Join-Path $RepoRoot "docs\intune-student-kiosk.rollback.xml"
$versionTpl = Join-Path $RepoRoot "docs\C2_intune-version.example.txt"
$aaJson = Join-Path $RepoRoot "docs\assigned-access-checklist.example.json"

foreach ($src in @($exampleIntune, $rollbackIntune, $aaJson)) {
  if (Test-Path $src) {
    Copy-Item -Force $src (Join-Path $EvidenceDir (Split-Path $src -Leaf))
  }
}
$versionDest = Join-Path $EvidenceDir "C2-intune-version.txt"
if (-not (Test-Path $versionDest) -and (Test-Path $versionTpl)) {
  Copy-Item -Force $versionTpl $versionDest
}

$exeCandidates = @(
  "C:\Program Files\Classroom Desk\Classroom Desk.exe",
  "C:\Program Files\Classroom Desk\ClassroomDesk.exe"
)
$exe = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host ""
Write-Host "=== Classroom Desk C2 operator (school lab Windows) ===" -ForegroundColor Cyan
Write-Host "Evidence: $EvidenceDir"
Write-Host "Installed exe: $(if ($exe) { $exe } else { '(not found — install Setup first)' })"
Write-Host ""
Write-Host "1) Intune TRIAL group only (1-3 PCs):"
Write-Host "   Upload docs\intune-student-kiosk.example.xml → assign trial → Sync device"
Write-Host "   Screenshot Start menu / policy → save as C2-intune-policy.png"
Write-Host "2) Assigned Access: single app = Classroom Desk exe path above"
Write-Host "3) Record under kiosk account:"
Write-Host "   - C2-alttab-win.mp4   (Alt+Tab / Win ineffective)"
Write-Host "   - C2-taskmgr-deny.mp4 (End task denied or process relaunched)"
Write-Host "   - C2-titlebar.png     (「已锁定」)"
Write-Host "   - C2-narrator.mp4     (optional, >=10s)"
Write-Host "4) Fill C2-intune-version.txt (22H2 + 24H2)"
Write-Host "5) AFTER trial: assign intune-student-kiosk.rollback.xml OR remove profile → Sync"
Write-Host "6) On teacher/dev machine: npm run verify:c2-evidence"
Write-Host ""
Write-Host "SECURITY: OS Alt+Tab/TM lockdown = L3 MDM. App does NOT hook Task Manager."
Write-Host "          No covert screen/key/mic capture — even on school PCs."
Write-Host ""

try { explorer.exe $EvidenceDir } catch { }

Write-Host "Done scaffolding. Complete recordings on this PC, then verify:c2-evidence."
