import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { CaptureSource } from '../../lib/sidecar';

// shortcut: short list of known games by process; widen it (or use a fullscreen hint from the core) when people ask.
const GAMES = new Set([
  'cs2.exe', 'valorant-win64-shipping.exe', 'league of legends.exe', 'dota2.exe', 'r5apex.exe', 'r5apex_dx12.exe',
  'fortniteclient-win64-shipping.exe', 'overwatch.exe', 'rocketleague.exe', 'gta5.exe', 'gta5_enhanced.exe',
  'eldenring.exe', 'minecraft.windows.exe', 'cod.exe', 'marvel-win64-shipping.exe', 'deadlock.exe', 'project8.exe',
]);

export type Kind = 'tela' | 'jogo' | 'janela';
export const kindOf = (s: CaptureSource): Kind =>
  !s.pid ? 'tela' : GAMES.has((s.process_name ?? '').toLowerCase()) ? 'jogo' : 'janela';

export type SavedSource = { process_name: string | null; title: string };

/** Last source by process and title (window ids change every run), else the main monitor. */
export function initialSource(list: CaptureSource[], saved: SavedSource | null) {
  const same = saved && (list.find((s) => s.process_name === saved.process_name && s.title === saved.title)
    ?? (saved.process_name ? list.find((s) => s.process_name === saved.process_name) : undefined));
  return same ?? list.find((s) => !s.pid && s.primary) ?? list.find((s) => !s.pid) ?? list[0];
}

const FILTERS = [['tudo', 'Tudo'], ['tela', 'Telas'], ['janela', 'Janelas'], ['jogo', 'Jogos']] as const;
const GROUPS: [Kind, string][] = [['tela', 'Telas'], ['jogo', 'Jogos'], ['janela', 'Janelas']];

type Props = {
  sources?: CaptureSource[];
  loading: boolean;
  selected?: string;
  disabled: boolean;
  refreshDisabled: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onSelect(source: CaptureSource): void;
  onRefresh(): void;
  onEnter(): void;
};

export function Fontes({ sources, loading, selected, disabled, refreshDisabled, searchRef, onSelect, onRefresh, onEnter }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('tudo');
  const [showAll, setShowAll] = useState(false);
  const tiles = useRef(new Map<string, HTMLButtonElement>());

  // Hygiene: tiny windows and repeated titles stay hidden until "Mostrar todas".
  const seen = new Set<string>();
  let hidden = 0;
  const kept = (sources ?? []).filter((s) => {
    if (!s.pid || s.id === selected) return true;
    const key = `${s.process_name}|${s.title}`;
    const tiny = !s.minimized && s.width !== null && s.height !== null && (s.width < 200 || s.height < 100);
    const repeated = seen.has(key);
    seen.add(key);
    if ((tiny || repeated) && !showAll) hidden++;
    return showAll || !(tiny || repeated);
  });
  const q = query.trim().toLowerCase();
  const filtered = !!q || filter !== 'tudo';
  const visible = kept.filter((s) => (filter === 'tudo' || kindOf(s) === filter)
    && (!q || s.title.toLowerCase().includes(q) || (s.process_name ?? '').toLowerCase().includes(q)));
  const groups = GROUPS.map(([kind, label]) => ({
    kind, label,
    items: visible.filter((s) => kindOf(s) === kind).sort((a, b) => (kind === 'janela' ? a.title.localeCompare(b.title, 'pt-BR') : 0)),
  })).filter((g) => g.items.length);
  const order = groups.flatMap((g) => g.items);
  const tabStop = order.some((s) => s.id === selected) ? selected : order[0]?.id;

  function onKey(event: KeyboardEvent) {
    const index = order.findIndex((s) => s.id === (event.target as HTMLElement).dataset.id);
    if (index < 0) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      return onEnter();
    }
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
    if (!step) return;
    event.preventDefault();
    const next = order[(index + step + order.length) % order.length];
    if (!disabled) onSelect(next);
    tiles.current.get(next.id)?.focus();
  }

  return (
    <section aria-label="Fonte" className="janela flex min-h-0 min-w-0 flex-col">
      <div className="barra">
        Fonte{sources ? ` · ${kept.length}` : ''}
        <button type="button" disabled={refreshDisabled || loading} onClick={onRefresh}
          className="ml-auto border-0 bg-transparent font-mono text-[11px] font-bold text-superficie uppercase underline disabled:opacity-50">
          {loading && sources ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-texto p-2">
        <input ref={searchRef} type="search" className="campo min-w-[150px] flex-1" placeholder="Buscar tela ou janela"
          aria-label="Buscar tela ou janela" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="abas" role="group" aria-label="Tipo de fonte">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </div>
      <div role="radiogroup" aria-label="Telas e janelas" aria-busy={!sources} onKeyDown={onKey}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {!sources && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 pt-3">
            {[0, 1, 2, 3, 4, 5].map((n) => <span key={n} className="skeleton aspect-[16/11]" />)}
          </div>
        )}
        {sources && !order.length && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
            <b className="text-[15px]">{filtered ? 'Nada com esse filtro' : 'Nenhuma janela encontrada'}</b>
            <span className="text-[13px] text-texto-fraco">{filtered ? 'Limpe a busca ou escolha Tudo.' : 'Abra o jogo e toque em Atualizar.'}</span>
            {filtered
              ? <button type="button" className="btn" onClick={() => { setQuery(''); setFilter('tudo'); }}>Limpar filtro</button>
              : <button type="button" className="btn" disabled={refreshDisabled || loading} onClick={onRefresh}>Atualizar</button>}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.kind}>
            <h3 className="rotulo sticky top-0 z-[2] m-0 -mx-3 border-b border-borda bg-superficie px-3 py-1.5 text-[11px]">{g.label} · {g.items.length}</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 pt-2">
              {g.items.map((s) => (
                <Tile key={s.id} source={s} on={s.id === selected} tabStop={s.id === tabStop} disabled={disabled}
                  register={(el) => { if (el) tiles.current.set(s.id, el); else tiles.current.delete(s.id); }}
                  onSelect={() => onSelect(s)} />
              ))}
            </div>
          </div>
        ))}
        {hidden > 0 && (
          <button type="button" className="mt-3 border-0 bg-transparent p-0 text-[13px] text-texto-fraco underline" onClick={() => setShowAll(true)}>
            Mostrar todas ({hidden} {hidden === 1 ? 'oculta' : 'ocultas'})
          </button>
        )}
      </div>
    </section>
  );
}

