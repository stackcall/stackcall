# Protótipo: Sala de Controle

Direção visual escolhida em 24/11/2026. Os arquivos são a fonte das telas do canvas de design. Eles usam o formato "Design Component" do canvas: o markup dentro de `<x-dc>` é HTML comum com estilos inline, e o bloco `<script type="text/x-dc">` traz os dados de exemplo em `renderVals()`. `{{nome}}` é um valor vindo desses dados, e `<sc-for>`/`<sc-if>` são repetição e condição.

| Arquivo | Tela |
|---|---|
| `Controle.html` | Sala: abas de salas no topo, palco com a transmissão "NO AR", câmeras numeradas, mesa de som com nível e volume por pessoa, chat à direita, barra de controles |
| `GoLive.html` | Entrar no ar: escolher tela ou janela, som do app, cartões de qualidade 720p30 a 4K60 com upload, carga da placa, dados por hora e motivo de bloqueio |
| `Atualizacoes.html` | Configurações → Sobre e atualizações: versão instalada e disponível, atualizar ao sair da sala, canal, histórico |
| `Novidades.html` | O que mudou na versão, por categoria: Novidades, Melhorias, Correções, Ajustes |

## Tokens usados

| Papel | Valor |
|---|---|
| Fundo | `#0f1012` |
| Painel | `#131417` |
| Superfície | `#17191c` / `#1b1d21` |
| Linha | `#30333a` |
| Texto | `#d9dbe0` |
| Texto secundário | `#9ea2ab` |
| Roxo (só no ar, selecionado, ativo) | `#7c5cff`, fundo ativo `#1c1833` / `#221b3d`, texto sobre ativo `#e2dbff` |
| Sair / perigo | borda `#5a2a33`, fundo `#24151a`, texto `#ffb3bd` |
| Fontes | Barlow (texto) e Barlow Condensed (títulos, rótulos e números, em caixa alta com espaçamento) |
| Cantos | 6px |

Componentes, cores, botões e fontes ainda vão ser ajustados pelo Filippe. Nomes e números das telas são fictícios.
