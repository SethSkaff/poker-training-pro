[CmdletBinding()]
param(
    [string]$ShortcutPath
)

$projectRoot = (Resolve-Path -LiteralPath (Join-Path -Path $PSScriptRoot -ChildPath '..')).Path
$targetPath = Join-Path -Path $projectRoot -ChildPath 'outputs\current\win-unpacked\Poker Training Pro.exe'

if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
    throw "The approved unpacked build does not exist: $targetPath. Run npm run package:win first."
}

if ([string]::IsNullOrWhiteSpace($ShortcutPath)) {
    $desktopCandidates = @(
        [Environment]::GetFolderPath('Desktop'),
        (Join-Path -Path $env:USERPROFILE -ChildPath 'OneDrive\Desktop'),
        (Join-Path -Path $env:USERPROFILE -ChildPath 'Desktop')
    ) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Container) } |
        Select-Object -Unique

    $ShortcutPath = $desktopCandidates |
        ForEach-Object { Join-Path -Path $_ -ChildPath 'Poker Training Pro.lnk' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1

    if ([string]::IsNullOrWhiteSpace($ShortcutPath)) {
        $desktop = $desktopCandidates | Select-Object -First 1
        if ([string]::IsNullOrWhiteSpace($desktop)) {
            throw 'Could not locate a Desktop folder for the Poker Training Pro shortcut.'
        }
        $ShortcutPath = Join-Path -Path $desktop -ChildPath 'Poker Training Pro.lnk'
    }
}

$ShortcutPath = [IO.Path]::GetFullPath($ShortcutPath)
$shortcutDirectory = Split-Path -Path $ShortcutPath -Parent
if (-not (Test-Path -LiteralPath $shortcutDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $shortcutDirectory -Force | Out-Null
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = Split-Path -Path $targetPath -Parent
$shortcut.Description = 'Poker Training Pro (latest approved build)'
$shortcut.Save()

[PSCustomObject]@{
    Shortcut = $ShortcutPath
    Target = $targetPath
} | Format-List
