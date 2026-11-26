import { naWeb } from './ambiente';

/**
 * Settings map and search (docs/design/v05-interface.md, section 5). Three groups; the server
 * group only for the owner and admins. The search looks in the setting name, its description
 * and nicknames ("ptt" finds push to talk), without accents or case.
 */
export type Grupo = 'voce' | 'servidor' | 'app';
export type PaginaId =
  | 'perfil' | 'voz' | 'celular' | 'atalhos' | 'clipes' | 'cutucadas' | 'sons' | 'quemfala' | 'cs2' | 'aparencia'
  | 'geral' | 'salas' | 'membros'
  | 'servidores' | 'sobre';

/** `soApp`: needs the Windows app (core, hotkeys, CS2 files); hidden in the web app. */
export type Pagina = { id: PaginaId; grupo: Grupo; rotulo: string; precisaServidor?: boolean; soApp?: boolean };

export const GRUPOS: { id: Grupo; rotulo: string }[] = [
  { id: 'voce', rotulo: 'Você' },
  { id: 'servidor', rotulo: 'Servidor' },
  { id: 'app', rotulo: 'App' },
];

export const PAGINAS: Pagina[] = [
  { id: 'perfil', grupo: 'voce', rotulo: 'Perfil', precisaServidor: true },
  { id: 'voz', grupo: 'voce', rotulo: 'Voz e rede' },
  { id: 'celular', grupo: 'voce', rotulo: 'Celular', precisaServidor: true },
  { id: 'atalhos', grupo: 'voce', rotulo: 'Atalhos', soApp: true },
  { id: 'clipes', grupo: 'voce', rotulo: 'Clipes e replay', soApp: true },
  { id: 'cutucadas', grupo: 'voce', rotulo: 'Cutucadas' },
  { id: 'sons', grupo: 'voce', rotulo: 'Sons e avisos' },
  { id: 'quemfala', grupo: 'voce', rotulo: 'Janela quem fala', soApp: true },
  { id: 'cs2', grupo: 'voce', rotulo: 'Mapa do CS2', soApp: true },
  { id: 'aparencia', grupo: 'voce', rotulo: 'Aparência' },
  { id: 'geral', grupo: 'servidor', rotulo: 'Geral e convites', precisaServidor: true },
  { id: 'salas', grupo: 'servidor', rotulo: 'Salas', precisaServidor: true },
  { id: 'membros', grupo: 'servidor', rotulo: 'Membros e cargos', precisaServidor: true },
  { id: 'servidores', grupo: 'app', rotulo: 'Servidores', soApp: true },
  { id: 'sobre', grupo: 'app', rotulo: 'Sobre e atualizações' },
];

/** Pages this person sees: the server group needs a server and an owner or admin. */
export function paginasVisiveis(comServidor: boolean, admin: boolean) {
  return PAGINAS.filter((p) => (!p.precisaServidor || comServidor) && (p.grupo !== 'servidor' || admin) && !(p.soApp && naWeb()));
}

/** `id` matches the `data-ajuste` of the row in the page, so a result can scroll to it. */
export type Ajuste = { id: string; pagina: PaginaId; titulo: string; descricao: string; apelidos?: string[] };

