param(
  [ValidateSet("staging", "production")]
  [string]$Environment = "staging",

  [ValidateSet("start", "stop", "status")]
  [string]$Action = "status",

  [string]$SubscriptionId,
  [string]$ResourceGroup,
  [string]$ClusterName,

  [switch]$Help,
  [switch]$CopyToClipboard
)

$ErrorActionPreference = "Stop"

if ($Help) {
  Write-Host "Usage:"
  Write-Host "  powershell -File scripts/staging-aks-toggle.ps1 -Environment staging -Action status"
  Write-Host "  powershell -File scripts/staging-aks-toggle.ps1 -Environment staging -Action stop"
  Write-Host "  powershell -File scripts/staging-aks-toggle.ps1 -Environment staging -Action start -CopyToClipboard"
  Write-Host ""
  Write-Host "Optional overrides:"
  Write-Host "  -SubscriptionId <id> -ResourceGroup <rg> -ClusterName <name>"
  Write-Host ""
  Write-Host "If not provided, the script uses env vars when present:"
  Write-Host "  - AZURE_SUBSCRIPTION_ID"
  Write-Host "  - AKS_RG_STAGING / AKS_CLUSTER_STAGING"
  Write-Host "  - AKS_RG_PROD / AKS_CLUSTER_PROD (when -Environment production)"
  exit 0
}

function Get-EnvValue([string]$Name) {
  $value = [string]::Empty
  if (Test-Path "Env:$Name") {
    $value = (Get-Item "Env:$Name").Value
  }
  if ($null -eq $value) {
    return ""
  }
  return $value.Trim()
}

function Pick-FirstNonEmpty([string[]]$Values) {
  foreach ($candidate in $Values) {
    if ($null -ne $candidate -and $candidate.Trim()) {
      return $candidate.Trim()
    }
  }
  return ""
}

$envKey = if ($Environment -eq "production") { "PROD" } else { "STAGING" }

$subscription = Pick-FirstNonEmpty @(
  $SubscriptionId,
  (Get-EnvValue "AZURE_SUBSCRIPTION_ID")
)

$resourceGroupValue = Pick-FirstNonEmpty @(
  $ResourceGroup,
  (Get-EnvValue ("AKS_RG_" + $envKey))
)

$clusterNameValue = Pick-FirstNonEmpty @(
  $ClusterName,
  (Get-EnvValue ("AKS_CLUSTER_" + $envKey))
)

if (-not $subscription) {
  $subscription = "<AZURE_SUBSCRIPTION_ID>"
}
if (-not $resourceGroupValue) {
  $resourceGroupValue = "<AKS_RESOURCE_GROUP>"
}
if (-not $clusterNameValue) {
  $clusterNameValue = "<AKS_CLUSTER_NAME>"
}

$commands = New-Object System.Collections.Generic.List[string]

$commands.Add("az login")
$commands.Add(("az account set --subscription ""{0}""" -f $subscription))
$commands.Add(("az aks show --resource-group ""{0}"" --name ""{1}"" --query ""powerState.code"" -o tsv" -f $resourceGroupValue, $clusterNameValue))

if ($Action -eq "stop") {
  $commands.Add(("az aks stop --resource-group ""{0}"" --name ""{1}""" -f $resourceGroupValue, $clusterNameValue))
} elseif ($Action -eq "start") {
  $commands.Add(("az aks start --resource-group ""{0}"" --name ""{1}""" -f $resourceGroupValue, $clusterNameValue))
}

$commands.Add(("az aks show --resource-group ""{0}"" --name ""{1}"" --query ""powerState.code"" -o tsv" -f $resourceGroupValue, $clusterNameValue))

$reminders = @(
  "CI secrets (staging env) used by workflows:",
  "  - AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_SUBSCRIPTION_ID",
  "  - AKS_RG_STAGING / AKS_CLUSTER_STAGING",
  "",
  "CI vars for scheduled staging checks:",
  "  - STAGING_SMOKE_ENABLED (staging-smoke.yml)",
  "  - STAGING_PLAYWRIGHT_ENABLED (staging-playwright.yml)",
  "  - STAGING_BASE_URL / STAGING_ALLOW_SELF_SIGNED",
  "",
  "Reminder: .github/workflows/staging-autoscale.yml runs on a schedule and will fail if AKS is stopped; disable it temporarily if needed."
)

Write-Host ""
Write-Host ("AKS {0}: {1}" -f $Environment, $Action)
Write-Host ("Resource group: {0}" -f $resourceGroupValue)
Write-Host ("Cluster name:   {0}" -f $clusterNameValue)
Write-Host ""
Write-Host "Commands:"
Write-Host "---------"

$scriptText = ($commands | ForEach-Object { $_ }) -join [Environment]::NewLine
Write-Host $scriptText

Write-Host ""
Write-Host "Reminders:"
Write-Host "----------"
$reminders | ForEach-Object { Write-Host $_ }

if ($CopyToClipboard) {
  try {
    Set-Clipboard -Value $scriptText
    Write-Host ""
    Write-Host "Copied commands to clipboard."
  } catch {
    Write-Warning ("Failed to copy commands to clipboard: {0}" -f $_.Exception.Message)
  }
}

