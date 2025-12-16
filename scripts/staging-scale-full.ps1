param(
  [string]$Namespace = "latitude-staging"
)

$ErrorActionPreference = "Stop"

$deployments = @(
  "staging-web",
  "staging-api-gateway",
  "staging-auth-service",
  "staging-linkedin-service",
  "staging-growth-engine",
  "staging-analytics-service",
  "staging-dev-agent-service",
  "staging-agent-orchestrator",
  "staging-designer-service",
  "staging-content-engine",
  "staging-content-service",
  "staging-user-service",
  "staging-model-router"
)

Write-Host "Scaling staging to FULL mode in namespace $Namespace..."

foreach ($name in $deployments) {
  try {
    kubectl -n $Namespace scale deployment/$name --replicas=1 | Out-Null
    Write-Host "  scaled $name to 1"
  } catch {
    Write-Warning "  could not scale $name (may not exist): $($_.Exception.Message)"
  }
}

try {
  kubectl -n $Namespace set env deployment/staging-web NEXT_PUBLIC_STAGING_LEAN_MODE=false | Out-Null
  Write-Host "  set NEXT_PUBLIC_STAGING_LEAN_MODE=false on staging-web"
} catch {
  Write-Warning "  could not set lean mode flag on staging-web: $($_.Exception.Message)"
}

Write-Host "Full mode applied."
