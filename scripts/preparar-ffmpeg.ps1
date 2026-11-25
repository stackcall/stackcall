param([switch]$OnlyDownload)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# BtbN removes most daily builds. Use the retained end-of-month release.
$tag = 'autobuild-2026-10-31-12-59'
$build = 'ffmpeg-n9.0.2-39-g7adfbe40dc-win64-lgpl-shared-9.0'
$sha256 = 'e907b01fa4783913151237e37df2a10fa97d99a1598a021bf59d4ae62ffed4c0'
$url = "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/$tag/$build.zip"
$cache = Join-Path $env:LOCALAPPDATA "StackcallBuild/$tag"
$archive = Join-Path $cache "$build.zip"
$ffmpeg = Join-Path $cache $build
$repo = Split-Path $PSScriptRoot -Parent

function Get-Sha256([string]$Path) {
    $file = [System.IO.File]::OpenRead($Path)
    try {
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        try {
            [System.BitConverter]::ToString($algorithm.ComputeHash($file)).Replace('-', '')
        } finally {
            $algorithm.Dispose()
        }
    } finally {
        $file.Dispose()
    }
}

function Get-VerifiedFile($Uri, $Destination, $Hash) {
    if ((Test-Path -LiteralPath $Destination) -and (Get-Sha256 $Destination) -eq $Hash) { return }
    $download = "$Destination.$PID.download"
    try {
        curl.exe --fail --location --silent --show-error --retry 3 --output $download $Uri
        if ($LASTEXITCODE -ne 0) { throw "Falha no download: $Uri" }
        if ((Get-Sha256 $download) -ne $Hash) {
            throw "O SHA-256 diverge do valor fixado: $Uri"
        }
        Move-Item -LiteralPath $download -Destination $Destination -Force
    } finally {
        if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download }
    }
}
New-Item -ItemType Directory -Force -Path $cache | Out-Null
Get-VerifiedFile $url $archive $sha256
if (!(Test-Path -LiteralPath (Join-Path $ffmpeg '.verified'))) {
    Expand-Archive -LiteralPath $archive -DestinationPath $cache -Force
    Set-Content -LiteralPath (Join-Path $ffmpeg '.verified') -Value $sha256
}

$env:FFMPEG_DIR = $ffmpeg
$env:Path = "$(Join-Path $ffmpeg 'bin');$env:Path"
if (!$env:LIBCLANG_PATH) {
    $llvm = Join-Path $env:ProgramFiles 'LLVM/bin'
    if (Test-Path -LiteralPath (Join-Path $llvm 'libclang.dll')) { $env:LIBCLANG_PATH = $llvm }
}
if ($OnlyDownload) { return }

$sidecar = Join-Path $repo 'app/src-tauri/sidecar'
New-Item -ItemType Directory -Force -Path $sidecar | Out-Null
$dlls = @('avcodec-63.dll', 'avformat-63.dll', 'avutil-61.dll', 'swscale-10.dll', 'swresample-7.dll')
foreach ($dll in $dlls) {
    Copy-Item -LiteralPath (Join-Path "$ffmpeg/bin" $dll) -Destination $sidecar
}
Copy-Item -LiteralPath (Join-Path $ffmpeg 'LICENSE.txt') -Destination (Join-Path $sidecar 'FFmpeg-LGPL.txt')
$gpl = Join-Path $cache 'FFmpeg-GPL.txt'
Get-VerifiedFile 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/7adfbe40dc/COPYING.GPLv3' $gpl `
    '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'
Copy-Item -LiteralPath $gpl -Destination $sidecar

$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $temp 'sc-target' }
$previousFlags = $env:RUSTFLAGS
try {
    $env:RUSTFLAGS = "$previousFlags -C target-feature=+crt-static -C link-arg=/STACK:16777216".Trim()
    cargo build --locked --release --target-dir $target --manifest-path (Join-Path $repo 'core/Cargo.toml')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o nucleo do Stackcall.' }
} finally {
    $env:RUSTFLAGS = $previousFlags
}
Copy-Item -LiteralPath (Join-Path $target 'release/stackcall-core.exe') `
    -Destination (Join-Path $sidecar 'stackcall-core-x86_64-pc-windows-msvc.exe')
