import { useEffect, useState } from 'react';
import { CATEGORIES, bundledChangelog, formatDate, loadChangelog, upperFirst, type Version } from '../lib/changelog';

const GROUP: Record<(typeof CATEGORIES)[number], { label: string; one: string }> = {
  Novidades: { label: 'novidades', one: 'novidade' },
  Melhorias: { label: 'melhorias', one: 'melhoria' },
  Correções: { label: 'correções', one: 'correção' },
  Ajustes: { label: 'ajustes', one: 'ajuste' },
};

/** Notes for one version; `from` is the version before an update (shown once after updating). */
export function Novidades({ from, current, onClose, onHistory }: { from: string | null; current: string; onClose(): void; onHistory(): void }) {
  const [versions, setVersions] = useState<Version[]>(bundledChangelog);
  useEffect(() => void loadChangelog().then(setVersions), []);
  const v = versions.find((x) => x.version === current) ?? versions[0];
  const groups = v ? CATEGORIES.flatMap((c) => v.categories.filter((g) => g.name === c).map((g) => ({ c, items: g.items }))) : [];

  return (
    <div role="dialog" aria-modal="true" aria-label="Novidades" className="absolute inset-0 z-30 flex justify-center overflow-y-auto bg-fundo">
      <div className="flex w-[880px] max-w-[calc(100%-48px)] flex-col gap-6 py-12">
        <header className="flex flex-col gap-2">
          <span className="rotulo">{from ? `Atualizado · ${from} → ${v?.version}` : `Versão ${v?.version ?? current}`}</span>
          <h1 className="text-[64px]">O que mudou na {v?.version ?? current}</h1>
          {v && <span className="text-texto-fraco">Publicada em {formatDate(v.date)} · canal estável</span>}
          <div className="mt-1 flex flex-wrap gap-2">
            {groups.map((g) => (
              <span key={g.c} className="rotulo border border-texto bg-lima px-2.5 py-1 text-sobre-lima">
                {g.items.length} {g.items.length === 1 ? GROUP[g.c].one : GROUP[g.c].label}
              </span>
            ))}
          </div>
        </header>

        {groups.map((g) => (
          <section key={g.c} className="janela flex flex-col">
            <h2 className="barra m-0">{g.c}</h2>
            {g.items.map((i, n) => (
              <div key={n} className="flex items-center gap-3 border-t border-borda px-4 py-3 first-of-type:border-t-0">
                <span>{upperFirst(i.message)}</span>
                {i.breaking && <span className="rotulo ml-auto text-perigo">Exige atualizar</span>}
              </div>
            ))}
          </section>
        ))}

        <footer className="mt-auto flex items-center gap-3">
          <button type="button" onClick={onHistory} className="btn btn-fant">Ver todas as versões</button>
          <button type="button" onClick={onClose} className="btn btn-prim btn-lg ml-auto">Voltar</button>
        </footer>
      </div>
    </div>
  );
}
