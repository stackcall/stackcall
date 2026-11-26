import { useCallback, useEffect, useRef, useState } from 'react';
import { falar } from './cutucar';
import { lerPreferencias } from './preferencias';
import type { Bora, Pessoa, RespostaBora, Servidor } from './servidor';

/** Open "Bora?" calls, refreshed every 20 s while the window is visible (one small GET). */
export const INTERVALO_BORA_MS = 20_000;

export const ROTULO_RESPOSTA: Record<RespostaBora, string> = { dentro: 'Tô dentro', '10min': 'Em 10 min', nao: 'Hoje não' };

/** "3 dentro · 1 em 10 min" for the strip. */
export function resumoRespostas(b: Bora) {
  const conta = (r: RespostaBora) => b.respostas.filter((x) => x.resposta === r).length;
  return [
    conta('dentro') && `${conta('dentro')} dentro`,
    conta('10min') && `${conta('10min')} em 10 min`,
    conta('nao') && `${conta('nao')} hoje não`,
  ].filter(Boolean).join(' · ');
}

const avisados = new Set<string>();

/** A new call from someone else: read aloud (same preference as pokes) and a Windows/browser notice. */
function avisar(b: Bora, autor: string, sala: string | null) {
  if (avisados.has(b.id)) return;
  avisados.add(b.id);
  const p = lerPreferencias();
  const frase = `${autor} chamou: bora?${b.recado ? ` ${b.recado}` : ''}`;
  if (p.cutucarVoz) falar(frase, p.cutucarVolume);
  if (p.cutucarAvisoWindows && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(`${autor}: bora?`, { body: [b.recado, sala && `Sala ${sala}`].filter(Boolean).join(' · '), tag: `bora-${b.id}` });
  }
}

export function useBoras(srv: Servidor | null, euId: string | null, pessoas: Pessoa[], nomeSala: (id: string) => string | null, visivel: boolean) {
  const [boras, setBoras] = useState<Bora[]>([]);
  const primeira = useRef(true);
  const nomes = useRef(new Map<string, string>());
  nomes.current = new Map(pessoas.map((p) => [p.id, p.nome] as const));
  const nomeSalaRef = useRef(nomeSala);
  nomeSalaRef.current = nomeSala;

  const atualizar = useCallback(async () => {
    if (!srv) return;
    const lista = await srv.boras().catch(() => null);
    if (!lista) return;
    // The first load only fills the list: calls made before opening the app do not ring.
    for (const b of lista) {
      if (b.autor !== euId && !primeira.current) avisar(b, nomes.current.get(b.autor) ?? 'Alguém', b.sala ? nomeSalaRef.current(b.sala) : null);
      else avisados.add(b.id);
    }
    primeira.current = false;
    setBoras(lista);
  }, [srv, euId]);

  useEffect(() => {
    if (!srv || !visivel) return;
    void atualizar();
    const t = setInterval(() => void atualizar(), INTERVALO_BORA_MS);
    return () => clearInterval(t);
  }, [srv, visivel, atualizar]);

  const agir = useCallback(async (f: () => Promise<unknown>) => {
    await f();
    await atualizar();
  }, [atualizar]);

  return {
    boras,
    criar: (opcoes: { sala?: string; recado?: string }) => agir(() => srv!.criarBora(opcoes)),
    responder: (id: string, resposta: RespostaBora) => agir(() => srv!.responderBora(id, resposta)),
    encerrar: (id: string) => agir(() => srv!.encerrarBora(id)),
  };
}