export const AJUSTES: Ajuste[] = [
  { id: 'perfil-editar', pagina: 'perfil', titulo: 'Nome, foto e capa', descricao: 'Como o grupo vê você no cartão de perfil.', apelidos: ['avatar', 'bio', 'banner'] },
  { id: 'presenca-jogo', pagina: 'perfil', titulo: 'Mostrar o jogo que estou jogando', descricao: 'Aparece "jogando CS2" para o grupo, na sala e no saguão.', apelidos: ['presença', 'status', 'privacidade'] },
  { id: 'voz-modo', pagina: 'voz', titulo: 'Modo de voz', descricao: 'Detecção de voz ou apertar para falar.', apelidos: ['ptt', 'push to talk', 'apertar para falar', 'soltura'] },
  { id: 'voz-aparelhos', pagina: 'voz', titulo: 'Microfone e saída de som', descricao: 'Escolha os aparelhos e teste o microfone.', apelidos: ['headset', 'fone', 'caixa', 'dispositivo', 'mic', 'teste do microfone'] },
  { id: 'voz-ruido', pagina: 'voz', titulo: 'Supressão de ruído', descricao: 'Tira ventoinha e ar-condicionado; a forte tira teclado e cliques.', apelidos: ['rnnoise', 'barulho', 'teclado'] },
  { id: 'voz-eco', pagina: 'voz', titulo: 'Cancelamento de eco', descricao: 'Precisa quando o som sai da caixa.', apelidos: ['eco', 'retorno'] },
  { id: 'voz-ganho', pagina: 'voz', titulo: 'Controle automático de ganho', descricao: 'Iguala o volume da sua voz.', apelidos: ['volume do microfone', 'agc'] },
  { id: 'voz-rede', pagina: 'voz', titulo: 'Teste de rede', descricao: 'Mede ping e perda até o servidor.', apelidos: ['ping', 'perda', 'latência', 'lag', 'internet', 'conexão'] },
  { id: 'atalhos-lista', pagina: 'atalhos', titulo: 'Atalhos', descricao: 'Teclas que funcionam com o jogo na frente. Nenhum vem pronto.', apelidos: ['tecla', 'mute', 'hotkey', 'ptt', 'janela quem fala'] },
  { id: 'atalhos-som', pagina: 'atalhos', titulo: 'Som de confirmação', descricao: 'Um bipe quando um atalho liga ou desliga algo.', apelidos: ['bipe'] },
  { id: 'replay-ligado', pagina: 'clipes', titulo: 'Replay sempre ligado', descricao: 'Guarda os últimos segundos da sala para salvar um clipe.', apelidos: ['gravação', 'gravar', 'clipe', 'replay'] },
  { id: 'replay-tempo', pagina: 'clipes', titulo: 'Quanto tempo guardar', descricao: '30, 60 ou 120 segundos.', apelidos: ['duração', 'segundos'] },
  { id: 'replay-qualidade', pagina: 'clipes', titulo: 'Qualidade do clipe', descricao: 'Igual à transmissão ou 720p, mais leve.', apelidos: ['resolução'] },
  { id: 'replay-pasta', pagina: 'clipes', titulo: 'Pasta dos clipes', descricao: 'Onde os clipes ficam neste PC.', apelidos: ['diretório', 'salvar em'] },
  { id: 'cutucar-receber', pagina: 'cutucadas', titulo: 'Receber cutucadas de', descricao: 'Todos do grupo, só amigos ou ninguém.', apelidos: ['poke', 'cutucar', 'chamar'] },
  { id: 'cutucar-voz', pagina: 'cutucadas', titulo: 'Ler o recado em voz alta', descricao: 'Uma voz do Windows lê quem cutucou e o recado.', apelidos: ['voz', 'tts', 'falar'] },
  { id: 'cutucar-volume', pagina: 'cutucadas', titulo: 'Volume da voz da cutucada', descricao: 'Separado do volume da sala.', apelidos: ['volume'] },
  { id: 'cutucar-silenciado', pagina: 'cutucadas', titulo: 'Tocar mesmo com o som silenciado', descricao: 'Chama quem tirou o som do Stackcall.', apelidos: ['mudo', 'mute'] },
  { id: 'cutucar-aviso', pagina: 'cutucadas', titulo: 'Aviso do Windows', descricao: 'A cutucada aparece na central de notificações.', apelidos: ['notificação', 'toast'] },
  { id: 'som-entrada', pagina: 'sons', titulo: 'Som de entrada e saída', descricao: 'Toca quando alguém entra ou sai da sua sala.', apelidos: ['entrou', 'saiu', 'aviso sonoro'] },
  { id: 'quemfala-mostrar', pagina: 'quemfala', titulo: 'Mostrar a janela quem fala', descricao: 'Janela por cima do jogo com quem está falando.', apelidos: ['overlay', 'sobreposição'] },
  { id: 'quemfala-conteudo', pagina: 'quemfala', titulo: 'O que a janela mostra', descricao: 'Só quem fala ou todos da sala.', apelidos: ['overlay'] },
  { id: 'quemfala-opacidade', pagina: 'quemfala', titulo: 'Opacidade da janela', descricao: 'De 20 a 100%.', apelidos: ['transparência', 'overlay'] },
  { id: 'quemfala-tamanho', pagina: 'quemfala', titulo: 'Tamanho da janela', descricao: 'Pequeno, médio ou grande.', apelidos: ['overlay'] },
  { id: 'quemfala-posicao', pagina: 'quemfala', titulo: 'Posição da janela', descricao: 'Canto da tela ou arrastar com o mouse.', apelidos: ['canto', 'mover', 'overlay'] },
  { id: 'cs2-sala', pagina: 'cs2', titulo: 'Sala do mapa do CS2', descricao: 'Separa CT e TR em sub-salas durante a partida.', apelidos: ['gsi', 'counter-strike', 'time', 'ct', 'tr'] },
  { id: 'cs2-gsi', pagina: 'cs2', titulo: 'Integração com o CS2', descricao: 'Instala o arquivo oficial de Game State Integration da Valve.', apelidos: ['gsi', 'valve', 'cfg'] },
  { id: 'tema', pagina: 'aparencia', titulo: 'Tema', descricao: 'Claro ou escuro.', apelidos: ['escuro', 'claro', 'dark', 'cores'] },
  { id: 'servidor-nome', pagina: 'geral', titulo: 'Este servidor', descricao: 'Nome, endereço e seu cargo.', apelidos: ['grupo'] },
  { id: 'servidor-dorme', pagina: 'geral', titulo: 'Servidor dorme', descricao: 'Se o servidor de voz dorme sem ninguém e se está dormindo agora.', apelidos: ['suspensão', 'livekit', 'economia', 'acordar'] },
  { id: 'convites', pagina: 'geral', titulo: 'Convites', descricao: 'Gerar, copiar e revogar links de convite.', apelidos: ['convidar', 'link'] },
  { id: 'salas-lista', pagina: 'salas', titulo: 'Salas', descricao: 'Criar, renomear e apagar salas.', apelidos: ['canal', 'canais'] },
  { id: 'membros-lista', pagina: 'membros', titulo: 'Membros', descricao: 'Quem está no servidor e o cargo de cada um. O dono troca admin e membro.', apelidos: ['pessoas', 'cargo', 'admin', 'promover', 'expulsar', 'remover'] },
  { id: 'servidores-lista', pagina: 'servidores', titulo: 'Seus servidores', descricao: 'Trocar de servidor ou entrar em outro com convite.', apelidos: ['turma', 'grupo'] },
  { id: 'aparelho', pagina: 'servidores', titulo: 'Este aparelho', descricao: 'Entrar em outro PC ou sair deste.', apelidos: ['sair', 'logout', 'outro pc', 'sessão'] },
  { id: 'atualizacoes', pagina: 'sobre', titulo: 'Atualizações', descricao: 'Versão instalada, procurar atualização e histórico.', apelidos: ['versão', 'update', 'novidades', 'changelog'] },
  { id: 'teste-placa', pagina: 'sobre', titulo: 'Teste da placa de vídeo', descricao: 'Refaz o teste que libera as qualidades de transmissão.', apelidos: ['gpu', 'codificador', 'encoder'] },
];

