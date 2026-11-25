import { useEffect, useState } from 'react';
import { Cabecalho, Chave, Deslizante, Linha, Segmento } from '../../components/Controles';
import { Faixa } from '../../components/Faixa';
import { Icone } from '../../components/Icone';
import { QuemFalaLista } from '../../components/QuemFalaLista';
import { falar, fraseCutucada, vozPortugues } from '../../lib/cutucar';
import { JANELA_FALANTES, nucleo } from '../../lib/nucleo';
import { usePreferencias, type PosicaoQuemFala } from '../../lib/preferencias';
import { ESTADO_EXEMPLO } from '../../lib/quemfala';
import { lerAtalhos } from '../../lib/atalhos';
import { tocarSom } from '../../lib/sons';
import type { ReceberCutucadas, Servidor, Usuario } from '../../lib/servidor';

type Pagina = { destaque?: string };
const erroDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Você > Perfil: the profile editor (its own screen) and the game in the presence. */
export function PaginaPerfil({ eu, destaque, onEditar }: Pagina & { eu: Usuario | null; onEditar(): void }) {
  const [p, mudar] = usePreferencias();
  const [agora, setAgora] = useState<string | null | undefined>();
  useEffect(() => {
    if (p.presencaJogo) void nucleo.jogoAtual().then(setAgora);
  }, [p.presencaJogo]);
  return (
    <>
      <Cabecalho rotulo={eu ? `Você · ${eu.papel}` : 'Você'} titulo="Perfil" />
      <Linha ajuste="perfil-editar" titulo="Nome, foto e capa" descricao="Como o grupo vê você no cartão de perfil." destaque={destaque === 'perfil-editar'}>
        <button type="button" className="btn" onClick={onEditar}>Editar perfil</button>
      </Linha>
      <Linha ajuste="presenca-jogo" titulo="Mostrar o jogo que estou jogando" destaque={destaque === 'presenca-jogo'}
        descricao={p.presencaJogo
          ? <>O grupo vê “jogando …” na sala e no saguão. {agora ? <>Agora: <b className="text-texto">{agora}</b>.</> : agora === null ? 'Nenhum jogo aberto agora.' : ''}</>
          : 'Desligado: o app não procura o jogo e não manda nada ao servidor.'}>
        <Chave rotulo="Mostrar o jogo que estou jogando" ligado={p.presencaJogo} onMudar={(presencaJogo) => mudar({ presencaJogo })} />
      </Linha>
    </>
  );
}

/** Você > Clipes e replay. */
export function PaginaClipes({ destaque }: Pagina) {
  const [p, mudar] = usePreferencias();
  const tecla = lerAtalhos().teclas;
  return (
    <>
      <Cabecalho rotulo="Você · gravado só neste PC" titulo="Clipes e replay" />
      <Linha ajuste="replay-ligado" titulo="Replay sempre ligado" destaque={destaque === 'replay-ligado'}
        descricao="Guarda os últimos segundos da sala o tempo todo; o botão Clipe salva. Gasta memória e um pouco da placa de vídeo.">
        <Chave rotulo="Replay sempre ligado" ligado={p.replayLigado} onMudar={(replayLigado) => mudar({ replayLigado })} />
      </Linha>
      <Linha ajuste="replay-tempo" titulo="Quanto tempo guardar" destaque={destaque === 'replay-tempo'}
        descricao={`Mais tempo usa mais memória: ${p.replaySegundos} s em 1080p60 ocupam cerca de ${Math.round(p.replaySegundos * 7.5)} MB.`}>
        <Segmento rotulo="Quanto tempo guardar" valor={p.replaySegundos} opcoes={[[30, '30 s'], [60, '60 s'], [120, '120 s']]} onMudar={(replaySegundos) => mudar({ replaySegundos })} />
      </Linha>
      <Linha ajuste="replay-qualidade" titulo="Qualidade do clipe" destaque={destaque === 'replay-qualidade'}
        descricao="Igual à transmissão guarda o que você manda; 720p ocupa menos e pesa menos na placa.">
        <Segmento rotulo="Qualidade do clipe" valor={p.replayQualidade} opcoes={[['transmissao', 'Igual à transmissão'], ['720p', '720p']]} onMudar={(replayQualidade) => mudar({ replayQualidade })} />
      </Linha>
      <Linha ajuste="replay-pasta" titulo="Pasta dos clipes" destaque={destaque === 'replay-pasta'}
        descricao="O núcleo grava os clipes sempre aqui. Abra pela galeria de Clipes, no topo.">
        <span className="font-mono text-[12.5px]">Vídeos\Stackcall</span>
      </Linha>
      <p className="m-0 text-[13px] text-texto-fraco">
        Quem está na sala vê o aviso “replay ligado” no seu canal e no topo da sala. Esse aviso não desliga.
        {Object.keys(tecla).length === 0 && ' Para salvar com uma tecla, defina um atalho em Atalhos.'}
      </p>
    </>
  );
}

