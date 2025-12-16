<#
.SYNOPSIS
Creates (or updates) an Azure Monitor scheduled query alert for revoked LinkedIn tokens.

.DESCRIPTION
This targets the common staging failure mode where LinkedIn refresh/access tokens are revoked and org/page authors disappear.
The alert is created via `az rest` (no Azure CLI extensions required).

.PARAMETER ResourceGroupName
Resource group that will own the scheduled query rule resource.

.PARAMETER WorkspaceResourceId
Resource ID of the Log Analytics workspace receiving container logs.
Example: /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.OperationalInsights/workspaces/<name>

.PARAMETER ActionGroupResourceId
Optional resource ID of an Azure Monitor Action Group to notify when the alert fires.

.PARAMETER RuleName
Name of the scheduled query rule resource.

.PARAMETER Namespace
Kubernetes namespace to filter by.

.PARAMETER DeploymentNamePrefix
Pod/deployment prefix to filter by (defaults to staging auth-service).
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [string] $ResourceGroupName,

  [Parameter(Mandatory = $true)]
  [string] $WorkspaceResourceId,

  [string] $ActionGroupResourceId,

  [string] $RuleName = "linkedin-revoked-token-spike",

  [string] $Location = "centralus",

  [int] $Severity = 2,

  [int] $WindowSizeMinutes = 15,

  [int] $EvaluationFrequencyMinutes = 5,

  [int] $Threshold = 1,

  [string] $Namespace = "latitude-staging",

  [string] $DeploymentNamePrefix = "staging-auth-service",

  [switch] $Disabled
)

$ErrorActionPreference = "Stop"

$subscriptionId = (az account show --query id -o tsv).Trim()
if (-not $subscriptionId) {
  throw "Unable to resolve subscription id (are you logged in via 'az login'?)"
}

$apiVersion = "2023-03-15-preview"
$ruleResourceId = "/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.Insights/scheduledQueryRules/$RuleName"
$enabled = -not $Disabled.IsPresent

$kql = @"
let window = ${WindowSizeMinutes}m;
union isfuzzy=true ContainerLogV2, ContainerLog
| where TimeGenerated > ago(window)
| extend Message = tostring(coalesce(LogMessage, LogEntry))
| where Message has "REVOKED_ACCESS_TOKEN"
   or Message has "TOKEN_REVOKED"
   or Message has "linkedin_state_unavailable"
| extend Pod = tostring(coalesce(PodName, Pod))
| extend KubeNamespace = tostring(coalesce(KubernetesNamespace, Namespace))
| where KubeNamespace == "$Namespace"
| where Pod startswith "$DeploymentNamePrefix"
| summarize Hits=count()
"@

$body = @{
  location   = $Location
  properties = @{
    displayName = "LinkedIn revoked tokens (auth-service)"
    description = "Alerts when auth-service logs indicate LinkedIn tokens are revoked/unavailable (company pages may disappear)."
    severity    = $Severity
    enabled     = $enabled
    scopes      = @($WorkspaceResourceId)
    evaluationFrequency = "PT${EvaluationFrequencyMinutes}M"
    windowSize          = "PT${WindowSizeMinutes}M"
    criteria = @{
      allOf = @(
        @{
          query           = $kql
          timeAggregation = "Count"
          operator        = "GreaterThanOrEqual"
          threshold       = $Threshold
          failingPeriods  = @{
            numberOfEvaluationPeriods = 1
            minFailingPeriodsToAlert  = 1
          }
        }
      )
    }
  }
}

if ($ActionGroupResourceId) {
  $body.properties.actions = @{
    actionGroups = @(
      @{
        actionGroupId = $ActionGroupResourceId
      }
    )
  }
}

$json = $body | ConvertTo-Json -Depth 20

if ($PSCmdlet.ShouldProcess($ruleResourceId, "Create/Update scheduled query rule")) {
  az rest `
    --method PUT `
    --uri ("https://management.azure.com{0}?api-version={1}" -f $ruleResourceId, $apiVersion) `
    --headers "Content-Type=application/json" `
    --body $json | Out-Null
}

Write-Host "Scheduled query rule ensured: $ruleResourceId"
Write-Host "Query window: ${WindowSizeMinutes}m, eval: ${EvaluationFrequencyMinutes}m, threshold: >= $Threshold"
if ($ActionGroupResourceId) {
  Write-Host "Action group wired: $ActionGroupResourceId"
} else {
  Write-Host "No action group configured (pass -ActionGroupResourceId to notify)."
}
