param([Parameter(Mandatory=$true)][long]$WindowHandle,[Parameter(Mandatory=$true)][uint32]$OwnerPid,[string]$PointsJson='[]')
$ErrorActionPreference='Stop'
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class FoldNativeRegion {
 [StructLayout(LayoutKind.Sequential)]public struct RECT{public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential)]public struct POINT{public int x,y;public POINT(int px,int py){x=px;y=py;}}
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr w,out RECT r);
 [DllImport("user32.dll")]public static extern int GetWindowRgn(IntPtr w,IntPtr region);
 [DllImport("gdi32.dll")]public static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
 [DllImport("gdi32.dll")]public static extern bool PtInRegion(IntPtr r,int x,int y);
 [DllImport("gdi32.dll")]public static extern bool DeleteObject(IntPtr o);
 [DllImport("user32.dll")]public static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern bool GetCursorPos(out POINT p);
}
'@
$window=[IntPtr]::new($WindowHandle);[uint32]$actualOwner=0;[void][FoldNativeRegion]::GetWindowThreadProcessId($window,[ref]$actualOwner)
if($actualOwner -ne $OwnerPid){throw 'Unexpected window owner'}
$rectangle=New-Object FoldNativeRegion+RECT;[void][FoldNativeRegion]::GetWindowRect($window,[ref]$rectangle)
$region=[FoldNativeRegion]::CreateRectRgn(0,0,0,0)
try{
 $kind=[FoldNativeRegion]::GetWindowRgn($window,$region)
 $samples=ConvertFrom-Json -InputObject $PointsJson
 $points=@(foreach($sample in $samples) {
  $pointX=[int]$rectangle.left+[int]$sample.x;$pointY=[int]$rectangle.top+[int]$sample.y
  $point=[FoldNativeRegion+POINT]::new($pointX,$pointY)
  $hit=[FoldNativeRegion]::WindowFromPoint($point);[uint32]$hitPid=0;[void][FoldNativeRegion]::GetWindowThreadProcessId($hit,[ref]$hitPid)
  [pscustomobject]@{name=$sample.name;x=$sample.x;y=$sample.y;inRegion=[FoldNativeRegion]::PtInRegion($region,[int]$sample.x,[int]$sample.y);hitWindow=$hit.ToInt64();hitOwner=$hitPid}
 })
 [uint32]$frontPid=0;$front=[FoldNativeRegion]::GetForegroundWindow();[void][FoldNativeRegion]::GetWindowThreadProcessId($front,[ref]$frontPid)
 $cursor=New-Object FoldNativeRegion+POINT;[void][FoldNativeRegion]::GetCursorPos([ref]$cursor)
 [pscustomobject]@{owner=$actualOwner;handle=$WindowHandle;bounds=@{x=$rectangle.left;y=$rectangle.top;width=$rectangle.right-$rectangle.left;height=$rectangle.bottom-$rectangle.top};cursor=@{x=$cursor.x;y=$cursor.y};regionType=$kind;foregroundWindow=$front.ToInt64();foregroundOwner=$frontPid;points=$points}|ConvertTo-Json -Depth 5 -Compress
}finally{[void][FoldNativeRegion]::DeleteObject($region)}
