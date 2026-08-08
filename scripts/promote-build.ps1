param(
  [switch]$Force
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputsRoot = Join-Path $projectRoot "outputs"
$currentPath = Join-Path $outputsRoot "current"
$nextPath = Join-Path $outputsRoot "next"

if (-not (Test-Path -LiteralPath $nextPath -PathType Container)) {
  throw "No candidate build exists at outputs\next. Run npm run package:win first."
}

$candidateExe = Join-Path $nextPath "win-unpacked\Poker Training Pro.exe"
if (-not (Test-Path -LiteralPath $candidateExe -PathType Leaf)) {
  throw "Candidate build is incomplete: outputs\next\win-unpacked\Poker Training Pro.exe was not found."
}

if ((Test-Path -LiteralPath $currentPath) -and -not $Force) {
  throw "outputs\current already exists. Re-run with -Force only after the candidate has been approved."
}

if ((Resolve-Path -LiteralPath $outputsRoot).Path -ne $outputsRoot) {
  throw "Unexpected outputs root; refusing to rotate builds."
}

if (Test-Path -LiteralPath $currentPath) {
  Remove-Item -LiteralPath $currentPath -Recurse -Force
}

Move-Item -LiteralPath $nextPath -Destination $currentPath
Write-Output "Promoted outputs\next to outputs\current."
Write-Output "Desktop shortcut target remains outputs\current\win-unpacked\Poker Training Pro.exe."
