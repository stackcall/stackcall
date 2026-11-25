import { useId, type ReactNode } from 'react';

/** Page header of Settings: data label, headline, one line of description. */
export function Cabecalho({ rotulo, titulo, children }: { rotulo?: string; titulo: string; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1.5">
      {rotulo && <span className="rotulo">/ {rotulo}</span>}
      <h1 className="text-[52px]">{titulo}</h1>
      {children && <p className="m-0 max-w-[72ch] text-texto-fraco">{children}</p>}
    </header>
  );
}

/**
 * One setting as a window row: name, one sentence of what changes, the control on the right.
 * `ajuste` is the search id (lib/buscaConfig.ts); `destaque` outlines it after a search.
 */
export function Linha({ ajuste, titulo, descricao, children, destaque, coluna = false }: {
  ajuste: string; titulo: string; descricao?: ReactNode; children?: ReactNode; destaque?: boolean; coluna?: boolean;
}) {
  const id = useId();
  return (
    <section data-ajuste={ajuste} aria-labelledby={id}
      className={`janela flex gap-x-6 gap-y-3 px-4 py-3.5 ${coluna ? 'flex-col' : 'flex-wrap items-center justify-between'} ${destaque ? 'outline-2 outline-offset-2 outline-destaque' : ''}`}>
      <span className="flex min-w-0 flex-1 basis-[240px] flex-col gap-0.5">
        <b id={id} className="text-[15px]">{titulo}</b>
        {descricao && <span className="text-[13.5px] text-texto-fraco">{descricao}</span>}
      </span>
      {children}
    </section>
  );
}

/** On/off switch: ink track, lime knob when on; the text says the state. */
export function Chave({ ligado, rotulo, onMudar, disabled, textos = ['Ligado', 'Desligado'] }: {
  ligado: boolean; rotulo: string; onMudar(v: boolean): void; disabled?: boolean; textos?: [string, string];
}) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} disabled={disabled} onClick={() => onMudar(!ligado)}
      className="flex min-h-11 shrink-0 items-center gap-2.5 border-0 bg-transparent px-1 text-[13px] font-bold text-texto disabled:text-texto-fraco">
      <span aria-hidden="true" className={`relative h-5 w-[38px] border border-texto ${ligado ? 'bg-texto' : 'bg-superficie'}`}>
        <span className={`absolute top-[3px] size-3 ${ligado ? 'left-[21px] bg-lima' : 'left-[3px] bg-texto'}`} />
      </span>
      <span className="w-[72px] text-left">{ligado ? textos[0] : textos[1]}</span>
    </button>
  );
}

/** Segmented choice (abas): the chosen one in ink, never red. */
export function Segmento<T extends string | number>({ valor, opcoes, rotulo, onMudar, disabled }: {
  valor: T; opcoes: [T, string][]; rotulo: string; onMudar(v: T): void; disabled?: boolean;
}) {
  return (
    <div className="abas shrink-0" role="group" aria-label={rotulo}>
      {opcoes.map(([v, texto]) => (
        <button key={String(v)} type="button" aria-pressed={valor === v} disabled={disabled} onClick={() => onMudar(v)}>{texto}</button>
      ))}
    </div>
  );
}

/** Range with its value next to it (tabular), for volume and opacity. */
export function Deslizante({ valor, min, max, passo = 1, rotulo, sufixo = '%', onMudar, disabled }: {
  valor: number; min: number; max: number; passo?: number; rotulo: string; sufixo?: string; onMudar(v: number): void; disabled?: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-3">
      <span className="rotulo tabular-nums">{min}{sufixo}</span>
      <input type="range" min={min} max={max} step={passo} value={valor} aria-label={rotulo} disabled={disabled}
        aria-valuetext={`${valor}${sufixo}`} onChange={(e) => onMudar(Number(e.target.value))} className="h-11 w-36 accent-texto" />
      <span className="rotulo tabular-nums">{max}{sufixo}</span>
      <b className="w-12 text-right font-mono text-[13px] tabular-nums">{valor}{sufixo}</b>
    </span>
  );
}
