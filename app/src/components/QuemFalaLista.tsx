import { corDe, inicial } from './Avatar';
import { linhasQuemFala, type EstadoQuemFala } from '../lib/quemfala';
import type { Preferencias } from '../lib/preferencias';

/** Row height and type per size; the core sizes the window from LARGURA_QUEM_FALA. */
const ESCALA = { p: { linha: 26, avatar: 16, fonte: 12 }, m: { linha: 32, avatar: 20, fonte: 13.5 }, g: { linha: 40, avatar: 26, fonte: 16 } };

/**
 * Content of the "quem fala" window (and its preview in Settings). Always dark: it sits over a
 * game. Static marks only, no continuous animation: it repaints when the room state changes.
 */
export function QuemFalaLista({ estado, prefs, largura }: {
  estado: EstadoQuemFala | null;
  prefs: Pick<Preferencias, 'quemFalaConteudo' | 'quemFalaOpacidade' | 'quemFalaTamanho'>;
  largura?: number;
}) {
  const e = ESCALA[prefs.quemFalaTamanho];
  const linhas = linhasQuemFala(estado, prefs.quemFalaConteudo);
  // "Só quem fala" with nobody speaking: nothing at all, not even the frame.
  if (!estado || (prefs.quemFalaConteudo === 'falando' && !linhas.length)) return null;
  return (
    <div aria-label="Quem está falando" style={{ opacity: prefs.quemFalaOpacidade / 100, width: largura, fontSize: e.fonte }}
      className="flex flex-col border border-[rgba(244,244,241,0.55)] bg-[rgba(16,16,18,0.86)] text-[#f4f4f1]">
      <ul className="m-0 list-none p-0">
        {linhas.map((p) => (
          <li key={p.id} className={`flex items-center gap-2 px-2 ${p.falando ? '' : 'opacity-60'}`} style={{ height: e.linha }}>
            <span aria-hidden="true" className={`font-display flex shrink-0 items-center justify-center border border-[#111] text-[#111] ${p.falando ? 'outline-2 outline-offset-1 outline-lima' : ''}`}
              style={{ width: e.avatar, height: e.avatar, fontSize: Math.round(e.avatar * 0.55), background: p.cor ?? corDe(p.nome) }}>{inicial(p.nome)}</span>
            <b className={`min-w-0 flex-1 truncate ${p.falando ? 'text-lima' : ''}`}>{p.nome}</b>
            {p.falando && <span className="sr-only">falando</span>}
            {p.falando && <span aria-hidden="true" className="h-2 w-6 shrink-0 bg-[repeating-linear-gradient(90deg,var(--color-lima)_0_4px,transparent_4px_6px)]" />}
            {p.mudo && <span className="shrink-0 font-mono text-[10px] font-bold uppercase text-[#ff7a6b]">mudo</span>}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-[rgba(244,244,241,0.3)] px-2 py-1 font-mono text-[10.5px] font-medium uppercase text-[#b3b3ab]">
        <span className="truncate">{estado.sala}{estado.ping !== null && ` · ${estado.ping} ms`}</span>
        {estado.replay && <span className="text-[#ff7a6b]">● replay</span>}
      </div>
    </div>
  );
}
