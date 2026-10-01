[CmdletBinding()]
param([string]$Payload = (Join-Path $PSScriptRoot '..\build\installer\payload'))
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$payloadPath = (Resolve-Path -LiteralPath $Payload).Path
$files = @(Get-ChildItem -LiteralPath $payloadPath -File -Recurse)
$privateStrings = [Collections.Generic.List[string]]::new()
$vault = Join-Path $root 'outputs\settings\api-keys.json'
if (Test-Path -LiteralPath $vault) {
    $vaultData = Get-Content -LiteralPath $vault -Raw | ConvertFrom-Json -AsHashtable
    foreach ($provider in $vaultData.providers.Values) {
        $key = [string]$provider.key
        if ($key -and $key -ne 'ollama') { $privateStrings.Add($key) }
    }
    $vaultData = $null
    $key = $null
}
foreach ($file in $files) {
    $relative = [IO.Path]::GetRelativePath($payloadPath, $file.FullName)
    if ($relative -match '(^|[\\/])(outputs|settings|api-keys\.json|\.env(?:\.[^\\/]+)?)([\\/]|$)' -or $file.Name -match '^(credentials|secrets?)\.(json|txt|ya?ml|toml|ini)$') {
        throw "Private file rejected from installer: $relative"
    }
    # Scan exact local key values in every payload file, including binaries.
    # Values are never written to the console or the release audit report.
    if ($privateStrings.Count) {
        $content = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($file.FullName))
        foreach ($keyValue in $privateStrings) {
            if ($content.Contains($keyValue)) { throw "Private credential found in installer payload: $relative" }
        }
    }
}
$privateStrings.Clear()
$total = ($files | Measure-Object -Property Length -Sum).Sum
Write-Host "Installer privacy audit passed: $($files.Count) files, $([math]::Round($total / 1MB, 1)) MB; no key vault, user outputs, or saved provider keys."
