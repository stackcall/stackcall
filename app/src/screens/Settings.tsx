import { useEffect, useState } from 'react';
import { CATEGORIES, formatDate, loadChangelog, type Version } from '../lib/changelog';
import type { useUpdater } from '../lib/updater';
import { updateButtonLabel } from '../components/UpdateBanner';

type Updater = ReturnType<typeof useUpdater>;

const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], [string, string]> = {
  novidades: ['novidade', 'novidades'],
  melhorias: ['melhoria', 'melhorias'],
  correcoes: ['correção', 'correções'],
  ajustes: ['ajuste', 'ajustes'],
};

export function summarize(v: Version) {
  return CATEGORIES.flatMap((c) => {
    const n = v.items.filter((i) => i.category === c).length;
    return n ? [`${n} ${CATEGORY_LABEL[c][n === 1 ? 0 : 1]}`] : [];
  }).join(', ');
}

const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function Settings({ updater, inCall, onClose, onNotes }: { updater: Updater; inCall: boolean; onClose(): void; onNotes(): void }) {
  const [history, setHistory] = useState<Version[]>([]);
  useEffect(() => void loadChangelog().then(setHistory), []);
  const current = history.find((v) => v.version === updater.current);
  const busy = updater.status === 'downloading' || updater.status === 'installing';

  return (
    <div role="dialog" aria-modal="true" aria-label="Configurações" className="absolute inset-0 z-20 grid grid-cols-[280px_minmax(0,1fr)] bg-bg">
      <nav aria-label="Configurações" className="flex flex-col gap-0.5 border-r border-line bg-panel px-3 py-5">
        <span className="px-3 pb-3 font-cond text-[20px] font-bold tracking-[0.04em]">CONFIGURAÇÕES</span>
        <span aria-current="page" className="flex h-10 items-center rounded-[6px] border-l-[3px] border-live bg-active px-3 text-on-active">Sobre e atualizações</span>
        <button type="button" onClick={onClose} className="mt-auto h-10 rounded-[6px] border border-line bg-transparent text-[#c5c8ce]">Voltar</button>
      </nav>

      <main className="flex min-w-0 flex-col gap-5 overflow-y-auto px-10 py-7">
        <h1 className="m-0 font-cond text-[28px] font-bold tracking-[0.03em]">SOBRE E ATUALIZAÇÕES</h1>

        <div className="grid grid-cols-2 gap-4">
          <section className="flex flex-col gap-3.5 rounded-[6px] border border-line bg-panel p-5">
            <span className="label-caps text-[13px] text-muted">Instalado</span>
            <div className="flex items-baseline gap-3">
              <b className="font-cond text-[44px] leading-none font-bold">{updater.current}</b>
              <span className="text-muted">canal estável{current ? ` · ${formatDate(current.date)}` : ''}</span>
            </div>
            <span className="text-muted">
              {updater.lastCheck ? `Última checagem: hoje, ${hhmm(updater.lastCheck)}` : 'Ainda não checou nesta sessão'}
              {updater.status === 'uptodate' && ' · você está na versão mais nova'}
            </span>
            {updater.status === 'error' && <span role="alert" className="text-danger-text">Não deu para checar: {updater.error}</span>}
            <button type="button" disabled={updater.status === 'checking'} onClick={() => void updater.check()} className="h-10 self-start rounded-[6px] border border-line bg-raised px-4 text-text">
              {updater.status === 'checking' ? 'Procurando…' : 'Procurar atualização'}
            </button>
          </section>

          {updater.available ? (
            <section className="flex flex-col gap-3.5 rounded-[6px] border-2 border-live bg-[#17142a] p-5">
              <span className="label-caps text-[13px] text-[#cbbdff]">Disponível</span>
              <div className="flex items-baseline gap-3">
                <b className="font-cond text-[44px] leading-none font-bold">{updater.available.version}</b>
                {updater.available.date && <span className="text-[#b9adf0]">publicada em {new Date(updater.available.date).toLocaleDateString('pt-BR')}</span>}
              </div>
              <span className="leading-[1.45] text-[#c5c8ce]">
                {updater.waitingForLeave
                  ? 'Baixada. Instala quando você sair da sala.'
                  : inCall
                    ? 'Você está numa chamada. A atualização baixa agora e instala quando você sair da sala.'
                    : 'O app fecha, instala e abre de novo.'}
              </span>
              <div className="flex gap-2.5">
                <button type="button" disabled={busy || updater.waitingForLeave} onClick={() => void updater.apply()} className="btn btn-primary text-[16px]">
                  {updateButtonLabel(updater, inCall)}
                </button>
                <button type="button" onClick={onNotes} className="h-11 rounded-[6px] border border-[#4b3d8f] bg-transparent px-4 text-[#d8ceff]">Ver novidades</button>
              </div>
            </section>
          ) : (
            <section className="flex flex-col justify-center gap-2 rounded-[6px] border border-line bg-panel p-5 text-muted">
              <span className="label-caps text-[13px]">Disponível</span>
              <span>Nada novo por enquanto. O app procura ao abrir e a cada 6 horas.</span>
            </section>
          )}
        </div>

        <section className="rounded-[6px] border border-line bg-panel">
          <label className="flex items-center gap-3.5 px-5 py-3.5">
            <span className="flex flex-1 flex-col gap-0.5">
              <b className="font-semibold">Canal</b>
              <span className="text-muted">O canal de teste chega depois. Por enquanto todo mundo recebe as versões estáveis.</span>
            </span>
            <select disabled value="estavel" className="h-10 rounded-[6px] border border-line bg-raised px-3 text-text">
              <option value="estavel">Estável</option>
            </select>
          </label>
        </section>

        <section className="flex flex-col gap-2">
          <span className="label-caps text-[13px] text-muted">Histórico de versões</span>
          {history.map((h) => (
            <div key={h.version} className="grid h-11 grid-cols-[90px_120px_minmax(0,1fr)_120px] items-center gap-4 rounded-[6px] border border-line bg-panel px-4">
              <b className="font-cond text-[18px] font-bold">{h.version}</b>
              <span className="text-muted">{formatDate(h.date)}</span>
              <span className="truncate text-[#c5c8ce]">{summarize(h)}</span>
              <button type="button" onClick={onNotes} className="bg-transparent text-right text-[#b9a8ff]">Ver notas</button>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
