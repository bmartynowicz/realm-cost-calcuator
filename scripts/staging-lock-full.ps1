param(
  [string]$Namespace = "latitude-staging",
  [int]$Hours = 12
)

$ErrorActionPreference = "Stop"

$lockUntil = (Get-Date).ToUniversalTime().AddHours($Hours).ToString("o")

Write-Host "Locking staging autoscale to FULL until $lockUntil in namespace $Namespace..."

$manifest = kubectl -n $Namespace create configmap staging-autoscale-lock --from-literal=lockUntil=$lockUntil --dry-run=client -o yaml
$manifest | kubectl apply -f - | Out-Null

./scripts/staging-scale-full.ps1 -Namespace $Namespace

Write-Host "Autoscale lock applied. Use scripts/staging-unlock-full.ps1 to remove."

