param([string]$InstallerPath)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\88af18cb-cbf0-525c-9d37-4311f029f41a'
$shortcut = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\codingSchedule.lnk'
$userReceipts = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'coding-schedule\receipts.json'
$sharedReceipts = Join-Path $env:USERPROFILE '.coding-schedule\receipts.json'
if ((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath $shortcut) -or (Test-Path -LiteralPath $userReceipts) -or (Test-Path -LiteralPath $sharedReceipts)) { throw 'An existing installation, shortcut or real integration receipt exists; isolated installer probe refused.' }
$testRoot = Join-Path $workspace ('.artifacts\installer\run-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$destination = Join-Path $testRoot 'codingSchedule'
if (-not ([IO.Path]::GetFullPath($destination).StartsWith($workspace + '\.artifacts\installer\'))) { throw 'Unsafe installer target' }
$installer = if ($InstallerPath) { (Resolve-Path -LiteralPath $InstallerPath).Path } else { Join-Path $workspace 'release\codingSchedule-0.1.0-win-x64-setup.exe' }
$installed = Start-Process -FilePath $installer -ArgumentList @('/S','--skip-integrations','--no-desktop-shortcut',('/D=' + $destination)) -WindowStyle Hidden -Wait -PassThru
if ($installed.ExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $destination 'codingSchedule.exe'))) { throw 'Installer failed' }
try {
  & node (Join-Path $workspace 'scripts\package-smoke.mjs') ('--dir=' + $destination)
  if ($LASTEXITCODE -ne 0) { throw 'Installed binary smoke failed' }
} finally {
  $uninstaller = Join-Path $destination 'Uninstall codingSchedule.exe'
  if (Test-Path -LiteralPath $uninstaller) { $removed = Start-Process -FilePath $uninstaller -ArgumentList @('/S') -WindowStyle Hidden -Wait -PassThru; Start-Sleep -Seconds 2 }
}
if ((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath (Join-Path $destination 'codingSchedule.exe'))) { throw 'Uninstall left registration or executable behind' }
$report = [pscustomobject]@{ ok=$true; scope='Existing Windows user, guarded temporary per-user install and silent uninstall; no clean VM or interactive checkbox acceptance'; installedExit=$installed.ExitCode; uninstalledExit=$removed.ExitCode; target=$destination }
$report | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $testRoot 'result.json')
$report | ConvertTo-Json -Compress
