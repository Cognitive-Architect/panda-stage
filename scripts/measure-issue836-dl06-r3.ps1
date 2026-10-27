param(
  [string] $AcceptanceRoot = 'D:\PandaStage-Acceptance\i836r3',
  [ValidateRange(250, 5000)]
  [int] $SampleIntervalMilliseconds = 500
)

$ErrorActionPreference = 'Stop'
$maximumAcceptedSampleGapMilliseconds = [double] $SampleIntervalMilliseconds * 10
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$electronExecutable = Join-Path $repositoryRoot 'node_modules\electron\dist\electron.exe'
$verifierScript = 'scripts/verify-issue819-dl02.cjs'
$acceptanceRootPath = [System.IO.Path]::GetFullPath($AcceptanceRoot)
$invocationId = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString()
$invocationFolderId = [guid]::NewGuid().ToString('N').Substring(0, 16)
$measurementRoot = Join-Path $acceptanceRootPath "m-$invocationFolderId"
$manifestPath = Join-Path $measurementRoot 'measurement-runs.json'
$runDefinitions = @(
  [pscustomobject]@{ sampleId = 1; phase = 'cold-process'; id = 'sample-1-cold-process' },
  [pscustomobject]@{ sampleId = 1; phase = 'warm-followup'; id = 'sample-1-warm-followup' },
  [pscustomobject]@{ sampleId = 2; phase = 'cold-process'; id = 'sample-2-cold-process' },
  [pscustomobject]@{ sampleId = 2; phase = 'warm-followup'; id = 'sample-2-warm-followup' }
)
$environmentNames = @(
  'PANDA_STAGE_ISSUE827_DL04',
  'PANDA_STAGE_ISSUE827_SAMPLE',
  'PANDA_STAGE_ISSUE827_ROOT',
  'PANDA_STAGE_ISSUE827_WRAPPER_RUN_ID',
  'PANDA_STAGE_ISSUE827_WRAPPER_COMMIT_SHA'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
  $previousEnvironment[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
}

function Write-JsonFile([string] $Path, [object] $Value) {
  $json = ConvertTo-Json -InputObject $Value -Depth 40
  [System.IO.File]::WriteAllText(
    $Path,
    $json + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-ProcessTreeIds([int] $RootProcessId) {
  $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue)
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  $null = $ids.Add($RootProcessId)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $processes) {
      $processId = [int] $process.ProcessId
      if (-not $ids.Contains($processId) -and $ids.Contains([int] $process.ParentProcessId)) {
        $null = $ids.Add($processId)
        $changed = $true
      }
    }
  }
  return @($ids)
}

function Get-DirectoryBytes([string] $Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return [long] 0 }
  $files = Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue
  $sum = ($files | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $sum) { return [long] 0 }
  return [long] $sum
}

