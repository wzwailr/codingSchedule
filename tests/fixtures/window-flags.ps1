param([Parameter(Mandatory=$true)][long]$WindowHandle,[Parameter(Mandatory=$true)][uint32]$OwnerPid)
$ErrorActionPreference='Stop'
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class ScheduleWindowFlags {
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]static extern IntPtr GetWindowLongPtr(IntPtr w,int n);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr w);
 public static object Read(long handle,uint owner){var w=new IntPtr(handle);uint pid;GetWindowThreadProcessId(w,out pid);if(pid!=owner)throw new Exception("Unexpected window owner");return new{visible=IsWindowVisible(w),topmost=(GetWindowLongPtr(w,-20).ToInt64()&8)!=0};}
}
'@
[ScheduleWindowFlags]::Read($WindowHandle,$OwnerPid)|ConvertTo-Json -Compress
