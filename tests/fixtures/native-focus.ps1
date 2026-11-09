param([string]$WidgetHandle, [int]$TargetX, [int]$TargetY, [switch]$WithInput, [int]$ExpandedHeight = 220)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeProbe {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
 [DllImport("user32.dll")] public static extern uint SendInput(uint count, Input[] inputs, int size);
 [StructLayout(LayoutKind.Explicit, Size = 40)] public struct Input { [FieldOffset(0)] public uint Type; [FieldOffset(8)] public Keyboard Key; }
 [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort Virtual; public ushort Scan; public uint Flags; public uint Time; public UIntPtr Extra; }
 public static bool SendCharacter(char value) { var down = new Input { Type = 1, Key = new Keyboard { Scan = value, Flags = 4 } }; var up = new Input { Type = 1, Key = new Keyboard { Scan = value, Flags = 6 } }; return SendInput(2, new[] { down, up }, 40) == 2; }
 public struct Point { public int X; public int Y; }
 public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
$previousPoint = New-Object NativeProbe+Point
[void][NativeProbe]::GetCursorPos([ref]$previousPoint)
$foreground = [NativeProbe]::GetForegroundWindow()
$widget = [IntPtr]([long]$WidgetHandle)
$cycles = @()
$form = $null
$box = $null
try {
  if ($WithInput) {
    Add-Type -AssemblyName System.Windows.Forms
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'codingSchedule input verification (temporary)'
    $form.StartPosition = 'Manual'
    $form.Location = New-Object System.Drawing.Point(50, 70)
    $form.Size = New-Object System.Drawing.Size(460, 145)
    $form.TopMost = $true
    $box = New-Object System.Windows.Forms.TextBox
    $box.Dock = 'Fill'
    $box.Multiline = $true
    $box.ImeMode = 'Disable'
    $form.Controls.Add($box)
    $form.Show()
    [void][NativeProbe]::ShowWindow($form.Handle, 5)
    [System.Windows.Forms.Application]::DoEvents()
    $clickPoint = $box.PointToScreen((New-Object System.Drawing.Point(20, 20)))
    $point = New-Object NativeProbe+Point
    $point.X = $clickPoint.X
    $point.Y = $clickPoint.Y
    for ($ready = 0; $ready -lt 20 -and [NativeProbe]::GetAncestor([NativeProbe]::WindowFromPoint($point), 2) -ne $form.Handle; $ready++) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 20
    }
    if ([NativeProbe]::GetAncestor([NativeProbe]::WindowFromPoint($point), 2) -ne $form.Handle) { throw 'Reference input is covered; no mouse click or keyboard input sent' }
    [void][NativeProbe]::SetCursorPos($point.X, $point.Y)
    [NativeProbe]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [NativeProbe]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.Application]::DoEvents()
    $foreground = $form.Handle
    if ([NativeProbe]::GetForegroundWindow() -ne $foreground -or -not $box.Focused) { throw 'Reference input is not focused; no keyboard input sent' }
  }
  if ($foreground -eq [IntPtr]::Zero) { throw 'No interactive foreground window is available' }
  if (-not [NativeProbe]::IsWindowVisible($widget)) { throw 'Sample window is not natively visible' }
  for ($i = 0; $i -lt 20; $i++) {
    [void][NativeProbe]::SetCursorPos(500, 250)
    Start-Sleep -Milliseconds 470
    $collapsed = New-Object NativeProbe+Rect
    [void][NativeProbe]::GetClientRect($widget, [ref]$collapsed)
    if (-not [NativeProbe]::SetCursorPos($TargetX, $TargetY)) { throw 'Windows rejected cursor positioning; no native hover proof' }
    Start-Sleep -Milliseconds 330
    $actualPoint = New-Object NativeProbe+Point
    [void][NativeProbe]::GetCursorPos([ref]$actualPoint)
    if ($actualPoint.X -ne $TargetX -or $actualPoint.Y -ne $TargetY) { throw 'Cursor did not reach the requested point; no native hover proof' }
    if ([NativeProbe]::GetAncestor([NativeProbe]::WindowFromPoint($actualPoint), 2) -ne $widget) { throw 'Widget target is covered or not on the interactive desktop; no native hover proof' }
    $expanded = New-Object NativeProbe+Rect
    [void][NativeProbe]::GetClientRect($widget, [ref]$expanded)
    $sameFocus = [NativeProbe]::GetForegroundWindow() -eq $foreground
    if ($WithInput -and $sameFocus) {
      if (-not [NativeProbe]::SendCharacter('x')) { throw 'Windows rejected synthetic test input' }
      for ($attempt = 0; $attempt -lt 10 -and $box.Text.Length -lt ($i + 1); $attempt++) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 20
      }
      if ($box.Text.Length -ne ($i + 1)) { throw 'Native keyboard input did not reach the expected test control' }
    }
    $cycles += [pscustomobject]@{ index = $i + 1; foregroundUnchanged = $sameFocus; collapsedHeight = $collapsed.Bottom - $collapsed.Top; expandedHeight = $expanded.Bottom - $expanded.Top }
    if (-not $sameFocus) { throw ('Foreground changed during hover: ' + (@{ cycle = $i + 1; expected = $foreground.ToInt64(); actual = [NativeProbe]::GetForegroundWindow().ToInt64(); widget = $widget.ToInt64() } | ConvertTo-Json -Compress)) }
    if (($expanded.Bottom - $expanded.Top) -ne $ExpandedHeight -or ($collapsed.Bottom - $collapsed.Top) -ne 48) { throw ('Native hover dimensions: ' + ($cycles[-1] | ConvertTo-Json -Compress)) }
  }
  $inputResult = $null
  if ($WithInput) { $inputResult = ($box.Text.Length -eq 20) }
  [pscustomobject]@{ cycles = $cycles; focusPass = $true; inputPass = $inputResult; nativeVisibility = $true; scaleTested = 1; inputLimitation = 'Synthetic English input only; physical keyboard and IME are not verified' } | ConvertTo-Json -Depth 5 -Compress
} finally {
  if ($form) { $form.Close(); $form.Dispose() }
  [void][NativeProbe]::SetCursorPos($previousPoint.X, $previousPoint.Y)
}
