import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icone } from './Icone';
import { filtrarPaleta, moverFoco, TITULO_GRUPO, type ItemPaleta } from '../lib/paleta';

/**
 * Command palette: the only modal in the middle of the screen (design rule). Arrows choose, Enter
 * does, Tab opens the highlighted setting in Settings, Esc closes. `>` actions, `@` people.
 */
export function Paleta({ itens, onFechar, onConfiguracoes, inicial = '' }: {
  itens: ItemPaleta[]; onFechar(): void; onConfiguracoes(): void; inicial?: string;
}) {
  const [consulta, setConsulta] = useState(inicial);
  const [foco, setFoco] = useState(0);
  const lista = useMemo(() => filtrarPaleta(itens, consulta), [itens, consulta]);
  const campo = useRef<HTMLInputElement>(null);
  const antes = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    campo.current?.focus();
    const voltar = antes.current;
    return () => {
      if (voltar instanceof HTMLElement && document.contains(voltar)) voltar.focus();
    };
  }, []);
  useEffect(() => setFoco(0), [consulta]);
  useEffect(() => {
    document.getElementById(`paleta-${foco}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [foco]);

  const fazer = (i: ItemPaleta | undefined, configurar = false) => {
    if (!i) return;
    onFechar();
    if (configurar && i.configurar) i.configurar();
    else i.executar();
  };

  function tecla(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setFoco((f) => moverFoco(f, lista.length, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      fazer(lista[foco]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (lista[foco]?.configurar) fazer(lista[foco], true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onFechar();
    }
  }

  const termos = consulta.replace(/^[>@]/, '').trim().split(/\s+/).filter(Boolean);
  const marcar = (t: string) => {
    if (!termos.length) return t;
    const i = t.toLowerCase().indexOf(termos[0].toLowerCase());
    if (i < 0) return t;
    return <>{t.slice(0, i)}<mark className="bg-lima text-sobre-lima">{t.slice(i, i + termos[0].length)}</mark>{t.slice(i + termos[0].length)}</>;
  };

  let grupoAnterior = '';
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/45" aria-hidden="true" onMouseDown={onFechar} />
      <div role="dialog" aria-modal="true" aria-label="Comandos" onKeyDown={tecla}
        className="janela fixed top-[88px] left-1/2 z-50 flex max-h-[min(560px,calc(100vh-120px))] w-[660px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col">
        <label className="flex h-14 shrink-0 items-center gap-3 border-b border-texto px-4">
          <Icone nome="busca" tamanho={20} />
          <span className="sr-only">Buscar sala, pessoa, ação ou ajuste</span>
          <input ref={campo} role="combobox" aria-expanded="true" aria-controls="paleta-lista" aria-activedescendant={lista.length ? `paleta-${foco}` : undefined}
            className="min-w-0 flex-1 border-0 bg-transparent text-[18px] font-medium text-texto outline-none" value={consulta}
            placeholder="Buscar sala, pessoa, ação ou ajuste" onChange={(e) => setConsulta(e.target.value)} autoComplete="off" spellCheck={false} />
          <kbd className="border border-texto px-1.5 py-0.5 font-mono text-[11px] font-bold">Esc</kbd>
        </label>
        <div id="paleta-lista" role="listbox" aria-label="Resultados" className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {lista.length === 0 && (
            <p className="m-0 px-4 py-6 text-[14px] text-texto-fraco">
              Nada com “{consulta.replace(/^[>@]/, '')}”. Procure nas{' '}
              <button type="button" className="border-0 bg-transparent p-0 font-bold text-texto underline" onClick={() => { onFechar(); onConfiguracoes(); }}>Configurações</button>.
            </p>
          )}
          {lista.map((i, n) => {
            const titulo = i.grupo !== grupoAnterior ? TITULO_GRUPO[i.grupo] : null;
            grupoAnterior = i.grupo;
            return (
              <div key={i.id} role="presentation">
                {titulo && <div role="presentation" className="px-4 pt-2.5 pb-1 font-mono text-[11px] font-bold tracking-[0.06em] text-texto-fraco uppercase">{titulo}</div>}
                <div id={`paleta-${n}`} role="option" aria-selected={n === foco} onMouseMove={() => setFoco(n)} onClick={() => fazer(i)}
                  className={`flex h-[38px] cursor-pointer items-center gap-3 px-4 text-[14px] ${n === foco ? 'bg-texto text-superficie' : ''}`}>
                  <Icone nome={i.icone} tamanho={16} />
                  <span className="min-w-0 flex-1 truncate">
                    {marcar(i.rotulo)}{i.detalhe && <em className="not-italic opacity-75"> · {marcar(i.detalhe)}</em>}
                  </span>
                  {i.teclas && <kbd className="border border-current px-1.5 py-0.5 font-mono text-[11px] opacity-80">{i.teclas}</kbd>}
                  <span className={`font-mono text-[11px] tracking-[0.04em] uppercase ${n === foco ? '' : 'text-texto-fraco'}`}>{i.onde}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-borda px-4 py-2.5 text-[12px] text-texto-fraco">
          <span><kbd className="border border-texto px-1 font-mono">↑</kbd> <kbd className="border border-texto px-1 font-mono">↓</kbd> escolher</span>
          <span><kbd className="border border-texto px-1 font-mono">Enter</kbd> fazer</span>
          <span><kbd className="border border-texto px-1 font-mono">Tab</kbd> abrir em Configurações</span>
          <span className="ml-auto font-mono">&gt; ações · @ pessoas</span>
        </div>
      </div>
    </>
  );
}
