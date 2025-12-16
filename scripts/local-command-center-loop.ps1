param(
  [string]$WebBaseUrl = "http://localhost:3001",

  [string]$Topic = "Walking skeleton local loop",
  [string]$StartDate,
  [string]$EndDate,

  [ValidateSet("confident", "conversational", "helpful", "bold", "curious")]
  [string]$Tone = "confident",

  [ValidateSet("daily", "weekly", "biweekly")]
  [string]$Cadence = "weekly",

  [switch]$SkipPublish,
  [switch]$SkipAnalytics,

  [switch]$StartStack,
  [int]$StartStackTimeoutSeconds = 240,

  [switch]$OpenBrowser,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  Get-Command $Name -ErrorAction Stop | Out-Null
}

function Wait-ForUrl([string]$Url, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 4
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return $true
      }
    } catch {
      # ignore
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Default-Date([int]$OffsetDays) {
  return (Get-Date).AddDays($OffsetDays).ToString("yyyy-MM-dd")
}

if ($Help) {
  Write-Host "Runs the Command Center campaign loop locally (generate -> visuals -> publish -> analytics)."
  Write-Host ""
  Write-Host "Prereq: run with PROFILE=dev + NEXT_PUBLIC_AUTH_BYPASS=true so the API can stamp workspace headers."
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  powershell -File scripts/local-command-center-loop.ps1"
  Write-Host "  powershell -File scripts/local-command-center-loop.ps1 -StartStack"
  Write-Host "  powershell -File scripts/local-command-center-loop.ps1 -Topic \"My campaign\" -Cadence daily -OpenBrowser"
  Write-Host ""
  Write-Host "Options:"
  Write-Host "  -SkipPublish     Only generate + visuals."
  Write-Host "  -SkipAnalytics   Skip analytics request."
  exit 0
}

if (-not $StartDate) { $StartDate = Default-Date 1 }
if (-not $EndDate) { $EndDate = Default-Date 8 }

$WebBaseUrl = $WebBaseUrl.TrimEnd("/")
$endpoint = "$WebBaseUrl/api/command-center/campaigns?skipPublish=$($SkipPublish.IsPresent.ToString().ToLowerInvariant())&skipAnalytics=$($SkipAnalytics.IsPresent.ToString().ToLowerInvariant())"

if ($StartStack) {
  Require-Command "pnpm"

  if (-not $env:PROFILE) { $env:PROFILE = "dev" }
  if (-not $env:NEXT_PUBLIC_PROFILE) { $env:NEXT_PUBLIC_PROFILE = "dev" }
  if (-not $env:NEXT_PUBLIC_AUTH_BYPASS) { $env:NEXT_PUBLIC_AUTH_BYPASS = "true" }
  if (-not $env:COMMAND_CENTER_DEMO_MODE) { $env:COMMAND_CENTER_DEMO_MODE = "true" }
  if (-not $env:NEXT_PUBLIC_COMMAND_CENTER_DEMO_MODE) { $env:NEXT_PUBLIC_COMMAND_CENTER_DEMO_MODE = "true" }

  Write-Host "Starting dev stack in a separate process (pnpm run dev:stack:full)..."
  Start-Process -FilePath cmd.exe -ArgumentList @("/c", "pnpm run dev:stack:full") -WorkingDirectory (Get-Location) | Out-Null

  Write-Host "Waiting for $WebBaseUrl/readyz (timeout: $StartStackTimeoutSeconds s)..."
  if (-not (Wait-ForUrl "$WebBaseUrl/readyz" $StartStackTimeoutSeconds)) {
    throw "Timed out waiting for web ready. Is the stack running and WEB_PORT mapped to $(($WebBaseUrl -split ':')[-1])?"
  }
} else {
  if (-not (Wait-ForUrl "$WebBaseUrl/readyz" 10)) {
    Write-Warning "Web doesn't look ready at $WebBaseUrl/readyz yet. Start the stack with: pnpm run dev:stack:full"
  }
}

$payload = @{
  topic = $Topic
  startDate = $StartDate
  endDate = $EndDate
  tone = $Tone
  cadence = $Cadence
}

Write-Host ""
Write-Host "Submitting campaign request:"
Write-Host "  POST $endpoint"
Write-Host ""

try {
  $response = Invoke-RestMethod -Method Post -Uri $endpoint -ContentType "application/json" -Body ($payload | ConvertTo-Json)
} catch {
  $message = $_.Exception.Message
  throw "Request failed. Ensure the stack is running with PROFILE=dev and NEXT_PUBLIC_AUTH_BYPASS=true. Error: $message"
}

$campaignId = $response.campaign.campaignId
$stages = $response.stages

Write-Host "Result:"
Write-Host ("  campaignId: {0}" -f $campaignId)
Write-Host ("  generation: {0}" -f $stages.generation.status)
Write-Host ("  visuals:    {0}" -f $stages.visuals.status)
Write-Host ("  publish:    {0}" -f $stages.publish.status)
Write-Host ("  analytics:  {0}" -f $stages.analytics.status)

if ($OpenBrowser) {
  Start-Process "$WebBaseUrl/command-center" | Out-Null
}
