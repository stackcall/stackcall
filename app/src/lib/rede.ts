/**
 * Network test of Settings > Voz e rede: round trips to `GET /api/rtt` (204, outside the
 * request limit of the porteiro). A request without an answer in 2 s counts as lost.
 */
export type ResultadoRede = { ping: number; perda: number; amostras: number };

/** Median of the answered round trips and the lost share in %, one decimal. */
export function resumoRede(amostras: (number | null)[]): ResultadoRede | null {
  const ok = amostras.filter((a): a is number => a !== null).sort((a, b) => a - b);
  if (!ok.length) return null;
  const meio = Math.floor(ok.length / 2);
  const ping = ok.length % 2 ? ok[meio] : (ok[meio - 1] + ok[meio]) / 2;
  return { ping: Math.round(ping), perda: Math.round(((amostras.length - ok.length) / amostras.length) * 1000) / 10, amostras: amostras.length };
}

/** Same words as the room's ping widget. */
export const qualidadeRede = (r: ResultadoRede) => (r.perda >= 5 || r.ping > 250 ? 'ruim' : r.perda >= 1 || r.ping > 150 ? 'ok' : 'boa');

export async function medirRede(url: string, total = 20, intervalo = 150, aoAvancar?: (feitas: number) => void) {
  const alvo = url.replace(/\/+$/, '') + '/api/rtt';
  const amostras: (number | null)[] = [];
  for (let i = 0; i < total; i++) {
    const inicio = performance.now();
    try {
      const r = await fetch(alvo, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
      amostras.push(r.ok ? performance.now() - inicio : null);
    } catch {
      amostras.push(null);
    }
    aoAvancar?.(i + 1);
    if (i < total - 1) await new Promise((r) => setTimeout(r, intervalo));
  }
  return resumoRede(amostras);
}
