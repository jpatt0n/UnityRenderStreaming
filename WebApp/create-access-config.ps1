[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$configPath = Join-Path $PSScriptRoot "access.local.json"
$linksPath = Join-Path $PSScriptRoot "access-links.local.txt"

if ((Test-Path -LiteralPath $configPath) -and -not $Force) {
    throw "$configPath already exists. Use -Force only when you intend to invalidate every existing link."
}

function New-AccessKey {
    $bytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$hostbotKey = New-AccessKey
$joshKey = New-AccessKey
$birdKey = New-AccessKey
$angelhairKey = New-AccessKey
$zerbzKey = New-AccessKey

$config = [ordered]@{
    cast = @(
        [ordered]@{
            key = $hostbotKey
            defaultUsername = "hostbot"
            profile = "hostbot"
            allowUsernameOverride = $true
            enabled = $true
        },
        [ordered]@{
            key = $joshKey
            defaultUsername = "josh"
            profile = "josh"
            allowUsernameOverride = $true
            enabled = $true
        },
        [ordered]@{
            key = $birdKey
            defaultUsername = "bird"
            profile = "bird"
            allowUsernameOverride = $true
            enabled = $true
        },
        [ordered]@{
            key = $angelhairKey
            defaultUsername = "angelhair"
            profile = "angelhair"
            allowUsernameOverride = $true
            enabled = $true
        },
        [ordered]@{
            key = $zerbzKey
            defaultUsername = "zerbz"
            profile = "zerbz"
            allowUsernameOverride = $true
            enabled = $true
        }
    )
    guests = @()
}

$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding utf8

@(
    "Hostbot: https://renderedsenseless.com/access#cast=$hostbotKey"
    "Josh: https://renderedsenseless.com/access#cast=$joshKey"
    "Bird: https://renderedsenseless.com/access#cast=$birdKey"
    "Angelhair: https://renderedsenseless.com/access#cast=$angelhairKey"
    "Zerbz: https://renderedsenseless.com/access#cast=$zerbzKey"
) | Set-Content -LiteralPath $linksPath -Encoding utf8

Write-Host "Created local access config and cast links."
Write-Host "Add guest entries to access.local.json using access.example.json as the shape."
