param(
  [Parameter(Mandatory = $true)][ValidateSet('cancel', 'save')][string]$Action,
  [Parameter(Mandatory = $true)][string]$ScreenshotPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System.Runtime.InteropServices;
public static class Issue816NativeClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, System.UIntPtr extraInfo);
}
'@

$buttonId = if ($Action -eq 'cancel') { '2' } else { '1' }

function Find-NativeSaveDialog {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($windowIndex = 0; $windowIndex -lt $windows.Count; $windowIndex++) {
    $owner = $windows.Item($windowIndex)
    if ($owner.Current.ClassName -ne 'Chrome_WidgetWin_1' -or $owner.Current.IsEnabled) { continue }
    $descendants = $owner.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    for ($elementIndex = 0; $elementIndex -lt $descendants.Count; $elementIndex++) {
      $element = $descendants.Item($elementIndex)
      if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) { continue }
      $dialogDescendants = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $hasSaveButton = $false
      $hasCancelButton = $false
      for ($buttonIndex = 0; $buttonIndex -lt $dialogDescendants.Count; $buttonIndex++) {
        $candidateButton = $dialogDescendants.Item($buttonIndex)
        if ($candidateButton.Current.ClassName -ne 'Button') { continue }
        if ($candidateButton.Current.AutomationId -eq '1') { $hasSaveButton = $true }
        if ($candidateButton.Current.AutomationId -eq '2') { $hasCancelButton = $true }
      }
      if ($hasSaveButton -and $hasCancelButton) { return $element }
    }
  }
  return $null
}

$deadline = [DateTime]::UtcNow.AddSeconds(20)
$dialog = $null
while ([DateTime]::UtcNow -lt $deadline -and $null -eq $dialog) {
  $dialog = Find-NativeSaveDialog
  if ($null -eq $dialog) { Start-Sleep -Milliseconds 100 }
}

if ($null -eq $dialog) { throw 'Timed out waiting for the native Save As dialog.' }

$descendants = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$button = $null
for ($elementIndex = 0; $elementIndex -lt $descendants.Count; $elementIndex++) {
  $element = $descendants.Item($elementIndex)
  if ($element.Current.ClassName -eq 'Button' -and $element.Current.AutomationId -eq $buttonId) {
    $button = $element
    break
  }
}

if ($null -eq $button -or -not $button.Current.IsEnabled -or $button.Current.IsOffscreen) {
  throw "Native Save As button $buttonId is unavailable for action '$Action'."
}

$dialogBounds = $dialog.Current.BoundingRectangle
if ($ScreenshotPath) {
  $parentDirectory = Split-Path -Parent $ScreenshotPath
  [void][System.IO.Directory]::CreateDirectory($parentDirectory)
  $size = New-Object System.Drawing.Size ([int]$dialogBounds.Width), ([int]$dialogBounds.Height)
  $bitmap = New-Object System.Drawing.Bitmap $size.Width, $size.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $source = New-Object System.Drawing.Point ([int]$dialogBounds.X), ([int]$dialogBounds.Y)
  $graphics.CopyFromScreen($source, [System.Drawing.Point]::Empty, $size)
  $bitmap.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

$bounds = $button.Current.BoundingRectangle
$x = [int]($bounds.X + $bounds.Width / 2)
$y = [int]($bounds.Y + $bounds.Height / 2)
if (-not [Issue816NativeClick]::SetCursorPos($x, $y)) { throw "Could not focus the native Save As button at $x,$y." }
Start-Sleep -Milliseconds 100
[Issue816NativeClick]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[Issue816NativeClick]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)

$closeDeadline = [DateTime]::UtcNow.AddSeconds(10)
do {
  Start-Sleep -Milliseconds 100
  $isOpen = $null -ne (Find-NativeSaveDialog)
} while ($isOpen -and [DateTime]::UtcNow -lt $closeDeadline)

if ($isOpen) { throw "Native Save As dialog did not close after action '$Action'." }
Write-Output "Clicked native Save As '$Action' button at $x,$y; screenshot=$ScreenshotPath"
