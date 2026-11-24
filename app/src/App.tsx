import { useCallback, useEffect, useState } from 'react';
import { demoScreen, store } from './lib/config';
import { modoFalso, servidorFalso } from './lib/falso';
import { ApiError, servidorReal, type Pessoa, type Sala, type Servidor, type Usuario } from './lib/servidor';
import { escolherServidor, esquecerServidor, ouvirDeepLinks, salvarServidor, servidorAtual } from './lib/servidores';
import type { LinkConvite } from './lib/convite';
import { useUpdater } from './lib/updater';
import { RoomScreen } from './screens/Room';
import { Entrada } from './screens/Entrada';
import { Settings } from './screens/Settings';
import { Novidades } from './screens/Novidades';
import { Perfil } from './screens/Perfil';
import { CartaoPerfil } from './components/CartaoPerfil';
import { UpdateBanner } from './components/UpdateBanner';

export type Overlay = null | 'settings' | 'perfil' | { novidades: string | null } | { cartao: string };

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
  const [link, setLink] = useState<LinkConvite | null>(null);
  const tela = falso ? demoScreen() : null;
  const [overlay, setOverlay] = useState<Overlay>(
    tela === 'config' ? 'settings' : tela === 'novidades' ? { novidades: null } : tela === 'perfil' ? 'perfil' : null,
  );
  const updater = useUpdater(!!sala, falso);

  const carregar = useCallback(async (s: Servidor) => {
    try {
      const [u, ss, ps, info] = await Promise.all([s.eu(), s.salas(), s.pessoas(), s.info().catch(() => null)]);
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

  // Invite links opened in the browser come back as stackcall://entrar and land here.
  useEffect(() => {
    let parar: (() => void) | undefined;
    void ouvirDeepLinks((l) => {
      setLink(l);
      setOverlay(null);
      setEstado((e) => (e.fase === 'pronto' ? { fase: 'entrada', voltar: true } : { fase: 'entrada' }));
    }).then((f) => (parar = f));
    return () => parar?.();
  }, []);

  // No polling: people and rooms refresh when the window comes back to the front.
  useEffect(() => {
    if (!srv || estado.fase !== 'pronto') return;
    const atualizar = () => {
      void srv.pessoas().then(setPessoas, () => undefined);
      void srv.salas().then(setSalas, () => undefined);
    };
    window.addEventListener('focus', atualizar);
    return () => window.removeEventListener('focus', atualizar);
  }, [srv, estado.fase]);

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

  async function amigo(id: string, sim: boolean) {
    if (!srv) return;
    setPessoas((ps) => ps.map((p) => (p.id === id ? { ...p, amigo: sim } : p)));
    await srv.amigo(id, sim).catch(() => setPessoas((ps) => ps.map((p) => (p.id === id ? { ...p, amigo: !sim } : p))));
  }

  const podeAdministrar = eu?.papel === 'dono' || eu?.papel === 'admin';
  const cartao = overlay && typeof overlay === 'object' && 'cartao' in overlay
    ? (overlay.cartao === eu?.id ? eu : pessoas.find((p) => p.id === overlay.cartao)) ?? null
    : null;

  let corpo;
  if (estado.fase === 'carregando') {
    corpo = (
      <div className="flex h-full flex-col gap-4 px-5 pt-4" aria-busy="true" aria-label="Carregando">
        <div className="skeleton h-[52px] w-full max-w-[720px]" />
        <div className="skeleton h-16 w-80" />
        <div className="skeleton flex-1" />
      </div>
    );
  } else if (estado.fase === 'erro') {
    corpo = (
      <div className="flex h-full items-center justify-center p-8">
        <div className="janela flex w-[460px] flex-col">
          <div className="barra">Sem conexão com o servidor</div>
          <div className="flex flex-col gap-3 p-5">
            <p role="alert" className="m-0 text-perigo">{estado.mensagem}</p>
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
        onVoltar={estado.fase === 'entrada' && estado.voltar && srv ? () => setEstado({ fase: 'pronto' }) : undefined}
        onEntrou={(s) => {
          setLink(null);
          setSala(null);
          if (!falso) escolherServidor(s.url);
          void carregar(s);
        }}
      />
    );
  } else {
    corpo = (
      <RoomScreen
        servidor={srv} nomeServidor={nomeServidor} eu={eu} salas={salas} pessoas={pessoas} sala={sala} demo={falso}
        onSala={setSala}
        onConfig={() => setOverlay('settings')}
        onPerfil={() => setOverlay('perfil')}
        onCartao={(id) => setOverlay({ cartao: id })}
        onConvidar={convidar}
        onAmigo={(id, sim) => void amigo(id, sim)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <UpdateBanner updater={updater} inCall={!!sala} room={salas.find((s) => s.id === sala)?.nome ?? ''} onNotes={() => setOverlay({ novidades: null })} />
      <div className="relative min-h-0 flex-1">
        {corpo}
        {overlay === 'settings' && (
          <Settings
            updater={updater} inCall={!!sala} servidor={estado.fase === 'pronto' ? srv : null} eu={eu} salas={salas} pessoas={pessoas}
            onClose={() => setOverlay(null)} onNotes={() => setOverlay({ novidades: null })}
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
              void srv?.remover(cartao.id).then(() => setPessoas((ps) => ps.filter((p) => p.id !== cartao.id)));
              setOverlay(null);
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