export const normalizar = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * Settings whose name, description or nickname contain every word of the query, best first:
 * a word in the name counts most, then a nickname, then the description.
 */
export function buscarAjustes(consulta: string, paginas: readonly PaginaId[] = PAGINAS.map((p) => p.id)): Ajuste[] {
  const palavras = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (!palavras.length) return [];
  const permitidas = new Set(paginas);
  const pontos = (a: Ajuste) => {
    const titulo = normalizar(a.titulo);
    const apelidos = (a.apelidos ?? []).map(normalizar);
    const descricao = normalizar(a.descricao);
    let total = 0;
    for (const p of palavras) {
      const n = titulo.includes(p) ? 3 : apelidos.some((x) => x.includes(p)) ? 2 : descricao.includes(p) ? 1 : 0;
      if (!n) return 0;
      total += n;
    }
    return total;
  };
  return AJUSTES.filter((a) => permitidas.has(a.pagina))
    .map((a) => ({ a, n: pontos(a) }))
    .filter((x) => x.n > 0)
    .sort((x, y) => y.n - x.n)
    .map((x) => x.a);
}

export const paginaDe = (id: PaginaId) => PAGINAS.find((p) => p.id === id)!;
export const caminhoDe = (a: Ajuste) => {
  const p = paginaDe(a.pagina);
  return `${GRUPOS.find((g) => g.id === p.grupo)!.rotulo} › ${p.rotulo}`;
};
