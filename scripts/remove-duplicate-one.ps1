param(
    [string]$Root = ".",
    [switch]$Apply,
    [switch]$IncludeDirectories
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-NewName {
    param([string]$Name)
    return ($Name -replace '\(1\)', '')
}

$rootPath = Resolve-Path -Path $Root
Write-Host "Root: $rootPath"
Write-Host ("Mode: " + ($(if ($Apply) { "APPLY (renaming)" } else { "DRY RUN (no changes)" })))

$items = @()

# Files (always)
$items += Get-ChildItem -Path $rootPath -Recurse -File -Force

# Optional directories
if ($IncludeDirectories) {
    $items += Get-ChildItem -Path $rootPath -Recurse -Directory -Force
}

# Rename deepest paths first so child paths are stable if directories are included
$items = $items | Sort-Object { $_.FullName.Length } -Descending

$renamed = 0
$skipped = 0
$collisions = 0

foreach ($item in $items) {
    $oldName = $item.Name
    $newName = Get-NewName -Name $oldName

    if ($newName -eq $oldName) {
        continue
    }

    if ([string]::IsNullOrWhiteSpace($newName)) {
        Write-Warning "Skipping empty target name: $($item.FullName)"
        $skipped++
        continue
    }

    $parentPath =
      if ($item.PSIsContainer) { $item.Parent.FullName }
      else { $item.DirectoryName }

    $targetPath = Join-Path -Path $parentPath -ChildPath $newName

    if (Test-Path -LiteralPath $targetPath) {
        Write-Warning "Collision, skipping: '$($item.FullName)' -> '$targetPath'"
        $collisions++
        continue
    }

    if ($Apply) {
        Rename-Item -LiteralPath $item.FullName -NewName $newName
        Write-Host "Renamed: '$($item.FullName)' -> '$targetPath'"
    } else {
        Write-Host "Would rename: '$($item.FullName)' -> '$targetPath'"
    }

    $renamed++
}

Write-Host ""
Write-Host "Done."
Write-Host "  Renamed/Would rename: $renamed"
Write-Host "  Collisions skipped:    $collisions"
Write-Host "  Other skipped:         $skipped"

if (-not $Apply) {
    Write-Host ""
    Write-Host "Run again with -Apply to perform the rename."
}
