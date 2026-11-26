import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { demoScreen, store } from './lib/config';
import { modoFalso, servidorFalso } from './lib/falso';
import { ApiError, aoPerderSessao, servidorReal, type Pessoa, type Sala, type Servidor, type Usuario } from './lib/servidor';
import { escolherServidor, esquecerServidor, ouvirDeepLinks, salvarServidor, servidorAtual } from './lib/servidores';
import type { LinkConvite } from './lib/convite';
import { useUpdater } from './lib/updater';
import { useJanelaVisivel } from './lib/leveza';
import { agendarPresenca } from './lib/presenca';
import { RoomScreen } from './screens/Room';
import { Entrada } from './screens/Entrada';
import { Settings } from './screens/Settings';
import { Novidades } from './screens/Novidades';
import { Perfil } from './screens/Perfil';
import { CartaoPerfil } from './components/CartaoPerfil';
import { UpdateBanner } from './components/UpdateBanner';
import { Faixa, type Acao } from './components/Faixa';
import { Camada05 } from './components/Camada05';
import { Saguao } from './screens/Saguao';
import { aoReceberCutucada, type Cutucada } from './lib/cutucar';
import { iniciarDeteccaoJogo } from './lib/jogo';
import type { PaginaId } from './lib/buscaConfig';
import { aoGsi } from './lib/nucleo';
import { lerPreferencias } from './lib/preferencias';
import { useBoras } from './lib/bora';
import { FaixaBora, NovoBora } from './components/FaixaBora';
import { destinoCs2, salasVisiveis, subSala } from './lib/cs2';

export type Overlay = null | 'settings' | 'perfil' | { novidades: string | null } | { cartao: string };

type Aviso = { tipo: 'erro' | 'aviso'; texto: string; acoes?: Acao[] };

type Estado =
  | { fase: 'carregando' }
  | { fase: 'entrada'; voltar?: boolean }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto' };