function Tile({ source: s, on, tabStop, disabled, register, onSelect }: {
  source: CaptureSource; on: boolean; tabStop: boolean; disabled: boolean;
  register(el: HTMLButtonElement | null): void; onSelect(): void;
}) {
  const dims = s.width !== null && s.height !== null ? `${s.width}×${s.height}` : '';
  // Cover fills the 16:9 frame; contain only when the shape is far from it (portrait, ultrawide).
  const ratio = s.width && s.height ? s.width / s.height : 16 / 9;
  const fit = Math.abs(ratio - 16 / 9) < 0.4 ? 'object-cover' : 'object-contain';
  return (
    <button ref={register} type="button" role="radio" aria-checked={on} data-id={s.id} tabIndex={tabStop ? 0 : -1}
      disabled={disabled} title={[s.title, s.process_name, dims].filter(Boolean).join(' · ')} onClick={onSelect}
      className="relative flex min-w-0 flex-col border border-texto bg-superficie p-0 text-left hover:bg-superficie-alta active:translate-y-px">
      <span className="relative block aspect-video w-full overflow-hidden border-b border-texto bg-palco">
        {s.thumbnail && !s.minimized
          ? <img alt="" className={`absolute inset-0 size-full ${fit}`} src={`data:image/png;base64,${s.thumbnail}`} />
          : <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-[12px] text-[#b3b3ab]">{s.minimized ? 'Minimizada' : 'Sem prévia'}</span>}
        {on && <span className="absolute top-0 left-0 bg-destaque px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-sobre-destaque">Escolhida</span>}
      </span>
      <span className="flex h-9 min-w-0 items-center gap-2 px-2.5">
        <b className="truncate text-[13px]">{s.title}</b>
        <span className="rotulo ml-auto shrink-0 text-[10px]">{dims}</span>
      </span>
      {s.minimized && <span className="px-2.5 pb-2 text-[12px] leading-tight text-texto-fraco">Minimizada: volte ao jogo antes de entrar no ar</span>}
      {/* The selection frame sits inside, so the focus ring (outside) never covers it. */}
      {on && <span aria-hidden="true" className="pointer-events-none absolute inset-0 border-[3px] border-destaque" />}
    </button>
  );
}
