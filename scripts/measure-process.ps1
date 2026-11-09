param([string]$ProcessIds, [switch]$Stream, [switch]$Details, [switch]$IncludeChildren)
$ErrorActionPreference = 'Stop'
function Measure-Product([string]$ProcessIds) {
$ids = $ProcessIds.Split(',') | ForEach-Object { [int]$_ }
$requestedIds=@($ids)
if($IncludeChildren){
 $tree=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
 do{$before=$ids.Count;$ids=@($ids)+@($tree | Where-Object { $_.ParentProcessId -in $ids } | ForEach-Object { [int]$_.ProcessId });$ids=@($ids | Select-Object -Unique)}while($ids.Count -gt $before)
}
$items = @(Get-Process -Id $ids -ErrorAction SilentlyContinue)
$result = [pscustomobject]@{
  count = $items.Count
  requestedCount = @($items | Where-Object { $_.Id -in $requestedIds }).Count
  processIds = @($items.Id | Sort-Object)
  privateBytes = [long](($items | Measure-Object PrivateMemorySize64 -Sum).Sum)
  workingSetBytes = [long](($items | Measure-Object WorkingSet64 -Sum).Sum)
  cpuMs = [double](($items | ForEach-Object { $_.TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum)
}
if ($Details) {
  $result | Add-Member -NotePropertyName processes -NotePropertyValue @($items | ForEach-Object {
    [pscustomobject]@{pid=$_.Id;name=$_.ProcessName;privateBytes=$_.PrivateMemorySize64;workingSetBytes=$_.WorkingSet64;cpuMs=$_.TotalProcessorTime.TotalMilliseconds}
  })
}
$result | ConvertTo-Json -Depth 4 -Compress
}
if ($Stream) {
  while ($null -ne ($line = [Console]::ReadLine())) {
    try { Measure-Product $line } catch { [pscustomobject]@{error=$_.Exception.Message} | ConvertTo-Json -Compress }
  }
} else { Measure-Product $ProcessIds }