export function App() {
  const [falso] = useState(modoFalso);
  const [fake] = useState(() => (falso ? servidorFalso() : null));
  const servidorDe = useCallback((url: string) => fake ?? servidorReal(url), [fake]);
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [srv, setSrv] = useState<Servidor | null>(null);
  const [nomeServidor, setNomeServidor] = useState('');
  const [eu, setEu] = useState<Usuario | null>(null);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [sala, setSala] = useState<string | null>(() => (modoFalso() && demoScreen() !== 'saguao' ? 'cs' : null));
  const visivel = useJanelaVisivel();
  const visivelRef = useRef(visivel);
  visivelRef.current = visivel;
  const agendaPresenca = useRef<ReturnType<typeof agendarPresenca> | null>(null);
  const avisarPresenca = useCallback(() => agendaPresenca.current?.avisar(), []);
  const escolherSala = useCallback((id: string | null) => {
    setSala(id);
    avisarPresenca();
  }, [avisarPresenca]);
  const [link, setLink] = useState<LinkConvite | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const salaRef = useRef(sala);
  salaRef.current = sala;
  const tela = falso ? demoScreen() : null;
  const [overlay, setOverlay] = useState<Overlay>(
    tela === 'config' ? 'settings' : tela === 'novidades' ? { novidades: null } : tela === 'perfil' ? 'perfil' : null,
  );
  const updater = useUpdater(!!sala, falso);
  const [paginaConfig, setPaginaConfig] = useState<PaginaId>();
  // Demo lobby shows a poke received, as in the prototype; real ones come from aoReceberCutucada.
  const [cutucada, setCutucada] = useState<Cutucada | null>(() => (falso && tela === 'saguao' && new URLSearchParams(location.search).get('grupo') !== 'pequeno'
    ? { id: 'demo', de: 'Rafa', recado: 'a sala tá pronta', salaId: 'cs', salaNome: 'CS' } : null));
  useEffect(() => aoReceberCutucada(setCutucada), []);
  // CS2 team sub-room: kept here until GET /api/salas lists it (only occupied ones are listed).
  const [subSalaAtual, setSubSalaAtual] = useState<Sala | null>(null);
  const salaAtual = salas.find((s) => s.id === sala) ?? (subSalaAtual?.id === sala ? subSalaAtual : undefined);
  const [boraAberto, setBoraAberto] = useState(false);
  const bora = useBoras(estado.fase === 'pronto' ? srv : null, eu?.id ?? null, pessoas, (id) => salas.find((s) => s.id === id)?.nome ?? null, visivel);
  const visiveis = salasVisiveis(salas, salaAtual);

  const carregar = useCallback(async (s: Servidor) => {
    try {
      // Presence comes from LiveKit; if it is down the rest of the app still opens.
      const [u, ss, ps, info] = await Promise.all([s.eu(), s.salas(), s.pessoas().catch(() => []), s.info().catch(() => null)]);
      setSrv(s);
      setEu(u);
      setSalas(ss);
      setPessoas(ps);
      const nome = info?.nome ?? new URL(s.url).host;
      setNomeServidor(nome);
      if (!fake) salvarServidor({ url: s.url, nome });
      setEstado({ fase: 'pronto' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setEstado({ fase: 'entrada' });
      else setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : String(e) });
    }
  }, [fake]);

  const iniciar = useCallback(async () => {
    setEstado({ fase: 'carregando' });
    const url = fake?.url ?? servidorAtual();
    if (!url) return setEstado({ fase: 'entrada' });
    const s = servidorDe(url);
    if (!(await s.temSessao())) return setEstado({ fase: 'entrada' });
    await carregar(s);
  }, [carregar, fake, servidorDe]);

  useEffect(() => void iniciar(), [iniciar]);

  function irParaConvite(l: LinkConvite) {
    setAviso(null);
    setLink(l);
    setOverlay(null);
    setEstado((e) => (e.fase === 'pronto' ? { fase: 'entrada', voltar: true } : { fase: 'entrada' }));
  }

  // Invite links opened in the browser come back as stackcall://entrar and land here.
  // In a call the link only asks; the call keeps running even after "Abrir" (the room stays mounted).
  const abrirConvite = useRef((l: LinkConvite) => irParaConvite(l));
  abrirConvite.current = (l: LinkConvite) => {
    if (!salaRef.current) return irParaConvite(l);
    setAviso({
      tipo: 'aviso',
      texto: `Convite recebido de ${new URL(l.servidor).host}. Abrir?`,
      acoes: [{ rotulo: 'Abrir', principal: true, onClick: () => irParaConvite(l) }, { rotulo: 'Agora não', onClick: () => setAviso(null) }],
    });
  };
  useEffect(() => {
    let parar: (() => void) | undefined;
    let vivo = true;
    void ouvirDeepLinks((l) => abrirConvite.current(l)).then((f) => (vivo ? (parar = f) : f()));
    return () => {
      vivo = false;
      parar?.();
    };
  }, []);

  // Session over (401 from any call, or the Rust event): back to the entry screen. A call in
  // progress keeps running only if the person says so.
  useEffect(() => {
    const encerrar = () => {
      setOverlay(null);
      setEstado({ fase: 'entrada' });
      const texto = 'Sua sessão neste aparelho acabou. Entre de novo com um convite.';
      if (!salaRef.current) return setAviso({ tipo: 'aviso', texto });
      setAviso({
        tipo: 'aviso',
        texto: `${texto} Você ainda está na voz: quer continuar?`,
        acoes: [
          { rotulo: 'Sair da voz', principal: true, onClick: () => { setSala(null); setAviso(null); } },
          { rotulo: 'Continuar na voz', onClick: () => setAviso({
            tipo: 'aviso', texto: 'Você continua na voz, sem sessão neste aparelho.',
            acoes: [{ rotulo: 'Sair da voz', onClick: () => { setSala(null); setAviso(null); } }],
          }) },
        ],
      });
    };
    const parar = aoPerderSessao(encerrar);
    let pararEvento: (() => void) | undefined;
    let vivo = true;
    if (isTauri()) void listen('sessao-encerrada', encerrar).then((f) => (vivo ? (pararEvento = f) : f()), () => undefined);
    return () => {
      vivo = false;
      parar();
      pararEvento?.();
    };
  }, []);

  useEffect(() => {
    if (!srv || estado.fase !== 'pronto') return;
    let ativa = true;
    const agenda = agendarPresenca(async () => {
      const [ps, ss] = await Promise.allSettled([srv.pessoas(), srv.salas()]);
      if (ativa) {
        if (ps.status === 'fulfilled') setPessoas(ps.value);
        if (ss.status === 'fulfilled') setSalas(ss.value);
      }
      return [ps, ss].some((r) => r.status === 'rejected' && r.reason instanceof ApiError && r.reason.status === 429);
    }, visivelRef.current);
    agendaPresenca.current = agenda;
    window.addEventListener('focus', avisarPresenca);
    return () => {
      ativa = false;
      agenda.parar();
      agendaPresenca.current = null;
      window.removeEventListener('focus', avisarPresenca);
    };
  }, [srv, estado.fase, avisarPresenca]);
  useEffect(() => agendaPresenca.current?.visibilidade(visivel), [visivel]);

  // Game in the presence: the core is asked every 30 s while the preference is on.
  useEffect(() => {
    if (!srv || estado.fase !== 'pronto' || falso) return;
    return iniciarDeteccaoJogo(srv);
  }, [srv, estado.fase, falso]);

  // Opens "Novidades" once after an update.
  useEffect(() => {
    if (fake) return;
    const seen = store.get('versaoVista');
    if (seen && seen !== updater.current) setOverlay({ novidades: seen });
    store.set('versaoVista', updater.current);
  }, [updater.current]);

  async function sairDoAparelho() {
    if (!srv) return;
    await srv.sair();
    if (!falso) esquecerServidor(srv.url);
    setSala(null);
    setOverlay(null);
    setSrv(null);
    setEstado({ fase: 'entrada' });
  }

  function trocarServidor(url: string) {
    escolherServidor(url);
    setSala(null);
    setOverlay(null);
    void iniciar();
  }

  async function convidar() {
    if (!srv) return;
    const c = await srv.criarConvite();
    if (!c.link) throw new Error('O servidor não devolveu o link do convite.');
    await navigator.clipboard.writeText(c.link);
  }

  async function remover(p: Pessoa | Usuario) {
    if (!srv) return;
    setAviso(null);
    try {
      await srv.remover(p.id);
      setPessoas((ps) => ps.filter((x) => x.id !== p.id));
    } catch (e) {
      setAviso({
        tipo: 'erro',
        texto: `Não deu para remover ${p.nome}. ${e instanceof Error ? e.message : String(e)}`,
        acoes: [{ rotulo: 'Tentar de novo', onClick: () => void remover(p) }],
      });
    }
  }

  async function amigo(id: string, sim: boolean) {
    if (!srv) return;
    setPessoas((ps) => ps.map((p) => (p.id === id ? { ...p, amigo: sim } : p)));
    await srv.amigo(id, sim).catch(() => setPessoas((ps) => ps.map((p) => (p.id === id ? { ...p, amigo: !sim } : p))));
  }

  const podeAdministrar = eu?.papel === 'dono' || eu?.papel === 'admin';
  const cartao = overlay && typeof overlay === 'object' && 'cartao' in overlay
    ? (overlay.cartao === eu?.id ? eu : pessoas.find((p) => p.id === overlay.cartao)) ?? null
    : null;

  // A call survives the entry screen (invite opened, session over): the room stays mounted, hidden.
  const comSala = !!(srv && eu && (estado.fase === 'pronto' || (estado.fase === 'entrada' && sala)));
  let corpo = null;
  if (estado.fase === 'carregando') {
    corpo = (
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-4 px-5 pt-4 pb-5" aria-busy="true" aria-label="Carregando">
        <div className="flex gap-3">
          <div className="skeleton h-[52px] w-[260px]" />
          <div className="skeleton h-[52px] w-[420px]" />
          <div className="skeleton ml-auto size-11" />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4"><div className="skeleton" /><div className="skeleton" /></div>
      </div>
    );
  } else if (estado.fase === 'erro') {
    corpo = (
      <div className="flex h-full items-center justify-center p-8">
        <div className="janela flex w-[520px] max-w-full flex-col">
          <div className="barra barra-ar">Sem conexão</div>
          <div className="flex flex-col gap-4 p-5">
            <h1 className="text-[40px]">Servidor fora do alcance</h1>
            <p role="alert" className="m-0">{estado.mensagem}</p>
            <p className="m-0 text-[14px] text-texto-fraco">Confira a internet. Se ela estiver boa, o servidor pode estar reiniciando.</p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-prim" onClick={() => void iniciar()}>Tentar de novo</button>
              <button type="button" className="btn" onClick={() => setEstado({ fase: 'entrada', voltar: true })}>Usar outro convite</button>
            </div>
          </div>
        </div>
      </div>
    );
  } else if (estado.fase === 'entrada' || !srv || !eu) {
    corpo = (
      <Entrada
        link={link}
        servidorDe={servidorDe}
        onLink={setLink}
        onConfig={() => setOverlay('settings')}
        onVoltar={estado.fase === 'entrada' && estado.voltar && srv ? () => { setLink(null); setEstado({ fase: 'pronto' }); } : undefined}
        onEntrou={(s) => {
          setLink(null);
          setSala(null);
          setAviso(null);
          if (!falso) escolherServidor(s.url);
          void carregar(s);
        }}
      />
    );
  }

  // "Sala do mapa do CS2": the GSI team moves me to the CT/TR sub-room, and back at the end of the match.
  const cs2 = useRef({ srv, salaAtual, salas, ocupado: false });
  Object.assign(cs2.current, { srv, salaAtual, salas });
  useEffect(() => aoGsi((e) => {
    const c = cs2.current;
    if (!c.srv || c.ocupado || !lerPreferencias().cs2SalaMapa) return;
    const d = destinoCs2(e, c.salaAtual);
    if (!d) return;
    if (d.ir === 'pai') return escolherSala(d.pai);
    const pai = c.salas.find((s) => s.id === d.pai);
    if (!pai) return;
    c.ocupado = true;
    c.srv.tokenCs2(d.pai, d.time).then((id) => {
      setSubSalaAtual(subSala(id, pai, d.time));
      escolherSala(id);
    }, (err: unknown) => setAviso({ tipo: 'erro', texto: `Não deu para entrar na sala do time. ${err instanceof Error ? err.message : String(err)}` }))
      .finally(() => (c.ocupado = false));
  }), [escolherSala]);

  return (
    <div className="flex h-full flex-col overflow-clip">
      <UpdateBanner updater={updater} inCall={!!sala} room={salas.find((s) => s.id === sala)?.nome ?? ''} onNotes={() => setOverlay({ novidades: null })} />
      {aviso && (
        <Faixa tipo={aviso.tipo} acoes={aviso.acoes} onFechar={aviso.acoes?.length ? undefined : () => setAviso(null)} className="mx-5 mt-3 shrink-0">
          {aviso.texto}
        </Faixa>
      )}
      {comSala && eu && (
        <div className="mx-5 mt-3 empty:hidden max-md:mx-2.5 max-md:mt-2">
          <FaixaBora boras={bora.boras} euId={eu.id} pessoas={pessoas} salas={visiveis} salaAtual={sala}
            onResponder={(id, r) => void bora.responder(id, r).catch((e: Error) => setAviso({ tipo: 'erro', texto: `Não deu para responder. ${e.message}` }))}
            onEncerrar={(id) => void bora.encerrar(id).catch(() => undefined)}
            onEntrar={(id) => escolherSala(id)} />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {comSala && srv && eu && !sala && (
          <div hidden={!!corpo} className="h-full">
            <Saguao
              nomeServidor={nomeServidor} eu={eu} salas={visiveis} pessoas={pessoas} cutucada={cutucada}
              onSala={(id) => {
                if (cutucada?.salaId === id) setCutucada(null);
                escolherSala(id);
              }}
              onConfig={() => setOverlay('settings')}
              onPerfil={() => setOverlay('perfil')}
              onCartao={(id) => setOverlay({ cartao: id })}
              onConvidar={convidar}
              onFecharCutucada={() => setCutucada(null)}
              onBora={() => setBoraAberto(true)}
            />
          </div>
        )}
        {comSala && srv && eu && sala && (
          <div hidden={!!corpo} className="h-full">
            <RoomScreen
              servidor={srv} nomeServidor={nomeServidor} eu={eu} salas={visiveis} pessoas={pessoas} sala={sala} demo={falso}
              onSala={escolherSala}
              onPresenceChange={avisarPresenca}
              onConfig={() => setOverlay('settings')}
              onPerfil={() => setOverlay('perfil')}
              onCartao={(id) => setOverlay({ cartao: id })}
              onConvidar={convidar}
              onAmigo={(id, sim) => void amigo(id, sim)}
              cutucada={cutucada} onFecharCutucada={() => setCutucada(null)}
              onBora={() => setBoraAberto(true)}
            />
          </div>
        )}
        {corpo}
        {boraAberto && (
          <NovoBora salas={visiveis} salaPadrao={sala} onFechar={() => setBoraAberto(false)} onEnviar={(o) => bora.criar(o)} />
        )}
        <Camada05 servidor={estado.fase === 'pronto' ? srv : null} eu={eu} pessoas={pessoas} salas={visiveis} sala={sala}
          onSala={escolherSala} onCartao={(id) => setOverlay({ cartao: id })}
          onConfig={(pagina) => { setPaginaConfig(pagina); setOverlay('settings'); }} />
        {overlay === 'settings' && (
          <Settings
            updater={updater} inCall={!!sala} servidor={estado.fase === 'pronto' ? srv : null} eu={eu} salas={salas} pessoas={pessoas}
            onClose={() => { setOverlay(null); setPaginaConfig(undefined); }} onNotes={() => setOverlay({ novidades: null })} onPerfil={() => setOverlay('perfil')}
            pagina={paginaConfig ?? (falso ? (new URLSearchParams(location.search).get('pagina') as PaginaId | null) ?? undefined : undefined)}
            onSalas={setSalas} onPessoas={setPessoas} onSair={() => void sairDoAparelho()} onTrocar={trocarServidor}
            onColarConvite={() => { setOverlay(null); setLink(null); setEstado({ fase: 'entrada', voltar: !!srv }); }}
          />
        )}
        {overlay === 'perfil' && srv && eu && (
          <Perfil servidor={srv} eu={eu} onFechar={() => setOverlay(null)} onSalvo={(u) => {
            setEu(u);
            setOverlay(null);
          }} />
        )}
        {cartao && eu && (
          <CartaoPerfil
            pessoa={cartao} souEu={cartao.id === eu.id} podeRemover={podeAdministrar && cartao.papel !== 'dono'}
            onAmigo={(sim) => void amigo(cartao.id, sim)}
            onEditar={() => setOverlay('perfil')}
            onRemover={() => {
              setOverlay(null);
              void remover(cartao);
            }}
            onFechar={() => setOverlay(null)}
          />
        )}
        {overlay && typeof overlay === 'object' && 'novidades' in overlay && (
          <Novidades from={overlay.novidades} current={updater.current} onClose={() => setOverlay(null)} onHistory={() => setOverlay('settings')} />
        )}
      </div>
    </div>
  );
}
