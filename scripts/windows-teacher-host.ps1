#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Prepare a Windows teacher PC as Classroom Desk LAN server host (no code signing needed).

.DESCRIPTION
  - Opens inbound TCP 8787 for student clients
  - Prints LAN IPv4 addresses to put into student apiBase: http://<IP>:8787
  - Optional -SmokeTest hits local /health if the API is already running

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\windows-teacher-host.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\windows-teacher-host.ps1 -SmokeTest
#>
param(
  [switch]$SmokeTest,
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$ruleName = 'Classroom Desk API'

Write-Host "=== Classroom Desk · teacher host prep ===" -ForegroundColor Cyan

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existing) {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $Port `
    -Action Allow `
    -Profile Any | Out-Null
  Write-Host "Firewall: created inbound allow TCP $Port ($ruleName)"
} else {
  Enable-NetFirewallRule -DisplayName $ruleName | Out-Null
  Write-Host "Firewall: rule already exists, ensured enabled ($ruleName)"
}

Write-Host ""
Write-Host "LAN IPv4 (use one of these in student apiBase):" -ForegroundColor Yellow
$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.PrefixOrigin -ne 'WellKnown' -and
    $_.IPAddress -notlike '169.254.*'
  } |
  Sort-Object InterfaceAlias

if (-not $ips) {
  Write-Host "  (none found — check Wi-Fi / cable)" -ForegroundColor Red
} else {
  foreach ($ip in $ips) {
    Write-Host ("  http://{0}:{1}   [{2}]" -f $ip.IPAddress, $Port, $ip.InterfaceAlias)
  }
}

Write-Host ""
Write-Host "Next:"
Write-Host "  1) cd <repo> ; set HOST=0.0.0.0 in .env ; npm run build:teacher ; npm run start:server"
Write-Host "  2) Open http://127.0.0.1:$Port/admin/ on this PC"
Write-Host "  3) On student PCs set apiBase to http://<LAN-IP>:$Port"
Write-Host "  4) From a student browser open http://<LAN-IP>:$Port/health (must work before class)"
Write-Host "Docs: docs/CLASSROOM_TEACHER_HOST.md"

if ($SmokeTest) {
  Write-Host ""
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 3
    Write-Host "Smoke /health: HTTP $($r.StatusCode) $($r.Content)"
  } catch {
    Write-Host "Smoke /health failed (is npm run start:server running?): $($_.Exception.Message)" -ForegroundColor Red
  }
}
