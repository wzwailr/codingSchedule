param([Parameter(Mandatory=$true)][string]$Executable,[string]$NodeExecutable='node',[string]$SchedulerTaskName)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$artifacts=Join-Path $root '.artifacts'
$statePath=Join-Path $artifacts 'endurance-current.json'
$exitPath=Join-Path $artifacts 'endurance-exit.json'
$startedAt=Get-Date
$log=Join-Path $artifacts ('endurance-'+$startedAt.ToString('yyyyMMdd-HHmmss-fff')+'.log')
$jobExit=1;$powerHeld=$false;$released=$true;$ownsRun=$false;$lock=$null;$state=$null
$priorState=$env:SCHEDULE_BENCH_STATE
function Get-EnduranceSha256([string]$Path){
 $stream=[IO.File]::OpenRead($Path);$digest=[Security.Cryptography.SHA256]::Create()
 try{return [BitConverter]::ToString($digest.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$digest.Dispose();$stream.Dispose()}
}
function Write-EnduranceJson([string]$Path,$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))}
function Note-EnduranceFailure([string]$Message){try{[IO.File]::AppendAllText($log,$Message+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))}catch{}}
try{
 Set-Location -LiteralPath $root
 [void][IO.Directory]::CreateDirectory($artifacts)
 # FileShare.None is an atomic cross-process owner lock, including during startup.
 try{$lock=[IO.File]::Open((Join-Path $artifacts 'endurance.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch [IO.IOException]{throw 'An endurance owner is still running'}
 if(Test-Path -LiteralPath $statePath){
  $previous=Get-Content -Raw -Encoding UTF8 -LiteralPath $statePath|ConvertFrom-Json
  $owner=Get-Process -Id $previous.wrapperPid -ErrorAction SilentlyContinue
  if($owner -and $previous.wrapperCreatedAtMs -and ([DateTimeOffset]$owner.StartTime).ToUnixTimeMilliseconds() -eq [long]$previous.wrapperCreatedAtMs){throw 'An endurance owner is still running'}
  if($owner -and -not $previous.wrapperCreatedAtMs -and $previous.status -in @('starting','running')){throw 'Previous running owner identity requires review'}
  $tag=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  Copy-Item -LiteralPath $statePath -Destination (Join-Path $artifacts ('endurance-'+$tag+'.json'))
  if(Test-Path -LiteralPath $exitPath){Copy-Item -LiteralPath $exitPath -Destination (Join-Path $artifacts ('endurance-'+$tag+'-exit.json'));Remove-Item -LiteralPath $exitPath}
 }
 $ownsRun=$true
 $state=[pscustomobject][ordered]@{status='starting';startedAt=$startedAt.ToString('o');expectedFinish=$startedAt.AddHours(8).AddMinutes(5).AddSeconds(15).ToString('o');executable=$Executable;sourceCommit=$null;sourceDirty=$null;rate=2;runs=10;mcpInstances=3;durationSec=28800;idleSec=300;databaseBudgetBytes=104857600;wrapperPid=$PID;wrapperCreatedAtMs=([DateTimeOffset](Get-Process -Id $PID).StartTime).ToUnixTimeMilliseconds();temporarySystemAwake=$false;nodeExecutable=$NodeExecutable;schedulerTaskName=$SchedulerTaskName;serviceOwned=[bool]$SchedulerTaskName;log=$log;exitFile=$exitPath}
 Write-EnduranceJson $statePath $state
 $candidate=(Resolve-Path -LiteralPath $Executable).Path
 $state.executable=$candidate
 $state|Add-Member -NotePropertyName appAsarSha256 -NotePropertyValue (Get-EnduranceSha256 (Join-Path (Split-Path $candidate) 'resources/app.asar'))
 $state|Add-Member -NotePropertyName relaySha256 -NotePropertyValue (Get-EnduranceSha256 (Join-Path (Split-Path $candidate) 'resources/bridge/mcp-relay.exe'))
 $state.sourceCommit=(git rev-parse HEAD).Trim();$state.sourceDirty=[bool](git status --porcelain)
 Add-Type @'
using System.Runtime.InteropServices;
public static class CodingScheduleEndurancePower {
 [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
}
'@
 if([CodingScheduleEndurancePower]::SetThreadExecutionState([uint32]2147483649) -eq 0){throw 'Temporary system-awake request failed'}
 $powerHeld=$true;$state.temporarySystemAwake=$true;Write-EnduranceJson $statePath $state
 $env:SCHEDULE_BENCH_STATE=$statePath
 $nativeExit=$null
 try{
  # PS5 turns native stderr into ErrorRecord. Capture it without aborting the run.
  $ErrorActionPreference='Continue'
  & $NodeExecutable scripts/bench.mjs --exe $candidate --endurance --rate 2 --runs 10 --mcp-instances 3 --duration 28800 --idle 300 2>&1|Out-File -LiteralPath $log -Encoding UTF8
  $nativeExit=$LASTEXITCODE
 }finally{$ErrorActionPreference='Stop'}
 if($null -eq $nativeExit){throw 'No benchmark exit code'}
 $jobExit=[int]$nativeExit
 if($jobExit -eq 0){
  $completed=Get-Content -Raw -Encoding UTF8 -LiteralPath $statePath|ConvertFrom-Json
  if(-not $completed.verdictFile){throw 'No benchmark verdict'}
  $verdict=Get-Content -Raw -Encoding UTF8 -LiteralPath $completed.verdictFile|ConvertFrom-Json
  if($verdict.ok -isnot [bool] -or -not $verdict.ok){throw 'Benchmark verdict did not pass'}
 }
}catch{
 $jobExit=1
 Note-EnduranceFailure ('Endurance wrapper failed: '+$_.Exception.GetType().Name)
}finally{
 $env:SCHEDULE_BENCH_STATE=$priorState
 if($powerHeld){try{$released=[CodingScheduleEndurancePower]::SetThreadExecutionState([uint32]2147483648) -ne 0}catch{$released=$false;$jobExit=1}}
 if(-not $released){$jobExit=1}
 # Terminal evidence is best effort on an unavailable filesystem. An I/O failure
 # always makes the exit nonzero and cannot bypass scheduler or lock cleanup.
 try{
  if($ownsRun){
   $finalState=$state
   try{$finalState=Get-Content -Raw -Encoding UTF8 -LiteralPath $statePath|ConvertFrom-Json}catch{$jobExit=1}
   $finishedAt=(Get-Date).ToString('o')
   try{
    foreach($entry in @{status=$(if($jobExit -eq 0){'passed'}else{'failed'});finishedAt=$finishedAt;exitCode=$jobExit;temporarySystemAwakeReleased=$released}.GetEnumerator()){$finalState|Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value -Force}
    Write-EnduranceJson $statePath $finalState
   }catch{$jobExit=1;Note-EnduranceFailure 'Terminal state write failed'}
   try{Write-EnduranceJson $exitPath ([ordered]@{exitCode=$jobExit;startedAt=$startedAt.ToString('o');finishedAt=$finishedAt;temporarySystemAwakeReleased=$released;log=$log})}catch{$jobExit=1;Note-EnduranceFailure 'Exit record write failed';try{$finalState.status='failed';$finalState.exitCode=1;Write-EnduranceJson $statePath $finalState}catch{}}
  }
 }finally{
  try{
   if($SchedulerTaskName){
    if($SchedulerTaskName -notmatch '^codingSchedule-endurance-[a-f0-9-]{36}$'){$jobExit=1;Note-EnduranceFailure 'Unexpected scheduler task identity'}
    else{try{$scheduler=New-Object -ComObject 'Schedule.Service';$scheduler.Connect();$scheduler.GetFolder('\').DeleteTask($SchedulerTaskName,0)}catch{$jobExit=1;Note-EnduranceFailure ('Scheduler cleanup failed: '+$_.Exception.GetType().Name)}}
   }
  }finally{
   try{
    if($ownsRun -and $finalState -and $finalState.exitCode -ne $jobExit){
     $finalState.status='failed';$finalState.exitCode=$jobExit
     Write-EnduranceJson $statePath $finalState
     Write-EnduranceJson $exitPath ([ordered]@{exitCode=$jobExit;startedAt=$startedAt.ToString('o');finishedAt=(Get-Date).ToString('o');temporarySystemAwakeReleased=$released;log=$log})
    }
   }catch{$jobExit=1;Note-EnduranceFailure 'Cleanup outcome write failed'}
   finally{if($lock){$lock.Dispose()}}
  }
 }
}
exit $jobExit
