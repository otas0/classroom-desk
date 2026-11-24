#Requires -Version 5.1
<#
  Classroom Desk — one Setup wizard (WinForms).
  Steps: install folder, Node (auto MSI / pick node.exe), options, install.
#>
param(
  [string]$PayloadRoot = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $PayloadRoot) { $PayloadRoot = $PSScriptRoot }
$PayloadRoot = ([string]$PayloadRoot).Trim().TrimEnd('\', '/')

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
[System.Windows.Forms.Application]::EnableVisualStyles()

function Test-IsAdmin {
  try {
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

function Get-PsExe {
  $p = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (Test-Path -LiteralPath $p) { return $p }
  return (Join-Path $env:SystemRoot 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe')
}

# Re-launch elevated once
if (-not (Test-IsAdmin)) {
  $ps = Get-PsExe
  $args = @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', $PSCommandPath,
    '-PayloadRoot', $PayloadRoot
  )
  try {
    Start-Process -FilePath $ps -Verb RunAs -ArgumentList $args | Out-Null
  } catch {
    [System.Windows.Forms.MessageBox]::Show(
      'Need Administrator to install Classroom Desk.',
      'Classroom Desk',
      'OK',
      'Warning'
    ) | Out-Null
  }
  exit 0
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Classroom Desk Setup'
$form.Size = New-Object System.Drawing.Size(560, 520)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = 'Classroom Desk'
$lblTitle.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16)
$lblTitle.Location = New-Object System.Drawing.Point(20, 16)
$lblTitle.AutoSize = $true
$form.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = 'One-time setup. After this, use the Desktop shortcut.'
$lblSub.Location = New-Object System.Drawing.Point(22, 48)
$lblSub.Size = New-Object System.Drawing.Size(500, 24)
$form.Controls.Add($lblSub)

# --- Install folder ---
$grpFolder = New-Object System.Windows.Forms.GroupBox
$grpFolder.Text = '1. Install folder'
$grpFolder.Location = New-Object System.Drawing.Point(20, 80)
$grpFolder.Size = New-Object System.Drawing.Size(505, 70)
$form.Controls.Add($grpFolder)

$txtFolder = New-Object System.Windows.Forms.TextBox
$txtFolder.Text = 'C:\ClassroomDesk'
$txtFolder.Location = New-Object System.Drawing.Point(12, 28)
$txtFolder.Size = New-Object System.Drawing.Size(380, 26)
$grpFolder.Controls.Add($txtFolder)

$btnBrowseFolder = New-Object System.Windows.Forms.Button
$btnBrowseFolder.Text = 'Browse...'
$btnBrowseFolder.Location = New-Object System.Drawing.Point(400, 26)
$btnBrowseFolder.Size = New-Object System.Drawing.Size(90, 28)
$grpFolder.Controls.Add($btnBrowseFolder)
$btnBrowseFolder.Add_Click({
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = 'Install Classroom Desk to:'
  $d.SelectedPath = $txtFolder.Text
  if ($d.ShowDialog() -eq 'OK') { $txtFolder.Text = $d.SelectedPath }
})

# --- Node ---
$grpNode = New-Object System.Windows.Forms.GroupBox
$grpNode.Text = '2. Node.js (required, 22.5+)'
$grpNode.Location = New-Object System.Drawing.Point(20, 160)
$grpNode.Size = New-Object System.Drawing.Size(505, 120)
$form.Controls.Add($grpNode)

$rbAuto = New-Object System.Windows.Forms.RadioButton
$rbAuto.Text = 'Auto install (official MSI)'
$rbAuto.Location = New-Object System.Drawing.Point(12, 28)
$rbAuto.AutoSize = $true
$rbAuto.Checked = $true
$grpNode.Controls.Add($rbAuto)

$rbCustom = New-Object System.Windows.Forms.RadioButton
$rbCustom.Text = 'I already have Node — pick node.exe'
$rbCustom.Location = New-Object System.Drawing.Point(12, 54)
$rbCustom.AutoSize = $true
$grpNode.Controls.Add($rbCustom)

$txtNode = New-Object System.Windows.Forms.TextBox
$txtNode.Location = New-Object System.Drawing.Point(12, 82)
$txtNode.Size = New-Object System.Drawing.Size(380, 26)
$txtNode.Enabled = $false
$grpNode.Controls.Add($txtNode)

$btnBrowseNode = New-Object System.Windows.Forms.Button
$btnBrowseNode.Text = 'Browse...'
$btnBrowseNode.Location = New-Object System.Drawing.Point(400, 80)
$btnBrowseNode.Size = New-Object System.Drawing.Size(90, 28)
$btnBrowseNode.Enabled = $false
$grpNode.Controls.Add($btnBrowseNode)

$rbAuto.Add_CheckedChanged({
  $txtNode.Enabled = $rbCustom.Checked
  $btnBrowseNode.Enabled = $rbCustom.Checked
})
$rbCustom.Add_CheckedChanged({
  $txtNode.Enabled = $rbCustom.Checked
  $btnBrowseNode.Enabled = $rbCustom.Checked
})
$btnBrowseNode.Add_Click({
  $d = New-Object System.Windows.Forms.OpenFileDialog
  $d.Filter = 'node.exe|node.exe|All|*.*'
  $d.Title = 'Select Windows node.exe'
  if ($d.ShowDialog() -eq 'OK') { $txtNode.Text = $d.FileName }
})

# --- Options ---
$grpOpt = New-Object System.Windows.Forms.GroupBox
$grpOpt.Text = '3. Options'
$grpOpt.Location = New-Object System.Drawing.Point(20, 290)
$grpOpt.Size = New-Object System.Drawing.Size(505, 90)
$form.Controls.Add($grpOpt)

$chkChina = New-Object System.Windows.Forms.CheckBox
$chkChina.Text = 'Prefer China mirrors (npmmirror) for Node MSI'
$chkChina.Location = New-Object System.Drawing.Point(12, 28)
$chkChina.AutoSize = $true
$chkChina.Checked = $true
$grpOpt.Controls.Add($chkChina)

$chkStart = New-Object System.Windows.Forms.CheckBox
$chkStart.Text = 'Start Classroom Desk when finished'
$chkStart.Location = New-Object System.Drawing.Point(12, 54)
$chkStart.AutoSize = $true
$chkStart.Checked = $true
$grpOpt.Controls.Add($chkStart)

# --- Log + buttons ---
$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ScrollBars = 'Vertical'
$txtLog.ReadOnly = $true
$txtLog.Location = New-Object System.Drawing.Point(20, 390)
$txtLog.Size = New-Object System.Drawing.Size(505, 50)
$txtLog.Font = New-Object System.Drawing.Font('Consolas', 9)
$form.Controls.Add($txtLog)

function Write-UiLog([string]$Msg) {
  $txtLog.AppendText(("[{0}] {1}`r`n" -f (Get-Date -Format 'HH:mm:ss'), $Msg))
  [System.Windows.Forms.Application]::DoEvents()
}

$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = 'Install'
$btnInstall.Location = New-Object System.Drawing.Point(320, 448)
$btnInstall.Size = New-Object System.Drawing.Size(100, 32)
$form.Controls.Add($btnInstall)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = 'Close'
$btnClose.Location = New-Object System.Drawing.Point(430, 448)
$btnClose.Size = New-Object System.Drawing.Size(95, 32)
$form.Controls.Add($btnClose)
$btnClose.Add_Click({ $form.Close() })

$btnInstall.Add_Click({
  $btnInstall.Enabled = $false
  $btnClose.Enabled = $false
  try {
    $root = ([string]$txtFolder.Text).Trim().TrimEnd('\', '/')
    if (-not $root) { throw 'Install folder is empty' }
    if ($rbCustom.Checked) {
      $ne = ([string]$txtNode.Text).Trim().Trim('"')
      if (-not $ne -or -not (Test-Path -LiteralPath $ne)) {
        throw 'Select a valid node.exe'
      }
    }

    Write-UiLog "Install folder: $root"
    if (-not (Test-Path -LiteralPath $root)) {
      New-Item -ItemType Directory -Path $root -Force | Out-Null
    }

    # Unblock payload
    Write-UiLog 'Unblock files...'
    Get-ChildItem -LiteralPath $PayloadRoot -Recurse -Force -ErrorAction SilentlyContinue |
      Unblock-File -ErrorAction SilentlyContinue

    # Preserve data, then copy payload -> install root
    if ($PayloadRoot -ne $root) {
      Write-UiLog 'Copying product files...'
      $keep = Join-Path $env:TEMP ("cd-keep-" + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $keep -Force | Out-Null
      if (Test-Path -LiteralPath (Join-Path $root '.env')) {
        Copy-Item (Join-Path $root '.env') (Join-Path $keep '.env') -Force
      }
      $dataSrc = Join-Path $root 'apps\server\data'
      if (Test-Path -LiteralPath $dataSrc) {
        New-Item -ItemType Directory -Path (Join-Path $keep 'data') -Force | Out-Null
        & robocopy $dataSrc (Join-Path $keep 'data') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
      }
      & robocopy $PayloadRoot $root /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "copy failed (robocopy $LASTEXITCODE)" }
      if (Test-Path -LiteralPath (Join-Path $keep '.env')) {
        Copy-Item (Join-Path $keep '.env') (Join-Path $root '.env') -Force
        Write-UiLog 'Kept existing .env'
      }
      if (Test-Path -LiteralPath (Join-Path $keep 'data')) {
        New-Item -ItemType Directory -Path $dataSrc -Force | Out-Null
        & robocopy (Join-Path $keep 'data') $dataSrc /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
        Write-UiLog 'Kept classroom data'
      }
      Remove-Item -LiteralPath $keep -Recurse -Force -ErrorAction SilentlyContinue
    }

    $ps = Get-PsExe
    $ensure = Join-Path $root 'ensure-windows-node.ps1'
    if (-not (Test-Path -LiteralPath $ensure)) { $ensure = Join-Path $PayloadRoot 'ensure-windows-node.ps1' }
    if (-not (Test-Path -LiteralPath $ensure)) { throw 'ensure-windows-node.ps1 missing' }

    Write-UiLog 'Configuring Node...'
    # No -Force: reuse Teacher-Setup embedded runtime / node-path / system Node first; MSI only if needed.
    $nodeArgs = @(
      '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', $ensure,
      '-InstallRoot', $root
    )
    if ($chkChina.Checked) { $nodeArgs += '-ChinaMirrorsFirst' }
    if ($rbCustom.Checked) {
      $nodeArgs += @('-NodeExe', ([string]$txtNode.Text).Trim().Trim('"'))
    }
    $pNode = Start-Process -FilePath $ps -ArgumentList $nodeArgs -Wait -PassThru -NoNewWindow
    if ($pNode.ExitCode -ne 0) {
      throw "Node setup failed (exit $($pNode.ExitCode)). Pick your own node.exe or fix network for MSI."
    }
    Write-UiLog 'Node OK'

    $installPs1 = Join-Path $root 'install-teacher.ps1'
    if (-not (Test-Path -LiteralPath $installPs1)) { throw 'install-teacher.ps1 missing' }
    Write-UiLog 'Finishing product install...'
    $instArgs = @(
      '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', $installPs1,
      '-InstallRoot', $root,
      '-SkipSourceDownload'
    )
    if ($chkChina.Checked) { $instArgs += '-ChinaMirrorsFirst' }
    if (-not $chkStart.Checked) { $instArgs += '-SkipStart' }
    $pInst = Start-Process -FilePath $ps -ArgumentList $instArgs -Wait -PassThru -NoNewWindow
    if ($pInst.ExitCode -ne 0) {
      throw "Install failed (exit $($pInst.ExitCode)). See Desktop\ClassroomDesk-Install-Log.txt"
    }

    Write-UiLog 'Done. Use Desktop: Classroom Desk'
    [System.Windows.Forms.MessageBox]::Show(
      "Installed to:`n$root`n`nLogin: teacher / admin`nDesktop shortcut: Classroom Desk",
      'Classroom Desk',
      'OK',
      'Information'
    ) | Out-Null
  } catch {
    Write-UiLog ("ERROR: " + $_.Exception.Message)
    [System.Windows.Forms.MessageBox]::Show(
      $_.Exception.Message,
      'Classroom Desk Setup',
      'OK',
      'Error'
    ) | Out-Null
  } finally {
    $btnInstall.Enabled = $true
    $btnClose.Enabled = $true
  }
})

[void]$form.ShowDialog()
exit 0
