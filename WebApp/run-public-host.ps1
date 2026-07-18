[CmdletBinding()]
param(
    [switch]$Elevated
)

$ErrorActionPreference = "Stop"
$serviceName = "Cloudflared"
$webPort = 55055
$webProcess = $null
$watchdogProcess = $null

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-WebPort {
    return [bool](Get-NetTCPConnection `
        -LocalPort $webPort `
        -State Listen `
        -ErrorAction SilentlyContinue)
}

if (-not (Test-IsAdministrator)) {
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$PSCommandPath`"",
        "-Elevated"
    )

    $elevatedProcess = Start-Process `
        -FilePath "powershell.exe" `
        -Verb RunAs `
        -ArgumentList $arguments `
        -Wait `
        -PassThru

    exit $elevatedProcess.ExitCode
}

Push-Location $PSScriptRoot

try {
    $service = Get-Service -Name $serviceName -ErrorAction Stop

    if (Test-WebPort) {
        throw "Port $webPort is already in use. Stop the existing RenderStreaming WebApp first."
    }

    if ($service.Status -ne "Stopped") {
        Write-Host "Stopping stale $serviceName connector..."
        Stop-Service -Name $serviceName -Force
        $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(15))
    }

    Write-Host "Building RenderStreaming WebApp..."
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "WebApp build failed with exit code $LASTEXITCODE."
    }

    $node = (Get-Command node.exe -ErrorAction Stop).Source
    Write-Host "Starting RenderStreaming WebApp on port $webPort..."
    $webProcess = Start-Process `
        -FilePath $node `
        -ArgumentList ".\build\index.js" `
        -WorkingDirectory $PSScriptRoot `
        -NoNewWindow `
        -PassThru

    $deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-WebPort)) {
        if ($webProcess.HasExited) {
            throw "WebApp exited before opening port $webPort."
        }
        if ((Get-Date) -ge $deadline) {
            throw "Timed out waiting for the WebApp to open port $webPort."
        }
        Start-Sleep -Milliseconds 250
    }

    Write-Host "Starting Cloudflare public connector..."
    Start-Service -Name $serviceName
    (Get-Service -Name $serviceName).WaitForStatus(
        "Running",
        [TimeSpan]::FromSeconds(15)
    )

    $watchdogProcess = Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-WindowStyle", "Hidden",
            "-File", "`"$PSScriptRoot\watch-public-host.ps1`"",
            "-WebProcessId", $webProcess.Id,
            "-Port", $webPort,
            "-ServiceName", $serviceName
        ) `
        -WindowStyle Hidden `
        -PassThru

    Write-Host ""
    Write-Host "Public host is live at https://stream.renderedsenseless.com"
    Write-Host "Close this window or press Ctrl+C to stop the WebApp and connector."
    Write-Host ""

    Wait-Process -Id $webProcess.Id
    $webProcess.Refresh()
    if ($webProcess.ExitCode -ne 0) {
        throw "WebApp exited with code $($webProcess.ExitCode)."
    }
}
finally {
    Write-Host "Stopping public host..."

    if ($webProcess -and -not $webProcess.HasExited) {
        Stop-Process -Id $webProcess.Id -Force -ErrorAction SilentlyContinue
    }

    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue

    if ($watchdogProcess -and -not $watchdogProcess.HasExited) {
        Stop-Process -Id $watchdogProcess.Id -Force -ErrorAction SilentlyContinue
    }

    Pop-Location
}