function Get-MediaToolSnapshot {
  $source = "const { resolveMediaToolPaths } = require('./dist-electron/main/services/production-resources.js'); console.log(JSON.stringify(resolveMediaToolPaths({ isPackaged: false, resourcesPath: process.resourcesPath })))"
  Push-Location $repositoryRoot
  try {
    $resolved = (& node -e $source | ConvertFrom-Json)
  }
  finally {
    Pop-Location
  }
  $tools = [ordered]@{}
  foreach ($name in @('ffmpeg', 'ffprobe')) {
    $path = $resolved.PSObject.Properties["${name}Path"].Value
    $versionLine = (& $path -version 2>&1 | Select-Object -First 1 | Out-String).Trim()
    $tools[$name] = [ordered]@{
      executablePath = $path
      versionLine = $versionLine
      sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  return $tools
}

function Get-DpiRegistrySnapshot {
  $systemDpi = $null
  try {
    if (-not ('PandaStageIssue836Dpi' -as [type])) {
      Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class PandaStageIssue836Dpi {
  [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
}
'@
    }
    $systemDpi = [PandaStageIssue836Dpi]::GetDpiForSystem()
  }
  catch { $systemDpi = $null }
  $systemScalePercent = if ($systemDpi) { [Math]::Round(($systemDpi / 96) * 100, 1) } else { $null }
  $snapshot = [ordered]@{
    systemDpi = $systemDpi
    systemScalePercent = $systemScalePercent
    desktopLogPixels = $null
    win8DpiScaling = $null
    perMonitorSettings = @()
    interpretation = 'Raw current-user DPI registry values; active per-window DPI was not queried.'
  }
  try {
    $desktop = Get-ItemProperty -LiteralPath 'HKCU:\Control Panel\Desktop' -ErrorAction Stop
    $snapshot.desktopLogPixels = $desktop.LogPixels
    $snapshot.win8DpiScaling = $desktop.Win8DpiScaling
    $perMonitorRoot = 'HKCU:\Control Panel\Desktop\PerMonitorSettings'
    if (Test-Path -LiteralPath $perMonitorRoot) {
      $snapshot.perMonitorSettings = @(Get-ChildItem -LiteralPath $perMonitorRoot | ForEach-Object {
        $settings = Get-ItemProperty -LiteralPath $_.PSPath
        [ordered]@{ monitorKey = $_.PSChildName; dpiValue = $settings.DpiValue; scaleFactor = $settings.ScaleFactor }
      })
    }
  }
  catch {
    $snapshot.interpretation = "NOT_MEASURED: $($_.Exception.Message)"
  }
  return $snapshot
}

if (-not (Test-Path -LiteralPath $electronExecutable -PathType Leaf)) {
  throw "Built Electron executable not found: $electronExecutable"
}
if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot 'dist-electron\main\index.js') -PathType Leaf)) {
  throw 'Run pnpm build before collecting DL-06 measurements.'
}

New-Item -ItemType Directory -Path $measurementRoot -Force | Out-Null
$commitSha = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$os = Get-CimInstance -ClassName Win32_OperatingSystem
$computer = Get-CimInstance -ClassName Win32_ComputerSystem
$processor = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1
$electronPackage = Get-Content -LiteralPath (Join-Path $repositoryRoot 'node_modules\electron\package.json') -Raw | ConvertFrom-Json
$logicalDisks = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{ drive = $_.DeviceID; fileSystem = $_.FileSystem; sizeBytes = $_.Size; freeBytes = $_.FreeSpace }
})
$physicalDisks = @(Get-CimInstance -ClassName Win32_DiskDrive -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{ model = $_.Model; interfaceType = $_.InterfaceType; mediaType = $_.MediaType; sizeBytes = $_.Size }
})
$mediaToolSnapshot = Get-MediaToolSnapshot
$runResults = [System.Collections.Generic.List[object]]::new()
$manifest = [ordered]@{
  version = 'issue836-dl06-r3-measurement/1'
  issue = 836
  invocationId = $invocationId
  measurementRoot = $measurementRoot
  sourceCommitSha = $commitSha
  environment = [ordered]@{
    manufacturer = $computer.Manufacturer
    deviceModel = $computer.Model
    processor = $processor.Name
    physicalMemoryBytes = [long] $computer.TotalPhysicalMemory
    windowsCaption = $os.Caption
    windowsVersion = $os.Version
    windowsBuild = $os.BuildNumber
    osArchitecture = $os.OSArchitecture
    electronVersion = $electronPackage.version
    logicalDisks = $logicalDisks
    physicalDisks = $physicalDisks
    dpiRegistry = Get-DpiRegistrySnapshot
    mediaTools = $mediaToolSnapshot
    sampleIntervalMilliseconds = $SampleIntervalMilliseconds
    packageState = 'built unpackaged Electron; not an installer'
  }
  runDefinition = [ordered]@{
    sampleOrder = '1 cold-process, 1 warm-followup, 2 cold-process, 2 warm-followup'
    coldProcess = 'Fresh Electron process and freshly generated fixture root; operating-system caches are not cleared.'
    warmFollowup = 'Same generated sample definition in a fresh Electron process immediately after its cold-process run; caches may remain warm.'
    windowLaunch = 'Normal window; retry AppActivate on an Electron PID with a nonzero main-window handle during process sampling.'
    projectSource = 'Generated Issue #827 probes based on demo-project/project-v1.example.json; not author-supplied real Projects.'
    maximumAcceptedSampleGapMilliseconds = $maximumAcceptedSampleGapMilliseconds
    sampleGapValidityRule = 'Runs exceeding 10 times the target process/storage sampling interval are measurement-invalid and stop the bounded set.'
    mainProjectHashAndFrameEvidence = 'See each verifier acceptance-receipt.json under receiptPath.'
    memory = 'Sampled peak working-set and private bytes per PID in the Electron process tree; sample gaps remain visible through sampleCount.'
  }
  measurements = @()
}

