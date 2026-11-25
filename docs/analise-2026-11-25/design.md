# Stackcall v0.3.0: revisão de design/UX (somente leitura)

Base: padrao-pessoal (Pôster), craft-floor, prints 58/59/60 (1920x1080, escuro) e docs/prints/v03 (1440x900, claro e escuro).
Esforço: P = menos de 1 h, M = meio dia, G = 1 dia ou mais. Caminhos relativos a `E:\Repo\Pessoal\stackcall\app`.

Medidas que valem para o desenho: janela mínima 1100x700 (`src-tauri/tauri.conf.json:19-20`), barra de atualização 48 px (`components/UpdateBanner.tsx:17`) e barra de título nativa. Área útil mínima da tela "Entrar no ar" é cerca de 1100x650. O resto do desenho parte desse número.

---

## 1. Nova tela "Entrar no ar" (spec)

### Causa do problema atual (`src/screens/GoLive.tsx`)
- L167: o overlay tem `overflow-y-auto` e uma grade de 2 colunas sem altura própria. A coluna esquerda cresce com o número de fontes (9 fontes x 159 px = 800 px) e empurra a página.
- L286: a barra de ação (`mt-auto`) mora no fim da coluna direita, dentro da rolagem. Por isso some.
- L225-296: a coluna direita termina no último preset e deixa o resto vazio (print 58, abaixo de y=445).
- L178: miniatura com `object-contain` em 104 px de altura gera tarja preta de 100 px de cada lado. O tile é 408 px de largura para uma imagem de 185 px.

### Estrutura (sem rolagem de página)
Overlay `absolute inset-0 grid grid-rows-[auto_minmax(0,1fr)_auto] bg-fundo`, sem `overflow-y-auto` na raiz. Três faixas:

```
+--------------------------------------------------------------------------------+
| / SALA GERAL · NINGUEM NA SALA AINDA                                      (A)  |  cabeçalho ~84 px
| ENTRAR NO AR   Escolha a fonte e a qualidade. Os números vêm do teste.         |
+----------------------------------------+---------------------------------------+
| FONTE · 9                  [Atualizar] | PREVIA · Tela 1                1920x1080 |  (B)
| [ Buscar tela ou janela ........... ]  | +-----------------------------------+ |
| [Tudo] [Telas] [Janelas] [Jogos]       | |                                   | |
| ---------------------------------------| |   miniatura 16:9, ao vivo,        | |
| TELAS                                  | |   flex-1, min 150 px              | |
| [thumb][thumb]                         | +-----------------------------------+ |
| JANELAS                                +---------------------------------------+
| [thumb][thumb][thumb]  <- rola AQUI    | QUALIDADE ESCOLHIDA   upload 26 Mb/s  |  (C)
| [thumb][thumb][thumb]                  | 1080P 30fps | UPLOAD 3,2 | PLACA 6% | |
|                                        | barra de carga · texto e área de trab.|
|                                        +---------------------------------------+
|                                        | PRESETS                  [Refazer teste]|  (D)
|                                        | 720P  30  1,4 Mb/s · 0,6 GB/h  escolhido|
|                                        | 1080P 30  3,2 Mb/s · 1,4 GB/h           |
|                                        | 1080P 60  travado: pede 16 Mb/s         |
+----------------------------------------+---------------------------------------+
| Vai transmitir Tela 1 em 1080p30, sem som   [Som do jogo: Lig|Desl] [Cancelar] [* Entrar no ar] |  barra de ação 72 px (E)
+--------------------------------------------------------------------------------+
```

