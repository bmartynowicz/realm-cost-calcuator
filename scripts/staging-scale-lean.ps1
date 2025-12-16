param(
  [string]$Namespace = "latitude-staging"
)

$ErrorActionPreference = "Stop"

$keep = @(
  "staging-web",
  "staging-api-gateway",
  "staging-auth-service",
  "staging-linkedin-service",
  "staging-growth-engine"
)

$scaleDown = @(
  "staging-analytics-service",
  "staging-dev-agent-service",
  "staging-agent-orchestrator",
  "staging-designer-service",
  "staging-content-engine",
  "staging-content-service",
  "staging-user-service",
  "staging-model-router"
)

Write-Host "Scaling staging to LEAN mode in namespace $Namespace..."

foreach ($name in $keep) {
  try {
    kubectl -n $Namespace scale deployment/$name --replicas=1 | Out-Null
    Write-Host "  kept $name at 1"
  } catch {
    Write-Warning "  could not scale $name (may not exist): $($_.Exception.Message)"
  }
}

foreach ($name in $scaleDown) {
  try {
    kubectl -n $Namespace scale deployment/$name --replicas=0 | Out-Null
    Write-Host "  scaled down $name to 0"
  } catch {
    Write-Warning "  could not scale $name (may not exist): $($_.Exception.Message)"
  }
}

try {
  kubectl -n $Namespace set env deployment/staging-web NEXT_PUBLIC_STAGING_LEAN_MODE=true | Out-Null
  Write-Host "  set NEXT_PUBLIC_STAGING_LEAN_MODE=true on staging-web"
} catch {
  Write-Warning "  could not set lean mode flag on staging-web: $($_.Exception.Message)"
}

Write-Host "Lean mode applied. Run scripts/staging-scale-full.ps1 to restore."
