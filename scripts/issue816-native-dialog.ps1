param(
  [Parameter(Mandatory = $true)][ValidateSet('cancel', 'save', 'overwrite-confirm', 'overwrite-cancel')][string]$Action,
  [Parameter(Mandatory = $true)][string]$ScreenshotPath,
  [string]$CreateTargetPath = '',
  [string]$CreateTargetContent = '',
  [string]$OverwritePromptScreenshotPath = '',
  [string]$SelectedFileName = ''
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

function Find-NativeOverwriteDialog {
  $confirmName = -join ([char[]]@(0x786E, 0x8BA4, 0x5141, 0x8BB8, 0x8986, 0x76D6))
  $cancelName = -join ([char[]]@(0x53D6, 0x6D88))
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $topWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($topIndex = 0; $topIndex -lt $topWindows.Count; $topIndex++) {
    $topWindow = $topWindows.Item($topIndex)
    $candidates = New-Object System.Collections.ArrayList
    [void]$candidates.Add($topWindow)
    $descendants = $topWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    for ($elementIndex = 0; $elementIndex -lt $descendants.Count; $elementIndex++) {
      $candidate = $descendants.Item($elementIndex)
      if ($candidate.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) {
        [void]$candidates.Add($candidate)
      }
    }

    foreach ($candidate in $candidates) {
      $children = $candidate.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $confirmButton = $null
      $cancelButton = $null
      for ($buttonIndex = 0; $buttonIndex -lt $children.Count; $buttonIndex++) {
        $button = $children.Item($buttonIndex)
        if ($button.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button) { continue }
        if ($button.Current.Name.Contains($confirmName)) { $confirmButton = $button }
        if ($button.Current.Name.Contains($cancelName)) { $cancelButton = $button }
      }
      if ($null -ne $confirmButton -and $null -ne $cancelButton) {
        return [pscustomobject]@{
          Window = $candidate
          ConfirmButton = $confirmButton
          CancelButton = $cancelButton
        }
      }
    }
  }
  return $null
}

function Find-NativeSystemOverwriteDialog {
  $affirmativeNames = @(
    'Yes',
    'Replace',
    -join ([char[]]@(0x662F)),
    -join ([char[]]@(0x66FF, 0x6362))
  )
  $negativeNames = @(
    'No',
    'Cancel',
    -join ([char[]]@(0x5426)),
    -join ([char[]]@(0x53D6, 0x6D88))
  )
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $topWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($topIndex = 0; $topIndex -lt $topWindows.Count; $topIndex++) {
    $topWindow = $topWindows.Item($topIndex)
    $candidates = New-Object System.Collections.ArrayList
    [void]$candidates.Add($topWindow)
    $descendants = $topWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    for ($elementIndex = 0; $elementIndex -lt $descendants.Count; $elementIndex++) {
      $candidate = $descendants.Item($elementIndex)
      if ($candidate.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) {
        [void]$candidates.Add($candidate)
      }
    }

    foreach ($candidate in $candidates) {
      $children = $candidate.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $affirmativeButton = $null
      $negativeButton = $null
      for ($buttonIndex = 0; $buttonIndex -lt $children.Count; $buttonIndex++) {
        $button = $children.Item($buttonIndex)
        if ($button.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button) { continue }
        $name = [string]$button.Current.Name
        if ($affirmativeNames | Where-Object { $name.Contains($_) }) { $affirmativeButton = $button }
        if ($negativeNames | Where-Object { $name.Contains($_) }) { $negativeButton = $button }
      }
      if ($null -ne $affirmativeButton -and $null -ne $negativeButton) {
        return [pscustomobject]@{
          Window = $candidate
          ConfirmButton = $affirmativeButton
          CancelButton = $negativeButton
        }
      }
    }
  }
  return $null
}

if ($Action -like 'overwrite-*') {
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  $confirmation = $null
  while ([DateTime]::UtcNow -lt $deadline -and $null -eq $confirmation) {
    $confirmation = Find-NativeOverwriteDialog
    if ($null -eq $confirmation) { Start-Sleep -Milliseconds 100 }
  }

  if ($null -eq $confirmation) { throw 'Timed out waiting for the native overwrite confirmation.' }
  $dialog = $confirmation.Window
  $button = if ($Action -eq 'overwrite-confirm') { $confirmation.ConfirmButton } else { $confirmation.CancelButton }
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
  if (-not [Issue816NativeClick]::SetCursorPos($x, $y)) { throw "Could not focus the native overwrite button at $x,$y." }
  Start-Sleep -Milliseconds 100
  [Issue816NativeClick]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [Issue816NativeClick]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)

  $closeDeadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 100
    $isOpen = $null -ne (Find-NativeOverwriteDialog)
  } while ($isOpen -and [DateTime]::UtcNow -lt $closeDeadline)

  if ($isOpen) { throw "Native overwrite confirmation did not close after action '$Action'." }
  Write-Output "Clicked native overwrite confirmation '$Action' button at $x,$y; screenshot=$ScreenshotPath"
  exit 0
}

