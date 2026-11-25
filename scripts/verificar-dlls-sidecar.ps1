$ErrorActionPreference = 'Stop'

$tauri = Join-Path (Split-Path $PSScriptRoot -Parent) 'app/src-tauri'
$config = Get-Content -LiteralPath (Join-Path $tauri 'tauri.conf.json') -Raw | ConvertFrom-Json
$core = Get-Item -LiteralPath (Join-Path $tauri 'sidecar/stackcall-core-x86_64-pc-windows-msvc.exe')
$dlls = @{}
foreach ($resource in $config.bundle.resources.PSObject.Properties) {
    if ($resource.Name -like 'sidecar/*.dll' -and $resource.Value -like '*.dll') {
        $dlls[$resource.Value] = Get-Item -LiteralPath (Join-Path $tauri $resource.Name)
    }
}
if (!$dlls.ContainsKey('avformat-63.dll')) { throw 'O muxer de clipes precisa de avformat-63.dll no pacote.' }

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$dumpbin = & $vswhere -latest -products '*' -find 'VC/Tools/MSVC/**/bin/Hostx64/x64/dumpbin.exe' |
    Select-Object -First 1
if (!$dumpbin) { throw 'dumpbin.exe do Visual Studio nao encontrado.' }

$missing = foreach ($file in (@($core) + @($dlls.Values))) {
    $output = & $dumpbin /nologo /dependents $file.FullName
    if ($LASTEXITCODE -ne 0) { throw "dumpbin falhou para $($file.Name)." }

    $imports = $output | ForEach-Object {
        if ($_ -match '^\s+([^\\/:*?"<>|]+\.dll)\s*$') { $Matches[1].Trim() }
    } | Sort-Object -Unique
    if (!$imports) { throw "Nenhum import de DLL encontrado em $($file.Name)." }
    Write-Host "$($file.Name) -> $($imports -join ', ')"

    foreach ($dll in $imports) {
        if ($dlls.ContainsKey($dll) -or $dll -match '^(api|ext)-ms-win-') { continue }
        $systemDll = Get-Item -LiteralPath (Join-Path ([Environment]::SystemDirectory) $dll) `
            -ErrorAction SilentlyContinue
        # The localized product name for the Windows property system can be Windows Search.
        if ($systemDll -and $dll -eq 'propsys.dll') { continue }
        # System32 can also contain separately installed runtimes such as the VC++ redistributable.
        if ($systemDll.VersionInfo.ProductName -notmatch 'Microsoft.*Windows') {
            "$($file.Name) -> $dll"
        }
    }
}

if ($missing) { throw "DLLs ausentes do pacote do sidecar: $($missing -join ', ')." }