### Grade e medidas
- Raiz: `px-8 pt-5`; linhas `auto / minmax(0,1fr) / auto`; `gap-4`.
- Corpo: `grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6 min-h-0` (2 colunas, sem vão morto: ambas preenchem a altura com `h-full`).
- Cabeçalho (A): h1 em 56 px (não 76), descrição em uma linha à direita do título (`flex items-end justify-between`). Eyebrow só com dado útil; "0 pessoas podem assistir" vira "Ninguém na sala ainda" quando `viewers` for 0 (L170).
- Barra de ação (E): `border-t border-texto bg-superficie px-8 h-[72px] flex items-center gap-3`. Fica fora de qualquer contêiner com rolagem. Esquerda: resumo "Vai transmitir **Tela 1** em **1080p30**, sem som do jogo" em 14 px, `truncate`. Meio: abas "Som do jogo Ligado/Desligado" compactas (substituem a janela de 70 px das L210-221; desabilitadas com título "Só em janela de jogo"). Direita: `Cancelar` (btn-lg) e `Entrar no ar` (btn-prim btn-lg). Mensagem de erro (L283-284) sobe para uma faixa `role="alert"` de 36 px logo acima da barra, ou entra na barra de título da janela de preset, nunca no fim de uma coluna.

### (B) Janela "Fonte" (altura fixa pela grade, rolagem só interna)
- `janela flex flex-col min-h-0`. Barra de título: "Fonte · 9" + botão "Atualizar" (hoje a lista é buscada uma vez, L72; sem isso quem abre o jogo depois não vê).
- Linha de filtros (44 px): campo `campo` com placeholder "Buscar tela ou janela" (filtra por título e `process_name`) + `abas` Tudo / Telas / Janelas / Jogos. Ctrl+F foca o campo.
- Lista: `flex-1 min-h-0 overflow-y-auto` com grade `grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 p-3`. Em 1100 px de largura dá 2 colunas; em 1920 px, 3 colunas.
- Cabeçalho de grupo sticky: "TELAS · 1", "JOGOS · 2", "JANELAS · 6" (rotulo 11 px, `border-b border-borda`, fundo `superficie`). Jogos = `process_name` em lista conhecida (cs2.exe, valorant, etc.) ou janela fullscreen/exclusiva; começar com lista curta no front e ampliar depois.
- Tile (168 x ~128): miniatura 16:9 (`aspect-video`, `object-cover` para janelas largas, `object-contain` só quando a proporção for muito diferente) + rodapé de 36 px com título (`truncate`, `title=`) e, à direita, o rótulo "tela" ou "janela" (11 px). Dimensões saem da miniatura e vão para o `title`/rodapé, não por cima da imagem (L188 usa cor fixa `#b3b3ab` sobre imagem arbitrária).
- Estados do tile: padrão; hover `bg-superficie-alta`; selecionado = outline 3 px `destaque` + etiqueta "ESCOLHIDA" no canto (não só cor); foco de teclado = outline 2 px com offset (hoje colide com o outline da seleção, L185); desabilitado/sem imagem (janela minimizada ou 160x28, como "Counter-Strike 2" no print 58) = miniatura riscada, texto "minimizada, restaure a janela", `aria-disabled`.
- Higiene da lista: esconder por padrão janelas sem título ou menores que 200x100, e janelas de título repetido ("Configurações" x2, L191 mostra título vazio); ligar a opção "Mostrar todas (3 ocultas)" no rodapé da lista. Ordem: monitores, jogos, janelas por título.
- Seleção padrão: já vir com o monitor principal selecionado, para o botão principal não nascer desabilitado (L291).
- Carregando: 6 tiles skeleton (hoje 4 de 150 px, L179). Vazio: título "Nenhuma janela encontrada" + "Abra o jogo e toque em Atualizar" + botão.