const TEXTO_RECEBER: [ReceberCutucadas, string][] = [['todos', 'Todos do grupo'], ['amigos', 'Só amigos'], ['ninguem', 'Ninguém']];

/** Você > Cutucadas. Who may poke is stored on the server; the rest is per PC. */
export function PaginaCutucadas({ servidor, eu, destaque }: Pagina & { servidor: Servidor | null; eu: Usuario | null }) {
  const [p, mudar] = usePreferencias();
  const [receber, setReceber] = useState<ReceberCutucadas | null>(null);
  const [erro, setErro] = useState<string>();
  const [semVoz, setSemVoz] = useState(false);
  const carregar = () => {
    if (!servidor) return;
    setErro(undefined);
    servidor.cutucadas().then(setReceber, (e) => setErro(erroDe(e)));
  };
  useEffect(carregar, [servidor]);
  useEffect(() => {
    // Voices load late in WebView2; ask again when the list arrives.
    const ver = () => setSemVoz(typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices().length > 0 && !vozPortugues());
    ver();
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.addEventListener?.('voiceschanged', ver);
    return () => speechSynthesis.removeEventListener?.('voiceschanged', ver);
  }, []);
  async function escolher(r: ReceberCutucadas) {
    if (!servidor) return;
    const antes = receber;
    setReceber(r);
    setErro(undefined);
    await servidor.salvarCutucadas(r).catch((e) => {
      setReceber(antes);
      setErro(erroDe(e));
    });
  }
  return (
    <>
      <Cabecalho rotulo="Você · para chamar quem tirou o som" titulo="Cutucadas" />
      <Linha ajuste="cutucar-receber" titulo="Receber cutucadas de" destaque={destaque === 'cutucar-receber'}
        descricao={servidor ? 'Quem não pode cutucar você vê “Cutucar…” apagado, sem saber o motivo. Vale em todos os seus aparelhos.' : 'Entre num servidor para escolher.'}>
        {servidor && receber === null && !erro ? <div className="skeleton h-11 w-[330px]" aria-label="Carregando" /> : (
          <Segmento rotulo="Receber cutucadas de" valor={receber ?? 'todos'} opcoes={TEXTO_RECEBER} onMudar={(r) => void escolher(r)} disabled={!servidor || receber === null} />
        )}
      </Linha>
      {erro && <Faixa acoes={[{ rotulo: 'Tentar de novo', onClick: carregar }]}>Não deu para ler ou salvar essa escolha no servidor. {erro}</Faixa>}
      <Linha ajuste="cutucar-voz" titulo="Ler o recado em voz alta" destaque={destaque === 'cutucar-voz'}
        descricao={semVoz ? 'Este PC não tem voz em português do Windows. A leitura sai com a voz que houver.' : 'Uma voz do Windows lê: “Rafa te cutucou: a sala tá pronta”. Roda neste PC; o recado não sai dele.'}>
        <Chave rotulo="Ler o recado em voz alta" ligado={p.cutucarVoz} onMudar={(cutucarVoz) => mudar({ cutucarVoz })} textos={['Ligada', 'Desligada']} />
      </Linha>
      <Linha ajuste="cutucar-volume" titulo="Volume da voz" descricao="Separado do volume da sala." destaque={destaque === 'cutucar-volume'}>
        <span className="flex items-center gap-3">
          <Deslizante rotulo="Volume da voz da cutucada" valor={p.cutucarVolume} min={0} max={100} passo={5} onMudar={(cutucarVolume) => mudar({ cutucarVolume })} disabled={!p.cutucarVoz} />
          <button type="button" className="btn btn-sm" disabled={!p.cutucarVoz} onClick={() => falar(fraseCutucada({ de: eu?.nome ?? 'Rafa', recado: 'a sala tá pronta' }), p.cutucarVolume)}>
            <Icone nome="play" tamanho={14} />Testar
          </button>
        </span>
      </Linha>
      <Linha ajuste="cutucar-silenciado" titulo="Tocar mesmo com o som silenciado" destaque={destaque === 'cutucar-silenciado'}
        descricao="É para isso que a cutucada serve: chamar quem tirou o som do Stackcall. O mudo do Windows continua valendo.">
        <Chave rotulo="Tocar mesmo com o som silenciado" ligado={p.cutucarMesmoSilenciado} onMudar={(cutucarMesmoSilenciado) => mudar({ cutucarMesmoSilenciado })} disabled={!p.cutucarVoz} />
      </Linha>
      <Linha ajuste="cutucar-aviso" titulo="Aviso do Windows" descricao="Mostra a cutucada na central de notificações." destaque={destaque === 'cutucar-aviso'}>
        <Chave rotulo="Aviso do Windows" ligado={p.cutucarAvisoWindows} onMudar={(cutucarAvisoWindows) => mudar({ cutucarAvisoWindows })} />
      </Linha>
      <p className="m-0 text-[13px] text-texto-fraco">Quem cutuca espera 30 s para cutucar a mesma pessoa de novo.</p>
    </>
  );
}

