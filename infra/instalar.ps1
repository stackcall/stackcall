#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Ip,
    [switch]$Atualizar
)

$ErrorActionPreference = 'Stop'

function Get-RandomHex([int]$Length) {
    $bytes = New-Object byte[] $Length
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
        [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    } finally {
        $generator.Dispose()
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Instale o Docker Desktop.'
}
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
    throw 'Instale o curl para conferir a saúde do porteiro.'
}
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Instale o plugin Docker Compose.' }
$engine = docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0 -or $engine -ne 'linux') {
    throw 'Inicie o Docker Desktop no modo de contêineres Linux.'
}

$configDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Stackcall\selfhost'
$envFile = Join-Path $configDir '.env'
$composeFile = Join-Path $PSScriptRoot 'docker-compose.selfhost.yml'
if ($Atualizar) {
    git -C $PSScriptRoot pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível atualizar o checkout do Stackcall.' }
}

if (Test-Path -LiteralPath $envFile) {
    $origin = Get-Content -LiteralPath $envFile |
        Where-Object { $_.StartsWith('SERVIDOR_URL=') } |
        Select-Object -First 1 |
        ForEach-Object { $_.Substring('SERVIDOR_URL='.Length) }
    if ($origin -notmatch '^http://([0-9.]+):8100$') {
        throw 'Confira SERVIDOR_URL no arquivo de configuração existente.'
    }
    if ($Ip -and $Ip -ne $Matches[1]) {
        throw 'O endereço já está salvo. Rode sem -Ip para reutilizá-lo.'
    }
} else {
    if (-not $Ip) {
        $Ip = Find-NetRoute -RemoteIPAddress '192.0.2.1' -ErrorAction SilentlyContinue |
            Where-Object { $_.CimClass.CimClassName -eq 'MSFT_NetIPAddress' } |
            Select-Object -First 1 -ExpandProperty IPAddress
    }
    $address = $null
    if (-not [Net.IPAddress]::TryParse($Ip, [ref]$address) -or
        $address.AddressFamily -ne 'InterNetwork' -or $address.ToString() -ne $Ip -or $Ip -eq '0.0.0.0') {
        throw 'Informe o IPv4 da rede local com -Ip.'
    }
    $origin = "http://${Ip}:8100"

    [IO.Directory]::CreateDirectory($configDir) | Out-Null
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
        $user, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $configDir -AclObject $acl

    $tempFile = Join-Path $configDir ([IO.Path]::GetRandomFileName())
    try {
        [IO.File]::WriteAllLines($tempFile, [string[]]@(
            "LIVEKIT_API_KEY=$(Get-RandomHex 16)"
            "LIVEKIT_API_SECRET=$(Get-RandomHex 32)"
            "LIVEKIT_PUBLIC_URL=ws://${Ip}:8100/rtc"
            'LIVEKIT_EXTERNAL_IP=false'
            "LIVEKIT_NODE_IP=$Ip"
            "SERVIDOR_URL=$origin"
            "STACKCALL_BIND_IP=$Ip"
            'CADDY_PORT=8100'
            'CADDY_SITE=selfhost-local.caddy'
        ))
        [IO.File]::Move($tempFile, $envFile)
    } finally {
        if (Test-Path -LiteralPath $tempFile) { Remove-Item -LiteralPath $tempFile }
    }
}

$compose = @('compose', '--project-name', 'stackcall-selfhost', '--env-file', $envFile, '-f', $composeFile)
Write-Output 'Na rede local: 8100/tcp, 7881/tcp, 7882/udp.'
docker @compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'O Docker Compose recusou a configuração.' }
$up = @('-d', '--build')
if ($Atualizar) {
    docker @compose pull --ignore-buildable
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível baixar as imagens.' }
    $up += '--force-recreate'
}
docker @compose up @up
if ($LASTEXITCODE -ne 0) { throw 'O Docker Compose não conseguiu subir os serviços.' }

$timer = [Diagnostics.Stopwatch]::StartNew()
while ($timer.Elapsed.TotalSeconds -lt 90) {
    # Use o curl nativo para evitar que um proxy do Windows intercepte a checagem da LAN.
    curl.exe --noproxy '*' -fs --max-time 3 "$origin/api/health" | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Output "Porteiro pronto em $origin"
        $logs = docker @compose logs --no-color --no-log-prefix porteiro
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível ler o log do porteiro.' }
        $invite = $logs | ForEach-Object {
            if ($_ -cmatch '^(?:CONVITE_DONO=|Convite do dono: )(https?://\S+/c/\S+)$') { $Matches[1] }
        } | Select-Object -Last 1
        if ($invite) {
            Write-Output "Convite do dono (uso privado): $invite"
        } else {
            Write-Output 'O porteiro não publicou um novo convite do dono.'
        }
        return
    }
    Start-Sleep -Seconds 2
}
throw 'O porteiro não respondeu em /api/health. Confira o Docker Desktop e o endereço da rede local.'
