param([Parameter(Mandatory=$true)][string]$Executable,[switch]$ValidateOnly)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$candidate=(Resolve-Path -LiteralPath $Executable).Path
$runner=Join-Path $PSScriptRoot 'run-endurance.ps1'
$hostPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$nodePath=(Get-Command node.exe -CommandType Application -ErrorAction Stop|Select-Object -First 1).Source
if(-not (Test-Path -LiteralPath $nodePath -PathType Leaf)){throw 'Node executable not found'}
$nodeVersion=(& $nodePath --version).Trim()
$parsedVersion=[Version]$nodeVersion.TrimStart('v')
if($parsedVersion -lt [Version]'24.15.0' -or $parsedVersion -ge [Version]'25.0.0'){throw 'Acceptance driver needs Node >=24.15 and <25'}
$statePath=Join-Path $root '.artifacts/endurance-current.json'
if(-not $ValidateOnly -and (Test-Path -LiteralPath $statePath)){
 $prior=Get-Content -Raw -Encoding UTF8 -LiteralPath $statePath|ConvertFrom-Json
 $owner=Get-Process -Id $prior.wrapperPid -ErrorAction SilentlyContinue
 if($owner -and $prior.wrapperCreatedAtMs -and ([DateTimeOffset]$owner.StartTime).ToUnixTimeMilliseconds() -eq [long]$prior.wrapperCreatedAtMs){throw 'An endurance owner is still running'}
}
$id=[Guid]::NewGuid().ToString()
$taskName='codingSchedule-endurance-'+$id
$probePath=Join-Path $root ('.artifacts/endurance-launch-probe-'+$id+'.json')
$service=New-Object -ComObject 'Schedule.Service'
$service.Connect()
$folder=$service.GetFolder('\')
$definition=$service.NewTask(0)
$definition.RegistrationInfo.Description='Temporary codingSchedule acceptance runner; demand start only; no reminders or recurring triggers.'
$definition.Principal.UserId=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$definition.Principal.LogonType=3
$definition.Principal.RunLevel=0
$definition.Settings.Enabled=$true
$definition.Settings.AllowDemandStart=$true
$definition.Settings.ExecutionTimeLimit='PT0S'
$definition.Settings.DisallowStartIfOnBatteries=$false
$definition.Settings.StopIfGoingOnBatteries=$false
$definition.Settings.MultipleInstances=2
$action=$definition.Actions.Create(0)
$action.Path=$hostPath
$action.WorkingDirectory=$root
if($ValidateOnly){
 $probe=@'
$ErrorActionPreference='Stop'
$self=Get-Process -Id $PID
$parent=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)).ParentProcessId
$info=[ordered]@{pid=$PID;parentPid=$parent;parentName=(Get-Process -Id $parent).ProcessName;sessionId=$self.SessionId}
[IO.File]::WriteAllText('__OUTPUT__',($info|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
'@
 $probe=$probe.Replace('__OUTPUT__',$probePath.Replace("'","''"))
 $action.Arguments='-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probe))
}else{
 $action.Arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+$runner+'" -Executable "'+$candidate+'" -NodeExecutable "'+$nodePath+'" -SchedulerTaskName "'+$taskName+'"'
}
$registered=$null
try{
 $registered=$folder.RegisterTaskDefinition($taskName,$definition,6,$definition.Principal.UserId,$null,3,$null)
 $instance=$registered.Run($null)
 if($ValidateOnly){
  $observed=$null
  for($attempt=0;$attempt -lt 100;$attempt++){
   if(Test-Path -LiteralPath $probePath){try{$observed=Get-Content -Raw -Encoding UTF8 -LiteralPath $probePath|ConvertFrom-Json;break}catch{}}
   Start-Sleep -Milliseconds 100
  }
  if(-not $observed){throw 'Scheduler probe did not start'}
  if($observed.sessionId -ne (Get-Process -Id $PID).SessionId -or $observed.parentName -notin @('svchost','taskeng','taskhostw','taskhost')){throw 'Scheduler did not create an independent interactive runner'}
  [ordered]@{serviceOwned=$true;validationOnly=$true;interactiveSession=$true;parentName=$observed.parentName;triggers=$definition.Triggers.Count;nodeVersion=$nodeVersion;nodeExecutableExists=$true}|ConvertTo-Json -Compress
 }else{
  $ready=$false
  for($attempt=0;$attempt -lt 150;$attempt++){
   $current=$null
   try{$current=Get-Content -Raw -Encoding UTF8 -LiteralPath $statePath|ConvertFrom-Json}catch{}
   if($current -and $current.schedulerTaskName -eq $taskName){
    if($current.status -eq 'failed'){throw 'Independent acceptance runner rejected startup'}
    if($current.status -eq 'running' -and $current.driverPid -and (Get-Process -Id $current.driverPid -ErrorAction SilentlyContinue)){$ready=$true;break}
   }
   Start-Sleep -Milliseconds 100
  }
  if(-not $ready){throw 'Independent acceptance runner did not become ready'}
  $proof=[ordered]@{serviceOwned=$true;validationOnly=$false;ready=$true;taskName=$taskName;instance=$instance.InstanceGuid;triggers=$definition.Triggers.Count;at=(Get-Date).ToString('o')}
  [IO.File]::WriteAllText((Join-Path $root '.artifacts/endurance-launch.json'),($proof|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  $proof|ConvertTo-Json -Compress
 }
}catch{
 $failure=$_
 if($registered){try{$registered.Stop(0)}catch{};try{$folder.DeleteTask($taskName,0)}catch{};$registered=$null}
 throw $failure
}finally{
 if($ValidateOnly -and $registered){$registered.Stop(0);$folder.DeleteTask($taskName,0)}
 if(Test-Path -LiteralPath $probePath){Remove-Item -LiteralPath $probePath}
}