### (C)/(D) Coluna direita
Ordem: Prévia (1fr) -> Qualidade escolhida (auto) -> Presets (auto). A coluna fecha exatamente na altura do corpo, sem sobra.
- Prévia (nova): `janela flex flex-col min-h-[150px] flex-1`; barra com nome da fonte e resolução; corpo `bg-palco`, miniatura 16:9 centralizada (reaproveita `candidate.thumbnail` já carregado; atualizar a cada 2 s só se a API do sidecar permitir). Sem fonte: "Escolha uma fonte à esquerda".
- Qualidade escolhida: número 88 px (não 120, L236; craft floor limita 96) com "30 fps" a pincel; 3 `Stat` em linha abaixo ou ao lado conforme a largura (`@container`), altura total ~124 px. Unidade corrigida (ver item A3: "Mb/s" vira "MB/S" pelo uppercase).
- Presets: linhas de 44 px (hoje 54, L273); 6 linhas no modo reserva cabem. Linha travada mostra motivo curto: "Pede 16 Mb/s · seu upload 26,4" (ver item M6). "Refazer teste" vira botão `btn btn-sm` de 32 px dentro da barra de 36 px.

### Alturas calculadas (corpo = altura útil - cabeçalho 84 - barra 72 - paddings 40)
| Janela | Corpo | Prévia | Qualidade | Presets (3 linhas) |
|---|---|---|---|---|
| 1920x1080 (útil ~1000) | ~800 | ~480 | 124 | ~170 |
| 1366x768 (útil ~690, com banner ~640) | ~440 | ~146 | 124 | ~170 |
| 1100x700 (mín., com banner ~600) | ~400 | 150 (mín.) | 124 | 128 (4 linhas viram rolagem interna no modo reserva) |

Abaixo de 600 px de altura útil: esconder a prévia (`@media (max-height: 640px)`), nunca rolar a página. A barra de ação nunca sai.

### Modo reserva (WebView2, L198-209)
Coluna esquerda vira um único botão "Escolher tela ou janela" com a prévia do `<video>` ocupando a janela inteira (`flex-1`), sem grade de fontes. Coluna direita: Qualidade + Presets (6 linhas x 44 = 264 px cabem). Mesma barra de ação.

### Acessibilidade e teclado
Foco inicial no campo de busca (ou no tile selecionado), Esc = Cancelar, Enter no tile = selecionar, setas movem entre tiles, Tab chega à barra de ação sem passar por 12 tiles (tile em `role="radiogroup"` com roving tabindex). Hoje o `dialog` (L167) não captura foco nem fecha com Esc.

### Exceção consciente ao padrão
O Pôster diz "sem rolagem dentro de card". Aqui há uma lista de tamanho imprevisível (N janelas abertas), então a rolagem interna da janela "Fonte" é a exceção justificada: foi o pedido do dono, a busca e os grupos reduzem a necessidade de rolar, e o contador "Fonte · 9" mostra o que há. A barra de rolagem fina já está tematizada em `index.css:138-141`.

---

## 2. Achados por prioridade

### ALTA

**A1. Entrar no ar: página inteira rola e some a barra de ação.**
Tela: Entrar no ar. `screens/GoLive.tsx:167` (`overflow-y-auto`), `:178` (grade de tiles sem limite), `:286` (barra de ação no fim da coluna). Correção: spec da seção 1. Esforço: G.

**A2. Entrar no ar: coluna direita termina em y=445 e deixa 600 px vazios (prints 58/60).**
`GoLive.tsx:225-296`. Correção: Prévia + Qualidade + Presets preenchendo a altura (seção 1). Inclui o item abaixo. Esforço: M (junto com A1).

**A3. "Mb/s" aparece como "MB/S" (megabit vira megabyte) em títulos e unidades.**
Classe `rotulo` aplica `text-transform: uppercase` (`index.css:150-158`) e é usada em `GoLive.tsx:230` (barra: "UPLOAD 26,4 MB/S"), `:304` (unidade do Stat "MB/S"). Mostra o dobro do valor real para quem sabe a diferença, e o texto do preset (L276) usa "Mb/s" minúsculo, então a tela se contradiz (print 58). Correção: `normal-case` nas unidades, ou escrever "Mbps" por todo lado; padronizar com o texto de `lib/presets.ts:80` ("Mbps"). Esforço: P.

