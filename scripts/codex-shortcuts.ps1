param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("spawn:init", "spawn:finish", "spawn:list", "spawn:prune", "status", "aks:stop", "aks:start")]
  [string]$Command,

  [string]$Name,
  [string]$Title,
  [string]$Locks,
  [string]$Focus,
  [string]$Summary,

  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Exec([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Exe $($Arguments -join ' ')"
  }
}

function Get-RepoRoot() {
  $root = & git rev-parse --show-toplevel 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $root) {
    throw "Run this from inside the repo."
  }
  return $root.Trim()
}

$repoRoot = Get-RepoRoot

switch ($Command) {
  "spawn:init" {
    if (-not $Name) { throw "Provide -Name (e.g. spawn-1-web-ui)." }
    if (-not $Title) { throw "Provide -Title." }
    if (-not $Locks) { throw "Provide -Locks." }
    $args = @(
      "-File", (Join-Path $repoRoot "scripts/codex-worktree.ps1"),
      "init",
      "-Name", $Name,
      "-Title", $Title,
      "-Locks", $Locks
    )
    if ($Focus) { $args += @("-Focus", $Focus) }
    if ($Summary) { $args += @("-Summary", $Summary) }
    if ($Force) { $args += "-Force" }
    Exec "powershell" $args
    exit 0
  }
  "spawn:finish" {
    if (-not $Name) { throw "Provide -Name (e.g. spawn-1-web-ui)." }
    $args = @(
      "-File", (Join-Path $repoRoot "scripts/codex-worktree.ps1"),
      "finish",
      "-Name", $Name
    )
    if ($Force) { $args += "-Force" }
    Exec "powershell" $args
    exit 0
  }
  "spawn:list" {
    Exec "powershell" @("-File", (Join-Path $repoRoot "scripts/codex-worktree.ps1"), "list")
    exit 0
  }
  "spawn:prune" {
    Exec "powershell" @("-File", (Join-Path $repoRoot "scripts/codex-worktree.ps1"), "prune")
    exit 0
  }
  "status" {
    Exec "git" @("-C", $repoRoot, "status", "-sb")
    Exec "git" @("-C", $repoRoot, "worktree", "list")
    Exec "gh" @("issue", "list", "--label", "codex:active")
    Exec "gh" @("pr", "list", "--state", "open")
    exit 0
  }
  "aks:stop" {
    Exec "powershell" @("-File", (Join-Path $repoRoot "scripts/staging-aks-toggle.ps1"), "-Stop")
    exit 0
  }
  "aks:start" {
    Exec "powershell" @("-File", (Join-Path $repoRoot "scripts/staging-aks-toggle.ps1"), "-Start")
    exit 0
  }
}
