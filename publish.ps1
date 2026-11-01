param(
    [Parameter(Mandatory = $true)]
    [string]$RepoUrl
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $root
try {
    $existing = git remote get-url origin 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $existing) {
        git remote add origin $RepoUrl
    } elseif ($existing -ne $RepoUrl) {
        git remote set-url origin $RepoUrl
    }
    git push -u origin main
} finally {
    Pop-Location
}
