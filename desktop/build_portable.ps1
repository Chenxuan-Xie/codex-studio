param(
    [string]$ElectronRoot = "D:\DSH\runtime\electron",
    [string]$PythonRoot = "D:\Deepseek Harness\resources\runtime\primary-runtime\dependencies\python",
    [string]$OutputDirectory = "D:\CodexStudio\dist\CodexStudio-win-x64"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$desktop = Join-Path $root "desktop"
$output = [IO.Path]::GetFullPath($OutputDirectory)

if (Test-Path $output) { Remove-Item -Recurse -Force $output }
New-Item -ItemType Directory -Force -Path $output | Out-Null

# Use the generic Electron runtime, not the DS H application executable.
Copy-Item (Join-Path $ElectronRoot "electron.exe") (Join-Path $output "CodexStudio.exe")
$files = @(
    "chrome_100_percent.pak", "chrome_200_percent.pak", "d3dcompiler_47.dll",
    "dxcompiler.dll", "dxil.dll", "ffmpeg.dll", "icudtl.dat",
    "libEGL.dll", "libGLESv2.dll", "resources.pak", "snapshot_blob.bin",
    "v8_context_snapshot.bin", "vk_swiftshader.dll", "vk_swiftshader_icd.json",
    "vulkan-1.dll", "LICENSE", "LICENSES.chromium.html", "version"
)
foreach ($file in $files) {
    $src = Join-Path $ElectronRoot $file
    if (Test-Path $src) { Copy-Item $src (Join-Path $output $file) }
}
Copy-Item (Join-Path $ElectronRoot "locales") (Join-Path $output "locales") -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $output "resources") | Out-Null

$app = Join-Path $output "resources\app"
New-Item -ItemType Directory -Force -Path $app | Out-Null
Copy-Item (Join-Path $root "server.py") $app
Copy-Item (Join-Path $root "static") $app -Recurse
Copy-Item (Join-Path $root "config.json") $app
$portableRaw = [IO.File]::ReadAllText((Join-Path $root "config.json"), [Text.Encoding]::UTF8)
$portableRaw = $portableRaw.Replace('"data_dir": "D:\\CodexStudio\\data"', '"data_dir": "D:\\CodexStudioAppData\\data"')
[IO.File]::WriteAllText((Join-Path $app "config.json"), $portableRaw, (New-Object Text.UTF8Encoding($false)))
Copy-Item (Join-Path $root "config.example.json") $app
Copy-Item (Join-Path $root "README.md") $app
Copy-Item (Join-Path $root "LICENSE") $app
Copy-Item (Join-Path $desktop "main.js") $app
Copy-Item (Join-Path $desktop "package.json") $app
Copy-Item (Join-Path $desktop "splash.html") $app
Copy-Item (Join-Path $desktop "icon.png") $app
Copy-Item (Join-Path $desktop "icon.ico") $app
Copy-Item (Join-Path $desktop "shortcuts.ps1") $app
Copy-Item $PythonRoot (Join-Path $app "python") -Recurse
Copy-Item (Join-Path $desktop "README-portable.txt") $output
Copy-Item (Join-Path $desktop "CodexStudio.cmd") $output
Copy-Item (Join-Path $desktop "shortcuts.ps1") $output
Copy-Item (Join-Path $desktop "icon.ico") $output

Write-Host "Built: $output"
Write-Host ("Size: {0:N0} MB" -f ((Get-ChildItem $output -Recurse -File | Measure-Object Length -Sum).Sum / 1MB))
