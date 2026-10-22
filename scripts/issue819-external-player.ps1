param(
  [Parameter(Mandatory = $true)][string]$VideoPath,
  [Parameter(Mandatory = $true)][string]$ScreenshotPath
)

$ErrorActionPreference = 'Stop'
if (-not [System.IO.File]::Exists($VideoPath)) {
  throw "MP4 does not exist: $VideoPath"
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Issue819WindowControl {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
}
'@
$vlcPlayer = 'C:\Program Files\VideoLAN\VLC\vlc.exe'
$windowsMediaPlayer = 'C:\Program Files\Windows Media Player\wmplayer.exe'
$launchMethod = $null
$launchProcess = $null
if ([System.IO.File]::Exists($vlcPlayer)) {
  $launchProcess = Start-Process -FilePath $vlcPlayer -ArgumentList @(
    '--no-one-instance',
    '--fullscreen',
    '--video-on-top',
    '--start-time=1.5',
    '--no-video-title-show',
    ('"' + $VideoPath + '"')
  ) -PassThru
  $launchMethod = 'VLC_DIRECT_FULLSCREEN'
} elseif ([System.IO.File]::Exists($windowsMediaPlayer)) {
  $launchProcess = Start-Process -FilePath $windowsMediaPlayer -ArgumentList @(
    '/fullscreen',
    '/play',
    ('"' + $VideoPath + '"')
  ) -PassThru
  $launchMethod = 'WINDOWS_MEDIA_PLAYER_DIRECT'
} else {
  throw 'No supported external media player is installed.'
}
$windowDeadline = [DateTime]::UtcNow.AddSeconds(10)
$playerWindow = $null
while ([DateTime]::UtcNow -lt $windowDeadline -and $null -eq $playerWindow) {
  $launchProcess.Refresh()
  if ($launchProcess.MainWindowHandle -ne 0) {
    $playerWindow = $launchProcess
  }
  if ($null -eq $playerWindow) { Start-Sleep -Milliseconds 250 }
}
if ($null -eq $playerWindow) {
  throw 'No external media player window appeared after opening the MP4.'
}
[void][Issue819WindowControl]::ShowWindow($playerWindow.MainWindowHandle, 3)
[void][Issue819WindowControl]::SetForegroundWindow($playerWindow.MainWindowHandle)
Start-Sleep -Milliseconds 900
[void]$playerWindow.Refresh()
$foregroundHandle = [Issue819WindowControl]::GetForegroundWindow()
[uint32]$foregroundProcessId = 0
[void][Issue819WindowControl]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundProcessId)
if ($foregroundProcessId -ne $playerWindow.Id) {
  throw "External player window did not become foreground (expected process $($playerWindow.Id), got $foregroundProcessId)."
}

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$parentDirectory = Split-Path -Parent $ScreenshotPath
[void][System.IO.Directory]::CreateDirectory($parentDirectory)
$bitmap = New-Object System.Drawing.Bitmap ([int]$screen.Width), ([int]$screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$source = New-Object System.Drawing.Point ([int]$screen.X), ([int]$screen.Y)
$graphics.CopyFromScreen($source, [System.Drawing.Point]::Empty, $bitmap.Size)
$bitmap.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

$windows = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
  [pscustomobject]@{
    processId = $_.Id
    processName = $_.ProcessName
    title = $_.MainWindowTitle
  }
})

[pscustomobject]@{
  launch = 'STARTED'
  launchMethod = $launchMethod
  processId = $playerWindow.Id
  processName = $playerWindow.ProcessName
  windowTitle = $playerWindow.MainWindowTitle
  foregroundProcessId = $foregroundProcessId
  screenshotPath = $ScreenshotPath
  topLevelWindows = $windows
} | ConvertTo-Json -Depth 5 -Compress
