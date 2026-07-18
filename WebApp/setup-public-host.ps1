[CmdletBinding()]
param(
    [switch]$Elevated
)

$ErrorActionPreference = "Stop"
$serviceName = "Cloudflared"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Find-Cloudflared {
    $command = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $knownPaths = @(
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\cloudflared\cloudflared.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
    )

    return $knownPaths |
        Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
        Select-Object -First 1
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

$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "$serviceName is already installed."
    Write-Host "No changes were made."
    exit 0
}

$cloudflared = Find-Cloudflared
if (-not $cloudflared) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Cloudflared is missing and winget is not available."
    }

    Write-Host "Installing Cloudflared..."
    & $winget.Source install `
        --id Cloudflare.cloudflared `
        --exact `
        --accept-package-agreements `
        --accept-source-agreements

    if ($LASTEXITCODE -ne 0) {
        throw "Cloudflared installation failed with exit code $LASTEXITCODE."
    }

    $cloudflared = Find-Cloudflared
    if (-not $cloudflared) {
        throw "Cloudflared was installed, but cloudflared.exe could not be found."
    }
}

Write-Host ""
Write-Host "Paste the Cloudflare tunnel token when prompted."
Write-Host "The token is used only to install the Windows service."
$secureToken = Read-Host "Tunnel token" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
    $secureToken
)

try {
    $tunnelToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
        $tokenPointer
    )

    Write-Host "Installing the Cloudflared Windows service..."
    & $cloudflared service install $tunnelToken
    if ($LASTEXITCODE -ne 0) {
        throw "Cloudflared service installation failed with exit code $LASTEXITCODE."
    }
}
finally {
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }

    Remove-Variable tunnelToken -ErrorAction SilentlyContinue
    Remove-Variable secureToken -ErrorAction SilentlyContinue
}

$service = Get-Service -Name $serviceName -ErrorAction Stop
Set-Service -Name $serviceName -StartupType Manual

if ($service.Status -ne "Stopped") {
    Stop-Service -Name $serviceName -Force
    $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(15))
}

Write-Host ""
Write-Host "Public-host setup is complete."
Write-Host "$serviceName is installed with Manual startup and is currently stopped."
Write-Host "Run run.bat when this machine should become the public host."
