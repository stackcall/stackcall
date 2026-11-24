import { useEffect, useState } from 'react';
import { CATEGORIES, bundledChangelog, formatDate, loadChangelog, upperFirst, type Version } from '../lib/changelog';

const GROUP: Record<(typeof CATEGORIES)[number], { title: string; label: string; one: string; dot: string; color: string }> = {
  Novidades: { title: 'NOVIDADES', label: 'novidades', one: 'novidade', dot: '#7c5cff', color: '#cbbdff' },
  Melhorias: { title: 'MELHORIAS', label: 'melhorias', one: 'melhoria', dot: '#7fb8a4', color: '#a9d6c6' },
  Correções: { title: 'CORREÇÕES', label: 'correções', one: 'correção', dot: '#d9a35b', color: '#e8c08c' },
  Ajustes: { title: 'AJUSTES', label: 'ajustes', one: 'ajuste', dot: '#8a8e97', color: '#b4b8c0' },
};

/** Notes for one version; `from` is the version before an update (shown once after updating). */
export function Novidades({ from, current, onClose, onHistory }: { from: string | null; current: string; onClose(): void; onHistory(): void }) {
  const [versions, setVersions] = useState<Version[]>(bundledChangelog);
  useEffect(() => void loadChangelog().then(setVersions), []);
  const v = versions.find((x) => x.version === current) ?? versions[0];
  const groups = v ? CATEGORIES.flatMap((c) => v.categories.filter((g) => g.name === c).map((g) => ({ c, items: g.items }))) : [];

  return (
    <div role="dialog" aria-modal="true" aria-label="Novidades" className="absolute inset-0 z-30 flex justify-center overflow-y-auto bg-bg text-[15px]">
      <div className="flex w-[880px] max-w-[calc(100%-48px)] flex-col gap-7 py-12">
        <header className="flex flex-col gap-2.5">
          <span className="label-caps text-[14px] tracking-[0.1em] text-[#cbbdff]">
            {from ? `Atualizado · ${from} → ${v?.version}` : `Versão ${v?.version ?? current}`}
          </span>
          <h1 className="m-0 font-cond text-[44px] leading-[1.05] font-bold tracking-[0.02em]">O que mudou na {v?.version ?? current}</h1>
          {v && <span className="text-muted">Publicada em {formatDate(v.date)} · canal estável</span>}
          <div className="mt-1 flex gap-2">
            {groups.map((g) => (
              <span key={g.c} className="flex h-[30px] items-center gap-2 rounded border border-line bg-panel px-3 text-[13px]">
                <span className="size-2 rounded-[2px]" style={{ background: GROUP[g.c].dot }} />
                {g.items.length} {g.items.length === 1 ? GROUP[g.c].one : GROUP[g.c].label}
              </span>
            ))}
          </div>
        </header>

        {groups.map((g) => (
          <section key={g.c} className="flex flex-col gap-2.5">
            <h2 className="label-caps m-0 flex items-center gap-2.5 text-[16px]" style={{ color: GROUP[g.c].color }}>
              <span className="size-2.5 rounded-[2px]" style={{ background: GROUP[g.c].dot }} />
              {GROUP[g.c].title}
            </h2>
            {g.items.map((i, n) => (
              <div key={n} className="flex items-center gap-3 rounded-[6px] border border-line bg-panel px-[18px] py-3.5">
                <span className="leading-normal">{upperFirst(i.message)}</span>
                {i.breaking && <span className="label-caps ml-auto rounded bg-danger-bg px-2 py-0.5 text-[12px] text-danger-text">Exige atualizar</span>}
              </div>
            ))}
          </section>
        ))}

        <footer className="mt-auto flex items-center gap-3">
          <button type="button" onClick={onHistory} className="bg-transparent text-[#b9a8ff]">Ver todas as versões</button>
          <button type="button" onClick={onClose} className="btn btn-primary ml-auto h-[46px] px-6 text-[17px]">Voltar</button>
        </footer>
      </div>
    </div>
  );
}