/** Você > Sons e avisos. */
export function PaginaSons({ destaque }: Pagina) {
  const [p, mudar] = usePreferencias();
  const vol = p.somEntradaSaidaVolume / 100;
  return (
    <>
      <Cabecalho rotulo="Você · vale para este PC" titulo="Sons e avisos" />
      <Linha ajuste="som-entrada" titulo="Som de entrada e saída" descricao="Toca quando alguém entra ou sai da sua sala." destaque={destaque === 'som-entrada'}>
        <Chave rotulo="Som de entrada e saída" ligado={p.somEntradaSaida} onMudar={(somEntradaSaida) => mudar({ somEntradaSaida })} />
      </Linha>
      <Linha ajuste="som-entrada" titulo="Volume dos sons" descricao="Baixo de propósito: toca por cima do jogo.">
        <span className="flex items-center gap-3">
          <Deslizante rotulo="Volume dos sons de entrada e saída" valor={p.somEntradaSaidaVolume} min={0} max={100} passo={5} onMudar={(somEntradaSaidaVolume) => mudar({ somEntradaSaidaVolume })} disabled={!p.somEntradaSaida} />
          <button type="button" className="btn btn-sm" disabled={!p.somEntradaSaida} onClick={() => tocarSom('entrou', vol)}>Entrou</button>
          <button type="button" className="btn btn-sm" disabled={!p.somEntradaSaida} onClick={() => tocarSom('saiu', vol)}>Saiu</button>
        </span>
      </Linha>
    </>
  );
}

const CANTOS: [PosicaoQuemFala, string][] = [
  ['sup-esq', 'Em cima, à esquerda'], ['sup-dir', 'Em cima, à direita'],
  ['meio-esq', 'No meio, à esquerda'], ['meio-dir', 'No meio, à direita'],
  ['inf-esq', 'Embaixo, à esquerda'], ['inf-dir', 'Embaixo, à direita'],
];
const POSICAO_PREVIA: Record<PosicaoQuemFala, string> = {
  'sup-esq': 'top-2 left-2 origin-top-left', 'sup-dir': 'top-2 right-2 origin-top-right', 'meio-esq': 'top-1/2 left-2 origin-left -translate-y-1/2', 'meio-dir': 'top-1/2 right-2 origin-right -translate-y-1/2',
  'inf-esq': 'bottom-2 left-2 origin-bottom-left', 'inf-dir': 'bottom-2 right-2 origin-bottom-right', livre: 'top-1/2 left-1/2 origin-center -translate-x-1/2 -translate-y-1/2',
};

