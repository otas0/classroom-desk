#Requires -RunAsAdministrator
<#
  Register a logon Scheduled Task to start Classroom Desk API on the teacher PC.
  Edit $RepoRoot and ensure .env exists with HOST=0.0.0.0
#>
param(
  [string]$RepoRoot = 'C:\classroom-desk',
  [string]$TaskName = 'ClassroomDeskServer'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $RepoRoot)) { throw "Repo not found: $RepoRoot" }

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c cd /d `"$RepoRoot`" && npm run start:server" -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Write-Host "Registered task '$TaskName' — starts API at user logon from $RepoRoot"
Write-Host "Test now: Start-ScheduledTask -TaskName '$TaskName'"
