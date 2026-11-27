import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MIC_BLOQUEADO } from '../../room/useLiveRoom';
import { Avatar } from '../../components/Avatar';
import { Faixa } from '../../components/Faixa';
import { Icone } from '../../components/Icone';
import { useInterfaceAtiva } from '../../lib/leveza';
import { ehCelular, podeTransmitirNoNavegador, temNucleo, useCompacto, useDeitado } from '../../lib/ambiente';
import { demoScreen } from '../../lib/config';
import { ultimoAlvo, esperaCutucar, marcarCutucada, marcarSilenciado } from '../../lib/cutucadas';
import { replay as nucleoReplay } from '../../lib/nucleo';
import { lerPreferencias, salvarPreferencias } from '../../lib/preferencias';
import { publicarQuemFala } from '../../lib/quemfala';
import { registrarItensSala, type ItemPaleta } from '../../lib/paleta';
import type { AcaoModeracao, Pessoa, Sala, Usuario } from '../../lib/servidor';
import type { Attachable, ChatMessage, Person, RoomActions, RoomModel, Stream } from '../../room/model';
import { RECUO_MS } from '../../room/reconexao';
import { barrasDe, nomesReplay, textoRede, type Rede } from '../../room/sala05';
import { GoLive } from '../GoLive';
import { ACOES, aoAtalho, aoMudarAtalhos, bipe, criarControleVoz, lerAtalhos, type AcaoId } from '../../lib/atalhos';
import type { ComSala } from '../Room';
import { Cutucar } from './Cutucar';
import { MenuPessoa } from './MenuPessoa';
import { navegarMenu, Popover, type Ancora } from './Popover';

/**
 * The room (0.5 interface, docs/design/v05-interface.md section 4 and docs/design/v05/index.html).
 * Lives outside Room.tsx so the lobby (another thread) and the room change in different files.
 */
export type Reconexao = { falhas: number; esgotou: boolean };

const fmt = (n: number, d = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
const qualidadePing = (ms: number) => (ms <= 150 ? 'bom' : ms <= 250 ? 'ok' : 'alto');
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const ancoraDe = (el: Element, abaixo = false): Ancora => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: abaixo ? r.bottom + 4 : r.top };
};

type Painel =
  | { tipo: 'menu'; id: string; ancora: Ancora }
  | { tipo: 'cutucar'; id: string; ancora: Ancora }
  | { tipo: 'ouvem'; ancora: Ancora }
  | { tipo: 'mais'; ancora: Ancora }
  | { tipo: 'sala'; ancora: Ancora }
  | null;

