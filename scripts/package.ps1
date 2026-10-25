$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = Join-Path $taskRoot 'release'
$stagePath = [IO.Path]::GetFullPath((Join-Path $releaseRoot 'Snap-Vanish'))
if (-not $stagePath.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging path' }
if (Test-Path -LiteralPath $stagePath) { Remove-Item -LiteralPath $stagePath -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stagePath | Out-Null
foreach ($entry in @('manifest.json','README.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md','docs','background','content','injected','engine','popup','studio','icons','vendor','models')) {
  Copy-Item -LiteralPath (Join-Path $taskRoot $entry) -Destination $stagePath -Recurse
}
$zipPath = Join-Path $taskRoot 'snap-vanish.zip'
Compress-Archive -Path (Join-Path $stagePath '*') -DestinationPath $zipPath -Force
Write-Output ('Packaged: ' + $zipPath)
Write-Output ('Unpacked extension: ' + $stagePath)