**A4. Erro cru "Erro do servidor (415)." ao Convidar (print 59), e provável bug real.**
Copy: `lib/servidor.ts:140` cai em `Erro do servidor (${status})` quando falta mapa em `MENSAGENS` (`:35-43`). Causa provável do 415: `criarConvite` (`:185`) faz POST sem corpo (`corpo ?? null`, `:130`), o servidor exige `Content-Type: application/json`. Correção: (1) mandar `{}` em `criarConvite` ou o Rust setar o tipo; (2) trocar o fallback por "O servidor recusou o pedido (código 415). Atualize o app e tente de novo.", com o código só em segundo plano; (3) mapear 415, 500, 502, 503 em `MENSAGENS`. Apresentação: `Room.tsx:214-218` põe o erro como texto solto de 13 px à esquerda do botão, que quebra linha e perde o vínculo com o botão. Mover para um toast/faixa `role="alert"` com ícone, botão "Tentar de novo" e fechar sozinho em 8 s. Esforço: P (copy), M (faixa).

**A5. Sala vazia: palco gigante e vazio + duas ações vermelhas iguais (print 59).**
`Room.tsx:318-330` (estado "Ninguém no ar" no meio de 640 px de preto) e `:399` (outro "Transmitir" vermelho no painel Você). Duas ações primárias na mesma tela vão contra "vermelho só para a ação principal". Correção: quando não há transmissão, o palco encolhe para uma faixa de ~200 px (barra "Palco · livre", texto + um botão) e o resto da altura vira a grade de pessoas na sala (cartões maiores, hoje espremidos no rodapé). Na barra Você, `Transmitir` fica secundário enquanto o palco mostra o próprio CTA. Esforço: G.

**A6. Rodapé de pessoas: caixa tracejada de 1500 px com uma frase de 13 px (print 59).**
`Room.tsx:236-238`. Espaço morto e texto minúsculo. Correção: com `others.length === 0`, não renderizar a faixa; colocar o convite aqui como ação ("Só você por aqui" + botão Convidar, grande, `btn-lg`), ou dar o espaço ao palco (A5). Um placeholder tracejado com a frase "Canal livre para mais um" também some quando a sala está cheia. Esforço: P-M.

**A7. Barra de título nativa clara no tema escuro.**
`src-tauri/tauri.conf.json:15-23` usa decorações padrão e `backgroundColor: "#f4f4f1"` (L21). No print 59/60 a faixa superior é clara (ícone + "Stackcall" + controles) sobre app preto, e no arranque o app pisca claro. Correção P: `getCurrentWindow().setTheme('dark'|'light')` em `lib/tema.ts` quando o tema muda, e ler a preferência salva antes de mostrar a janela. Correção G (melhor para o Pôster): `decorations: false` + barra própria de 32 px (`data-tauri-drag-region`, título em Anton 16 px, controles quadrados 44x32 com foco visível), arrastar/duplo clique, snap do Windows 11 preservado com `shadow`. Esforço: P / G.

### MÉDIA

**M1. Cabeçalho da sala: nome enorme e eixo desalinhado (print sala-claro).**
`Room.tsx:207-223`. O h1 em 64 px (L210) ocupa 100 px de altura vertical para repetir o nome que já está na aba ativa. E a linha "5 na sala · Rafa transmitindo" sai 90 px à direita do "CS" porque a coluna do h1 herda a largura do eyebrow "/ GALERA · SALA 01" (L208-209), gerando vão. Correção: tirar o eyebrow (nome do servidor e número da sala já estão no topo) e reduzir o h1 para 40 px na mesma linha da contagem e do botão Convidar; o ganho (~60 px) vai para o palco. Esforço: P.

**M2. Número da sala "01/02/03/04" nas abas e no eyebrow.**
`Room.tsx:90` e `:209`. Numeração decorativa (craft floor recusa numeração sem informação). Remover da aba e usar o espaço para a contagem em fonte maior, ou para o ícone de som. Esforço: P.

