#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Pin the teacher PC to a fixed IPv4 (default 192.168.31.179), then remind host + autostart.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\windows-set-fixed-ip.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\windows-set-fixed-ip.ps1 -IP 192.168.31.179 -PrefixLength 24 -Gateway 192.168.31.1
#>
param(
  [string]$IP = '192.168.31.179',
  [int]$PrefixLength = 24,
  [string]$Gateway = '192.168.31.1',
  [string[]]$Dns = @('192.168.31.1', '223.5.5.5'),
  [string]$Alias = ''
)

$ErrorActionPreference = 'Stop'
Write-Host "=== Classroom Desk · fixed IP ===" -ForegroundColor Cyan

$adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.HardwareInterface }
if (-not $adapters) { throw 'No connected Ethernet/Wi-Fi adapter found.' }

if ($Alias) {
  $nic = $adapters | Where-Object { $_.Name -eq $Alias } | Select-Object -First 1
  if (-not $nic) { throw "Adapter alias not found: $Alias" }
} else {
  Write-Host 'Connected adapters:'
  $adapters | ForEach-Object { Write-Host ("  [{0}] {1}  {2}" -f $_.ifIndex, $_.Name, $_.InterfaceDescription) }
  $nic = $adapters | Select-Object -First 1
  Write-Host ("Using: {0}" -f $nic.Name) -ForegroundColor Yellow
}

Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '169.254.*' } |
  ForEach-Object {
    Remove-NetIPAddress -InterfaceIndex $nic.ifIndex -IPAddress $_.IPAddress -Confirm:$false -ErrorAction SilentlyContinue
  }
Remove-NetRoute -InterfaceIndex $nic.ifIndex -DestinationPrefix '0.0.0.0/0' -Confirm:$false -ErrorAction SilentlyContinue

New-NetIPAddress -InterfaceIndex $nic.ifIndex -IPAddress $IP -PrefixLength $PrefixLength -DefaultGateway $Gateway | Out-Null
Set-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -ServerAddresses $Dns

Write-Host ("Fixed IP set: {0}/{1} gateway {2}" -f $IP, $PrefixLength, $Gateway) -ForegroundColor Green
Write-Host 'Next on this PC (admin PowerShell):'
Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\windows-teacher-host.ps1 -SmokeTest'
Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\windows-autostart-server.ps1 -RepoRoot C:\classroom-desk'
Write-Host ("Student apiBase must be http://{0}:8787" -f $IP)
