$ErrorActionPreference = 'Stop'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Error "GitHub CLI ('gh') not found on PATH."
  exit 1
}

function ConvertFrom-GhJson {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $Lines
  )

  return ($Lines | Out-String | ConvertFrom-Json)
}

$userJson = & gh api user
if ($LASTEXITCODE -ne 0) {
  Write-Error "Failed to query current GitHub user. Run 'gh auth login' first."
  exit 1
}

$user = ConvertFrom-GhJson $userJson
$login = [string]$user.login

$repoJson = & gh repo view --json nameWithOwner,viewerPermission
if ($LASTEXITCODE -ne 0) {
  Write-Error "Failed to query repo access. Ensure you can access this repo via 'gh'."
  exit 1
}

$repo = ConvertFrom-GhJson $repoJson

Write-Output "gh login: $login"
Write-Output "repo: $($repo.nameWithOwner)"
Write-Output "repo access: $($repo.viewerPermission)"

if ($login -ne 'latitude-codex') {
  Write-Error "Expected GitHub login 'latitude-codex' but got '$login'."
  exit 1
}

exit 0
