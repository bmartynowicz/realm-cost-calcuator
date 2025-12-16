param(
  [string]$Namespace = "latitude-staging"
)

$ErrorActionPreference = "Stop"

Write-Host "Removing staging autoscale lock in namespace $Namespace..."
kubectl -n $Namespace delete configmap staging-autoscale-lock --ignore-not-found | Out-Null
Write-Host "Autoscale lock removed."

