# Снимок окна Яндекс Музыки с экрана (в отличие от tools/eval.js --shot видит прозрачность окна).
param([string]$Out = "$env:TEMP\overtone-window.png")
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class OtWin {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
}
'@
[OtWin]::SetProcessDPIAware() | Out-Null
$proc = Get-Process | Where-Object { $_.Path -like '*\Programs\YandexMusic\*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw 'Окно Яндекс Музыки не найдено' }
[OtWin]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 700
$r = New-Object OtWin+RECT
[OtWin]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save($Out)
"saved $Out $($bmp.Width)x$($bmp.Height)"
