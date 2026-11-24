# Gera as imagens do instalador NSIS no padrão Pôster: papel com grade, tinta e o ícone.
# Saída: app/src-tauri/instalador/{cabecalho,lateral}.bmp (tamanhos exigidos pelo NSIS).
# Rode de novo depois de mudar docs/marca/icone.svg e `npx tauri icon`.
# Impact é a fonte condensada do Windows mais próxima de Anton (o NSIS só aceita bitmap).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$raiz = Split-Path $PSScriptRoot -Parent
$saida = Join-Path $raiz 'app/src-tauri/instalador'
New-Item -ItemType Directory -Force $saida | Out-Null
$icone = [System.Drawing.Image]::FromFile((Join-Path $raiz 'app/src-tauri/icons/icon.png'))

$papel = [System.Drawing.ColorTranslator]::FromHtml('#f4f4f1')
$grade = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#e7e7e2'))
$tinta = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#111111'))
$vermelho = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#c8191f'))
$lima = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#c8f03c'))

function Novo-Quadro([int]$largura, [int]$altura) {
    $bmp = New-Object System.Drawing.Bitmap $largura, $altura, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear($papel)
    for ($x = 0; $x -lt $largura; $x += 20) { $g.DrawLine($grade, $x, 0, $x, $altura) }
    for ($y = 0; $y -lt $altura; $y += 20) { $g.DrawLine($grade, 0, $y, $largura, $y) }
    return @($bmp, $g)
}

function Escrever-Marca($g, [float]$tamanho, [float]$x, [float]$y) {
    $fonte = New-Object System.Drawing.Font 'Impact', $tamanho, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
    $formato = [System.Drawing.StringFormat]::GenericTypographic
    $g.DrawString('STACK', $fonte, $tinta, $x, $y, $formato)
    $largura = $g.MeasureString('STACK', $fonte, 1000, $formato).Width
    $g.DrawString('CALL', $fonte, $vermelho, $x + $largura, $y, $formato)
}

# Cabeçalho 150x57: fica à direita do título de cada página.
$bmp, $g = Novo-Quadro 150 57
$g.DrawImage($icone, 104, 8, 40, 40)
Escrever-Marca $g 19 8 18
$bmp.Save((Join-Path $saida 'cabecalho.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $bmp.Dispose()

# Lateral 164x314: boas-vindas e fim da instalação.
$bmp, $g = Novo-Quadro 164 314
$g.DrawImage($icone, 20, 24, 72, 72)
$fonte = New-Object System.Drawing.Font 'Impact', 46, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('STACK', $fonte, $tinta, 18, 110, [System.Drawing.StringFormat]::GenericTypographic)
$g.DrawString('CALL', $fonte, $vermelho, 18, 156, [System.Drawing.StringFormat]::GenericTypographic)
$g.FillRectangle($lima, 20, 218, 124, 6)
$g.FillRectangle($tinta, 0, 274, 164, 40)
$fonte = New-Object System.Drawing.Font 'Consolas', 11, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('VOZ / TELA / CHAT', $fonte, (New-Object System.Drawing.SolidBrush $papel), 20, 288)
$bmp.Save((Join-Path $saida 'lateral.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $bmp.Dispose()
$icone.Dispose()
Write-Output "Imagens em $saida"
