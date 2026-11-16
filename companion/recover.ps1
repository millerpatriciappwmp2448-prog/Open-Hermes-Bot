param(
    [Parameter(Mandatory = $true)][string]$StateDirectory,
    [Parameter(Mandatory = $true)][string]$TunnelHost,
    [Parameter(Mandatory = $true)][string]$IdentityFile,
    [Parameter(Mandatory = $true)][string]$Socket,
    [switch]$GroupReadable,
    [ValidateRange(1, 65535)][int]$Port = 8770
)

# Run at login and periodically as the same Windows user as Codex. This only
# restores missing processes; it never enables supervision or sends a message.
$ErrorActionPreference = 'Stop'
$StateDirectory = [IO.Path]::GetFullPath($StateDirectory)
$IdentityFile = (Resolve-Path -LiteralPath $IdentityFile).Path
$tunnelFile = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'ssh_tunnel.py')).Path
$pythonFile = (Get-Command python.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
if ($TunnelHost -notmatch '^[^\s-][^\s]*$') { throw 'Use one SSH host alias or user@host.' }
if (-not $Socket.StartsWith('/') -or $Socket.IndexOfAny([char[]]"`r`n`0:") -ge 0) { throw 'Use one absolute Linux socket path.' }
foreach ($value in @($StateDirectory, $TunnelHost, $IdentityFile, $Socket, $tunnelFile)) {
    if ($value.Contains('"') -or $value.Contains("`r") -or $value.Contains("`n")) { throw 'Arguments must not contain quotes or newlines.' }
}

New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
# An exclusive file lock also prevents duplicate starts from manual checks.
$lockFile = Join-Path $StateDirectory 'recovery.lock'
try { $lock = [IO.File]::Open($lockFile, 'OpenOrCreate', 'ReadWrite', 'None') }
catch [IO.IOException] { Write-Output 'Recovery is already running.'; return }
try {
    & (Join-Path $PSScriptRoot 'windows.ps1') -Action Start -StateDirectory $StateDirectory -Port $Port
    $matching = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object {
        $_.ExecutablePath -eq $pythonFile -and
        $_.CommandLine.Contains('"' + $tunnelFile + '"') -and
        $_.CommandLine.Contains('--state-dir "' + $StateDirectory + '"')
    })
    if ($matching.Count -gt 1) { throw 'Multiple tunnel helpers use this state directory. No process was stopped.' }
    if ($matching.Count -eq 1) {
        Write-Output 'Private tunnel helper is already running.'
        return
    }
    $arguments = '-u "' + $tunnelFile + '" --host "' + $TunnelHost + '" --identity "' + $IdentityFile +
        '" --socket "' + $Socket + '" --state-dir "' + $StateDirectory + '" --port ' + $Port
    if ($GroupReadable) { $arguments += ' --group-readable' }
    $process = Start-Process -FilePath $pythonFile -ArgumentList $arguments -WindowStyle Hidden -PassThru `
        -RedirectStandardError (Join-Path $StateDirectory 'tunnel-start-error.log')
    Write-Output ('Private tunnel helper started: ' + $process.Id)
} finally { $lock.Dispose() }
