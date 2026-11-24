import { useEffect, useState, type FormEvent } from 'react';
import { requestToken } from '../lib/api';
import { DEFAULT_SERVER, NAME_PATTERN, store } from '../lib/config';
import { invite as inviteVault } from '../lib/invite';
import type { Session } from '../room/useLiveRoom';

export function Login({ onEnter, onSettings }: { onEnter(session: Session): void; onSettings(): void }) {
  const [name, setName] = useState(() => store.get('nome') ?? '');
  const [invite, setInvite] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void inviteVault.load().then((saved) => saved && setInvite((v) => v || saved));
  }, []);

  const nameOk = NAME_PATTERN.test(name);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!nameOk) return setError('O nome deve ter de 1 a 32 caracteres, sem dois-pontos.');
    setBusy(true);
    setError(undefined);
    try {
      await requestToken(DEFAULT_SERVER, invite, name, 'geral'); // checks the invite before entering
      store.set('nome', name);
      await (remember ? inviteVault.save(invite) : inviteVault.clear());
      onEnter({ server: DEFAULT_SERVER, name, invite });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center">
      <form onSubmit={submit} className="flex w-[420px] flex-col gap-5 rounded-[6px] border border-line bg-panel p-8" aria-label="Entrar">
        <div className="flex items-baseline justify-between">
          <h1 className="m-0 font-cond text-[28px] font-bold tracking-[0.04em]">STACKCALL</h1>
          <span className="text-[13px] text-muted">v{__APP_VERSION__}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="nome" className="label-caps text-[13px] text-muted">Nome</label>
          <input id="nome" className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" required aria-invalid={!!name && !nameOk} aria-describedby="nome-ajuda" />
          <span id="nome-ajuda" className={`text-[12px] ${name && !nameOk ? 'text-danger-text' : 'text-faint'}`}>
            De 1 a 32 caracteres, sem dois-pontos. É como os amigos veem você.
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="convite" className="label-caps text-[13px] text-muted">Convite</label>
          <input id="convite" className="field" type="password" value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" required />
        </div>
        <label className="flex items-center gap-2.5 text-[13px] text-muted">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-[18px] accent-live" />
          Lembrar o convite neste PC (fica no cofre do Windows)
        </label>
        {error && <p role="alert" className="m-0 rounded-[6px] border border-danger-line bg-danger-bg px-3 py-2 text-danger-text">{error}</p>}
        <button type="submit" disabled={busy} className="btn btn-primary h-12 text-[17px]">
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <button type="button" onClick={onSettings} className="self-center bg-transparent text-[13px] text-muted underline-offset-2 hover:underline">
          Sobre e atualizações
        </button>
      </form>
    </div>
  );
}
