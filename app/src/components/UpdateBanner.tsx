import { useState } from 'react';
import type { useUpdater } from '../lib/updater';

type Updater = ReturnType<typeof useUpdater>;

export function updateButtonLabel(updater: Updater, inCall: boolean) {
  if (updater.status === 'downloading') return `Baixando ${Math.round((updater.progress ?? 0) * 100)}%`;
  if (updater.status === 'installing') return 'Instalando…';
  return inCall ? 'Atualizar ao sair da sala' : 'Atualizar e reiniciar';
}

/** Slim lime strip (40 px); "Depois" hides it until the app opens again, so it never sits over a match. */
export function UpdateBanner({ updater, inCall, room, onNotes }: {
  updater: Updater; inCall: boolean; room: string; onNotes(): void;
}) {
  const [depois, setDepois] = useState<string | null>(null);
  if (!updater.available || depois === updater.available.version) return null;
  const busy = updater.status === 'downloading' || updater.status === 'installing';
  return (
    <div role="status" className="flex min-h-10 shrink-0 items-center gap-3 border-b border-texto bg-lima px-5 text-[14px] text-sobre-lima">
      <span><b>Stackcall {updater.available.version}</b> está disponível.</span>
      <button type="button" onClick={onNotes} className="border-0 bg-transparent p-0 font-bold text-sobre-lima underline underline-offset-2">Ver novidades</button>
      {updater.status === 'error' && <span className="font-bold">Falhou: {updater.error}</span>}
      <span className="ml-auto" />
      {updater.waitingForLeave ? (
        <span>Instala quando você sair da sala{room ? ` ${room}` : ''}.</span>
      ) : (
        <button type="button" disabled={busy} onClick={() => void updater.apply()} className="btn btn-sm">
          {updateButtonLabel(updater, inCall)}
        </button>
      )}
      {!busy && <button type="button" onClick={() => setDepois(updater.available!.version)} className="btn btn-sm btn-fant text-sobre-lima hover:!bg-black/10 hover:!text-sobre-lima">Depois</button>}
    </div>
  );
}
