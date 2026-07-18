[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [int]$WebProcessId,

    [int]$Port = 55055,

    [string]$ServiceName = "Cloudflared"
)

$missingPortChecks = 0

while (Get-Process -Id $WebProcessId -ErrorAction SilentlyContinue) {
    $isListening = [bool](Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction SilentlyContinue)

    if ($isListening) {
        $missingPortChecks = 0
    }
    else {
        $missingPortChecks++
        if ($missingPortChecks -ge 5) {
            break
        }
    }

    Start-Sleep -Seconds 2
}

Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