**M3. Tema Claro/Escuro ocupa 150 px do topo, o tempo todo.**
`Room.tsx:104-107`. Tema é preferência, não ação da sala. Mover para Configurações (já tem "Sobre e atualizações") ou para o menu do avatar. O topo fica com: logo, servidor, salas, ping, config, avatar. Esforço: P.

**M4. Caixa de ping (print 59/saguão).**
`Room.tsx:124-139` (janela 52 px com barra lima de 18 px + número em Anton 22 px). Ocupa o mesmo peso visual das salas para um dado de 3 dígitos; fora da sala mostra "▬ MS" (print saguao-escuro). Correção: pílula `ping 160 ms · ok` de 32 px alinhada à direita da barra Você ou no rodapé; sumir fora de sala. Esforço: P.

**M5. Saguão: 4 cartões ocupam 800 de 1440 px e o resto é vazio (print saguao-escuro).**
`Room.tsx:144-171`. Grade `auto-fill minmax(240px,1fr)` com poucas salas deixa colunas vazias porque `auto-fill` reserva trilhos fantasmas à direita. Correção: `auto-fit` + altura igual; ou, melhor, repetir a estrutura da sala: salas à esquerda, painel Pessoas (reaproveitar `Lateral`, L476) à direita, e o saguão deixa de parecer vazio. Os 4 botões "Entrar na sala X" são 4 vermelhos (L164): só a sala com gente fica `btn-prim`; as vazias, `btn`. Esforço: M.

**M6. Presets travados: motivo longo e enganoso.**
`lib/presets.ts:80` ("Seu upload medido (23,9 Mbps) não sustenta este preset. Ele pede cerca de 12 Mbps com folga.") e `GoLive.tsx:274,276` (resolução riscada + motivo de 90 caracteres, repetido em 2 linhas no print 60). Com 23,9 Mbps medidos e 12 pedidos, "não sustenta" é falso: o limite é a folga de 50%. Correção de copy: "Usa mais da metade do seu upload (pede 12 de 23,9 Mb/s)". Visual: sem `line-through` na resolução (lê como erro), ícone de cadeado 14 px + texto fraco. Esforço: P.

**M7. "Refazer teste" é um link de 11 px dentro da barra.**
`GoLive.tsx:263`. Alvo de ~14 px de altura (regra: 44 px; barra tem 28 px). Texto `text-superficie` sublinhado, sem estado de foco visível sobre fundo de tinta. Correção: `btn btn-sm` invertido (32 px) e barra de 36 px (`index.css:167-181`). Esforço: P.

**M8. Seleção de fonte só por cor.**
`GoLive.tsx:185`. `outline-[3px] outline-destaque` e nada mais; em tema escuro o `destaque` #ff5a5f sobre tinta preta funciona, mas daltônicos e o foco de teclado (2 px, offset 2, `index.css:143-146`) disputam o mesmo contorno. Correção: etiqueta "ESCOLHIDA" + marca quadrada no canto, foco com `outline-offset: 3px` em tinta. Esforço: P.

**M9. Fonte sem título: tile em branco (print 58, dois tiles).**
`GoLive.tsx:191`. `candidate.title` vazio mostra rodapé vazio. Correção: `title || process_name || 'Janela sem título'`. Esforço: P.

**M10. Texto de 10 px em 13 lugares.**
`text-[10px]` em `GoLive.tsx:188,192,277,302...`, `Room.tsx:76,90,428,470,501...`. Abaixo do piso de legibilidade de uma tela de 1920 px vista a 60 cm; as legendas "monitor/janela", "travado", "escolhido", dimensões ficam ilegíveis. Correção: piso de 11 px, com `rotulo` padrão de 12 px (já é em `index.css:152`); só a barra de título fica em 11 px. Esforço: P.

