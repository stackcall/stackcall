import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { CATEGORIES, countOf, formatDate, loadChangelog, type Version } from '../lib/changelog';
import type { useUpdater } from '../lib/updater';
import { updateButtonLabel } from '../components/UpdateBanner';
import { Avatar } from '../components/Avatar';
import { Icone } from '../components/Icone';
import { Faixa } from '../components/Faixa';
import { Cabecalho } from '../components/Controles';
import { testMachine } from '../lib/sidecar';
import type { Convite, Pessoa, Sala, Servidor, Usuario } from '../lib/servidor';
import { escolherServidor, lerServidores, servidorAtual } from '../lib/servidores';
import { buscarAjustes, caminhoDe, GRUPOS, paginasVisiveis, type Ajuste, type PaginaId } from '../lib/buscaConfig';
import { SecaoAparencia, SecaoPreferencias } from './Preferencias';
import { SecaoAtalhos } from './Atalhos';
import { PaginaClipes, PaginaCs2, PaginaCutucadas, PaginaPerfil, PaginaQuemFala, PaginaSons } from './config/Paginas';

type Updater = ReturnType<typeof useUpdater>;

const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], [string, string]> = {
  Novidades: ['novidade', 'novidades'],
  Melhorias: ['melhoria', 'melhorias'],
  Correções: ['correção', 'correções'],
  Ajustes: ['ajuste', 'ajustes'],
};

export function summarize(v: Version) {
  return CATEGORIES.flatMap((c) => {
    const n = countOf(v, c);
    return n ? [`${n} ${CATEGORY_LABEL[c][n === 1 ? 0 : 1]}`] : [];
  }).join(', ');
}