/** Você > Janela quem fala, with a live preview over a drawn game frame. */
export function PaginaQuemFala({ destaque }: Pagina) {
  const [p, mudar] = usePreferencias();
  const tecla = lerAtalhos().teclas.quemFala;
  const conteudo = p.quemFalaConteudo === 'falando' ? 'só quem fala' : 'todos';
  const tamanho = { p: 'pequeno', m: 'médio', g: 'grande' }[p.quemFalaTamanho];
  return (
    <>
      <Cabecalho rotulo="Você · janela separada, sempre no topo" titulo="Janela quem fala" />
      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-3 max-[1180px]:grid-cols-1">
        <div className="flex flex-col gap-2">
          <Linha ajuste="quemfala-mostrar" titulo="Mostrar a janela" descricao="Fica por cima do jogo em tela cheia sem borda. Nada entra no jogo." destaque={destaque === 'quemfala-mostrar'}>
            <Chave rotulo="Mostrar a janela quem fala" ligado={p.quemFalaMostrar} onMudar={(quemFalaMostrar) => mudar({ quemFalaMostrar })} textos={['Ligada', 'Desligada']} />
          </Linha>
          <Linha ajuste="quemfala-conteudo" titulo="O que mostrar" descricao="Em “todos da sala”, quem fala acende em lima." destaque={destaque === 'quemfala-conteudo'}>
            <Segmento rotulo="O que a janela mostra" valor={p.quemFalaConteudo} opcoes={[['falando', 'Só quem fala'], ['todos', 'Todos da sala']]} onMudar={(quemFalaConteudo) => mudar({ quemFalaConteudo })} />
          </Linha>
          <Linha ajuste="quemfala-opacidade" titulo="Opacidade" descricao="Mais baixa deixa ver o jogo por trás." destaque={destaque === 'quemfala-opacidade'}>
            <Deslizante rotulo="Opacidade da janela" valor={p.quemFalaOpacidade} min={20} max={100} passo={5} onMudar={(quemFalaOpacidade) => mudar({ quemFalaOpacidade })} />
          </Linha>
          <Linha ajuste="quemfala-tamanho" titulo="Tamanho" destaque={destaque === 'quemfala-tamanho'}>
            <Segmento rotulo="Tamanho da janela" valor={p.quemFalaTamanho} opcoes={[['p', 'Pequeno'], ['m', 'Médio'], ['g', 'Grande']]} onMudar={(quemFalaTamanho) => mudar({ quemFalaTamanho })} />
          </Linha>
          <Linha ajuste="quemfala-posicao" titulo="Posição" destaque={destaque === 'quemfala-posicao'}
            descricao={p.quemFalaPosicao === 'livre' ? 'Onde ela estava. Escolha um canto do monitor principal.' : 'Canto do monitor principal. Em tela cheia exclusiva o Windows pode esconder a janela; use janela sem borda.'}>
            <span className="flex items-center gap-3">
              <span role="radiogroup" aria-label="Canto da tela" className="grid grid-cols-[repeat(2,28px)] grid-rows-[repeat(3,20px)] gap-[3px] border border-texto p-1">
                {CANTOS.map(([id, texto]) => (
                  <button key={id} type="button" role="radio" aria-checked={p.quemFalaPosicao === id} aria-label={texto} title={texto}
                    onClick={() => mudar({ quemFalaPosicao: id })}
                    className={`border ${p.quemFalaPosicao === id ? 'border-texto bg-texto' : 'border-borda bg-superficie hover:bg-superficie-alta'}`} />
                ))}
              </span>
            </span>
          </Linha>
          <Linha ajuste="quemfala-mostrar" titulo="Atalho para mostrar e esconder" descricao={tecla ? <>Tecla: <span className="font-mono">{tecla}</span></> : 'Nenhum vem pronto.'}>
            <span className="rotulo">Em Você › Atalhos</span>
          </Linha>
        </div>
        <section className="janela flex flex-col" aria-label="Prévia da janela quem fala">
          <div className="barra">Prévia<span className="ml-auto font-medium">{conteudo} · {p.quemFalaOpacidade}% · {tamanho}</span></div>
          <div className="relative aspect-video overflow-hidden bg-[linear-gradient(#56636f_0_46%,#7c6f58_46%_100%)]">
            <span aria-hidden="true" className="absolute top-[40%] right-[30%] bottom-[30%] left-[30%] bg-[#a08f6d]" />
            <div className={`absolute scale-[0.7] ${POSICAO_PREVIA[p.quemFalaPosicao]}`}>
              <QuemFalaLista estado={ESTADO_EXEMPLO} prefs={p} largura={JANELA_FALANTES.largura} />
            </div>
          </div>
          <p className="m-0 px-3 py-2.5 text-[13px] text-texto-fraco">{p.quemFalaMostrar ? 'Assim ela aparece por cima do jogo.' : 'Desligada: a janela não aparece.'}</p>
        </section>
      </div>
    </>
  );
}