**M11. Escala de tamanhos do h1 incoerente.**
76 px (`GoLive.tsx:171`), 64 px (`Room.tsx:147,210`), 104 px (`Entrada.tsx:24`), 48 px (`Perfil.tsx:143`), 120 px (`GoLive.tsx:236`). O Pôster manda 48-72 e o craft floor 96 px de teto. Correção: definir `--text-hero: 96px` (só Entrada), `--text-titulo: 56px`, `--text-painel: 40px`, `--text-numero: 72-88px` e aplicar. Esforço: P.

**M12. Acentos cortados no Anton com `line-height: 0.95`.**
`index.css:112`. "Ninguém", "Configurações", "Atualizações" (print config-escuro: til do "Õ" encosta no eyebrow). Correção: `line-height: 1.05` nos h1 e `padding-top: 0.08em`. Esforço: P.

**M13. Botão desabilitado vermelho vira rosa lavado.**
`index.css:216-218` (opacity .45 em tudo). No print entrada-claro o "Continuar" lê como erro de renderização, e o texto branco sobre rosa tem ~1.9:1. Correção: `disabled` usa `bg-superficie-alta`, `color: texto-fraco`, borda `borda` (cinza), sem opacidade. Mais um texto auxiliar dizendo por quê ("Cole o link para continuar"). Esforço: P.

**M14. Botão principal de Entrar no ar desabilitado sem explicação.**
`GoLive.tsx:291`. `disabled` quando falta fonte ou o teste da placa está rodando. Mostrar o motivo na barra de ação ("Escolha uma fonte" / "Testando a placa de vídeo…" com spinner). Esforço: P.

**M15. Barra de salas quebra linha com muitas salas.**
`Room.tsx:80` (`flex-wrap` na janela de salas, `min-w-[112px]` por sala). Em 1100 px com 6+ salas vira 2 linhas com borda irregular. Correção: `overflow-x-auto` com setas, ou menu "Salas (8)" a partir de 6. Esforço: M.

**M16. Diálogo de Entrar no ar sem foco inicial, sem armadilha de foco e sem Esc.**
`GoLive.tsx:167`. `aria-modal` sem comportamento de modal; o foco fica no botão "Transmitir" atrás. Esforço: P (`autoFocus` + `onKeyDown` Esc; focus-trap simples).

**M17. Estado de erro do palco: mensagem crua, sem ação clara.**
`Room.tsx:299-308`. `{model.error}` vem direto de exceção (`useLiveRoom`); "Tentar de novo" é `btn` neutro; sem diagnóstico. Correção: título "Sem conexão com a sala", causa em português + `btn-prim "Tentar de novo"`, detalhe técnico recolhido. Esforço: M. Mesmo padrão em `App.tsx:144-158` (erro do servidor com `estado.mensagem` cru, janela de 460 px solta no meio da tela).

**M18. Painel Você repete o estado em texto de 10 px.**
`Room.tsx:405-407` ("MIC LIGADO · SOM LIGADO · FORA DO AR") repete o que o `aria-pressed` e a cor dos botões já dizem; é a linha mais fraca da tela (print 59, rodapé esquerdo). Correção: trocar por medidor do próprio microfone (usa `level` que já existe, `Medidor`, L423) ou remover. Esforço: P.

### BAIXA

**B1. Botão "Enviar" do chat com 36 px.** `Room.tsx:545` (`min-h-9 w-9`), alvo abaixo de 44 px. Subir para 44 e aumentar o campo (L541). P.

**B2. Cores fixas fora dos tokens.** `GoLive.tsx:188,202`, `Room.tsx:349` (`#b3b3ab`), `UpdateBanner.tsx:20` (`#7a0d0d`), `Avatar.tsx:19`. Texto sobre `palco` em tema claro usa o cinza do escuro, ok, mas deveria ser token `--color-sobre-palco`. P.

**B3. Faixa de atualização com 48 px e vermelho dentro de lima.** `UpdateBanner.tsx:17,25`. Lima + vermelho + preto concorrem pela atenção, e a faixa fica fixa mesmo durante a transmissão. Correção: 40 px e dispensável na sala; "Ver novidades" como link. P.

