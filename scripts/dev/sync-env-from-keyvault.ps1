param(
  [string]$VaultName = "lat-staging-kv",
  [string]$OutFile = ".env.local"
)

$ErrorActionPreference = "Stop"

function Get-KeyVaultSecretValue([string]$name) {
  return (az keyvault secret show --vault-name $VaultName --name $name --query value -o tsv).Trim()
}

function Format-DotenvValue([string]$value) {
  if ($null -eq $value) { return "" }
  $needsQuotes = $value -match '[\s#]' -or $value.Contains('"') -or $value.Contains("'")
  if (-not $needsQuotes) { return $value }
  $escaped = $value.Replace('\', '\\').Replace('"', '\"')
  return '"' + $escaped + '"'
}

function Set-ManagedEnvBlock([string]$path, [string[]]$lines) {
  $begin = "# BEGIN KEYVAULT SYNC (managed)"
  $end = "# END KEYVAULT SYNC (managed)"

  $existing = @()
  if (Test-Path $path) {
    $existing = Get-Content -LiteralPath $path -ErrorAction Stop
  }

  $beginIndex = $existing.IndexOf($begin)
  $endIndex = $existing.IndexOf($end)

  $block = @($begin) + $lines + @($end)

  if ($beginIndex -ge 0 -and $endIndex -gt $beginIndex) {
    $before = @()
    if ($beginIndex -gt 0) { $before = $existing[0..($beginIndex - 1)] }
    $after = @()
    if ($endIndex + 1 -lt $existing.Count) { $after = $existing[($endIndex + 1)..($existing.Count - 1)] }
    $combined = @($before) + $block + @($after)
    Set-Content -LiteralPath $path -Encoding UTF8 -Value $combined
    return
  }

  $prefix = @()
  if ($existing.Count -gt 0) { $prefix = $existing + @("") }
  Set-Content -LiteralPath $path -Encoding UTF8 -Value ($prefix + $block)
}

# Ensure az is available + logged in
try {
  az account show 1>$null 2>$null
} catch {
  throw "Azure CLI not logged in. Run: az login"
}

$managedLines = @(
  "",
  "# Secrets pulled from Azure Key Vault: $VaultName",
  ("MODEL_ROUTER_OPENAI_API_KEY=" + (Format-DotenvValue (Get-KeyVaultSecretValue "model-router-openai-api-key"))),
  ("LINKEDIN_CLIENT_ID=" + (Format-DotenvValue (Get-KeyVaultSecretValue "linkedin-client-id"))),
  ("LINKEDIN_CLIENT_SECRET=" + (Format-DotenvValue (Get-KeyVaultSecretValue "linkedin-client-secret"))),
  ("LINKEDIN_SCOPE=" + (Format-DotenvValue (Get-KeyVaultSecretValue "linkedin-scope")))
)

Set-ManagedEnvBlock -path $OutFile -lines $managedLines

Write-Output "Wrote Key Vault secrets into $OutFile (managed block)."