/** Você > Mapa do CS2: the room split by team, from the official Valve GSI. */
export function PaginaCs2({ destaque }: Pagina) {
  const [p, mudar] = usePreferencias();
  // Path where the file goes (null: CS2 not found); `instalado` only after installing here.
  const [gsi, setGsi] = useState<{ caminho: string | null; instalado: boolean } | undefined>();
  const [confirmar, setConfirmar] = useState(false);
  const [erro, setErro] = useState<string>();
  const [instalando, setInstalando] = useState(false);
  useEffect(() => void nucleo.gsiLocalizar().then((caminho) => setGsi({ caminho, instalado: false }), (e: unknown) => {
    setGsi({ caminho: null, instalado: false });
    setErro(erroDe(e));
  }), []);
  async function instalar() {
    setConfirmar(false);
    setErro(undefined);
    setInstalando(true);
    try {
      setGsi({ caminho: await nucleo.gsiInstalar(), instalado: true });
    } catch (e) {
      setErro(erroDe(e));
    } finally {
      setInstalando(false);
    }
  }
  return (
    <>
      <Cabecalho rotulo="Você · vale para este PC" titulo="Mapa do CS2">
        Durante a partida, a sala se divide em CT e TR sozinha. As telas do outro time ficam escondidas até o fim do round.
      </Cabecalho>
      <Linha ajuste="cs2-sala" titulo="Sala do mapa" destaque={destaque === 'cs2-sala'}
        descricao="Liga a troca automática para a sub-sala do seu time. Precisa da integração com o CS2, logo abaixo.">
        <Chave rotulo="Sala do mapa do CS2" ligado={p.cs2SalaMapa} onMudar={(cs2SalaMapa) => mudar({ cs2SalaMapa })} />
      </Linha>
      <Linha ajuste="cs2-gsi" titulo="Integração com o CS2" destaque={destaque === 'cs2-gsi'}
        descricao={gsi === undefined ? 'Procurando o CS2…' : gsi.caminho === null ? 'O CS2 não foi encontrado neste PC.'
          : gsi.instalado ? <>Instalada em <span className="break-all font-mono text-[12px]">{gsi.caminho}</span>. Feche e abra o CS2.</>
            : 'O arquivo oficial de Game State Integration da Valve. O CS2 manda o time e o round para este PC; nada entra no jogo.'}>
        {gsi?.instalado ? <span className="rotulo text-vitoria">● instalada</span> : (
          <button type="button" className="btn" disabled={!gsi?.caminho || instalando} onClick={() => setConfirmar(true)}>{instalando ? 'Instalando…' : 'Instalar integração'}</button>
        )}
      </Linha>
      {confirmar && (
        <Faixa tipo="aviso" acoes={[{ rotulo: 'Instalar', principal: true, onClick: () => void instalar() }, { rotulo: 'Cancelar', onClick: () => setConfirmar(false) }]}>
          Vai criar <span className="break-all font-mono text-[12px]">{gsi?.caminho}</span>. Feche e abra o CS2 depois. Para desfazer, apague o arquivo.
        </Faixa>
      )}
      {erro && <Faixa acoes={[{ rotulo: 'Tentar de novo', onClick: () => void instalar() }]}>Não deu para instalar. {erro}</Faixa>}
    </>
  );
}