**B4. Entrada: grade centralizada com 280 px vazios em cima e embaixo, "Sobre e atualizações" solto.** `Entrada.tsx:21,36-39`. Aceitável numa tela de login; se quiser reforçar o pôster, ancorar o bloco ao topo, e colocar a versão no rodapé. Nota: o print entrada mostra "v0.2.1" com banner 0.3.0, artefato do protótipo (`__APP_VERSION__`). P.

**B5. Placeholder do campo sem tema.** `index.css:283-302` não define `::placeholder` (craft floor: superfícies do navegador). Contraste do placeholder padrão no escuro fica baixo. P.

**B6. Config e Perfil com a metade inferior vazia (prints config-escuro, perfil-claro).** `Perfil.tsx:140` (`max-w-4xl`, coluna única + prévia, sem altura própria). Aceitável em formulário curto; se quiser densidade, fixar botões Salvar/Cancelar em barra de ação inferior (padrão da nova GoLive) e crescer a prévia do cartão. M.

**B7. Cartões de pessoa com 184 px fixos e rolagem horizontal.** `Room.tsx:232,451`. Com 10 pessoas, 4 saem da tela sem indício. Quebrar em grade (`auto-fill`) quando A5 liberar altura. M.

**B8. Skeleton do carregamento inicial não espelha a tela.** `App.tsx:136-143` (3 blocos genéricos). Espelhar topo + palco + lateral para evitar salto de layout. P.

---

## 3. Contraste (ambos os temas, números calculados)
- Texto de erro: `perigo` #ff7a6b sobre #0e0e10 = ~7:1, passa; #b42318 sobre #f4f4f1 = ~6:1, passa. O problema do "Erro do servidor (415)" não é a cor, é o tamanho (13 px), a posição solta e a falta de ícone/saída (A4).
- Texto sobre lima: sempre #111, passa. Barra `barra-ar` com texto branco sobre #c8191f = ~5.6:1, passa; no escuro `sobre-destaque` #111 sobre #ff5a5f ~6.5:1, passa.
- Botão primário desabilitado em claro (M13) e `btn-fant` com `texto-fraco` sobre `lima` (UpdateBanner, L21) passam raspando; revisar.
- Rótulos em `texto-fraco` de 10 px (M10): passam em razão de cor, falham em tamanho.

## 4. Consistência com o Pôster: o que já está certo
Janelas de 1 px com barra, cantos retos (exceto `rounded-[2px]` no campo de chat, aceitável), sem sombra, lima só em dado, Anton só em caixa alta, pincel em uma palavra por tela ("call", "30 fps", "ao vivo!"; na sala de transmissão aparecem "ao vivo!" e, se houver GoLive aberto, o pincel de "fps" em outra camada: ok por serem telas distintas), tema escuro sem neon, skeleton em vez de "Carregando…", foco visível global (`index.css:143-146`), `prefers-reduced-motion` e modo "parado" tratados. Pontos "genéricos de IA" a evitar: tile de card idêntico repetido em grade (a lista de fontes), eyebrow antes de todo h1 (`Room.tsx:146,209`, `GoLive.tsx:170`), caixa tracejada de placeholder (A6), widget de métrica "Ping" com barra de título (M4).

## 5. Ordem de execução sugerida
1. P rápidos num PR só: A3, A4 (copy + corpo do POST), M9, M10, M12, M13, M7, M8, M14, M16, B1, B5.
2. GoLive novo (A1, A2, M6, seção 1) como PR próprio, no T3, com tela em Claude/Opus.
3. Sala: A5, A6, M1-M4, M15, M17, M18 em outro PR.
4. Janela: A7 (tema da barra, P) agora; barra própria depois, se fizer sentido.

Não verificado: não rodei o app; alturas calculadas vêm de números de CSS e dos prints. A causa do 415 é hipótese lida do código do cliente (não vi o `servidor` da VPS).
