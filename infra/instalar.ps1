param(
    [string]$Ip,
    [string]$Diretorio = (Join-Path $env:LOCALAPPDATA 'Stackcall\Servidor')
)

$ErrorActionPreference = 'Stop'

function New-Hex([int]$Length) {
    $buffer = New-Object byte[] $Length
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($buffer)
        [BitConverter]::ToString($buffer).Replace('-', '').ToLowerInvariant()
    } finally {
        $random.Dispose()
    }
}

docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Inicie o Docker Desktop com contêineres Linux.' }
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Instale o Docker Compose v2.24.4 ou mais recente.' }

New-Item -ItemType Directory -Path $Diretorio -Force | Out-Null
$Diretorio = (Resolve-Path -LiteralPath $Diretorio).Path
$infra = $PSScriptRoot
if (!$infra -or !(Test-Path -LiteralPath (Join-Path $infra 'docker-compose.selfhost.yml'))) {
    $source = Join-Path $Diretorio 'source'
    $infra = Join-Path $source 'infra'
    if (!(Test-Path -LiteralPath (Join-Path $infra 'docker-compose.selfhost.yml'))) {
        git clone --depth 1 https://github.com/stackcall/stackcall.git $source
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível baixar o Stackcall.' }
    }
}

$envFile = Join-Path $Diretorio '.env'
if (!(Test-Path -LiteralPath $envFile)) {
    if (!$Ip) {
        $adapter = Get-NetIPConfiguration |
            Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } |
            Select-Object -First 1
        $Ip = $adapter.IPv4Address.IPAddress | Select-Object -First 1
    }
    $address = $null
    if ($Ip -notmatch '^(\d{1,3}\.){3}\d{1,3}$' -or
        ![Net.IPAddress]::TryParse($Ip, [ref]$address) -or $address.ToString() -ne $Ip -or $Ip -eq '0.0.0.0') {
        throw 'Informe um IPv4 local em -Ip.'
    }

    $livekit = (Join-Path $Diretorio 'livekit.yaml').Replace('\', '/')
    @"
port: 7880
bind_addresses: ["0.0.0.0"]
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  node_ip: $Ip
"@ | Set-Content -LiteralPath $livekit -Encoding Ascii

    $tempEnv = Join-Path $Diretorio ([IO.Path]::GetRandomFileName())
    New-Item -ItemType File -Path $tempEnv | Out-Null
    try {
        $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $rights = [Security.AccessControl.FileSystemRights]::FullControl
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($user, $rights, [Security.AccessControl.AccessControlType]::Allow)
        $acl = New-Object Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true, $false)
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $tempEnv -AclObject $acl

        $settings = @"
LIVEKIT_API_KEY=$(New-Hex 16)
LIVEKIT_API_SECRET=$(New-Hex 32)
LIVEKIT_PUBLIC_URL=ws://${Ip}:8100/rtc
INSTANCIA_URL=http://${Ip}:8100
MODO_CADASTRO=convite
LIVEKIT_CONFIG='$livekit'
CADDY_BIND_IP=$Ip
CADDY_PORT=8100
CADDY_CONFIG=local.caddy
"@
        [IO.File]::WriteAllText($tempEnv, $settings + "`n", [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $tempEnv -Destination $envFile
    } finally {
        if (Test-Path -LiteralPath $tempEnv) { Remove-Item -LiteralPath $tempEnv }
    }
}

if (!(Select-String -LiteralPath $envFile -Pattern '^CADDY_CONFIG=local\.caddy$' -Quiet)) {
    throw 'Use um diretório de configuração exclusivo para a instalação local.'
}

$project = if ($env:COMPOSE_PROJECT_NAME) { $env:COMPOSE_PROJECT_NAME } else { 'stackcall' }
$compose = @('compose', '--project-name', $project, '--env-file', $envFile,
    '-f', (Join-Path $infra 'docker-compose.yml'),
    '-f', (Join-Path $infra 'docker-compose.selfhost.yml'),
    '-f', (Join-Path $infra 'docker-compose.local.yml'))

docker @compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'A configuração do Compose é inválida.' }
docker @compose up -d --build --wait
if ($LASTEXITCODE -ne 0) { throw 'O Docker Compose não iniciou o Stackcall.' }

for ($i = 0; $i -lt 30; $i++) {
    $logs = @(docker @compose logs --no-color --no-log-prefix porteiro 2>&1)
    if ($logs -match '^Porteiro ouvindo em') {
        Write-Host 'Na rede local: 8100/tcp, 7881/tcp e 7882/udp.'
        $logs | Where-Object { $_ -match '^Convite do primeiro admin: ' } | Select-Object -First 1
        exit 0
    }
    Start-Sleep -Seconds 1
}
throw 'O porteiro não iniciou. Confira o estado com docker compose ps.'