const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const data = (iso: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—');

type Props = {
  updater: Updater;
  inCall: boolean;
  servidor: Servidor | null;
  eu: Usuario | null;
  salas: Sala[];
  pessoas: Pessoa[];
  /** First page to open (for example from the lobby or the room). */
  pagina?: PaginaId;
  onClose(): void;
  onNotes(): void;
  onPerfil(): void;
  onSalas(s: Sala[]): void;
  onPessoas(p: Pessoa[]): void;
  onSair(): void;
  onTrocar(url: string): void;
  onColarConvite(): void;
};

/**
 * Settings (docs/design/v05-interface.md, section 5): Você, Servidor (owner and admins) and
 * App, with a search over every setting. A result opens its page and outlines the row.
 */
export function Settings(props: Props) {
  const admin = props.eu?.papel === 'dono' || props.eu?.papel === 'admin';
  const comServidor = !!(props.servidor && props.eu);
  const visiveis = paginasVisiveis(comServidor, admin);
  // The server may still be loading: keep the wish and fall back below until the page is visible.
  const [pagina, setPagina] = useState<PaginaId>(props.pagina ?? 'perfil');
  const [busca, setBusca] = useState('');
  const [destaque, setDestaque] = useState<string>();
  const principal = useRef<HTMLElement>(null);
  const atual = visiveis.some((p) => p.id === pagina) ? pagina : visiveis[0].id;

  useEffect(() => {
    // Esc while a shortcut is being recorded cancels the recording, not the whole screen.
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[data-gravando]') && props.onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [props.onClose]);

  useEffect(() => {
    if (!destaque) return;
    principal.current?.querySelector(`[data-ajuste~="${destaque}"]`)?.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => setDestaque(undefined), 2500);
    return () => clearTimeout(t);
  }, [destaque, atual]);

  const abrir = (id: PaginaId, ajuste?: string) => {
    setPagina(id);
    setBusca('');
    setDestaque(ajuste);
    principal.current?.scrollTo?.({ top: 0 });
  };
  const resultados = busca.trim() ? buscarAjustes(busca, visiveis.map((p) => p.id)) : null;
  const nomeServidor = props.servidor ? new URL(props.servidor.url).host : '';

  return (
    <div role="dialog" aria-modal="true" aria-label="Configurações" className="absolute inset-0 z-20 grid grid-cols-[272px_minmax(0,1fr)] bg-fundo">
      <nav aria-label="Seções" className="flex min-h-0 flex-col gap-px overflow-y-auto border-r border-texto bg-superficie px-3.5 pt-4 pb-3">
        <span className="rotulo px-1">/ Configurações</span>
        <label className={`my-2 flex h-10 shrink-0 items-center gap-2 border px-2.5 text-texto-fraco ${busca ? 'border-2 border-destaque' : 'border-texto'}`}>
          <Icone nome="busca" tamanho={15} />
          <input type="search" value={busca} placeholder="Buscar ajuste" aria-label="Buscar ajuste" autoComplete="off" spellCheck={false}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && busca) {
                e.stopPropagation();
                setBusca('');
              }
              if (e.key === 'Enter' && resultados?.[0]) abrir(resultados[0].pagina, resultados[0].id);
            }}
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-texto outline-none placeholder:text-texto-fraco" />
        </label>
        {GRUPOS.map((g) => {
          const itens = visiveis.filter((p) => p.grupo === g.id);
          if (!itens.length) return null;
          return (
            <div key={g.id} className="flex flex-col gap-px" role="group" aria-label={g.rotulo}>
              <span className="mt-2.5 flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10.5px] font-bold tracking-[0.06em] text-texto-fraco uppercase">
                {g.id === 'servidor' && props.eu ? <>Servidor <span className="max-w-[120px] truncate normal-case">{nomeServidor}</span><span className="border border-current px-1 py-px text-[9.5px]">{props.eu.papel}</span></> : g.rotulo}
              </span>
              {itens.map((p) => (
                <button key={p.id} type="button" aria-current={!resultados && atual === p.id ? 'page' : undefined} onClick={() => abrir(p.id)}
                  className={`flex min-h-[32px] items-center border-0 px-2.5 text-left text-[14px] ${!resultados && atual === p.id ? 'bg-texto font-bold text-superficie' : 'bg-transparent font-medium text-texto hover:bg-superficie-alta'}`}>
                  {p.rotulo}
                </button>
              ))}
            </div>
          );
        })}
        <button type="button" onClick={props.onClose} className="btn btn-fant mt-auto shrink-0 justify-start gap-2 border-t border-t-borda">
          <Icone nome="sair" tamanho={16} />Voltar
        </button>
      </nav>
      <main ref={principal} className="flex min-w-0 flex-col gap-3 overflow-y-auto px-8 pt-6 pb-8">
        <div className="flex w-full max-w-[1040px] flex-col gap-3">
          {resultados ? <Resultados busca={busca} lista={resultados} onAbrir={(a) => abrir(a.pagina, a.id)} /> : (
            <>
              {atual === 'perfil' && <PaginaPerfil eu={props.eu} destaque={destaque} onEditar={props.onPerfil} />}
              {atual === 'voz' && <SecaoPreferencias servidorUrl={props.servidor?.url ?? null} destaque={destaque} />}
              {atual === 'atalhos' && <SecaoAtalhos />}
              {atual === 'clipes' && <PaginaClipes destaque={destaque} />}
              {atual === 'cutucadas' && <PaginaCutucadas servidor={props.servidor} eu={props.eu} destaque={destaque} />}
              {atual === 'sons' && <PaginaSons destaque={destaque} />}
              {atual === 'quemfala' && <PaginaQuemFala destaque={destaque} />}
              {atual === 'cs2' && <PaginaCs2 destaque={destaque} />}
              {atual === 'aparencia' && <SecaoAparencia destaque={destaque} />}
              {atual === 'geral' && props.servidor && props.eu && <PaginaGeral servidor={props.servidor} eu={props.eu} />}
              {atual === 'salas' && props.servidor && <PaginaSalas servidor={props.servidor} salas={props.salas} onSalas={props.onSalas} />}
              {atual === 'membros' && props.servidor && props.eu && <PaginaMembros servidor={props.servidor} eu={props.eu} pessoas={props.pessoas} onPessoas={props.onPessoas} />}
              {atual === 'servidores' && (
                <SecaoServidores atual={props.servidor?.url ?? null} servidor={props.servidor} eu={props.eu}
                  onTrocar={props.onTrocar} onColarConvite={props.onColarConvite} onSair={props.onSair} />
              )}
              {atual === 'sobre' && <SecaoSobre updater={props.updater} inCall={props.inCall} onNotes={props.onNotes} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Resultados({ busca, lista, onAbrir }: { busca: string; lista: Ajuste[]; onAbrir(a: Ajuste): void }) {
  return (
    <>
      <Cabecalho rotulo={`Busca · ${lista.length === 1 ? '1 ajuste' : `${lista.length} ajustes`} com “${busca.trim()}”`} titulo="Resultados" />
      {lista.length ? (
        <ul className="janela m-0 flex list-none flex-col p-0" aria-label="Resultados da busca">
          {lista.map((a) => (
            <li key={a.id} className="border-t border-borda first:border-t-0">
              <button type="button" onClick={() => onAbrir(a)} className="flex w-full items-center gap-6 border-0 bg-transparent px-4 py-3.5 text-left text-texto hover:bg-superficie-alta">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="rotulo">{caminhoDe(a)}</span>
                  <b className="text-[15px]">{a.titulo}</b>
                  <span className="text-[13.5px] text-texto-fraco">{a.descricao}</span>
                </span>
                <span className="rotulo shrink-0">Abrir ›</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="janela p-4 text-texto-fraco">Nenhum ajuste com “{busca.trim()}”. Tente outra palavra, como “microfone” ou “tela”.</div>
      )}
      <p className="m-0 font-mono text-[11.5px] text-texto-fraco">Busca no nome do ajuste, na descrição e em apelidos (“ptt”, “mute”, “gravação”).</p>
    </>
  );
}

/** Error strip with a way out: "Tentar de novo" when the action can be repeated. */
function Erro({ texto, onTentar }: { texto?: string; onTentar?(): void }) {
  return texto ? <Faixa acoes={onTentar ? [{ rotulo: 'Tentar de novo', onClick: onTentar }] : []}>{texto}</Faixa> : null;
}

/** Servidor > Geral e convites. */
function PaginaGeral({ servidor, eu }: { servidor: Servidor; eu: Usuario }) {
  const host = new URL(servidor.url).host;
  return (
    <>
      <Cabecalho rotulo={`Servidor · ${host}`} titulo="Geral e convites">
        Você entrou como <b className="text-texto">{eu.nome}</b> ({eu.papel}). Um servidor é um grupo: só entra quem recebe convite.
      </Cabecalho>
      <div data-ajuste="servidor-nome convites"><Convites servidor={servidor} /></div>
    </>
  );
}

/** Servidor > Salas. */
function PaginaSalas({ servidor, salas, onSalas }: { servidor: Servidor; salas: Sala[]; onSalas(s: Sala[]): void }) {
  return (
    <>
      <Cabecalho rotulo={`Servidor · ${salas.length === 1 ? '1 sala' : `${salas.length} salas`}`} titulo="Salas">
        As salas fixas do grupo. As sub-salas CT e TR do CS2 aparecem e somem sozinhas durante a partida.
      </Cabecalho>
      <div data-ajuste="salas-lista"><Salas servidor={servidor} salas={salas} onSalas={onSalas} /></div>
    </>
  );
}

/** Servidor > Membros e cargos. */
function PaginaMembros(p: { servidor: Servidor; eu: Usuario; pessoas: Pessoa[]; onPessoas(p: Pessoa[]): void }) {
  return (
    <>
      <Cabecalho rotulo={`Servidor · ${p.pessoas.length} membros`} titulo="Membros e cargos">
        O dono e os admins convidam, cuidam das salas e moderam. O cargo de cada pessoa aparece ao lado do nome.
      </Cabecalho>
      <div data-ajuste="membros-lista"><Membros {...p} /></div>
    </>
  );
}

/** "Este aparelho": another PC or leaving this one. Shown under Servidores for everyone. */
function EsteAparelho({ servidor, onSair }: { servidor: Servidor; onSair(): void }) {
  const [aparelho, setAparelho] = useState<string>();
  const [erro, setErro] = useState<string>();
  return (
    <section data-ajuste="aparelho" className="janela flex flex-col">
      <div className="barra">Este aparelho<span className="ml-auto font-medium">{new URL(servidor.url).host}</span></div>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button type="button" className="btn" onClick={async () => {
          setErro(undefined);
          try {
            const link = await servidor.linkAparelho();
            setAparelho(link);
            await navigator.clipboard.writeText(link).catch(() => undefined);
          } catch (e) {
            setErro(e instanceof Error ? e.message : String(e));
          }
        }}>Entrar em outro aparelho</button>
        <button type="button" className="btn text-perigo" onClick={onSair}>Sair deste aparelho</button>
        {aparelho && (
          <p role="status" className="m-0 basis-full text-[14px]">
            Link copiado. Abra no outro PC em até 10 minutos; ele vale uma vez: <code className="font-mono break-all">{aparelho}</code>
          </p>
        )}
        <Erro texto={erro} />
      </div>
    </section>
  );
}

function Convites({ servidor }: { servidor: Servidor }) {
  const [lista, setLista] = useState<Convite[] | null>(null);
  const [falha, setFalha] = useState<{ texto: string; refazer?(): void }>();
  const setErro = (texto?: string, refazer?: () => void) => setFalha(texto ? { texto, refazer } : undefined);
  const [copiado, setCopiado] = useState<string>();
  const carregar = () => {
    setErro(undefined);
    return servidor.convites().then(setLista, (e: Error) => { setLista([]); setErro(e.message, () => void carregar()); });
  };
  useEffect(() => void carregar(), [servidor]);
  const gerar = async () => {
    setErro(undefined);
    try {
      const c = await servidor.criarConvite();
      setLista((l) => [c, ...(l ?? [])]);
      await copiar(c);
    } catch (e) {
      setErro(`Não deu para gerar o convite. ${e instanceof Error ? e.message : String(e)}`, () => void gerar());
    }
  };
  const copiar = async (c: Convite) => {
    if (!c.link) return;
    await navigator.clipboard.writeText(c.link).catch(() => undefined);
    setCopiado(c.id);
  };
  return (
    <section className="janela flex flex-col" aria-busy={lista === null}>
      <div className="barra">Convites<span className="ml-auto font-medium">1 uso · 7 dias</span></div>
      <div className="flex flex-col gap-3 p-4">
        <button type="button" className="btn btn-prim self-start" onClick={() => void gerar()}><Icone nome="link" />Gerar convite</button>
        <Erro texto={falha?.texto} onTentar={falha?.refazer} />
        {lista === null && <div className="skeleton h-11" />}
        {lista?.length === 0 && !falha && <p className="m-0 text-[14px] text-texto-fraco">Nenhum convite ativo. Gere um e mande no WhatsApp.</p>}
        <ul className="m-0 flex list-none flex-col p-0">
          {lista?.map((c) => (
            <li key={c.id} className="flex min-h-11 items-center gap-3 border-t border-borda py-1.5 first:border-t-0">
              <span className="rotulo tabular-nums">{c.usos}/{c.usosMax} usos · vence {data(c.expiraEm)}</span>
              {copiado === c.id && <span role="status" className="text-[13px] text-texto-fraco">Copiado</span>}
              <span className="ml-auto flex gap-2">
                {c.link && <button type="button" className="btn" onClick={() => void copiar(c)}><Icone nome="copiar" />Copiar link</button>}
                <button type="button" className="btn text-perigo" onClick={async () => {
                  await servidor.revogarConvite(c.id).then(() => setLista((l) => l?.filter((x) => x.id !== c.id) ?? null), (e: Error) => setErro(e.message));
                }}>Revogar</button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Salas({ servidor, salas, onSalas }: { servidor: Servidor; salas: Sala[]; onSalas(s: Sala[]): void }) {
  const [nova, setNova] = useState('');
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [erro, setErro] = useState<string>();
  const tentar = async (f: () => Promise<void>) => {
    setErro(undefined);
    try {
      await f();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  };
  const criar = (e: FormEvent) => {
    e.preventDefault();
    if (!nova.trim()) return;
    void tentar(async () => {
      onSalas([...salas, await servidor.criarSala(nova.trim())]);
      setNova('');
    });
  };
  return (
    <section className="janela flex flex-col">
      <div className="barra">Salas<span className="ml-auto font-medium">{salas.length}</span></div>
      <div className="flex flex-col gap-3 p-4">
        <ul className="m-0 flex list-none flex-col p-0">
          {salas.map((s) => (
            <li key={s.id} className="flex min-h-11 items-center gap-2 border-t border-borda py-1.5 first:border-t-0">
              {editando?.id === s.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => {
                  e.preventDefault();
                  void tentar(async () => {
                    const r = await servidor.renomearSala(s.id, editando.nome.trim());
                    onSalas(salas.map((x) => (x.id === s.id ? r : x)));
                    setEditando(null);
                  });
                }}>
                  <label htmlFor={`sala-${s.id}`} className="sr-only">Novo nome da sala {s.nome}</label>
                  <input id={`sala-${s.id}`} className="campo flex-1" value={editando.nome} maxLength={32} autoFocus onChange={(e) => setEditando({ id: s.id, nome: e.target.value })} />
                  <button type="submit" className="btn btn-prim" disabled={!editando.nome.trim()}>Salvar</button>
                  <button type="button" className="btn" onClick={() => setEditando(null)}>Cancelar</button>
                </form>
              ) : (
                <>
                  <b className="flex-1">{s.nome}</b>
                  <button type="button" className="btn" onClick={() => setEditando({ id: s.id, nome: s.nome })}>Renomear</button>
                  <button type="button" className="btn text-perigo" onClick={() => void tentar(async () => {
                    await servidor.apagarSala(s.id);
                    onSalas(salas.filter((x) => x.id !== s.id));
                  })}>Apagar</button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={criar} className="flex gap-2">
          <label htmlFor="nova-sala" className="sr-only">Nome da nova sala</label>
          <input id="nova-sala" className="campo flex-1" placeholder="Nome da nova sala" value={nova} maxLength={32} onChange={(e) => setNova(e.target.value)} />
          <button type="submit" className="btn" disabled={!nova.trim()}><Icone nome="mais" />Criar sala</button>
        </form>
        <Erro texto={erro} />
      </div>
    </section>
  );
}

function Membros({ servidor, eu, pessoas, onPessoas }: { servidor: Servidor; eu: Usuario; pessoas: Pessoa[]; onPessoas(p: Pessoa[]): void }) {
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [erro, setErro] = useState<string>();
  return (
    <section className="janela flex flex-col">
      <div className="barra">Pessoas<span className="ml-auto font-medium">{pessoas.length}</span></div>
      <ul className="m-0 flex list-none flex-col p-4">
        {pessoas.map((p) => (
          <li key={p.id} className="flex min-h-11 items-center gap-3 border-t border-borda py-1.5 first:border-t-0">
            <Avatar pessoa={p} tamanho={32} />
            <b>{p.nome}</b>
            <span className="rotulo">{p.papel}</span>
            {p.id !== eu.id && p.papel !== 'dono' && (
              confirmar === p.id ? (
                <span className="ml-auto flex gap-2">
                  <button type="button" className="btn border-perigo text-perigo" onClick={async () => {
                    setErro(undefined);
                    await servidor.remover(p.id).then(() => onPessoas(pessoas.filter((x) => x.id !== p.id)), (e: Error) => setErro(e.message));
                    setConfirmar(null);
                  }}>Confirmar remoção</button>
                  <button type="button" className="btn" onClick={() => setConfirmar(null)}>Cancelar</button>
                </span>
              ) : (
                <button type="button" className="btn ml-auto" onClick={() => setConfirmar(p.id)}>Remover</button>
              )
            )}
          </li>
        ))}
      </ul>
      {erro && <div className="px-4 pb-4"><Erro texto={erro} /></div>}
      <p className="m-0 border-t border-borda px-4 py-3 text-[13px] text-texto-fraco">Remover derruba a pessoa da sala e encerra as sessões dela em todos os aparelhos.</p>
    </section>
  );
}

function SecaoServidores({ atual, servidor, eu, onTrocar, onColarConvite, onSair }: {
  atual: string | null; servidor: Servidor | null; eu: Usuario | null; onTrocar(url: string): void; onColarConvite(): void; onSair(): void;
}) {
  const lista = lerServidores();
  const ativo = atual ?? servidorAtual();
  return (
    <>
      <Cabecalho rotulo={`App · ${lista.length === 1 ? '1 servidor' : `${lista.length} servidores`}`} titulo="Servidores">
        Cada servidor é uma turma. Para entrar em outro, cole o convite que essa turma mandou.
      </Cabecalho>
      <section data-ajuste="servidores-lista" className="janela flex flex-col">
        <div className="barra">Seus servidores</div>
        <ul className="m-0 flex list-none flex-col p-4">
          {lista.length === 0 && <li className="text-texto-fraco">Nenhum servidor salvo neste PC.</li>}
          {lista.map((s) => (
            <li key={s.url} className="flex min-h-11 items-center gap-3 border-t border-borda py-1.5 first:border-t-0">
              <b>{s.nome}</b>
              <span className="rotulo truncate">{new URL(s.url).host}</span>
              {s.url === ativo ? (
                <span className="rotulo ml-auto">em uso</span>
              ) : (
                <button type="button" className="btn ml-auto" onClick={() => { escolherServidor(s.url); onTrocar(s.url); }}>Usar este</button>
              )}
            </li>
          ))}
        </ul>
        <div className="border-t border-texto p-4">
          <button type="button" className="btn btn-prim" onClick={onColarConvite}><Icone nome="mais" />Adicionar servidor com convite</button>
        </div>
      </section>
      {servidor && eu && <EsteAparelho servidor={servidor} onSair={onSair} />}
    </>
  );
}

function SecaoSobre({ updater, inCall, onNotes }: { updater: Updater; inCall: boolean; onNotes(): void }) {
  const [history, setHistory] = useState<Version[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  useEffect(() => void loadChangelog().then(setHistory), []);
  const current = history.find((v) => v.version === updater.current);
  const busy = updater.status === 'downloading' || updater.status === 'installing';

  return (
    <>
      <Cabecalho rotulo="App · canal estável" titulo="Sobre e atualizações" />
      <div data-ajuste="atualizacoes" className="grid grid-cols-2 gap-4">
        <section className="janela flex flex-col">
          <div className="barra barra-lima">Instalado</div>
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-baseline gap-3">
              <b className="font-display tabular-nums text-[48px] leading-none">{updater.current}</b>
              <span className="text-texto-fraco">{current ? formatDate(current.date) : ''}</span>
            </div>
            <span className="text-texto-fraco">
              {updater.lastCheck ? `Última checagem: hoje, ${hhmm(updater.lastCheck)}` : 'Ainda não checou nesta sessão'}
              {updater.status === 'uptodate' && ' · você está na versão mais nova'}
            </span>
            {updater.status === 'error' && <p role="alert" className="m-0 text-perigo">Não deu para checar: {updater.error}</p>}
            <button type="button" disabled={updater.status === 'checking'} onClick={() => void updater.check()} className="btn self-start">
              {updater.status === 'checking' ? 'Procurando…' : 'Procurar atualização'}
            </button>
          </div>
        </section>
        {updater.available ? (
          <section className="janela flex flex-col">
            <div className="barra barra-ar">Disponível</div>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-baseline gap-3">
                <b className="font-display tabular-nums text-[48px] leading-none">{updater.available.version}</b>
                {updater.available.date && <span className="text-texto-fraco">publicada em {new Date(updater.available.date).toLocaleDateString('pt-BR')}</span>}
              </div>
              <span>
                {updater.waitingForLeave ? 'Baixada. Instala quando você sair da sala.'
                  : inCall ? 'Você está numa chamada. A atualização baixa agora e instala quando você sair da sala.'
                    : 'O app fecha, instala e abre de novo.'}
              </span>
              <div className="flex gap-2">
                <button type="button" disabled={busy || updater.waitingForLeave} onClick={() => void updater.apply()} className="btn btn-prim">
                  {updateButtonLabel(updater, inCall)}
                </button>
                <button type="button" onClick={onNotes} className="btn">Ver novidades</button>
              </div>
            </div>
          </section>
        ) : (
          <section className="janela flex flex-col">
            <div className="barra">Disponível</div>
            <p className="m-0 p-4 text-texto-fraco">Nada novo por enquanto. O app procura ao abrir e a cada 6 horas.</p>
          </section>
        )}
      </div>

      <label className="janela flex items-center gap-4 px-4 py-3">
        <span className="flex flex-1 flex-col gap-0.5">
          <b>Canal</b>
          <span className="text-texto-fraco">O canal de teste chega depois. Por enquanto todo mundo recebe as versões estáveis.</span>
        </span>
        <select disabled value="estavel" className="campo w-auto">
          <option value="estavel">Estável</option>
        </select>
      </label>

      {isTauri() && (
        <section data-ajuste="teste-placa" className="janela flex items-center gap-4 px-4 py-3">
          <button type="button" disabled={testing} className="btn" onClick={async () => {
            setTesting(true);
            setTestResult('');
            try {
              const { trials } = await testMachine(true);
              setTestResult(trials.some((trial) => trial.ok) ? 'Teste da placa de vídeo concluído.' : 'Nenhum codificador de hardware disponível.');
            } catch (error) {
              setTestResult(String(error));
            } finally {
              setTesting(false);
            }
          }}>{testing ? 'Testando a placa…' : 'Refazer teste da placa de vídeo'}</button>
          <span role="status" className="text-texto-fraco">{testResult}</span>
        </section>
      )}

      <section className="janela flex flex-col">
        <div className="barra">Histórico de versões</div>
        {history.length === 0 && <div className="skeleton m-4 h-11" />}
        {history.map((h) => (
          <div key={h.version} className="grid min-h-11 grid-cols-[90px_120px_minmax(0,1fr)_auto] items-center gap-4 border-t border-borda px-4 first:border-t-0">
            <b className="font-display tabular-nums text-[20px]">{h.version}</b>
            <span className="text-texto-fraco">{formatDate(h.date)}</span>
            <span className="truncate">{summarize(h)}</span>
            <button type="button" onClick={onNotes} className="btn btn-fant">Ver notas</button>
          </div>
        ))}
      </section>
    </>
  );
}
