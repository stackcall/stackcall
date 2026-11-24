[CmdletBinding()]
param(
    [string]$TargetHost = 'stackcall.80-190-79-129.sslip.io',
    [string]$Ip,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $false
$client = New-Object System.Net.Http.HttpClient -ArgumentList $handler
$client.Timeout = [TimeSpan]::FromSeconds(10)
$url = "https://$TargetHost/api/rtt"

try {
    $samples = @(for ($i = 0; $i -lt 30; $i++) {
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $response = $client.GetAsync($url).GetAwaiter().GetResult()
        $timer.Stop()
        try {
            if ([int]$response.StatusCode -ne 204) {
                throw "Amostra $($i + 1): HTTP $([int]$response.StatusCode) em $url"
            }
            $timer.Elapsed.TotalMilliseconds
        } finally {
            $response.Dispose()
        }
    })
} finally {
    $client.Dispose()
}

$sorted = @($samples | Sort-Object)
$icmpMs = $null
$ping = New-Object System.Net.NetworkInformation.Ping
try {
    if (-not $Ip) {
        $Ip = [Net.Dns]::GetHostAddresses($TargetHost) |
            Where-Object AddressFamily -eq InterNetwork |
            Select-Object -First 1 -ExpandProperty IPAddressToString
    }
    if ($Ip) {
        $reply = $ping.Send($Ip, 2000)
        if ($reply.Status -eq 'Success') {
            $icmpMs = $reply.RoundtripTime
        }
    }
} catch {
    Write-Verbose "ICMP indisponivel: $_"
} finally {
    $ping.Dispose()
}

$result = [pscustomobject][ordered]@{
    url = $url
    maquina = $env:COMPUTERNAME
    data = (Get-Date).ToString('o')
    amostras = $samples.Count
    minimo_ms = [Math]::Round($sorted[0], 2)
    mediana_ms = [Math]::Round(($sorted[14] + $sorted[15]) / 2, 2)
    p95_ms = [Math]::Round($sorted[([int][Math]::Ceiling(0.95 * $sorted.Count) - 1)], 2)
    ip = $Ip
    icmp_ms = $icmpMs
}

if ($Json) {
    $result | ConvertTo-Json
} else {
    $result | Format-List | Out-String
    if ($null -eq $icmpMs) { 'ICMP indisponivel.' }
}
