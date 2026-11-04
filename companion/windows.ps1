param(
    [ValidateSet('Start', 'Status', 'Stop', 'Register')]
    [string]$Action = 'Start',
    [string]$StateDirectory = '',
    [ValidateRange(1, 65535)]
    [int]$Port = 8770
)

$ErrorActionPreference = 'Stop'
$serverFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'server.cjs'))
if (-not $StateDirectory) {
    if ($env:HERMES_CODEX_HOME) { $StateDirectory = $env:HERMES_CODEX_HOME }
    elseif ($env:HERMES_HOME) { $StateDirectory = Join-Path $env:HERMES_HOME 'codex-supervisor' }
    else { $StateDirectory = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.hermes\codex-supervisor' }
}
$StateDirectory = [IO.Path]::GetFullPath($StateDirectory)
$env:HERMES_CODEX_HOME = $StateDirectory
$env:HERMES_CODEX_PORT = [string]$Port
$pidFile = Join-Path $StateDirectory 'service.json'
$tokenFile = Join-Path $StateDirectory 'token'
$nodeFile = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source

function Get-CompanionProcess {
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
    $record = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    if ($record.server -ne $serverFile) { throw 'The service record belongs to another companion installation.' }
    $running = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.id)"
    if (-not $running) { return $null }
    if ($running.ExecutablePath -ne $nodeFile -or -not $running.CommandLine.Contains('"' + $serverFile + '"') -or
        $running.CreationDate.ToUniversalTime().Ticks -ne ([datetime]$record.created).ToUniversalTime().Ticks) {
        throw 'The recorded process no longer belongs to this companion. No process was stopped.'
    }
    return $running
}

function Get-CompanionStatus {
    $credential = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/status" -Headers @{ Authorization = "Bearer $credential" } -TimeoutSec 2
}

if ($Action -eq 'Register') {
    & $nodeFile $serverFile --register
    if ($LASTEXITCODE -ne 0) { throw 'Codex desktop registration failed.' }
    return
}

$running = Get-CompanionProcess
if ($Action -eq 'Stop') {
    if ($running) { Stop-Process -Id $running.ProcessId -ErrorAction Stop }
    if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile }
    Write-Output 'Companion stopped. The saved watch is preserved for the next start.'
    return
}
if ($Action -eq 'Status') {
    if (-not $running) { Write-Output 'Companion is not running.'; return }
    $status = Get-CompanionStatus
    [pscustomobject]@{ Running = $true; ProcessId = $running.ProcessId; WatchEnabled = $status.enabled; State = $status.state }
    return
}
if ($running) { Write-Output 'Companion is already running.'; return }

New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
$process = Start-Process -FilePath $nodeFile -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $StateDirectory 'service.log') -RedirectStandardError (Join-Path $StateDirectory 'service-error.log')
$identity = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
if (-not $identity) { throw 'Companion exited before startup. Read service-error.log in the state directory.' }
@{ id = $process.Id; server = $serverFile; created = $identity.CreationDate.ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($process.HasExited) { throw 'Companion could not start. Read service-error.log in the state directory.' }
    try {
        $status = Get-CompanionStatus
        [pscustomobject]@{ Running = $true; ProcessId = $process.Id; WatchEnabled = $status.enabled; State = $status.state }
        return
    } catch { Start-Sleep -Milliseconds 200 }
}
throw 'Companion has not answered yet. Read service-error.log in the state directory.'
