param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('before', 'after')]
    [string]$Phase,

    [string]$Root = 'D:\PandaStage-Acceptance\issue742-repair-contract-20261009-attempt03',

    [string]$AfterFileName = 'animate-host-after.json'
)

$ErrorActionPreference = 'Stop'
$ExecutablePath = 'D:\AN2023\Adobe Animate 2023\Animate.exe'
$ResolvedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
$RepositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path.TrimEnd('\')
if ($ResolvedRoot.Equals($RepositoryRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $ResolvedRoot.StartsWith($RepositoryRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Issue #742 host receipts must remain outside the repository: $ResolvedRoot"
}

if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
    throw "Configured Animate executable does not exist: $ExecutablePath"
}

$processes = @(
    Get-CimInstance Win32_Process -Filter "name = 'Animate.exe'" |
        Where-Object { $_.ExecutablePath -eq $ExecutablePath } |
        ForEach-Object {
            [ordered]@{
                processId = $_.ProcessId
                commandLine = $_.CommandLine
                windowTitle = (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).MainWindowTitle
            }
        }
)
if ($processes.Count -eq 0) {
    throw "No running Animate process matches the configured executable: $ExecutablePath"
}

$signature = Get-AuthenticodeSignature -LiteralPath $ExecutablePath
$file = Get-Item -LiteralPath $ExecutablePath
$version = $file.VersionInfo.FileVersion
$hash = (Get-FileHash -LiteralPath $ExecutablePath -Algorithm SHA256).Hash.ToUpperInvariant()
$provenance = if ($signature.Status -eq 'Valid') { 'VALID_SIGNED' } else { 'UNTRUSTED / MODIFIED' }
$receipt = [ordered]@{
    schemaVersion = 'issue742-animate-host-provenance/1'
    issue = 742
    phase = $Phase
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    executablePath = $ExecutablePath
    fileVersion = $version
    sha256 = $hash
    authenticodeStatus = [string]$signature.Status
    signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    provenance = $provenance
    runningProcesses = $processes
}

if (-not (Test-Path -LiteralPath $ResolvedRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $ResolvedRoot | Out-Null
}

if ($Phase -eq 'before') {
    $jsonPath = Join-Path $ResolvedRoot 'animate-host-before.json'
    $manifestPath = Join-Path $ResolvedRoot 'animate-host-provenance.txt'
    if (Test-Path -LiteralPath $jsonPath) { throw "Refusing to overwrite $jsonPath" }
    if (Test-Path -LiteralPath $manifestPath) { throw "Refusing to overwrite $manifestPath" }

    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($jsonPath, ($receipt | ConvertTo-Json -Depth 8) + "`n", $utf8NoBom)
    $manifest = @(
        "EXECUTABLE_PATH=$ExecutablePath"
        "FILE_VERSION=$version"
        "SHA256=$hash"
        "AUTHENTICODE_STATUS=$($signature.Status)"
        "PROVENANCE=$provenance"
    ) -join "`n"
    [System.IO.File]::WriteAllText($manifestPath, $manifest + "`n", $utf8NoBom)
    Write-Output "Issue #742 Animate provenance captured before run: $jsonPath"
    Write-Output "JSFL manifest: $manifestPath"
    exit 0
}

$beforePath = Join-Path $ResolvedRoot 'animate-host-before.json'
$afterFileLeaf = [System.IO.Path]::GetFileName($AfterFileName)
if ([string]::IsNullOrWhiteSpace($AfterFileName) -or $afterFileLeaf -ne $AfterFileName) {
    throw "AfterFileName must be a filename without a directory: $AfterFileName"
}
$afterPath = Join-Path $ResolvedRoot $AfterFileName
if (-not (Test-Path -LiteralPath $beforePath -PathType Leaf)) {
    throw "Before-run provenance is missing: $beforePath"
}
if (Test-Path -LiteralPath $afterPath) { throw "Refusing to overwrite $afterPath" }
$before = Get-Content -Raw -LiteralPath $beforePath -Encoding UTF8 | ConvertFrom-Json
$receipt['stableDuringExperiment'] = (
    $before.executablePath -eq $ExecutablePath -and
    $before.fileVersion -eq $version -and
    $before.sha256 -eq $hash -and
    $before.authenticodeStatus -eq [string]$signature.Status
)
$beforeProcessSummary = @(
    $before.runningProcesses | Sort-Object processId | ForEach-Object {
        '{0}|{1}|{2}' -f $_.processId, $_.commandLine, $_.windowTitle
    }
) -join "`n"
$afterProcessSummary = @(
    $processes | Sort-Object processId | ForEach-Object {
        '{0}|{1}|{2}' -f $_.processId, $_.commandLine, $_.windowTitle
    }
) -join "`n"
$receipt['processesStableDuringExperiment'] = $beforeProcessSummary -ceq $afterProcessSummary
$receipt['stableDuringExperiment'] = $receipt['stableDuringExperiment'] -and $receipt['processesStableDuringExperiment']
[System.IO.File]::WriteAllText($afterPath, ($receipt | ConvertTo-Json -Depth 8) + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "Issue #742 Animate provenance captured after run: $afterPath"
Write-Output "Stable during experiment: $($receipt['stableDuringExperiment'])"
Write-Output "Animate process/window state stable: $($receipt['processesStableDuringExperiment'])"
if (-not $receipt['stableDuringExperiment']) { exit 2 }
