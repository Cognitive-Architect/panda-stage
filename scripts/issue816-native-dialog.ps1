param(
  [Parameter(Mandatory = $true)][ValidateSet('cancel', 'save', 'overwrite-confirm', 'overwrite-cancel')][string]$Action,
  [Parameter(Mandatory = $true)][string]$ScreenshotPath,
  [string]$CreateTargetPath = '',
  [string]$CreateTargetContent = '',
  [string]$OverwritePromptScreenshotPath = '',
  [string]$SelectedFileName = '',
  [int]$TargetProcessId = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Issue816NativeClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, System.UIntPtr extraInfo);
}
'@

$buttonId = if ($Action -eq 'cancel') { '2' } else { '1' }
$script:MatchedOwnerProcessId = $null
$script:MatchedDialogProcessId = $null

function Find-NativeSaveDialog {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($windowIndex = 0; $windowIndex -lt $windows.Count; $windowIndex++) {
    $owner = $windows.Item($windowIndex)
    if ($owner.Current.ClassName -ne 'Chrome_WidgetWin_1' -or $owner.Current.IsEnabled) { continue }
    if ($TargetProcessId -gt 0 -and $owner.Current.ProcessId -ne $TargetProcessId) { continue }
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
      if ($hasSaveButton -and $hasCancelButton) {
        $script:MatchedOwnerProcessId = [int]$owner.Current.ProcessId
        $script:MatchedDialogProcessId = [int]$element.Current.ProcessId
        return $element
      }
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
    if ($TargetProcessId -gt 0 -and $topWindow.Current.ProcessId -ne $TargetProcessId) { continue }
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
    if ($TargetProcessId -gt 0 -and $topWindow.Current.ProcessId -ne $TargetProcessId) { continue }
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

function Get-NativeForegroundWindow {
  $handle = [Issue816NativeClick]::GetForegroundWindow()
  $processId = [uint32]0
  if ($handle -ne [IntPtr]::Zero) {
    [void][Issue816NativeClick]::GetWindowThreadProcessId($handle, [ref]$processId)
  }
  return [pscustomobject]@{ Handle = $handle; ProcessId = [int]$processId }
}

function Ensure-NativeDialogForeground {
  param(
    [Parameter(Mandatory = $true)]$Dialog,
    [Parameter(Mandatory = $true)][string]$Context
  )

  $dialogInfo = $Dialog.Current
  $dialogHandle = [IntPtr]$dialogInfo.NativeWindowHandle
  $dialogProcessId = [int]$dialogInfo.ProcessId
  if ($dialogHandle -eq [IntPtr]::Zero) {
    throw "$Context has no native window handle; target PID=$TargetProcessId dialog PID=$dialogProcessId."
  }

  $activationRequested = [Issue816NativeClick]::SetForegroundWindow($dialogHandle)
  $deadline = [DateTime]::UtcNow.AddSeconds(2)
  $foreground = Get-NativeForegroundWindow
  while ($foreground.ProcessId -ne $dialogProcessId -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 50
    $foreground = Get-NativeForegroundWindow
  }
  if ($foreground.ProcessId -ne $dialogProcessId) {
    throw "$Context did not become the foreground window; target PID=$TargetProcessId dialog PID=$dialogProcessId dialog HWND=$dialogHandle activationRequested=$activationRequested foreground PID=$($foreground.ProcessId) HWND=$($foreground.Handle)."
  }
  return $foreground
}

function Test-NativeDialogScreenshotBounds {
  param([Parameter(Mandatory = $true)]$Bounds)

  try {
    if ($Bounds.IsEmpty) { return $false }
    $values = @([double]$Bounds.X, [double]$Bounds.Y, [double]$Bounds.Width, [double]$Bounds.Height)
    foreach ($value in $values) {
      if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) { return $false }
      if ($value -gt [int]::MaxValue -or $value -lt [int]::MinValue) { return $false }
    }
    return $Bounds.Width -ge 1 -and $Bounds.Height -ge 1
  }
  catch {
    return $false
  }
}

function Get-NativeDialogScreenshotRegion {
  param([Parameter(Mandatory = $true)]$Dialog)

  $windowBounds = $Dialog.Current.BoundingRectangle
  if (Test-NativeDialogScreenshotBounds -Bounds $windowBounds) {
    return [pscustomobject]@{ Bounds = $windowBounds; Source = 'window' }
  }

  $controls = $Dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $left = [double]::PositiveInfinity
  $top = [double]::PositiveInfinity
  $right = [double]::NegativeInfinity
  $bottom = [double]::NegativeInfinity
  $validControlCount = 0
  for ($controlIndex = 0; $controlIndex -lt $controls.Count; $controlIndex++) {
    try {
      $control = $controls.Item($controlIndex)
      if ($control.Current.ControlType -notin @([System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::Text)) { continue }
      if ($control.Current.IsOffscreen) { continue }
      $bounds = $control.Current.BoundingRectangle
      if (-not (Test-NativeDialogScreenshotBounds -Bounds $bounds)) { continue }
      $left = [Math]::Min($left, $bounds.X)
      $top = [Math]::Min($top, $bounds.Y)
      $right = [Math]::Max($right, ($bounds.X + $bounds.Width))
      $bottom = [Math]::Max($bottom, ($bounds.Y + $bounds.Height))
      $validControlCount++
    }
    catch { }
  }

  if ($validControlCount -eq 0) { return $null }
  $controlBounds = [pscustomobject]@{
    X = $left
    Y = $top
    Width = $right - $left
    Height = $bottom - $top
  }
  if (-not (Test-NativeDialogScreenshotBounds -Bounds $controlBounds)) { return $null }
  return [pscustomobject]@{ Bounds = $controlBounds; Source = 'visible-descendant-controls' }
}

function Save-NativeDialogScreenshot {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Dialog,
    [Parameter(Mandatory = $true)]$Bounds,
    [Parameter(Mandatory = $true)][string]$Context
  )

  $bitmap = $null
  $graphics = $null
  try {
    $values = @([double]$Bounds.X, [double]$Bounds.Y, [double]$Bounds.Width, [double]$Bounds.Height)
    foreach ($value in $values) {
      if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) {
        throw 'The UI Automation bounding rectangle contains a non-finite coordinate.'
      }
      if ($value -gt [int]::MaxValue -or $value -lt [int]::MinValue) {
        throw "The UI Automation bounding rectangle coordinate is outside Int32 range ($value)."
      }
    }

    $x = [int][Math]::Floor($Bounds.X)
    $y = [int][Math]::Floor($Bounds.Y)
    $width = [int][Math]::Ceiling($Bounds.Width)
    $height = [int][Math]::Ceiling($Bounds.Height)
    if ($width -lt 1 -or $height -lt 1) {
      throw "The UI Automation bounding rectangle has non-positive dimensions ($width x $height)."
    }

    $size = [System.Drawing.Size]::new($width, $height)
    $source = [System.Drawing.Point]::new($x, $y)
    $parentDirectory = Split-Path -Parent $Path
    [void][System.IO.Directory]::CreateDirectory($parentDirectory)
    $bitmap = [System.Drawing.Bitmap]::new($size.Width, $size.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($source, [System.Drawing.Point]::Empty, $size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  catch {
    throw "$Context screenshot capture failed; target PID=$TargetProcessId dialog PID=$($Dialog.Current.ProcessId) bounds=$Bounds path='$Path'; $($_.Exception.Message)"
  }
  finally {
    if ($null -ne $graphics) { $graphics.Dispose() }
    if ($null -ne $bitmap) { $bitmap.Dispose() }
  }
}

function Get-NativeSaveDialogWindowSnapshot {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $snapshot = [System.Collections.Generic.List[object]]::new()
  for ($windowIndex = 0; $windowIndex -lt $windows.Count; $windowIndex++) {
    $owner = $windows.Item($windowIndex)
    try { $ownerInfo = $owner.Current } catch { continue }
    if ($ownerInfo.ClassName -notin @('Chrome_WidgetWin_1', '#32770')) { continue }
    $dialogs = [System.Collections.Generic.List[object]]::new()
    try {
      $descendants = $owner.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      for ($elementIndex = 0; $elementIndex -lt $descendants.Count; $elementIndex++) {
        $element = $descendants.Item($elementIndex)
        if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) { continue }
        $buttonIds = [System.Collections.Generic.List[string]]::new()
        $controls = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        for ($controlIndex = 0; $controlIndex -lt $controls.Count; $controlIndex++) {
          $control = $controls.Item($controlIndex)
          if ($control.Current.ClassName -eq 'Button') {
            $buttonId = [string]$control.Current.AutomationId
            if ($buttonId) { $buttonIds.Add($buttonId) }
          }
        }
        $dialogs.Add([ordered]@{
          className = [string]$element.Current.ClassName
          processId = [int]$element.Current.ProcessId
          isEnabled = [bool]$element.Current.IsEnabled
          buttonAutomationIds = @($buttonIds.ToArray() | Sort-Object -Unique)
        })
      }
    }
    catch { }
    $snapshot.Add([ordered]@{
      ownerClassName = [string]$ownerInfo.ClassName
      ownerProcessId = [int]$ownerInfo.ProcessId
      ownerIsEnabled = [bool]$ownerInfo.IsEnabled
      descendantWindows = @($dialogs.ToArray())
    })
  }
  return ConvertTo-Json -InputObject @($snapshot.ToArray()) -Depth 8 -Compress
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
    Save-NativeDialogScreenshot -Path $ScreenshotPath -Dialog $dialog -Bounds $dialogBounds -Context 'Native overwrite confirmation'
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

if ($null -eq $dialog) {
  $windowSnapshot = try { Get-NativeSaveDialogWindowSnapshot } catch { "NOT_MEASURED: $($_.Exception.Message)" }
  throw "Timed out waiting for the native Save As dialog. UIA window snapshot: $windowSnapshot"
}

$descendants = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Write-Output "Matched native Save As owner PID=$script:MatchedOwnerProcessId dialog PID=$script:MatchedDialogProcessId target PID=$TargetProcessId bounds=$($dialog.Current.BoundingRectangle)"

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
  Save-NativeDialogScreenshot -Path $ScreenshotPath -Dialog $dialog -Bounds $dialogBounds -Context 'Native Save As dialog'
}

$bounds = $button.Current.BoundingRectangle
try {
  $x = [int][Math]::Round($bounds.X + $bounds.Width / 2)
  $y = [int][Math]::Round($bounds.Y + $bounds.Height / 2)
}
catch {
  throw "Native Save As button coordinate conversion failed; target PID=$TargetProcessId owner PID=$script:MatchedOwnerProcessId dialog PID=$script:MatchedDialogProcessId button PID=$($button.Current.ProcessId) bounds=$bounds; $($_.Exception.Message)"
}
$clickMethod = 'coordinate-click'
$invokeError = $null
if ($Action -eq 'save') {
  try {
    $invokePattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invokePattern.Invoke()
    $clickMethod = 'UI Automation InvokePattern'
  } catch {
    $invokeError = $_.Exception.Message
  }
}
if ($clickMethod -eq 'coordinate-click') {
  if (-not [Issue816NativeClick]::SetCursorPos($x, $y)) { throw "Could not focus the native Save As button at $x,$y." }
  Start-Sleep -Milliseconds 100
  [Issue816NativeClick]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [Issue816NativeClick]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
} elseif ($Action -eq 'save') {
  Start-Sleep -Milliseconds 600
  if ($null -ne (Find-NativeSaveDialog) -and $null -eq (Find-NativeSystemOverwriteDialog)) {
    if (-not [Issue816NativeClick]::SetCursorPos($x, $y)) { throw "Could not focus the native Save As button at $x,$y after InvokePattern." }
    Start-Sleep -Milliseconds 100
    [Issue816NativeClick]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
    Start-Sleep -Milliseconds 50
    [Issue816NativeClick]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
    $clickMethod = 'UI Automation InvokePattern with coordinate fallback'
  }
}

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
    $foreground = Ensure-NativeDialogForeground -Dialog $dialog -Context 'Windows Save As overwrite prompt'
    Write-Output "Foreground verified for Windows Save As overwrite prompt; target PID=$TargetProcessId dialog PID=$($dialog.Current.ProcessId) foreground PID=$($foreground.ProcessId) HWND=$($foreground.Handle)"
    if ($OverwritePromptScreenshotPath) {
      $promptProcessId = 'unknown'
      try { $promptProcessId = [int]$dialog.Current.ProcessId } catch { }
      $screenshotRegion = $null
      $regionError = $null
      try { $screenshotRegion = Get-NativeDialogScreenshotRegion -Dialog $dialog }
      catch { $regionError = $_.Exception.Message }
      if ($null -eq $screenshotRegion) {
        Write-Output "Windows Save As overwrite prompt screenshot unavailable; continuing with the matched confirmation button. target PID=$TargetProcessId dialog PID=$promptProcessId; $regionError"
      } else {
        try {
          Save-NativeDialogScreenshot -Path $OverwritePromptScreenshotPath -Dialog $dialog -Bounds $screenshotRegion.Bounds -Context 'Windows Save As overwrite prompt'
          Write-Output "Captured Windows Save As overwrite prompt from $($screenshotRegion.Source) bounds=$($screenshotRegion.Bounds)"
        }
        catch {
          Write-Output "Windows Save As overwrite prompt screenshot unavailable; continuing with the matched confirmation button. target PID=$TargetProcessId dialog PID=$promptProcessId bounds=$($screenshotRegion.Bounds); $($_.Exception.Message)"
        }
      }
    }

    $clickMethod = 'UI Automation InvokePattern'
    $invokeError = $null
    try {
      $invokePattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $invokePattern.Invoke()
    }
    catch {
      $invokeError = $_.Exception.Message
      $foreground = Ensure-NativeDialogForeground -Dialog $dialog -Context 'Windows Save As overwrite prompt coordinate fallback'
      $bounds = $button.Current.BoundingRectangle
      try {
        $x = [int][Math]::Round($bounds.X + $bounds.Width / 2)
        $y = [int][Math]::Round($bounds.Y + $bounds.Height / 2)
      }
      catch {
        throw "System overwrite button coordinate conversion failed; target PID=$TargetProcessId dialog PID=$($dialog.Current.ProcessId) button PID=$($button.Current.ProcessId) bounds=$bounds; $($_.Exception.Message)"
      }
      if (-not [Issue816NativeClick]::SetCursorPos($x, $y)) { throw "Could not focus the native system overwrite confirmation at $x,$y." }
      Start-Sleep -Milliseconds 100
      [Issue816NativeClick]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [Issue816NativeClick]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
      $clickMethod = 'foreground-verified coordinate click'
    }
    Write-Output "Accepted the Windows Save As overwrite prompt via $clickMethod; invokeError='$invokeError'; screenshot=$OverwritePromptScreenshotPath"
  }
}

$closeDeadline = [DateTime]::UtcNow.AddSeconds(10)
do {
  Start-Sleep -Milliseconds 100
  $isOpen = $null -ne (Find-NativeSaveDialog)
} while ($isOpen -and [DateTime]::UtcNow -lt $closeDeadline)
if ($isOpen) {
  $remainingDialog = Find-NativeSaveDialog
  $details = if ($null -ne $remainingDialog) {
    "window='$($remainingDialog.Current.Name)' class='$($remainingDialog.Current.ClassName)' bounds='$($remainingDialog.Current.BoundingRectangle)'"
  } else {
    'dialog lookup returned null after the close check'
  }
  throw "Native Save As dialog did not close after action '$Action' via $clickMethod ($details). InvokePatternError='$invokeError'; screenshot=$ScreenshotPath"
}
Write-Output "Clicked native Save As '$Action' button via $clickMethod at $x,$y; screenshot=$ScreenshotPath"
