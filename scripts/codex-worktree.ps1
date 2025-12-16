param(
  [Parameter(Position = 0)]
  [ValidateSet("init", "finish", "list", "prune", "help")]
  [string]$Command = "help",

  [string]$Name,
  [string]$Title,
  [string]$Locks,
  [string]$Focus,
  [string]$Summary,
  [string]$BaseRef = "origin/main",
  [string]$WorktreePath,

  [switch]$SkipIssue,
  [switch]$KeepBranch,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Section([string]$Text) {
  Write-Host ""
  Write-Host $Text
  Write-Host ("-" * $Text.Length)
}

function Write-Preflight([string]$RepoRoot, [string]$CurrentWorktreeRoot) {
  $cwd = (Get-Location).Path
  Write-Host ""
  Write-Host "Preflight"
  Write-Host "---------"
  Write-Host "Repo root:     $RepoRoot"
  Write-Host "CWD:           $cwd"
  Write-Host "Worktree root: $CurrentWorktreeRoot"

  $trimChars = [char[]]@('\', '/')
  $repoFull = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd($trimChars)
  $cwdFull = [System.IO.Path]::GetFullPath($cwd).TrimEnd($trimChars)
  if (-not $cwdFull.StartsWith($repoFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Host ""
    Write-Host "WARNING: Your current directory is outside the repo. cd into the repo before running Codex to avoid editing the wrong files."
    Write-Host "Example:"
    Write-Host "  cd `"$RepoRoot`""
  }

  $worktreeFull = ""
  if ($CurrentWorktreeRoot) {
    $worktreeFull = [System.IO.Path]::GetFullPath($CurrentWorktreeRoot).TrimEnd($trimChars)
  }
  if ($worktreeFull -and -not $cwdFull.StartsWith($worktreeFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Host ""
    Write-Host "WARNING: Your current directory is not the active worktree root. Consider cd'ing into the worktree before editing files."
    Write-Host "Example:"
    Write-Host "  cd `"$CurrentWorktreeRoot`""
  }
}

function Write-Utf8NoBomFile([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Require-Command([string]$Name) {
  Get-Command $Name -ErrorAction Stop | Out-Null
}

function Exec([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Exe $($Arguments -join ' ')"
  }
}

function ExecCapture([string]$Exe, [string[]]$Arguments) {
  $output = & $Exe @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Exe $($Arguments -join ' ')`n$output"
  }
  return ($output | Out-String).Trim()
}

function TryExec([string]$Exe, [string[]]$Arguments) {
  try {
    Exec $Exe $Arguments
    return $true
  } catch {
    return $false
  }
}

function Get-RepoRoot() {
  $commonDir = ExecCapture "git" @("rev-parse", "--git-common-dir")
  $commonAbsolute = [System.IO.Path]::GetFullPath($commonDir)
  return Split-Path -Parent $commonAbsolute
}

function Get-CurrentWorktreeRoot() {
  return ExecCapture "git" @("rev-parse", "--show-toplevel")
}

function Get-WorktreesRoot([string]$RepoRoot) {
  return Join-Path $RepoRoot ".worktrees"
}

function Normalize-Slug([string]$Value) {
  $trimmed = ""
  if ($null -ne $Value) {
    $trimmed = $Value.Trim()
  }
  if (-not $trimmed) {
    return ""
  }
  return ($trimmed -replace "[^a-zA-Z0-9-_]", "-").Trim("-").ToLowerInvariant()
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Resolve-WorktreePath([string]$RepoRoot, [string]$Name, [string]$ExplicitPath) {
  if ($ExplicitPath) {
    $candidate = $ExplicitPath
    if (-not [System.IO.Path]::IsPathRooted($candidate)) {
      $candidate = Join-Path $RepoRoot $candidate
    }
    return [System.IO.Path]::GetFullPath($candidate)
  }
  if (-not $Name) {
    throw "Provide -Name or -WorktreePath."
  }
  $root = Get-WorktreesRoot $RepoRoot
  return Join-Path $root $Name
}

function Branch-Exists([string]$Branch) {
  try {
    Exec "git" @("-C", $script:RepoRoot, "show-ref", "--verify", "--quiet", "refs/heads/$Branch")
    return $true
  } catch {
    return $false
  }
}

function Pick-BranchName([string]$Slug) {
  $prefix = "codex"
  $candidate = "$prefix/$Slug"
  if (-not $Slug) {
    $candidate = "$prefix/run"
  }
  if (-not (Branch-Exists $candidate)) {
    return $candidate
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $candidate = "$prefix/$Slug-$stamp"
  if (-not (Branch-Exists $candidate)) {
    return $candidate
  }

  $i = 2
  while (Branch-Exists "$candidate-$i") {
    $i += 1
  }
  return "$candidate-$i"
}

function Get-GitWorktreeList() {
  return ExecCapture "git" @("worktree", "list", "--porcelain")
}

function Get-WorktreeMetaPath([string]$WorktreePath) {
  return Join-Path $WorktreePath ".codex-checkin.json"
}

function Write-WorktreeMeta([string]$WorktreePath, [hashtable]$Meta) {
  $metaPath = Get-WorktreeMetaPath $WorktreePath
  $json = $Meta | ConvertTo-Json -Depth 6
  Write-Utf8NoBomFile -Path $metaPath -Content $json
}

function Read-WorktreeMeta([string]$WorktreePath) {
  $metaPath = Get-WorktreeMetaPath $WorktreePath
  if (-not (Test-Path $metaPath)) {
    return $null
  }
  $raw = Get-Content -Raw -Path $metaPath
  return $raw | ConvertFrom-Json
}

function Ensure-CodexIssue([string]$WorktreePath, [string]$Branch, [string]$Locks, [string]$Title, [string]$Focus, [string]$Summary) {
  Require-Command "gh"

  $login = ExecCapture "gh" @("api", "user", "--jq", ".login")
  $owner = if ($login.StartsWith("@")) { $login } else { "@$login" }

  $issueTitle = ""
  if ($null -ne $Title) {
    $issueTitle = $Title.Trim()
  }
  if (-not $issueTitle) {
    $issueTitle = "Codex check-in: $Branch"
  } elseif (-not $issueTitle.ToLowerInvariant().StartsWith("codex check-in:")) {
    $issueTitle = "Codex check-in: $issueTitle"
  }

  $locksLine = ""
  if ($null -ne $Locks) {
    $locksLine = $Locks.Trim()
  }
  if (-not $locksLine) {
    throw "Provide -Locks (comma-separated) unless using -SkipIssue."
  }

  $focusText = ""
  if ($null -ne $Focus) {
    $focusText = $Focus.Trim()
  }
  if (-not $focusText) {
    $focusText = "Parallel Codex run using an isolated git worktree."
  }

  $summaryText = ""
  if ($null -ne $Summary) {
    $summaryText = $Summary.Trim()
  }
  if (-not $summaryText) {
    $summaryText = "Created via scripts/codex-worktree.ps1."
  }

  $body = @"
Owner: $owner
Locks: $locksLine

Focus:
$focusText

Summary:
$summaryText

Worktree:
$ cd $WorktreePath
Branch: $Branch
"@

  Write-Section "Creating Codex check-in issue"
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    Write-Utf8NoBomFile -Path $tmp -Content $body
    $url = ExecCapture "gh" @(
      "issue",
      "create",
      "--title",
      $issueTitle,
      "--body-file",
      $tmp,
      "--label",
      "codex",
      "--label",
      "codex:active"
    )
  } finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $tmp
  }

  $number = ($url.TrimEnd("/") -split "/")[-1]

  return @{
    number = [int]$number
    url = $url
    title = $issueTitle
    owner = $owner
    locks = $locksLine
    focus = $focusText
    summary = $summaryText
  }
}

function Show-Help() {
  Write-Host "Codex worktree helper"
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  powershell -File scripts/codex-worktree.ps1 init   -Name <spawn> -Title <desc> -Locks <csv> [-Focus <text>] [-Summary <text>]"
  Write-Host "  powershell -File scripts/codex-worktree.ps1 finish -Name <spawn> [-Force] [-KeepBranch]"
  Write-Host "  powershell -File scripts/codex-worktree.ps1 list"
  Write-Host "  powershell -File scripts/codex-worktree.ps1 prune"
  Write-Host ""
  Write-Host "Notes:"
  Write-Host "  - Creates worktrees under .worktrees/ (gitignored)."
  Write-Host "  - Creates a Codex check-in issue and stores metadata in .codex-checkin.json (gitignored)."
  Write-Host "  - 'finish' closes the check-in issue and removes the worktree."
  Write-Host "  - 'init' refuses to run from a dirty worktree unless -Force."
}

Require-Command "git"

if ($Command -eq "help") {
  Show-Help
  exit 0
}

$repoRoot = Get-RepoRoot
$script:RepoRoot = $repoRoot
$currentWorktreeRoot = Get-CurrentWorktreeRoot
Write-Preflight -RepoRoot $repoRoot -CurrentWorktreeRoot $currentWorktreeRoot

if ($Command -eq "list") {
  Write-Section "Git worktrees"
  Exec "git" @("-C", $repoRoot, "worktree", "list")
  exit 0
}

if ($Command -eq "prune") {
  Write-Section "Pruning worktrees"
  Exec "git" @("-C", $repoRoot, "worktree", "prune")
  exit 0
}

if ($Command -eq "init") {
  if (-not $Name) {
    throw "Provide -Name (e.g. spawn-1)."
  }

  $dirty = ExecCapture "git" @("-C", $currentWorktreeRoot, "status", "--porcelain")
  if ($dirty -and -not $Force) {
    throw "Current worktree has uncommitted changes. Run 'git status -sb' and commit/stash first, or rerun with -Force."
  }

  $slug = Normalize-Slug $Name
  if (-not $slug) {
    throw "Invalid -Name '$Name'."
  }

  if (($slug -match "^spawn-\\d+$") -and -not $Force) {
    throw "Spawn names must be descriptive (e.g. spawn-2-assets, spawn-3-linkedin-org). Got '$slug'. Rerun with a descriptive -Name, or pass -Force to allow a bare spawn number."
  }

  $worktreesRoot = Get-WorktreesRoot $repoRoot
  Ensure-Directory $worktreesRoot

  $targetPath = Resolve-WorktreePath $repoRoot $slug $WorktreePath
  if (Test-Path $targetPath) {
    if (-not $Force) {
      throw "Worktree path already exists: $targetPath (use -Force to remove it first)"
    }

    Write-Section "Removing existing worktree directory (Force)"
    try {
      Exec "git" @("-C", $repoRoot, "worktree", "remove", "--force", $targetPath)
    } catch {
      Write-Host "Warning: git worktree remove failed (continuing): $($_.Exception.Message)"
    }

    try {
      Exec "cmd" @("/c", "rmdir", "/s", "/q", "`"$targetPath`"")
    } catch {
      Write-Host "Warning: directory delete failed (continuing): $($_.Exception.Message)"
    }
  }

  $branch = Pick-BranchName $slug

  Write-Section "Creating git worktree"
  Exec "git" @("-C", $repoRoot, "worktree", "add", "-b", $branch, $targetPath, $BaseRef)

  $meta = @{
    repoRoot = $repoRoot
    worktreePath = $targetPath
    branch = $branch
    baseRef = $BaseRef
    createdAt = (Get-Date).ToString("o")
  }

  if (-not $SkipIssue) {
    $issue = Ensure-CodexIssue -WorktreePath $targetPath -Branch $branch -Locks $Locks -Title $Title -Focus $Focus -Summary $Summary
    $meta.issue = $issue
  }

  Write-WorktreeMeta -WorktreePath $targetPath -Meta $meta

  Write-Section "Ready"
  Write-Host "Worktree: $targetPath"
  Write-Host "Branch:   $branch"
  if ($meta.issue) {
    Write-Host "Check-in: $($meta.issue.url)"
  }
  Write-Host ""
  Write-Host "Verify identity (recommended before opening PRs):"
  Write-Host "  gh auth status"
  Write-Host "  gh api user --jq .login"
  Write-Host "  git config user.name"
  Write-Host "  git config user.email"
  Write-Host ""
  Write-Host "Avoid PowerShell formatting pitfalls:"
  Write-Host "  - Prefer 'gh pr create --body-file <file>' instead of '--body'."
  Write-Host "  - In PowerShell, use newlines via backtick-n (`n), not literal \\n."
  exit 0
}

if ($Command -eq "finish") {
  $targetPath = if ($Name -or $WorktreePath) {
    Resolve-WorktreePath $repoRoot $Name $WorktreePath
  } else {
    $currentWorktreeRoot
  }
  if (-not (Test-Path $targetPath)) {
    throw "Worktree path not found: $targetPath"
  }

  $meta = Read-WorktreeMeta $targetPath
  if ($meta -and $meta.issue -and -not $SkipIssue) {
    Require-Command "gh"
    $issueNumber = $meta.issue.number
    Write-Section "Closing Codex check-in #$issueNumber"
    $comment = "Work complete; closing check-in. (Worktree: $targetPath, branch: $($meta.branch))"
    if (-not (TryExec "gh" @("issue", "close", "$issueNumber", "--comment", $comment))) {
      Write-Host "Warning: failed to close issue #$issueNumber (it may already be closed)."
    }
  }

  Write-Section "Removing worktree"
  $removed = $false
  if ($Force) {
    $removed = TryExec "git" @("-C", $repoRoot, "worktree", "remove", "--force", $targetPath)
  } else {
    $removed = TryExec "git" @("-C", $repoRoot, "worktree", "remove", $targetPath)
  }

  if (-not $removed -and -not $Force) {
    throw "Failed to remove worktree. Re-run with -Force to remove untracked artifacts (e.g. node_modules)."
  }

  if ($Force -and (Test-Path $targetPath)) {
    Write-Host "Worktree directory still exists; attempting Windows force-delete via rmdir."
    TryExec "cmd" @("/c", "rmdir", "/s", "/q", "`"$targetPath`"") | Out-Null
  }

  if (-not $KeepBranch -and $meta -and $meta.branch) {
    $branch = [string]$meta.branch
    if ($branch -and (Branch-Exists $branch)) {
      Write-Section "Deleting local branch $branch"
      Exec "git" @("-C", $repoRoot, "branch", "-D", $branch)
    }
  }

  Exec "git" @("-C", $repoRoot, "worktree", "prune")

  Write-Section "Done"
  exit 0
}

throw "Unknown command: $Command"
