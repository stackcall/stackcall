import { ROOMS, type RoomId } from '../lib/config';
import type { useUpdater } from '../lib/updater';

type Updater = ReturnType<typeof useUpdater>;

export function updateButtonLabel(updater: Updater, inCall: boolean) {
  if (updater.status === 'downloading') return `Baixando ${Math.round((updater.progress ?? 0) * 100)}%`;
  if (updater.status === 'installing') return 'Instalando…';
  return inCall ? 'Atualizar ao sair da sala' : 'Atualizar e reiniciar';
}

export function UpdateBanner({ updater, inCall, room, onNotes }: {
  updater: Updater; inCall: boolean; room: RoomId; onNotes(): void;
}) {
  if (!updater.available) return null;
  const roomLabel = ROOMS.find((r) => r.id === room)?.label ?? room;
  const busy = updater.status === 'downloading' || updater.status === 'installing';
  return (
    <div role="status" className="flex h-12 shrink-0 items-center gap-3.5 border-b border-[#4b3d8f] bg-active px-6">
      <span className="label-caps rounded bg-live px-2 py-0.5 text-[13px] text-bg">Nova versão</span>
      <span>
        <b className="font-semibold">Stackcall {updater.available.version}</b> está disponível
      </span>
      {updater.status === 'error' && <span className="text-danger-text">Falhou: {updater.error}</span>}
      <button type="button" onClick={onNotes} className="ml-auto bg-transparent text-[#b9a8ff] underline-offset-2 hover:underline">
        Ver novidades
      </button>
      {updater.waitingForLeave ? (
        <span className="text-[#b9adf0]">Instala quando você sair da sala {roomLabel}</span>
      ) : (
        <button type="button" disabled={busy} onClick={() => void updater.apply()} className="btn btn-primary h-8 text-[14px]">
          {updateButtonLabel(updater, inCall)}
        </button>
      )}
    </div>
  );
}
