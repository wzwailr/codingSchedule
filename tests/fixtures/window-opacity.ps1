param([Parameter(Mandatory=$true)][long]$WindowHandle,[Parameter(Mandatory=$true)][uint32]$OwnerPid)
$ErrorActionPreference='Stop'
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class ScheduleOpacity {
 [StructLayout(LayoutKind.Sequential)]public struct RECT{public int left,top,right,bottom;}
 [DllImport("user32.dll")]public static extern bool GetLayeredWindowAttributes(IntPtr w,out uint key,out byte alpha,out uint flags);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr w,out RECT rect);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr w);
}
'@
$window=[IntPtr]::new($WindowHandle);[uint32]$owner=0;[void][ScheduleOpacity]::GetWindowThreadProcessId($window,[ref]$owner)
if($owner -ne $OwnerPid){throw 'Unexpected window owner'}
[uint32]$key=0;[byte]$alpha=0;[uint32]$flags=0;$available=[ScheduleOpacity]::GetLayeredWindowAttributes($window,[ref]$key,[ref]$alpha,[ref]$flags)
[uint32]$frontOwner=0;$front=[ScheduleOpacity]::GetForegroundWindow();[void][ScheduleOpacity]::GetWindowThreadProcessId($front,[ref]$frontOwner)
$rect=New-Object ScheduleOpacity+RECT;[void][ScheduleOpacity]::GetWindowRect($window,[ref]$rect)
[pscustomobject]@{at=(Get-Date).ToString('o');owner=$owner;visible=[ScheduleOpacity]::IsWindowVisible($window);bounds=@{x=$rect.left;y=$rect.top;width=$rect.right-$rect.left;height=$rect.bottom-$rect.top};layeredAttributesAvailable=$available;alphaByte=if($available -and ($flags-band 2)){[int]$alpha}else{$null};opacity=if($available -and ($flags-band 2)){$alpha/255.0}else{$null};foregroundWindow=$front.ToInt64();foregroundOwner=$frontOwner}|ConvertTo-Json -Depth 4 -Compress
