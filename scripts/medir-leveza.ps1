#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('parado', 'voz', 'transmitindo', 'assistindo')]
    [string]$Situacao,

    [ValidateRange(1, 2147483647)]
    [int]$Segundos = 60
)

$ErrorActionPreference = 'Stop'

function Get-StackcallSample([hashtable]$WebViews) {
    $byId = $null
    $sample = @{}
    foreach ($process in Get-Process -Name stackcall, stackcall-core, msedgewebview2 -ErrorAction SilentlyContinue) {
        try {
            $created = $process.StartTime
            $cpu = $process.TotalProcessorTime
            $workingSet = $process.WorkingSet64
        } catch {
            # Um processo pode terminar durante a leitura ou estar inacessível para este usuário.
            continue
        }
        if ($null -eq $created -or $null -eq $cpu) { continue }
        $key = "$($process.Id):$($created.Ticks)"

        if ($process.ProcessName -eq 'stackcall-core') {
            $group = 'Core'
        } elseif ($process.ProcessName -eq 'stackcall') {
            $group = 'App'
        } else {
            if (-not $WebViews.ContainsKey($key)) {
                if ($null -eq $byId) {
                    $byId = @{}
                    foreach ($item in Get-CimInstance -ClassName Win32_Process -Property Name, ProcessId, ParentProcessId, CreationDate) {
                        $byId[[int]$item.ProcessId] = $item
                    }
                }
                $child = $byId[$process.Id]
                $belongsToApp = $false
                while ($child -and $child.ParentProcessId -ne $child.ProcessId) {
                    $parent = $byId[[int]$child.ParentProcessId]
                    if (-not $parent -or $parent.CreationDate -gt $child.CreationDate) { break }
                    if ($parent.Name -eq 'stackcall.exe') {
                        $belongsToApp = $true
                        break
                    }
                    $child = $parent
                }
                $WebViews[$key] = $belongsToApp
            }
            if (-not $WebViews[$key]) { continue }
            $group = 'App'
        }
        $sample[$key] = @{
            Group = $group
            CpuTicks = $cpu.Ticks
            WorkingSet = $workingSet
            Created = $created
        }
    }
    return $sample
}

$clock = [Diagnostics.Stopwatch]::StartNew()
$webViews = @{}
$previous = Get-StackcallSample $webViews
$previousTime = $clock.Elapsed
$previousDate = Get-Date
if ('App' -notin $previous.Values.Group) {
    throw 'Abra o Stackcall antes de iniciar a medição.'
}
$firstTime = $previousTime
$started = $previousDate

$rows = for ($index = 1; $index -le $Segundos; $index++) {
    $delay = ($previousTime.TotalSeconds + 1 - $clock.Elapsed.TotalSeconds) * 1000
    if ($delay -gt 0) { Start-Sleep -Milliseconds ([int]$delay) }

    $current = Get-StackcallSample $webViews
    $now = $clock.Elapsed
    $date = Get-Date
    $ticks = @{ App = 0.0; Core = 0.0 }
    $memory = @{ App = 0.0; Core = 0.0 }
    foreach ($entry in $current.GetEnumerator()) {
        $process = $entry.Value
        $memory[$process.Group] += $process.WorkingSet
        if ($previous.ContainsKey($entry.Key)) {
            $ticks[$process.Group] += [Math]::Max(0, $process.CpuTicks - $previous[$entry.Key].CpuTicks)
        } elseif ($process.Created -ge $previousDate) {
            $ticks[$process.Group] += $process.CpuTicks
        }
    }
    $capacity = ($now - $previousTime).Ticks * [Environment]::ProcessorCount
    $appCpu = 100 * $ticks.App / $capacity
    $coreCpu = 100 * $ticks.Core / $capacity
    [pscustomobject]@{
        Instante = $date.ToString('o')
        Segundos = [Math]::Round(($now - $firstTime).TotalSeconds, 3)
        AppCpuPct = [Math]::Round($appCpu, 3)
        AppMemoriaMB = [Math]::Round($memory.App / 1MB, 2)
        CoreCpuPct = [Math]::Round($coreCpu, 3)
        CoreMemoriaMB = [Math]::Round($memory.Core / 1MB, 2)
        TotalCpuPct = [Math]::Round($appCpu + $coreCpu, 3)
        TotalMemoriaMB = [Math]::Round(($memory.App + $memory.Core) / 1MB, 2)
    }
    $previous = $current
    $previousTime = $now
    $previousDate = $date
}

$directory = Join-Path (Split-Path $PSScriptRoot -Parent) 'docs/medidas'
[IO.Directory]::CreateDirectory($directory) | Out-Null
$stem = Join-Path $directory "$($started.ToString('yyyy-MM-dd-HHmmss-fff'))-$($Situacao.ToLowerInvariant())"
$csv = "$stem.csv"
$report = "$stem.md"
$rows | Export-Csv -LiteralPath $csv -NoTypeInformation -Encoding UTF8

$lines = @(
    "# Medição de leveza — $Situacao"
    ''
    "Início em $($started.ToString('yyyy-MM-dd HH:mm:ss zzz')), com $Segundos amostra(s) em intervalos de 1 s."
    ''
    '| Processo | CPU média (%) | CPU pico (%) | Memória média (MB) | Memória pico (MB) |'
    '|---|---:|---:|---:|---:|'
)
foreach ($group in @(
    @{ Prefix = 'App'; Label = 'Stackcall + WebView2' }
    @{ Prefix = 'Core'; Label = 'stackcall-core' }
    @{ Prefix = 'Total'; Label = 'Total' }
)) {
    $cpu = $rows | Measure-Object -Property "$($group.Prefix)CpuPct" -Average -Maximum
    $ram = $rows | Measure-Object -Property "$($group.Prefix)MemoriaMB" -Average -Maximum
    $lines += '| {0} | {1:F3} | {2:F3} | {3:F2} | {4:F2} |' -f $group.Label, $cpu.Average, $cpu.Maximum, $ram.Average, $ram.Maximum
}
$lines += @(
    ''
    'A CPU usa a capacidade total dos processadores lógicos. Processos encerrados entre amostras podem ficar fora da conta.'
    'A memória soma os conjuntos de trabalho dos processos (1 MB = 1.048.576 bytes), incluindo páginas compartilhadas.'
    ''
    "[$([IO.Path]::GetFileName($csv))]($([IO.Path]::GetFileName($csv)))"
)
$lines | Set-Content -LiteralPath $report -Encoding UTF8
Write-Output "Medição gravada em $report"