export function RoomView(props: ComSala & { model: RoomModel & RoomActions; reconexao: Reconexao; onRetry(): void }) {
  const { model, sala, salas, pessoas, eu, demo, onSala, onCartao, onConvidar, servidor } = props;
  const [goLive, setGoLive] = useState(() => demo && demoScreen() === 'ar');
  const [fallback, setFallback] = useState(false);
  const [stageId, setStageId] = useState<string | null>(null);
  const [convite, setConvite] = useState<'' | 'gerando' | 'copiado' | { erro: string }>('');
  const [confirmarAr, setConfirmarAr] = useState(0);
  const [painel, setPainel] = useState<Painel>(null);
  const [grade, setGrade] = useState(() => new URLSearchParams(location.search).has('grade'));
  const [replayAtivo, setReplayAtivo] = useState(false);
  const compacto = useCompacto();
  // Web app: no core (clips, overlay); screen capture only where the browser has it (not phones).
  const nucleo = temNucleo();
  const podeTransmitir = nucleo || podeTransmitirNoNavegador();
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);
  const antesDoMudo = useRef(new Map<string, number>());
  const me = model.people.find((p) => p.isLocal);
  const imLive = !!me?.live;
  const emGrade = grade && model.streams.length >= 2;
  const stage = model.streams.find((s) => s.owner.id === stageId) ?? model.streams[0];
  const others = model.people.filter((p) => !p.isLocal);
  const porId = new Map(pessoas.map((p) => [p.id, p] as const));
  const conectada = model.state === 'connected';
  const gravando = model.people.filter((p) => p.replay);

  // Replay state and clip results come from the core (stackcall-replay); the clip is ready only on "saved".
  useEffect(() => {
    void nucleoReplay.atual().then(setReplayAtivo, () => setReplayAtivo(false));
    return nucleoReplay.aoEvento((e) => {
      if (e.event === 'state') setReplayAtivo(e.ativo);
      else if (e.event === 'saved') {
        bipe('liga');
        avisar(`Clipe de ${Math.round(e.duracao)} s salvo. Veja em Clipes, no topo.`);
      } else avisar(`O replay parou. ${e.motivo}`, true);
    });
  }, []);
  const replay = { ligado: replayAtivo, segundos: lerPreferencias().replaySegundos };
  useEffect(() => {
    marcarSilenciado(model.deafened);
    return () => marcarSilenciado(false);
  }, [model.deafened]);
  // "Quem fala" window: equal states are dropped by publicarQuemFala, so every render may call it.
  useEffect(() => publicarQuemFala({
    sala: sala.nome, ping: model.ping, replay: replayAtivo,
    pessoas: model.people.map((p) => ({ id: p.id, nome: p.name, cor: porId.get(p.id)?.cor ?? null, falando: p.speaking, mudo: p.muted })),
  }));
  useEffect(() => () => publicarQuemFala(null), []);
  // Grid: receive every screen while it is open; back to one when it closes.
  useEffect(() => {
    model.assistirTodas?.(emGrade);
    if (!emGrade) model.setSomTela?.(null);
  }, [emGrade]);

  // Red dot on the tray icon while streaming; cleared when the stream ends or the room closes.
  useEffect(() => {
    if (!isTauri() || !imLive) return;
    const marcar = (noAr: boolean) => void invoke('bandeja_no_ar', { noAr }).catch(() => undefined);
    marcar(true);
    return () => marcar(false);
  }, [imLive]);

  const avisar = (texto: string, erro = false) => setAviso({ texto, erro });

  // Keyboard: M mic, S sound, T transmit (app in focus). Never while typing or with a dialog open.
  // The same voice actions answer the global shortcuts (lib/atalhos), which beep because the game hides the app.
  const atual = useRef({ model, conectada, imLive, goLive, stage, others });
  atual.current = { model, conectada, imLive, goLive, stage, others };
  const voz = useMemo(() => criarControleVoz({
    micAberto: () => atual.current.model.micOn,
    abrirMic: (on) => (atual.current.model.setMic ? atual.current.model.setMic(on) : on !== atual.current.model.micOn && atual.current.model.toggleMic()),
    silenciado: () => atual.current.model.deafened,
    alternarSilencio: () => atual.current.model.toggleDeafen(),
  }), []);
  useEffect(() => () => voz.parar(), [voz]);

  async function salvarClipe() {
    try {
      await nucleoReplay.salvar();
    } catch (e) {
      avisar(`Não deu para salvar o clipe. ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }
  const alternarRedeRuim = () => {
    const on = !atual.current.model.redeRuim;
    atual.current.model.setRedeRuim?.(on);
    bipe(on ? 'desliga' : 'liga');
  };
  // Same preference as Settings and the global shortcut; the main window shows or hides the window.
  const alternarQuemFala = () => {
    const mostrar = !lerPreferencias().quemFalaMostrar;
    salvarPreferencias({ quemFalaMostrar: mostrar });
    avisar(mostrar ? 'Janela quem fala aberta.' : 'Janela quem fala escondida.');
  };
  async function cutucarDeNovo() {
    const alvo = ultimoAlvo();
    if (!alvo || esperaCutucar(alvo) > 0) return;
    await servidor.cutucar(alvo, '').then(() => { marcarCutucada(alvo); bipe('liga'); }, () => bipe('desliga'));
  }

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (alvo?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]') || document.querySelector('[aria-modal="true"]')) return;
      const a = atual.current;
      const k = e.key.toLowerCase();
      if (k === 'm') voz.executar('mic', 'pressionado', false);
      else if (k === 's') voz.executar('silenciar', 'pressionado', false);
      else if (k === 't' && podeTransmitir && a.conectada && !a.imLive && !a.goLive) setGoLive(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', tecla);
    const parar = aoAtalho((id: AcaoId, estado) => {
      if (voz.executar(id, estado) || estado !== 'pressionado') return;
      const a = atual.current;
      const tela = a.stage && !a.stage.owner.isLocal ? a.stage : undefined;
      if (id === 'arEntrar' && a.conectada && !a.imLive) {
        // First press opens with the last choice; a second press while open confirms it.
        if (a.goLive) setConfirmarAr((n) => n + 1);
        else setGoLive(true);
        bipe('liga');
      } else if (id === 'arSair' && a.imLive) {
        a.model.stopLive();
        bipe('desliga');
      } else if (id === 'assistir' && tela && !tela.watching) {
        a.model.watch(tela.owner.id);
        bipe('liga');
      } else if (id === 'pararAssistir' && tela?.watching) {
        a.model.unwatch(tela.owner.id);
        bipe('desliga');
      } else if (id === 'clipe') void salvarClipe();
      else if (id === 'redeRuim') alternarRedeRuim();
      else if (id === 'cutucarUltimo') void cutucarDeNovo();
    });
    return () => {
      window.removeEventListener('keydown', tecla);
      parar();
    };
  }, [voz]);

  // The palette (above every screen) lists the room's live actions.
  useEffect(() => registrarItensSala((): ItemPaleta[] => {
    const a = atual.current;
    const ruim = !!a.model.redeRuim;
    return [
      { id: 'sala-rede', grupo: 'acoes', rotulo: 'Modo internet ruim', detalhe: ruim ? 'ligado' : undefined, onde: ruim ? 'desligar' : 'ligar', icone: 'antena',
        apelidos: ['lag', 'rede', 'voz primeiro'], teclas: lerAtalhos().teclas.redeRuim, executar: alternarRedeRuim },
      ...(temNucleo() ? [
        { id: 'sala-clipe', grupo: 'acoes', rotulo: 'Salvar clipe', onde: 'clipes', icone: 'replay', teclas: lerAtalhos().teclas.clipe, executar: () => void salvarClipe() },
        { id: 'sala-quemfala', grupo: 'acoes', rotulo: 'Mostrar ou esconder a janela quem fala', onde: 'janela', icone: 'pessoa', executar: alternarQuemFala },
      ] satisfies ItemPaleta[] : []),
      ...(temNucleo() || podeTransmitirNoNavegador() ? [{ id: 'sala-transmitir', grupo: 'acoes', rotulo: a.imLive ? 'Sair do ar' : 'Transmitir', onde: 'transmitir', icone: 'tela',
        executar: () => (a.imLive ? a.model.stopLive() : setGoLive(true)) }] satisfies ItemPaleta[] : []),
      ...a.others.flatMap((p): ItemPaleta[] => [{
        id: `sala-cutucar-${p.id}`, grupo: 'salas', pessoa: true, rotulo: `Cutucar ${p.name}`, detalhe: textoRede(p.rede ?? { qualidade: 'boa' }) ?? undefined,
        onde: 'na sala', icone: 'cutuca', executar: () => abrirCutucar(p.id),
      }]),
    ];
  }), []);

  function abrirCutucar(id: string, ancora?: Ancora) {
    const el = document.querySelector(`[data-canal="${CSS.escape(id)}"]`);
    setPainel({ tipo: 'cutucar', id, ancora: ancora ?? (el ? ancoraDe(el) : { x: innerWidth / 2 - 208, y: innerHeight / 2 - 120 }) });
  }

  async function convidar() {
    setConvite('gerando');
    try {
      await onConvidar();
      setConvite('copiado');
    } catch (e) {
      setConvite({ erro: e instanceof Error ? e.message : String(e) });
    }
  }

  async function moderar(acao: AcaoModeracao, nome: string) {
    try {
      await servidor.moderar(sala.id, acao);
      props.onPresenceChange?.();
      avisar(acao.acao === 'mover' ? `${nome} foi movido.` : acao.acao === 'retirar' ? `${nome} saiu da sala.` : 'Todos os microfones da sala foram desligados. Cada um pode religar o seu.');
    } catch (e) {
      avisar(`Não deu para moderar. ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  const silenciarParaMim = (p: Person) => {
    if (p.volume > 0) {
      antesDoMudo.current.set(p.id, p.volume);
      model.setVolume(p.id, 0);
    } else model.setVolume(p.id, antesDoMudo.current.get(p.id) ?? 1);
  };

  const abrirGoLive = () => setGoLive(true);
  const vivo = model.state === 'connected' || model.state === 'reconnecting';
  const linha = `${model.people.length} na sala · ${stage ? `${stage.owner.isLocal ? 'você' : stage.owner.name} no ar` : 'ninguém no ar'}`;
  const alvoMenu = painel?.tipo === 'menu' || painel?.tipo === 'cutucar' ? model.people.find((p) => p.id === painel.id) : undefined;

  const voce = (
    <Voce model={model} nome={eu.nome} sala={sala.nome} imLive={imLive} replay={replay} podeTransmitir={podeTransmitir} temClipe={nucleo}
      onGoLive={abrirGoLive} onSair={() => onSala(null)} onClipe={() => void salvarClipe()}
      onFallback={() => { model.clearStreamError?.(); setFallback(true); setGoLive(true); }}
      onOuvem={(el) => setPainel({ tipo: 'ouvem', ancora: { x: el.getBoundingClientRect().left - 10, y: el.getBoundingClientRect().top - 8 } })}
      onMais={(el) => setPainel({ tipo: 'mais', ancora: ancoraDe(el) })} />
  );
  const abrirMenuSala = (el: HTMLElement) =>
    setPainel({ tipo: 'sala', ancora: { x: Math.max(8, el.getBoundingClientRect().right - 260), y: el.getBoundingClientRect().bottom + 4 } });

  return (
    <>
      {compacto ? (
        <SalaCompacta sala={sala.nome} linha={linha} model={model} stage={stage} others={others} porId={porId} pessoas={pessoas} salas={salas} eu={eu}
          aviso={aviso} onFecharAviso={() => setAviso(null)} reconexao={props.reconexao} onRetry={props.onRetry}
          onCartao={onCartao} onAmigo={props.onAmigo} onMenuSala={abrirMenuSala} voce={voce}
          onMenuPessoa={(id, ancora) => setPainel({ tipo: 'menu', id, ancora })} />
      ) : (
      <div className="grid min-h-0 grid-rows-[36px_minmax(0,1fr)_164px] gap-2.5">
        <div className="flex min-w-0 items-center gap-3.5">
          <h1 className="text-[32px] leading-none">{sala.nome}</h1>
          <span className="rotulo truncate">{linha}</span>
          {gravando.length > 0 && (
            <span className="inline-flex h-[30px] shrink-0 items-center gap-2 border border-texto bg-superficie px-2.5 text-[13px]" role="status"
              title="Quem está com o replay ligado grava os últimos segundos da sala">
              <span className="text-destaque"><Icone nome="replay" tamanho={16} /></span>
              <span><b>Replay ligado:</b> {nomesReplay(gravando.map((p) => (p.isLocal ? 'você' : p.name)))}</span>
            </span>
          )}
          {model.streams.length >= 2 && (
            <div className="abas shrink-0 [&>button]:min-h-[30px]" role="group" aria-label="Arranjo das telas">
              <button type="button" aria-pressed={!grade} onClick={() => setGrade(false)}><Icone nome="uma" tamanho={14} /> Uma</button>
              <button type="button" aria-pressed={grade} onClick={() => setGrade(true)}><Icone nome="grade" tamanho={14} /> Grade</button>
            </div>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {convite === 'copiado' && <span role="status" className="text-[13px] text-texto-fraco">Link copiado. Vale 7 dias e 1 uso.</span>}
            <button type="button" className="btn btn-sm" disabled={convite === 'gerando'} onClick={() => void convidar()}>
              <Icone nome="link" tamanho={16} />{convite === 'gerando' ? 'Gerando…' : 'Convidar'}
            </button>
            <button type="button" className="btn btn-sm btn-icone" aria-label="Menu da sala" aria-haspopup="menu" title="Menu da sala"
              onClick={(e) => abrirMenuSala(e.currentTarget)}>
              <Icone nome="pontos" tamanho={16} />
            </button>
          </span>
        </div>

        <main className={`grid min-h-0 gap-3 ${emGrade ? 'grid-cols-[minmax(0,1fr)_44px]' : 'grid-cols-[minmax(0,1fr)_330px]'}`}>
          <section className="flex min-h-0 min-w-0 flex-col gap-2">
            {typeof convite === 'object' && (
              <Faixa acoes={[{ rotulo: 'Tentar de novo', onClick: () => void convidar() }]} onFechar={() => setConvite('')}>
                Não deu para gerar o convite. {convite.erro}
              </Faixa>
            )}
            {aviso && <Faixa tipo={aviso.erro ? 'erro' : 'aviso'} onFechar={() => setAviso(null)}>{aviso.texto}</Faixa>}
            {model.avisoImagem && <Faixa tipo="aviso" onFechar={model.fecharAvisoImagem}>{model.avisoImagem}</Faixa>}
            {emGrade ? (
              <Grade model={model} streams={model.streams} />
            ) : stage || !vivo ? (
              <Palco model={model} stage={stage} reconexao={props.reconexao} jogo={stage ? porId.get(stage.owner.id)?.jogo : null} onPick={(id) => {
                if (stage?.watching && !stage.owner.isLocal && stage.owner.id !== id) model.unwatch(stage.owner.id);
                setStageId(id);
              }} onRetry={props.onRetry} />
            ) : (
              <SalaLivre model={model} others={others} porId={porId} pessoas={pessoas} salas={salas} sala={sala}
                onCartao={onCartao} onMenu={(id, ancora) => setPainel({ tipo: 'menu', id, ancora })} />
            )}
          </section>
          {emGrade
            ? <ConversaFina chat={model.chat} onAbrir={() => setGrade(false)} />
            : <Lateral sala={sala.nome} model={model} pessoas={pessoas} salas={salas} eu={eu} onCartao={onCartao} onAmigo={props.onAmigo} />}
        </main>

        <footer className="grid min-h-0 min-w-0 grid-cols-[372px_minmax(0,1fr)] gap-3">
          {voce}
          {stage || emGrade ? (
            <ul aria-label="Pessoas na sala" className="m-0 grid min-w-0 list-none auto-cols-[minmax(200px,1fr)] grid-flow-col gap-3 overflow-x-auto p-0">
              {others.map((p) => (
                <Canal key={p.id} person={p} perfil={porId.get(p.id)} onVolume={(v) => model.setVolume(p.id, v)} onCartao={() => onCartao(p.id)}
                  onMenu={(ancora) => setPainel({ tipo: 'menu', id: p.id, ancora })} onAssistir={() => p.live && model.watch(p.id)} />
              ))}
              {others.length === 0 && <li className="flex items-center px-2 text-[14px] text-texto-fraco">Só você na sala.</li>}
            </ul>
          ) : (
            <Atalhos />
          )}
        </footer>
      </div>
      )}

      {painel?.tipo === 'menu' && alvoMenu && (
        <MenuPessoa ancora={painel.ancora} person={alvoMenu} perfil={porId.get(alvoMenu.id)} eu={eu} salas={salas} salaAtual={sala.id}
          esperaCutucar={esperaCutucar(alvoMenu.id)} silenciadoParaMim={alvoMenu.volume === 0} onFechar={() => setPainel(null)}
          onVolume={(v) => model.setVolume(alvoMenu.id, v)}
          onPerfil={() => onCartao(alvoMenu.id)}
          onAssistir={() => model.watch(alvoMenu.id)}
          onCutucar={() => abrirCutucar(alvoMenu.id, painel.ancora)}
          onSilenciarParaMim={() => silenciarParaMim(alvoMenu)}
          onMover={(destinoId) => void moderar({ acao: 'mover', usuarioId: alvoMenu.id, destinoId }, alvoMenu.name)}
          onTirar={() => void moderar({ acao: 'retirar', usuarioId: alvoMenu.id }, alvoMenu.name)} />
      )}
      {painel?.tipo === 'cutucar' && alvoMenu && (
        <Cutucar ancora={painel.ancora} alvo={{ id: alvoMenu.id, nome: alvoMenu.name }} eu={eu.nome} servidor={servidor}
          somDesligado={false} onFechar={() => setPainel(null)} onEnviada={() => avisar(`${alvoMenu.name} foi cutucado.`)} />
      )}
      {painel?.tipo === 'ouvem' && (
        <QuemRecebe ancora={painel.ancora} model={model} imLive={imLive} onFechar={() => setPainel(null)} />
      )}
      {painel?.tipo === 'sala' && (
        <Popover ancora={painel.ancora} onFechar={() => setPainel(null)} rotulo="Menu da sala" role="menu" className="w-[260px] py-1">
          <div onKeyDown={navegarMenu}>
            {[
              ...(eu.papel === 'dono' || eu.papel === 'admin' ? [{ t: 'Silenciar todos', f: () => void moderar({ acao: 'silenciar' }, sala.nome), i: 'mic-off' as const }] : []),
              { t: 'Sair da sala', f: () => onSala(null), i: 'sair' as const },
            ].map((o) => (
              <button key={o.t} type="button" role="menuitem" onClick={() => { setPainel(null); o.f(); }}
                className="flex h-[34px] w-full items-center gap-2.5 border-0 bg-transparent px-3 text-left text-[14px] hover:bg-texto hover:text-superficie focus-visible:bg-texto focus-visible:text-superficie focus-visible:outline-none">
                <Icone nome={o.i} tamanho={16} />{o.t}
              </button>
            ))}
          </div>
        </Popover>
      )}
      {painel?.tipo === 'mais' && (
        <Popover ancora={painel.ancora} onFechar={() => setPainel(null)} rotulo="Mais" role="menu" className="w-[260px] py-1">
          <div onKeyDown={navegarMenu}>
            {[
              { t: model.redeRuim ? 'Desligar modo internet ruim' : 'Modo internet ruim', f: alternarRedeRuim, i: 'antena' as const },
              ...(nucleo ? [{ t: 'Mostrar ou esconder a janela quem fala', f: alternarQuemFala, i: 'pessoa' as const }] : []),
              { t: 'Teste de rede e microfone', f: props.onConfig, i: 'ajustes' as const },
              ...(podeTransmitir ? [{ t: 'Entrar no ar com outra fonte', f: abrirGoLive, i: 'tela' as const, off: !conectada || imLive }] : []),
            ].map((o) => (
              <button key={o.t} type="button" role="menuitem" aria-disabled={o.off || undefined}
                onClick={o.off ? undefined : () => { setPainel(null); o.f(); }}
                className={`flex h-[34px] w-full items-center gap-2.5 border-0 bg-transparent px-3 text-left text-[14px] hover:bg-texto hover:text-superficie focus-visible:bg-texto focus-visible:text-superficie focus-visible:outline-none ${o.off ? 'text-texto-fraco' : ''}`}>
                <Icone nome={o.i} tamanho={16} />{o.t}
              </button>
            ))}
          </div>
        </Popover>
      )}

      {goLive && (
        <GoLive
          demo={demo}
          fallback={fallback}
          server={servidor.url}
          roomLabel={sala.nome}
          viewers={Math.max(0, model.people.length - 1)}
          confirmar={confirmarAr}
          onCancel={() => { setGoLive(false); setFallback(false); setConfirmarAr(0); }}
          onStart={async (track, preset, codec) => {
            await model.goLive(track, preset, codec);
            setGoLive(false);
            setFallback(false);
          }}
          onNativeStart={model.goLiveNative && (async (...args) => {
            await model.goLiveNative!(...args);
            setGoLive(false);
          })}
        />
      )}
    </>
  );
}

/** "Quem recebe você": opens above the Você window. Someone who silenced you only for themselves still shows (decision 2). */
function QuemRecebe({ ancora, model, imLive, onFechar }: { ancora: Ancora; model: RoomModel; imLive: boolean; onFechar(): void }) {
  const lista = model.receptores ?? [];
  const avatar = (id: string, nome: string) => <Avatar pessoa={{ nome, avatar: null }} tamanho={28} key={id} />;
  return (
    <Popover ancora={{ x: ancora.x, y: Math.max(8, ancora.y - (lista.length * 43 + 110)) }} onFechar={onFechar} rotulo="Quem recebe você" className="w-[372px]">
      <div className="barra">Quem recebe você<span className="ml-auto font-medium">voz · tela</span></div>
      {lista.length === 0 ? (
        <p className="m-0 px-3 py-3 text-[13px] text-texto-fraco">Ninguém mais aqui. Para chamar alguém, clique com o botão direito no nome e escolha Cutucar.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {lista.map((r) => (
            <li key={r.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto_44px] items-center gap-2.5 border-b border-borda px-3 py-[7px]">
              {avatar(r.id, r.nome)}
              <b className="truncate text-[14px]">{r.nome}</b>
              <span className={`font-mono text-[11px] font-bold uppercase ${r.voz ? 'text-vitoria' : 'text-texto-fraco'}`}>{r.voz ? '✓ voz' : r.motivo ?? '—'}</span>
              <span className={`text-center font-mono text-[11px] ${r.tela ? 'font-bold text-vitoria uppercase' : 'text-texto-fraco'}`}>{r.tela ? '✓ tela' : '—'}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 px-3 pt-2 pb-3 text-[12.5px] text-texto-fraco">
        {imLive ? 'Quem assiste a sua tela aparece em “tela”.' : 'Você não está transmitindo. Quando estiver, quem assiste aparece em “tela”.'}
      </p>
    </Popover>
  );
}

/** Local keys (app in focus) and the global shortcuts the person configured in Settings > Atalhos. */
export function Atalhos() {
  const [cfg, setCfg] = useState(lerAtalhos);
  useEffect(() => aoMudarAtalhos(setCfg), []);
  const locais: [string, string][] = [['M', 'microfone'], ['S', 'silencia tudo'], ['T', 'transmite'], ['Ctrl+K', 'busca e comandos']];
  const globais = ACOES.flatMap((a) => (cfg.teclas[a.id] ? [[cfg.teclas[a.id]!, a.rotulo.toLowerCase()] as [string, string]] : []));
  const item = ([k, t]: [string, string]) => (
    <li key={k + t} className="flex items-center gap-2 text-[14px]">
      <kbd className="inline-flex h-8 min-w-8 items-center justify-center border border-texto bg-superficie-alta px-1.5 font-mono text-[13px] font-bold">{k}</kbd>
      <span className="text-texto-fraco">{t}</span>
    </li>
  );
  return (
    <section className="janela flex min-w-0 flex-col" aria-label="Atalhos do teclado">
      <div className="barra">Atalhos<span className="ml-auto font-medium">{globais.length ? `${globais.length} globais` : 'com o app em foco'}</span></div>
      <ul className="m-0 flex flex-1 list-none flex-wrap content-center items-center gap-x-6 gap-y-2 px-4 py-3">
        {locais.map(item)}
        {globais.length > 0 ? (
          <>
            <li aria-hidden="true" className="h-6 w-px bg-borda" />
            {globais.map(item)}
          </>
        ) : (
          <li className="text-[13px] text-texto-fraco">Atalhos com o jogo na frente: Configurações &gt; Atalhos.</li>
        )}
      </ul>
    </section>
  );
}

/** Empty stage: a slim strip (the one red Transmit lives in the Você window) and the room's people get the space. */
function SalaLivre({ model, others, porId, pessoas, salas, sala, onCartao, onMenu }: {
  model: RoomModel & RoomActions; others: Person[]; porId: Map<string, Pessoa>; pessoas: Pessoa[]; salas: Sala[]; sala: Sala;
  onCartao(id: string): void; onMenu(id: string, ancora: Ancora): void;
}) {
  const nomeSala = new Map(salas.map((s) => [s.id, s.nome] as const));
  const naVoz = new Set(model.people.map((p) => p.id));
  const fora = pessoas.filter((p) => p.online && !naVoz.has(p.id) && p.sala !== sala.id);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="janela flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 pr-3 pl-4">
        <b className="font-display text-[28px]">Palco livre</b>
        <span className="text-texto-fraco">Ninguém transmitindo. Use Transmitir na janela Você para mostrar seu jogo.</span>
      </div>
      <section className="janela flex min-h-0 flex-1 flex-col" aria-label="Pessoas na sala">
        <div className="barra">Na sala<span className="ml-auto font-medium">{plural(model.people.length, 'pessoa', 'pessoas')}</span></div>
        {others.length > 0 ? (
          <ul className="m-0 grid min-h-0 flex-1 list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-3 overflow-y-auto p-3">
            {others.map((p) => (
              <Canal key={p.id} person={p} perfil={porId.get(p.id)} onVolume={(v) => model.setVolume(p.id, v)} onCartao={() => onCartao(p.id)}
                onMenu={(ancora) => onMenu(p.id, ancora)} onAssistir={() => undefined} />
            ))}
          </ul>
        ) : (
          <Vazio titulo="Só você por aqui" texto="Chame a galera em Convidar: o link vale 7 dias e 1 uso. Para o grupo todo, gere um link de grupo em Configurações › Geral e convites.">
            {fora.length > 0 && (
              <div className="mt-3 flex flex-col items-center gap-2">
                <span className="rotulo">Online em outro lugar · {fora.length}</span>
                <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
                  {fora.slice(0, 8).map((p) => (
                    <li key={p.id}>
                      <button type="button" className="btn btn-fant gap-2 px-2" onClick={() => onCartao(p.id)} aria-label={`Ver perfil de ${p.nome}`}>
                        <Avatar pessoa={p} tamanho={28} />
                        <span className="text-[13px]">{p.nome}<span className="text-texto-fraco"> · {p.sala ? nomeSala.get(p.sala) ?? 'outra sala' : 'fora da voz'}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Vazio>
        )}
      </section>
    </div>
  );
}

export function TrackVideo({ track, className, muted = true, pip = false, videoRef }: {
  track?: Attachable; className?: string; muted?: boolean; pip?: boolean; videoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const proprio = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? proprio;
  const ativa = useInterfaceAtiva();
  // Detached while nobody sees the window: the decoder stops drawing (leveza). PiP keeps it attached.
  useEffect(() => {
    const el = ref.current;
    if (!track || !el || (!ativa && document.pictureInPictureElement !== el)) return;
    track.attach(el);
    return () => void track.detach(el);
  }, [track, ativa]);
  // Picture in picture only where the stage offers it (the button), never the browser's own overlay elsewhere.
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} disablePictureInPicture={!pip} />;
}

async function toggleFullscreen(el: HTMLElement, video?: HTMLVideoElement | null) {
  const v = video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null | undefined;
  // iPhone Safari has no element full screen: its own player takes the display and turns sideways.
  if (!document.fullscreenEnabled && v?.webkitEnterFullscreen) {
    try { v.webkitEnterFullscreen(); } catch { /* video not ready yet: the next tap works */ }
    return;
  }
  const on = !document.fullscreenElement;
  if (on) await el.requestFullscreen?.().catch(() => undefined);
  else await document.exitFullscreen?.().catch(() => undefined);
  // Android: lie the phone down with the video; browsers that refuse the lock just keep the rotation.
  const orientacao = screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> };
  if (on && ehCelular()) await orientacao?.lock?.('landscape').catch(() => undefined);
  // WebView2 fullscreens the element only inside the window; make the window follow.
  if (isTauri()) await getCurrentWindow().setFullscreen(on).catch(() => undefined);
}

const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3];

/** Stage controls: quality, zoom, floating window, full screen. They show on hover or focus. */
function ControlesTela({ model, stream, videoRef, alvo, zoom, setZoom, mini = false, compacto = false }: {
  model: RoomModel & RoomActions; stream: Stream; videoRef: React.RefObject<HTMLVideoElement | null>; alvo: React.RefObject<HTMLDivElement | null>;
  zoom: number; setZoom(z: number): void; mini?: boolean; compacto?: boolean;
}) {
  const q = model.qualidade?.[stream.owner.id] ?? 'original';
  const local = stream.owner.isLocal;
  const s = model.stageStats;
  // Phone: one short row of icons that fits 320 px; zoom stays on the desktop (wheel and buttons).
  const curto = mini || compacto;
  const nomeQ = q === 'leve' ? (compacto ? 'Leve' : 'Leve 720p') : `Original${!curto && s ? ` ${s.height}p${s.fps}` : ''}`;
  const pip = async () => {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => undefined);
    else await v.requestPictureInPicture?.().catch(() => undefined);
  };
  const ctrl = `inline-flex ${mini ? 'h-[30px] min-w-[30px]' : 'h-9 min-w-9'} items-center justify-center gap-2 border border-[#4a4a50] bg-[#101012] px-2 text-[13px] text-[#f4f4f1] hover:border-[#f4f4f1]`;
  return (
    <div role="toolbar" aria-label={`Controles da tela de ${stream.owner.isLocal ? 'você' : stream.owner.name}`}
      className={`absolute ${mini ? 'inset-x-2 bottom-2' : 'inset-x-3 bottom-3'} z-10 flex items-center justify-end gap-1.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`}>
      {!local && model.setQualidade && (
        <button type="button" className={`${ctrl} ${curto ? 'mr-auto' : ''}`} title="Qualidade que você recebe"
          aria-label={`Você recebe: ${nomeQ}. Trocar para ${q === 'leve' ? 'Original' : 'Leve'}`}
          onClick={() => model.setQualidade!(stream.owner.id, q === 'leve' ? 'original' : 'leve')}>
          <span className="font-mono text-[11px] text-[#b3b3ab] uppercase">{curto ? 'Recebe' : 'Você recebe'}</span><b>{nomeQ}</b>
          {!curto && <Icone nome="dir" tamanho={14} />}
        </button>
      )}
      {!curto && stream.track && (
        <span className="inline-flex">
          <button type="button" className={ctrl} aria-label="Diminuir zoom" disabled={zoom <= 1} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}><Icone nome="menos" tamanho={16} /></button>
          <span className={`${ctrl} min-w-[52px] border-x-0 font-mono text-[12px] font-bold`} aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" className={ctrl} aria-label="Aumentar zoom" disabled={zoom >= 3} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}><Icone nome="mais" tamanho={16} /></button>
        </span>
      )}
      {stream.track && (
        <>
          {document.pictureInPictureEnabled && (
            <button type="button" className={ctrl} aria-label="Janela flutuante" title="Janela flutuante" onClick={() => void pip()}><Icone nome="pip" tamanho={16} /></button>
          )}
          <button type="button" className={ctrl} aria-label="Tela cheia" title="Tela cheia (clique duplo)" onClick={() => alvo.current && void toggleFullscreen(alvo.current, videoRef.current)}><Icone nome="cheia" tamanho={16} /></button>
        </>
      )}
      {!mini && stream.watching && !local && (compacto ? (
        <button type="button" className={ctrl} aria-label="Parar de assistir" title="Parar de assistir" onClick={() => model.unwatch(stream.owner.id)}><Icone nome="fechar" tamanho={16} /></button>
      ) : (
        <button type="button" className="btn btn-sm min-h-9" onClick={() => model.unwatch(stream.owner.id)}>Parar de assistir</button>
      ))}
    </div>
  );
}

/** Bad internet mode over the stage: "voz primeiro" and the way back. */
function VozPrimeiro({ model }: { model: RoomModel & RoomActions }) {
  return (
    <div className="absolute inset-0 z-20 grid place-content-center justify-items-center gap-3 bg-palco p-6 text-center text-sobre-palco" role="status">
      <b className="font-pincel -rotate-4 text-[40px] text-lima">voz primeiro</b>
      <p className="m-0 max-w-[52ch] text-[14px]">Modo internet ruim ligado. O vídeo que você recebe está pausado e a sua voz tem prioridade. A sua tela continua indo para quem assiste.</p>
      <button type="button" className="btn btn-sm" onClick={() => model.setRedeRuim?.(false)}>Desligar e voltar o vídeo</button>
    </div>
  );
}

function Palco({ model, stage, reconexao, jogo, onPick, onRetry, compacto = false }: {
  model: RoomModel & RoomActions; stage?: Stream; reconexao: Reconexao; jogo?: string | null; onPick(id: string): void; onRetry(): void;
  compacto?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [zoom, setZoom] = useState(1);
  const [arraste, setArraste] = useState({ x: 0, y: 0 });
  const inicio = useRef<{ x: number; y: number; ax: number; ay: number } | null>(null);
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement && isTauri()) void getCurrentWindow().setFullscreen(false).catch(() => undefined);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    if (zoom === 1) setArraste({ x: 0, y: 0 });
  }, [zoom]);
  useEffect(() => setZoom(1), [stage?.owner.id]);

  if (model.state === 'error') {
    const proxima = RECUO_MS[reconexao.falhas] / 1000;
    return (
      <div className="janela flex min-h-0 flex-1 flex-col">
        <div className="barra barra-ar">Palco<span className="ml-auto font-medium">sem conexão</span></div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <b className="font-display text-[32px]">Sem conexão com a sala</b>
          <p role="alert" className="m-0 max-w-[480px]">{model.error}</p>
          <p role="status" className="m-0 text-[14px] text-texto-fraco">
            {reconexao.esgotou ? 'Toque em Reconectar quando a internet voltar.'
              : !navigator.onLine ? 'Sem internet. Reconecta sozinho quando a rede voltar.'
                : `Reconectando sozinho em ${proxima} s (tentativa ${reconexao.falhas + 1} de ${RECUO_MS.length}).`}
          </p>
          <button type="button" className="btn btn-prim btn-lg" onClick={onRetry}>Reconectar</button>
        </div>
      </div>
    );
  }
  if (model.state === 'connecting' || !stage) {
    return (
      <div className="janela flex min-h-0 flex-1 flex-col" aria-busy="true">
        <div className="barra">Palco<span className="ml-auto font-medium">conectando</span></div>
        <div className="skeleton m-4 flex-1" />
      </div>
    );
  }
  const nome = stage.owner.isLocal ? 'Você' : stage.owner.name;
  const s = model.stageStats;
  const numeros = stage.owner.isLocal || !s
    ? stage.info
    : [`${s.height}p${s.fps}`, s.codec, s.mbps !== null && `${fmt(s.mbps)} Mb/s`].filter(Boolean).join(' · ');
  const roda = (e: React.WheelEvent) => {
    if (!stage.track) return;
    const i = ZOOMS.indexOf(zoom) + (e.deltaY < 0 ? 1 : -1);
    setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i))]);
  };
  return (
    <div ref={ref} className="janela flex min-h-0 flex-1 flex-col">
      <div className="barra barra-ar">
        <span aria-hidden="true" className="size-[7px] bg-sobre-destaque" /><span className="truncate">No ar · {nome}{jogo ? ` · ${jogo}` : ''}</span>
        <span className="ml-auto truncate font-medium normal-case">{[numeros, `${stage.watchers} assistindo`].filter(Boolean).join(' · ')}</span>
      </div>
      <div tabIndex={stage.track ? 0 : -1} aria-label={`Tela de ${nome}`} className="group relative min-h-0 flex-1 overflow-hidden bg-palco outline-none"
        onWheel={roda} onDoubleClick={() => stage.track && ref.current && void toggleFullscreen(ref.current, videoRef.current)}
        onPointerDown={(e) => { if (zoom > 1) { inicio.current = { x: e.clientX, y: e.clientY, ax: arraste.x, ay: arraste.y }; e.currentTarget.setPointerCapture?.(e.pointerId); } }}
        onPointerMove={(e) => { const i = inicio.current; if (i) setArraste({ x: i.ax + e.clientX - i.x, y: i.ay + e.clientY - i.y }); }}
        onPointerUp={() => (inicio.current = null)}>
        {stage.track ? (
          <div className="absolute inset-0" style={{ transform: `translate(${arraste.x}px, ${arraste.y}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : undefined }}>
            <TrackVideo track={stage.track} videoRef={videoRef} pip className="absolute inset-0 size-full object-contain" />
          </div>
        ) : stage.watching && !stage.owner.isLocal ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 pb-14 text-center text-sobre-palco" role="status">
            {model.imagemFalhou ? (
              <>
                <span className="text-[14px]">A imagem de {nome} não abriu neste aparelho.</span>
                <button type="button" className="btn btn-sm" onClick={() => { model.unwatch(stage.owner.id); model.watch(stage.owner.id); }}>Tentar de novo</button>
              </>
            ) : <span className="text-[14px]">Abrindo a imagem de {nome}…</span>}
          </div>
        ) : (
          <div className={`absolute inset-0 flex flex-col items-center justify-center text-center ${compacto ? 'gap-2 p-3' : 'gap-3 p-6'}`}>
            <span className={`font-pincel -rotate-6 text-lima ${compacto ? 'text-[28px]' : 'text-[40px]'}`}>ao vivo!</span>
            {!compacto && <span className="text-[14px] text-sobre-palco">Tela de {nome}. Assistir gasta internet só de quem assiste.</span>}
            {!stage.watching && (
              <button type="button" className={`btn btn-prim ${compacto ? '' : 'btn-lg'}`} onClick={() => model.watch(stage.owner.id)}>Assistir</button>
            )}
          </div>
        )}
        {stage.owner.isLocal && model.videoPaused && (
          // The core stops encoding with no viewers, so the own preview freezes or goes black.
          <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 bg-palco/85 p-6 text-center">
            <span className="rotulo text-lima">Pausado</span>
            <span className="text-[14px] text-sobre-palco">Ninguém assistindo agora. A imagem volta sozinha quando alguém clicar em Assistir.</span>
          </div>
        )}
        {model.redeRuim && !stage.owner.isLocal && <VozPrimeiro model={model} />}
        {/* Before Assistir there is nothing to control, and a toolbar there covered the button on phones. */}
        {(stage.watching || stage.track) && (
          <ControlesTela model={model} stream={stage} videoRef={videoRef} alvo={ref} zoom={zoom} setZoom={setZoom} compacto={compacto} />
        )}
        {!compacto && <SeloLeve model={model} stream={stage} className="top-3 left-3" />}
        <div className="absolute top-3 right-3 z-10 flex flex-wrap justify-end gap-2">
          {model.streams.length > 1 && model.streams.map((x) => (
            <button key={x.owner.id} type="button" onClick={() => onPick(x.owner.id)} aria-pressed={x === stage} className={`btn btn-sm ${x === stage ? 'bg-texto text-superficie' : ''}`}>
              {x.owner.isLocal ? 'Você' : x.owner.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Two or more screens side by side; the sound comes from the marked one (red outline). Click a screen to move the sound. */
function Grade({ model, streams }: { model: RoomModel & RoomActions; streams: Stream[] }) {
  const som = model.somTela ?? streams.find((s) => !s.owner.isLocal)?.owner.id ?? null;
  useEffect(() => {
    if (model.somTela === undefined || model.somTela === null) model.setSomTela?.(som);
  }, [som]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <span className="rotulo">{streams.length} telas · o som vem da tela marcada · clique numa tela para ouvir ela</span>
      <div className={`grid min-h-0 flex-1 gap-3 ${streams.length > 2 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-2'}`}>
        {streams.map((s) => <TelaGrade key={s.owner.id} model={model} stream={s} comSom={s.owner.id === som} />)}
      </div>
    </div>
  );
}

/** Always visible while a remote screen comes in light 720p: the hover-only quality button hid it. */
function SeloLeve({ model, stream, className }: { model: RoomModel & RoomActions; stream: Stream; className: string }) {
  if (stream.owner.isLocal || model.qualidade?.[stream.owner.id] !== 'leve' || !model.setQualidade) return null;
  return (
    <button type="button" title="Você está recebendo a versão leve desta tela"
      className={`absolute z-10 inline-flex h-8 items-center gap-2 border border-[#4a4a50] bg-[#101012] px-2 text-[13px] text-[#f4f4f1] hover:border-[#f4f4f1] ${className}`}
      onClick={(e) => { e.stopPropagation(); model.setQualidade!(stream.owner.id, 'original'); }}>
      <b className="text-lima">Leve 720p</b><span>Ver em Original</span>
    </button>
  );
}

function TelaGrade({ model, stream, comSom }: { model: RoomModel & RoomActions; stream: Stream; comSom: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const q = model.qualidade?.[stream.owner.id] === 'leve' ? 'leve 720p' : stream.info ? stream.info.toLowerCase() : 'original';
  return (
    <div ref={ref} className={`janela flex min-h-0 flex-col ${comSom ? 'outline-[3px] outline-offset-[-1px] outline-destaque' : ''}`}>
      <div className="barra barra-ar">
        <span className="truncate">■ {stream.owner.isLocal ? 'Você' : stream.owner.name}</span>
        <span className="ml-auto font-medium">{comSom ? `♪ som · ${q}` : `mudo · ${q}`}</span>
      </div>
      <div className="group relative min-h-0 flex-1 overflow-hidden bg-palco" onClick={() => !stream.owner.isLocal && model.setSomTela?.(stream.owner.id)}>
        {stream.track ? <TrackVideo track={stream.track} videoRef={videoRef} pip className="absolute inset-0 size-full object-contain" />
          : <span className="absolute inset-0 grid place-items-center text-[13px] text-sobre-palco">Carregando a tela…</span>}
        {model.redeRuim && !stream.owner.isLocal && <VozPrimeiro model={model} />}
        <ControlesTela model={model} stream={stream} videoRef={videoRef} alvo={ref} zoom={1} setZoom={() => undefined} mini />
        <SeloLeve model={model} stream={stream} className="top-2 left-2" />
        {!comSom && !stream.owner.isLocal && (
          <button type="button" className="btn btn-sm absolute top-2 right-2 z-10" aria-label={`Ouvir a tela de ${stream.owner.name}`}
            onClick={(e) => { e.stopPropagation(); model.setSomTela?.(stream.owner.id); }}><Icone nome="volume" tamanho={16} /></button>
        )}
      </div>
    </div>
  );
}

/** In the grid the chat shrinks to a 44 px strip with the count of new messages. */
function ConversaFina({ chat, onAbrir }: { chat: ChatMessage[]; onAbrir(): void }) {
  const [base] = useState(chat.length);
  const novas = Math.max(0, chat.length - base);
  return (
    <button type="button" onClick={onAbrir} aria-label={`Abrir conversa${novas ? `, ${novas} novas` : ''}`}
      className="janela flex flex-col items-center gap-3 border-texto pt-3 hover:bg-superficie-alta">
      <Icone nome="chat" tamanho={18} />
      <span className="rotate-180 font-mono text-[11px] font-bold tracking-[0.08em] uppercase [writing-mode:vertical-rl]">Conversa</span>
      {novas > 0 && <b className="bg-destaque px-1.5 py-1 font-mono text-[11px] text-sobre-destaque">{novas}</b>}
    </button>
  );
}

/** Three network bars: faint when fine, `perigo` only when bad (always with text elsewhere). */
function BarrasRede({ rede, naBarra = true }: { rede?: Rede; naBarra?: boolean }) {
  if (!rede) return null;
  const n = barrasDe(rede.qualidade);
  const dica = [rede.ms !== undefined && `ping ${rede.ms} ms`, rede.perda !== undefined && `perda ${fmt(rede.perda * 100)}%`].filter(Boolean).join(' · ') || 'rede';
  return (
    <span className={`inline-flex h-[11px] shrink-0 items-end gap-0.5 ${rede.qualidade === 'ruim' ? (naBarra ? 'text-[#ff7a6b]' : 'text-perigo') : ''}`} title={dica} aria-label={`Rede ${rede.qualidade}, ${dica}`} role="img">
      {[4, 7, 11].map((h, i) => <i key={h} className="w-[3px] bg-current" style={{ height: h, opacity: i < n ? 1 : 0.3 }} />)}
    </span>
  );
}

function Voce({ model, nome, sala, imLive, replay, podeTransmitir, temClipe, onGoLive, onSair, onFallback, onClipe, onOuvem, onMais }: {
  model: RoomModel & RoomActions; nome: string; sala: string; imLive: boolean; replay: { ligado: boolean; segundos: number };
  podeTransmitir: boolean; temClipe: boolean;
  onGoLive(): void; onSair(): void; onFallback(): void; onClipe(): void; onOuvem(el: HTMLElement): void; onMais(el: HTMLElement): void;
}) {
  const me = model.people.find((p) => p.isLocal);
  const estado = { connecting: 'conectando…', connected: `na voz · ${sala}`, reconnecting: 'reconectando…', error: 'fora da voz' }[model.state];
  const ping = model.ping;
  const receptores = model.receptores ?? [];
  const ouvem = receptores.filter((r) => r.voz).length;
  const veem = receptores.filter((r) => r.tela).length;
  return (
    <div className="janela flex min-h-0 flex-col">
      <div className="barra">
        <span className="truncate">Você · {nome}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 font-medium" role="status">{estado}</span>
        <BarrasRede rede={me?.rede ?? (ping !== null ? { qualidade: ping > 250 ? 'ruim' : ping > 150 ? 'media' : 'boa', ms: ping } : undefined)} />
        {ping !== null && (
          <span role="status" aria-label={`Ping ${ping} milissegundos, ${qualidadePing(ping)}`} title="Ida e volta até o servidor de voz"
            className={`font-medium tabular-nums normal-case ${ping > 250 ? 'text-[#ff7a6b]' : ''}`}>{ping} ms</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-2.5 pt-3 pb-2.5">
        <button type="button" className={`btn btn-icone w-10 ${model.micOn ? '' : 'btn-off'}`} aria-pressed={!model.micOn}
          aria-label={model.micOn ? 'Desligar microfone' : 'Ligar microfone'} title={model.micOn ? 'Microfone ligado (M)' : 'Microfone desligado (M)'} onClick={model.toggleMic}>
          <Icone nome={model.micOn ? 'mic' : 'mic-off'} />
        </button>
        <button type="button" className={`btn btn-icone w-10 ${model.deafened ? 'btn-off' : ''}`} aria-pressed={model.deafened}
          aria-label={model.deafened ? 'Ligar o som' : 'Silenciar tudo'} title={model.deafened ? 'Som desligado (S)' : 'Silenciar tudo (S)'} onClick={model.toggleDeafen}>
          <Icone nome={model.deafened ? 'fone-off' : 'fone'} />
        </button>
        {imLive ? (
          <button type="button" className="btn min-w-0 flex-1 px-2" onClick={model.stopLive}><Icone nome="tela" />Sair do ar</button>
        ) : podeTransmitir ? (
          <button type="button" className="btn btn-prim min-w-0 flex-1 px-2" disabled={model.state !== 'connected'} onClick={onGoLive}><Icone nome="tela" />Transmitir</button>
        ) : <span className="flex-1" />}
        {temClipe && <button type="button" className="btn btn-icone relative w-10" onClick={onClipe}
          aria-label={replay?.ligado ? 'Salvar clipe, replay ligado' : 'Salvar clipe'} title={replay?.ligado ? `Salvar clipe (últimos ${replay.segundos} s)` : 'Salvar clipe (ligue o replay em Configurações)'}>
          <Icone nome="replay" />
          {replay?.ligado && <span aria-hidden="true" className="absolute top-1 right-1 size-[7px] bg-destaque" />}
        </button>}
        <button type="button" className="btn btn-icone w-10" aria-label="Mais" aria-haspopup="menu" title="Mais: janela quem fala, internet ruim, teste de rede"
          onClick={(e) => onMais(e.currentTarget)}><Icone nome="pontos" /></button>
        <button type="button" className="btn btn-icone w-10 text-destaque" aria-label="Sair da sala" title="Sair da sala" onClick={onSair}>
          <Icone nome="sair" />
        </button>
      </div>
      {(model.micError || model.streamError || (imLive && (model.videoPaused || model.gameMinimized))) && (
        <div role="alert" className="flex flex-col gap-1.5 px-2.5 pb-2 text-[12.5px] text-perigo">
          {imLive && model.gameMinimized && <span>Jogo minimizado: volte ao jogo para a imagem voltar.</span>}
          {imLive && model.videoPaused && <span className="text-texto-fraco">Ninguém assistindo · vídeo pausado</span>}
          {model.micError && <span>{model.micError}</span>}
          {model.micError === MIC_BLOQUEADO && !isTauri() && (
            <span className="text-texto-fraco">Libere o microfone no navegador: toque no cadeado ao lado do endereço e permita o microfone.</span>
          )}
          {model.micError === MIC_BLOQUEADO && (
            <span className="flex flex-wrap gap-2">
              {isTauri() && <button type="button" className="btn btn-sm" onClick={() => void openUrl('ms-settings:privacy-microphone').catch(() => undefined)}>
                Abrir configurações do Windows
              </button>}
              <button type="button" className="btn btn-sm" onClick={() => model.setMic?.(true)}>Tentar de novo</button>
            </span>
          )}
          {model.streamError && (
            <>
              <span>{model.streamError}</span>
              <button type="button" className="btn btn-sm self-start" disabled={model.state !== 'connected'} onClick={onFallback}>Transmitir pelo modo de reserva</button>
            </>
          )}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-borda px-2.5 py-2">
        <button type="button" className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-[13px] whitespace-nowrap text-texto underline decoration-borda underline-offset-[3px]"
          aria-haspopup="dialog" onClick={(e) => onOuvem(e.currentTarget)}>
          <Icone nome="antena" tamanho={16} /><b>{ouvem}</b> te ouvem · <b>{veem}</b> veem
        </button>
        {replay?.ligado && <span className="rotulo text-[11px]">Replay {replay.segundos} s</span>}
        {model.redeRuim && <span className="rotulo text-[11px] text-perigo">internet ruim</span>}
      </div>
    </div>
  );
}

/**
 * Voice meter outside React state: while the person speaks and the window is visible, a
 * requestAnimationFrame loop reads the level and flips the lit cells in the DOM. Silence = no loop.
 */
export function Medidor({ person, ativo, className = 'h-14 w-2.5' }: { person: Pick<Person, 'level' | 'nivel' | 'speaking'>; ativo: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { nivel, speaking, level } = person;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let aceso = -1;
    const pintar = (v: number) => {
      const n = Math.round(v * 8);
      if (n === aceso) return;
      aceso = n;
      Array.from(el.children).forEach((c, i) => c.toggleAttribute('data-aceso', i < n));
    };
    if (!ativo) return pintar(0);
    if (!nivel) return pintar(level); // demo room: fixed level
    if (!speaking) return pintar(0);
    let id = requestAnimationFrame(function quadro() {
      pintar(nivel());
      id = requestAnimationFrame(quadro);
    });
    return () => cancelAnimationFrame(id);
  }, [ativo, speaking, nivel, level]);
  return (
    <span ref={ref} aria-hidden="true" className={`medidor flex flex-col-reverse gap-0.5 ${className}`}>
      {Array.from({ length: 8 }, (_, i) => <i key={i} />)}
    </span>
  );
}

type CanalProps = {
  person: Person; perfil?: Pessoa; onVolume(v: number): void; onCartao(): void; onMenu(ancora: Ancora): void; onAssistir(): void;
};
const mesmaRede = (a?: Rede, b?: Rede) => a?.qualidade === b?.qualidade && a?.ms === b?.ms && a?.perda === b?.perda;
const mesmaPessoa = (a: Person, b: Person) =>
  a.id === b.id && a.name === b.name && a.speaking === b.speaking && (a.nivel ? true : a.level === b.level)
  && a.muted === b.muted && a.live === b.live && a.volume === b.volume && a.replay === b.replay && mesmaRede(a.rede, b.rede);
/**
 * Memoized: a speaker event re-renders only the channels whose voice data changed.
 * The callbacks are skipped on purpose; they only forward the person's id to stable actions.
 */
const Canal = memo(CanalView, (a: CanalProps, b: CanalProps) => mesmaPessoa(a.person, b.person) && a.perfil === b.perfil);

function CanalView({ person, perfil, onVolume, onCartao, onMenu, onAssistir }: CanalProps) {
  const ativa = useInterfaceAtiva();
  const pct = Math.round(person.volume * 100);
  const status = person.speaking ? 'falando' : person.muted ? 'mic desligado' : 'ouvindo';
  const ruim = person.rede ? textoRede(person.rede) : null;
  const linha2 = ruim ?? (person.live ? `no ar${perfil?.jogo ? ` · ${perfil.jogo}` : ''}` : perfil?.jogo ? `jogando ${perfil.jogo}` : null);
  const fala = person.speaking && !person.live;
  const fundo = person.live ? 'bg-palco text-sobre-palco' : fala ? 'bg-lima text-[#111]' : 'bg-superficie';
  const abrirMenu = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    const el = e.currentTarget.getBoundingClientRect();
    onMenu('clientX' in e && e.clientX ? { x: e.clientX, y: e.clientY } : { x: el.left, y: el.top });
  };
  return (
    <li data-canal={person.id} tabIndex={0} aria-label={`${person.name}, ${status}${ruim ? `, ${ruim}` : ''}. Menu com botão direito ou Shift+F10`}
      onContextMenu={abrirMenu} onDoubleClick={() => person.live && onAssistir()}
      onKeyDown={(e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) abrirMenu(e); }}
      className={`flex min-w-0 flex-col border border-texto ${fundo}`}>
      <div className={`barra ${person.live ? 'barra-ar' : fala ? 'barra-lima' : ''}`}>
        <span className="truncate">{person.name}</span>
        <span className="ml-auto inline-flex items-center gap-2">
          {person.replay && <span className={person.live ? '' : 'text-destaque'} aria-label="Replay ligado" role="img"><Icone nome="replay" tamanho={14} /></span>}
          <BarrasRede rede={person.rede} />
          <button type="button" className="-mr-1.5 inline-flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 text-current opacity-80 hover:opacity-100"
            aria-label={`Menu de ${person.name}`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); onMenu({ x: e.currentTarget.getBoundingClientRect().left - 230, y: e.currentTarget.getBoundingClientRect().bottom }); }}>
            <Icone nome="pontos" tamanho={14} />
          </button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 gap-2.5 px-2.5 pt-2.5 pb-1">
        <button type="button" className="h-11 border-0 bg-transparent p-0" aria-label={`Ver perfil de ${person.name}`} onClick={onCartao}>
          <Avatar pessoa={{ nome: person.name, avatar: perfil?.avatar ?? null }} tamanho={44} />
        </button>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className={`text-[14px] ${person.muted && !person.speaking ? (person.live ? 'text-[#ff7a6b]' : 'text-perigo') : ''}`}>{status}</b>
          {linha2 && <span className={`font-mono text-[11px] leading-[1.3] ${ruim ? `font-bold ${person.live ? 'text-[#ff7a6b]' : 'text-perigo'}` : 'opacity-75'}`}>{linha2}</span>}
        </span>
        <Medidor person={person} ativo={ativa} className="h-11 w-2" />
      </div>
      <div className="flex items-center gap-2 px-3 pb-2">
        <Slider.Root className="relative flex h-8 flex-1 touch-none items-center select-none" min={0} max={200} step={5}
          value={[pct]} onValueChange={([v]) => onVolume(v / 100)}>
          <Slider.Track className="relative h-1 grow bg-current/25">
            <Slider.Range className="absolute h-full bg-current" />
          </Slider.Track>
          <Slider.Thumb aria-label={`Volume de ${person.name}`} aria-valuetext={`${pct}%`} className="block h-4 w-3 border border-current bg-superficie" />
        </Slider.Root>
        <span className="w-10 text-right font-mono text-[11px] tabular-nums">{pct}%</span>
      </div>
    </li>
  );
}

/**
 * Phone layout: the watched screen on top (16:9), then tabs for the room, the chat and the
 * server, and the Você controls at the bottom within thumb reach.
 */
function SalaCompacta({ sala, linha, model, stage, others, porId, pessoas, salas, eu, aviso, onFecharAviso, reconexao, onRetry, onCartao, onAmigo, onMenuSala, onMenuPessoa, voce }: {
  sala: string; linha: string; model: RoomModel & RoomActions; stage?: Stream; others: Person[]; porId: Map<string, Pessoa>; pessoas: Pessoa[]; salas: Sala[]; eu: Usuario;
  aviso: { texto: string; erro?: boolean } | null; onFecharAviso(): void; reconexao: Reconexao; onRetry(): void;
  onCartao(id: string): void; onAmigo(id: string, sim: boolean): void; onMenuSala(el: HTMLElement): void; onMenuPessoa(id: string, ancora: Ancora): void; voce: ReactNode;
}) {
  const [aba, setAba] = useState<'sala' | 'conversa' | 'servidor'>('sala');
  const abas = [
    { id: 'sala' as const, rotulo: `Na sala · ${others.length + 1}` },
    { id: 'conversa' as const, rotulo: 'Conversa' },
    { id: 'servidor' as const, rotulo: `Galera · ${pessoas.filter((p) => p.online).length} on` },
  ];
  // Lying down while a screen plays: the stage covers the display, like a video player.
  const deitado = useDeitado();
  const telaInteira = deitado && !!stage?.track;
  return (
    // Scrolls when the display is short (small phones, lying down) instead of squashing the tabs to nothing.
    <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-[26px] leading-none">{sala}</h1>
        <span className="rotulo min-w-0 truncate text-[11px]">{linha}</span>
        <button type="button" className="btn btn-sm btn-icone ml-auto shrink-0" aria-label="Menu da sala" aria-haspopup="menu" onClick={(e) => onMenuSala(e.currentTarget)}>
          <Icone nome="pontos" tamanho={16} />
        </button>
      </div>
      {aviso && <Faixa tipo={aviso.erro ? 'erro' : 'aviso'} onFechar={onFecharAviso}>{aviso.texto}</Faixa>}
      {model.avisoImagem && <Faixa tipo="aviso" onFechar={model.fecharAvisoImagem}>{model.avisoImagem}</Faixa>}
      {(stage || model.state === 'error') && (
        <div className={telaInteira
          ? 'fixed inset-0 z-40 flex flex-col bg-palco pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]'
          : 'flex aspect-video w-full shrink-0 flex-col'}>
          <Palco model={model} stage={stage} reconexao={reconexao} jogo={stage ? porId.get(stage.owner.id)?.jogo : null} onPick={() => undefined} onRetry={onRetry} compacto />
        </div>
      )}
      <section className="janela flex min-h-[220px] flex-1 flex-col" aria-label="Sala">
        <div className="flex border-b border-texto" role="tablist" aria-label="Painéis da sala">
          {abas.map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}
              className={`min-h-11 flex-1 border-0 px-1 font-mono text-[11px] font-bold tracking-[0.04em] uppercase [&+&]:border-l [&+&]:border-texto ${aba === a.id ? 'bg-texto text-superficie' : 'bg-transparent text-texto-fraco'}`}>
              {a.rotulo}
            </button>
          ))}
        </div>
        {aba === 'sala' && (
          <ul aria-label="Pessoas na sala" className="m-0 grid min-h-0 flex-1 list-none content-start gap-2 overflow-y-auto p-2">
            {others.map((p) => (
              <Canal key={p.id} person={p} perfil={porId.get(p.id)} onVolume={(v) => model.setVolume(p.id, v)} onCartao={() => onCartao(p.id)}
                onMenu={(ancora) => onMenuPessoa(p.id, ancora)} onAssistir={() => p.live && model.watch(p.id)} />
            ))}
            {others.length === 0 && <li className="px-2 py-3 text-[14px] text-texto-fraco">Só você na sala. Chame a galera com o Bora?.</li>}
          </ul>
        )}
        {aba === 'conversa' && <Conversa sala={sala} chat={model.chat} onSend={model.sendChat} />}
        {aba === 'servidor' && <Pessoas pessoas={pessoas} salas={salas} eu={eu} onCartao={onCartao} onAmigo={onAmigo} />}
      </section>
      <div className="shrink-0 pb-[env(safe-area-inset-bottom)]">{voce}</div>
    </div>
  );
}

function Lateral({ sala, model, pessoas, salas, eu, onCartao, onAmigo }: {
  sala: string; model: RoomModel & RoomActions; pessoas: Pessoa[]; salas: Sala[]; eu: Usuario; onCartao(id: string): void; onAmigo(id: string, sim: boolean): void;
}) {
  const [aba, setAba] = useState<'conversa' | 'pessoas'>('conversa');
  return (
    <aside className="janela flex min-h-0 flex-col" aria-label={aba === 'conversa' ? 'Conversa da sala' : 'Pessoas do servidor'}>
      <div className="flex border-b border-texto" role="tablist" aria-label="Painel lateral">
        {(['conversa', 'pessoas'] as const).map((a) => (
          <button key={a} type="button" role="tab" aria-selected={aba === a} onClick={() => setAba(a)}
            className={`min-h-10 flex-1 border-0 font-mono text-[11px] font-bold tracking-[0.04em] uppercase [&+&]:border-l [&+&]:border-texto ${aba === a ? 'bg-texto text-superficie' : 'bg-transparent text-texto-fraco hover:bg-superficie-alta'}`}>
            {a === 'conversa' ? `Conversa · ${sala}` : `Pessoas · ${pessoas.filter((p) => p.online).length} on`}
          </button>
        ))}
      </div>
      {aba === 'conversa'
        ? <Conversa sala={sala} chat={model.chat} onSend={model.sendChat} />
        : <Pessoas pessoas={pessoas} salas={salas} eu={eu} onCartao={onCartao} onAmigo={onAmigo} />}
    </aside>
  );
}

/** Memoized: a new message or a voice event does not redraw the messages already on screen. */
const Mensagem = memo(function Mensagem({ m }: { m: ChatMessage }) {
  return (
    <>
      <Avatar pessoa={{ nome: m.who, avatar: null }} tamanho={30} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-baseline gap-2"><b className="text-[14px]">{m.who}</b><span className="rotulo text-[11px]">{m.hora}</span></span>
        <span className="text-[14px] leading-[1.45] break-words">{m.text}</span>
      </div>
    </>
  );
});

/** Memoized on the messages: voice events and stats do not redraw the chat (sendChat reads the room itself). */
const Conversa = memo(ConversaView, (a, b) => a.sala === b.sala && a.chat === b.chat);
function ConversaView({ sala, chat, onSend }: { sala: string; chat: ChatMessage[]; onSend(text: string): void }) {
  const [text, setText] = useState('');
  const lista = useRef<HTMLDivElement>(null);
  // Virtualized: only the visible messages are in the DOM (leveza).
  const v = useVirtualizer({ count: chat.length, getScrollElement: () => lista.current, estimateSize: () => 64, overscan: 6, initialRect: { width: 330, height: 600 } });
  useEffect(() => {
    if (chat.length) v.scrollToIndex(chat.length - 1, { align: 'end' });
  }, [chat.length]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSend(text);
    setText('');
  };
  return (
    <>
      <div ref={lista} className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3" aria-live="polite" role="log" aria-label="Mensagens">
        {chat.length === 0 ? (
          <p className="m-0 flex h-full items-end text-texto-fraco">Sala quieta. Manda um oi.</p>
        ) : (
          <div className="relative w-full" style={{ height: v.getTotalSize() }}>
            {v.getVirtualItems().map((item) => {
              const m = chat[item.index];
              return (
                <div key={m.id} data-index={item.index} ref={v.measureElement} className="absolute left-0 grid w-full grid-cols-[30px_minmax(0,1fr)] gap-2.5 pb-3"
                  style={{ transform: `translateY(${item.start}px)` }}>
                  <Mensagem m={m} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <form onSubmit={submit} className="mx-3 mb-3 flex items-center gap-2 rounded-[2px] border border-texto bg-superficie py-0.5 pr-0.5 pl-3 focus-within:outline-2 focus-within:outline-destaque">
        <label htmlFor="msg" className="sr-only">Mensagem</label>
        <input id="msg" className="min-h-10 min-w-0 flex-1 border-0 bg-transparent text-[14px] text-texto outline-none" placeholder={`Mensagem para ${sala}`}
          value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <button type="submit" className="btn btn-icone btn-sm" aria-label="Enviar" disabled={!text.trim()}><Icone nome="enviar" tamanho={16} /></button>
      </form>
    </>
  );
}

function Pessoas({ pessoas, salas, eu, onCartao, onAmigo }: { pessoas: Pessoa[]; salas: Sala[]; eu: Usuario; onCartao(id: string): void; onAmigo(id: string, sim: boolean): void }) {
  const nomeSala = new Map(salas.map((s) => [s.id, s.nome] as const));
  const outras = pessoas.filter((p) => p.id !== eu.id);
  const grupos: [string, Pessoa[]][] = [
    ['Amigos', outras.filter((p) => p.amigo)],
    ['Outros no servidor', outras.filter((p) => !p.amigo)],
  ];
  if (outras.length === 0) return <Vazio titulo="Só você aqui" texto="Gere um convite e mande para a galera." />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {grupos.map(([titulo, lista]) => (
        <section key={titulo}>
          <h3 className="rotulo m-0 border-b border-borda px-3.5 py-2">{titulo} · {lista.length}</h3>
          {lista.length === 0 && <p className="m-0 px-3.5 py-2 text-[13px] text-texto-fraco">{titulo === 'Amigos' ? 'Adicione amigos para vê-los aqui em cima.' : 'Todo mundo já é seu amigo.'}</p>}
          <ul className="m-0 list-none p-0">
            {[...lista].sort((a, b) => Number(b.online) - Number(a.online)).map((p) => (
              <li key={p.id} className="flex items-center gap-2.5 px-3.5 py-1">
                <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left" onClick={() => onCartao(p.id)} aria-label={`Ver perfil de ${p.nome}`}>
                  <Avatar pessoa={p} tamanho={32} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <b className="truncate text-[14px]">{p.nome}</b>
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-texto-fraco">
                      <span aria-hidden="true" className={`size-1.5 shrink-0 ${p.online ? 'bg-lima outline outline-1 outline-texto' : 'bg-borda'}`} />
                      <span className="truncate">{p.online ? [p.sala ? `em ${nomeSala.get(p.sala) ?? 'outra sala'}` : 'online', p.jogo && `jogando ${p.jogo}`].filter(Boolean).join(' · ') : 'offline'}</span>
                    </span>
                  </span>
                </button>
                <button type="button" className="btn btn-fant btn-icone" aria-label={p.amigo ? `Remover ${p.nome} dos amigos` : `Adicionar ${p.nome} aos amigos`}
                  title={p.amigo ? 'Remover amigo' : 'Adicionar amigo'} onClick={() => onAmigo(p.id, !p.amigo)}>
                  <Icone nome={p.amigo ? 'amigo-off' : 'amigo'} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Vazio({ titulo, texto, children }: { titulo: string; texto: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <b className="font-display text-[28px]">{titulo}</b>
      <span className="max-w-[44ch] text-[14px] text-texto-fraco">{texto}</span>
      {children}
    </div>
  );
}