$deadline = [DateTime]::UtcNow.AddSeconds(20)
$dialog = $null
while ([DateTime]::UtcNow -lt $deadline -and $null -eq $dialog) {
  $dialog = Find-NativeSaveDialog
  if ($null -eq $dialog) { Start-Sleep -Milliseconds 100 }
}

if ($null -eq $dialog) { throw 'Timed out waiting for the native Save As dialog.' }

$descendants = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

if ($Action -eq 'save' -and $SelectedFileName) {
  $nameField = $null
  $fallbackNameField = $null
  for ($elementIndex = 0; $elementIndex -lt $descendants.Count; $elementIndex++) {
    $element = $descendants.Item($elementIndex)
    if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit) { continue }
    try {
      $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if ($element.Current.AutomationId -eq '1001') {
        $nameField = $valuePattern
        break
      }
      $fallbackNameField = $valuePattern
    } catch { }
  }
  if ($null -eq $nameField) { $nameField = $fallbackNameField }
  if ($null -eq $nameField) { throw 'The native Save As filename field is unavailable.' }
  $nameField.SetValue($SelectedFileName)
}

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

if ($Action -eq 'save' -and $CreateTargetPath) {
  if ([System.IO.File]::Exists($CreateTargetPath)) {
    throw "The controlled output target already exists before Save As selection: $CreateTargetPath"
  }
  $encoding = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($CreateTargetPath, $CreateTargetContent, $encoding)
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

if ($Action -eq 'save') {
  $promptDeadline = [DateTime]::UtcNow.AddSeconds(3)
  $systemOverwrite = $null
  while ([DateTime]::UtcNow -lt $promptDeadline -and $null -eq $systemOverwrite) {
    $systemOverwrite = Find-NativeSystemOverwriteDialog
    if ($null -eq $systemOverwrite -and $null -ne (Find-NativeSaveDialog)) {
      Start-Sleep -Milliseconds 100
    } else {
      break
    }
  }
  if ($null -ne $systemOverwrite) {
    $dialog = $systemOverwrite.Window
    $button = $systemOverwrite.ConfirmButton
    $dialogBounds = $dialog.Current.BoundingRectangle
    if ($OverwritePromptScreenshotPath) {
      $parentDirectory = Split-Path -Parent $OverwritePromptScreenshotPath
      [void][System.IO.Directory]::CreateDirectory($parentDirectory)
      $size = New-Object System.Drawing.Size ([int]$dialogBounds.Width), ([int]$dialogBounds.Height)
      $bitmap = New-Object System.Drawing.Bitmap $size.Width, $size.Height
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $source = New-Object System.Drawing.Point ([int]$dialogBounds.X), ([int]$dialogBounds.Y)
      $graphics.CopyFromScreen($source, [System.Drawing.Point]::Empty, $size)
      $bitmap.Save($OverwritePromptScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
      $graphics.Dispose()
      $bitmap.Dispose()
    }

    $bounds = $button.Current.BoundingRectangle
    $x = [int]($bounds.X + $bounds.Width / 2)
    $y = [int]($bounds.Y + $bounds.Height / 2)
    if (-not [Issue816NativeClick]::SetCursorPos($x, $y)) { throw "Could not focus the native system overwrite confirmation at $x,$y." }
    Start-Sleep -Milliseconds 100
    [Issue816NativeClick]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
    Start-Sleep -Milliseconds 50
    [Issue816NativeClick]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
    Write-Output "Accepted the Windows Save As overwrite prompt; screenshot=$OverwritePromptScreenshotPath"
  }
}

$closeDeadline = [DateTime]::UtcNow.AddSeconds(10)
do {
  Start-Sleep -Milliseconds 100
  $isOpen = $null -ne (Find-NativeSaveDialog)
} while ($isOpen -and [DateTime]::UtcNow -lt $closeDeadline)
if ($isOpen) { throw "Native Save As dialog did not close after action '$Action'." }
Write-Output "Clicked native Save As '$Action' button at $x,$y; screenshot=$ScreenshotPath"