try {
  foreach ($definition in $runDefinitions) {
    $runRoot = Join-Path $measurementRoot $definition.id
    New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
    $stdoutPath = Join-Path $runRoot 'electron-stdout.log'
    $stderrPath = Join-Path $runRoot 'electron-stderr.log'
    $runId = [guid]::NewGuid().ToString()

    [System.Environment]::SetEnvironmentVariable('PANDA_STAGE_ISSUE827_DL04', '1', 'Process')
    [System.Environment]::SetEnvironmentVariable('PANDA_STAGE_ISSUE827_SAMPLE', [string] $definition.sampleId, 'Process')
    [System.Environment]::SetEnvironmentVariable('PANDA_STAGE_ISSUE827_ROOT', $runRoot, 'Process')
    [System.Environment]::SetEnvironmentVariable('PANDA_STAGE_ISSUE827_WRAPPER_RUN_ID', $runId, 'Process')
    [System.Environment]::SetEnvironmentVariable('PANDA_STAGE_ISSUE827_WRAPPER_COMMIT_SHA', $commitSha, 'Process')

    $startedAt = [DateTimeOffset]::UtcNow
    $process = Start-Process `
      -FilePath $electronExecutable `
      -ArgumentList @($verifierScript) `
      -WorkingDirectory $repositoryRoot `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -WindowStyle Normal `
      -PassThru
    $creatorWindowForegroundActivated = $false
    $creatorWindowForegroundProcessId = $null
    $creatorWindowActivationAttempts = 0
    $shell = $null
    try { $shell = New-Object -ComObject WScript.Shell } catch { $shell = $null }
    $processStats = @{}
    $sampleCount = 0
    $peakConcurrentProcessCount = 0
    $peakObservedSampleIntervalMilliseconds = 0.0
    $previousSampleAt = $null
    $peakFrameJobBytes = [long] 0
    $peakFrozenMediaBytes = [long] 0
    $peakOutputStagingBytes = [long] 0
    $peakConcurrentTransientBytes = [long] 0
    $peakFrameFileCount = 0
    $storageSampleCount = 0
    $fixtureRunRoot = $null
    $projectRoot = $null
    $frameJobsRoot = $null
    $frozenMediaRoot = $null

    while ($true) {
      $process.Refresh()
      if ($process.HasExited) { break }
      $sampleAt = [DateTimeOffset]::UtcNow
      if ($null -ne $previousSampleAt) {
        $sampleInterval = ($sampleAt - $previousSampleAt).TotalMilliseconds
        $peakObservedSampleIntervalMilliseconds = [Math]::Max($peakObservedSampleIntervalMilliseconds, $sampleInterval)
      }
      $previousSampleAt = $sampleAt
      $sampleCount += 1
      $processTreeIds = @(Get-ProcessTreeIds -RootProcessId $process.Id)
      $peakConcurrentProcessCount = [Math]::Max($peakConcurrentProcessCount, $processTreeIds.Count)
      foreach ($processId in $processTreeIds) {
        $sampledProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $sampledProcess) { continue }
        if (
          -not $creatorWindowForegroundActivated -and
          $null -ne $shell -and
          $sampledProcess.ProcessName -eq 'electron' -and
          $sampledProcess.MainWindowHandle -ne [IntPtr]::Zero
        ) {
          $creatorWindowActivationAttempts += 1
          try {
            $creatorWindowForegroundActivated = [bool] $shell.AppActivate($processId)
            if ($creatorWindowForegroundActivated) { $creatorWindowForegroundProcessId = $processId }
          }
          catch { $creatorWindowForegroundActivated = $false }
        }
        $key = [string] $processId
        if (-not $processStats.ContainsKey($key)) {
          $processStats[$key] = [ordered]@{
            processId = $processId
            processName = $sampledProcess.ProcessName
            sampleCount = 0
            peakWorkingSetBytes = [long] 0
            peakPrivateBytes = [long] 0
          }
        }
        $stats = $processStats[$key]
        $stats.sampleCount += 1
        $stats.peakWorkingSetBytes = [Math]::Max([long] $stats.peakWorkingSetBytes, [long] $sampledProcess.WorkingSet64)
        $stats.peakPrivateBytes = [Math]::Max([long] $stats.peakPrivateBytes, [long] $sampledProcess.PrivateMemorySize64)
      }
      if (-not $fixtureRunRoot) {
        $fixtureRun = Get-ChildItem -LiteralPath $runRoot -Directory -Filter 'run-*' -ErrorAction SilentlyContinue |
          Sort-Object Name -Descending |
          Select-Object -First 1
        if ($fixtureRun) {
          $fixtureRunRoot = $fixtureRun.FullName
          $projectRoot = Join-Path $fixtureRunRoot 'Panda Stage formal export.pandastage'
          $frameJobsRoot = Join-Path $fixtureRunRoot 'frame-jobs'
          $frozenMediaRoot = Join-Path $fixtureRunRoot 'frozen-media'
        }
      }
      if ($fixtureRunRoot) {
        $storageSampleCount += 1
        $frameFiles = @(Get-ChildItem -LiteralPath $frameJobsRoot -Recurse -File -ErrorAction SilentlyContinue)
        $peakFrameFileCount = [Math]::Max($peakFrameFileCount, $frameFiles.Count)
        $frameJobBytesValue = ($frameFiles | Measure-Object -Property Length -Sum).Sum
        $frameJobBytes = if ($null -eq $frameJobBytesValue) { [long] 0 } else { [long] $frameJobBytesValue }
        $frozenMediaBytes = Get-DirectoryBytes -Path $frozenMediaRoot
        $stagingFiles = @(Get-ChildItem -LiteralPath $projectRoot -File -Filter '.panda-stage-export-*' -ErrorAction SilentlyContinue)
        $stagingBytesValue = ($stagingFiles | Measure-Object -Property Length -Sum).Sum
        $stagingBytes = if ($null -eq $stagingBytesValue) { [long] 0 } else { [long] $stagingBytesValue }
        $peakFrameJobBytes = [Math]::Max($peakFrameJobBytes, $frameJobBytes)
        $peakFrozenMediaBytes = [Math]::Max($peakFrozenMediaBytes, $frozenMediaBytes)
        $peakOutputStagingBytes = [Math]::Max($peakOutputStagingBytes, $stagingBytes)
        $peakConcurrentTransientBytes = [Math]::Max($peakConcurrentTransientBytes, $frameJobBytes + $frozenMediaBytes + $stagingBytes)
      }
      Start-Sleep -Milliseconds $SampleIntervalMilliseconds
    }

    $process.WaitForExit()
    $process.Refresh()
    $processExitCode = $null
    try {
      $observedExitCode = $process.ExitCode
      if ($null -ne $observedExitCode) { $processExitCode = [int] $observedExitCode }
    }
    catch { $processExitCode = $null }
    $endedAt = [DateTimeOffset]::UtcNow
    if ($null -ne $shell) {
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
      $shell = $null
    }
    $receipt = Get-ChildItem -LiteralPath $runRoot -Recurse -File -Filter 'acceptance-receipt.json' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    $receiptHash = if ($receipt) { (Get-FileHash -LiteralPath $receipt.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
    $runResult = [ordered]@{
      id = $definition.id
      sampleId = $definition.sampleId
      phase = $definition.phase
      runId = $runId
      startedAtUtc = $startedAt.ToString('o')
      endedAtUtc = $endedAt.ToString('o')
      wallClockMilliseconds = [long] ($endedAt - $startedAt).TotalMilliseconds
      electronRootProcessId = $process.Id
      creatorWindowForegroundActivated = $creatorWindowForegroundActivated
      creatorWindowForegroundProcessId = $creatorWindowForegroundProcessId
      creatorWindowActivationAttempts = $creatorWindowActivationAttempts
      exitCode = $processExitCode
      sampleCount = $sampleCount
      peakConcurrentProcessCount = $peakConcurrentProcessCount
      peakObservedSampleIntervalMilliseconds = [Math]::Round($peakObservedSampleIntervalMilliseconds, 1)
      processTree = @($processStats.Values | Sort-Object processId)
      sampledStorage = [ordered]@{
        fixtureRunRoot = if ($fixtureRunRoot) { $fixtureRunRoot } else { 'NOT_MEASURED' }
        frameJobsPath = if ($frameJobsRoot) { $frameJobsRoot } else { 'NOT_MEASURED' }
        peakFrameFileCount = if ($storageSampleCount -gt 0) { $peakFrameFileCount } else { 'NOT_MEASURED' }
        peakFrameJobBytes = if ($storageSampleCount -gt 0) { $peakFrameJobBytes } else { 'NOT_MEASURED' }
        frozenMediaPath = if ($frozenMediaRoot) { $frozenMediaRoot } else { 'NOT_MEASURED' }
        peakFrozenMediaBytes = if ($storageSampleCount -gt 0) { $peakFrozenMediaBytes } else { 'NOT_MEASURED' }
        outputStagingPath = if ($projectRoot) { $projectRoot } else { 'NOT_MEASURED' }
        peakOutputStagingBytes = if ($storageSampleCount -gt 0) { $peakOutputStagingBytes } else { 'NOT_MEASURED' }
        peakConcurrentTransientBytes = if ($storageSampleCount -gt 0) { $peakConcurrentTransientBytes } else { 'NOT_MEASURED' }
        sumOfIndependentCategoryPeaksBytes = if ($storageSampleCount -gt 0) { $peakFrameJobBytes + $peakFrozenMediaBytes + $peakOutputStagingBytes } else { 'NOT_MEASURED' }
        sampleCount = $storageSampleCount
        pendingFrameQueuePeak = 'NOT_MEASURED'
        phaseWallTimes = 'NOT_MEASURED'
        taskReleaseAfterTerminalMilliseconds = 'NOT_MEASURED'
        note = 'Sampled directory byte totals are approximate; sub-500ms peaks can be missed. Frame file count is not the renderer pending-write queue. Independent category peaks may not have occurred simultaneously.'
      }
      receiptPath = if ($receipt) { $receipt.FullName } else { $null }
      receiptSha256 = $receiptHash
      stdoutPath = $stdoutPath
      stderrPath = $stderrPath
    }
    $runResults.Add($runResult)
    $manifest.measurements = @($runResults)
    Write-JsonFile -Path $manifestPath -Value $manifest
    if ($peakObservedSampleIntervalMilliseconds -gt $maximumAcceptedSampleGapMilliseconds) {
      throw "DL-06 measurement run $($definition.id) is measurement-invalid: observed sampling gap $([Math]::Round($peakObservedSampleIntervalMilliseconds, 1)) ms exceeded the $maximumAcceptedSampleGapMilliseconds ms limit. Inspect the preserved measurement manifest and run evidence under $runRoot."
    }
    if (($null -ne $processExitCode -and $processExitCode -ne 0) -or -not $receipt) {
      throw "DL-06 measurement run $($definition.id) failed; inspect its logs and retained evidence under $runRoot."
    }
  }
}
finally {
  if ($null -ne $shell) {
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
  }
  foreach ($name in $environmentNames) {
    [System.Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
  }
}

Write-Host "DL-06 R3 measurement receipts: $manifestPath"
