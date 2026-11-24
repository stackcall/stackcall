import type { useUpdater } from '../lib/updater';

type Updater = ReturnType<typeof useUpdater>;

export function updateButtonLabel(updater: Updater, inCall: boolean) {
  if (updater.status === 'downloading') return `Baixando ${Math.round((updater.progress ?? 0) * 100)}%`;
  if (updater.status === 'installing') return 'Instalando…';
  return inCall ? 'Atualizar ao sair da sala' : 'Atualizar e reiniciar';
}

export function UpdateBanner({ updater, inCall, room, onNotes }: {
  updater: Updater; inCall: boolean; room: string; onNotes(): void;
}) {
  if (!updater.available) return null;
  const busy = updater.status === 'downloading' || updater.status === 'installing';
  return (
    <div role="status" className="flex min-h-12 shrink-0 items-center gap-3.5 border-b border-texto bg-lima px-5 text-sobre-lima">
      <span className="rotulo text-sobre-lima">Nova versão</span>
      <span><b>Stackcall {updater.available.version}</b> está disponível</span>
      {updater.status === 'error' && <span className="text-[#7a0d0d]">Falhou: {updater.error}</span>}
      <button type="button" onClick={onNotes} className="btn btn-fant ml-auto text-sobre-lima">Ver novidades</button>
      {updater.waitingForLeave ? (
        <span>Instala quando você sair da sala{room ? ` ${room}` : ''}</span>
      ) : (
        <button type="button" disabled={busy} onClick={() => void updater.apply()} className="btn btn-prim">
          {updateButtonLabel(updater, inCall)}
        </button>
      )}
    </div>
  );
}
