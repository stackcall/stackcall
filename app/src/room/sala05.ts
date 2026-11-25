/**
 * Pure rules of the 0.5 room (kept out of React and LiveKit so they can be unit tested).
 */

/** Attribute with the identities whose microphone this client receives (docs/api-v05.md, "Quem me ouve"). */
export const ATRIBUTO_OUVE = 'stackcall.ouve.v1';
/**
 * Each client publishes its own round trip and loss so the others can show "rede ruim · 210 ms · 3% perda".
 * Assumed name (not in docs/api-v05.md yet): JSON { ms: number, perda: number (0..1) }.
 */
export const ATRIBUTO_REDE = 'stackcall.rede.v1';

export type QualidadeRede = 'boa' | 'media' | 'ruim' | 'desconhecida';
export type Rede = { qualidade: QualidadeRede; ms?: number; perda?: number };

function json(attrs: Record<string, string> | undefined, chave: string): unknown {
  try {
    return attrs?.[chave] ? JSON.parse(attrs[chave]) : undefined;
  } catch {
    return undefined;
  }
}

/** LiveKit connectionQuality ('excellent' | 'good' | 'poor' | 'lost' | 'unknown') plus the published numbers. */
export function redeDe(connectionQuality: string, attrs?: Record<string, string>): Rede {
  const v = json(attrs, ATRIBUTO_REDE) as { ms?: unknown; perda?: unknown } | undefined;
  const ms = typeof v?.ms === 'number' && v.ms >= 0 ? Math.round(v.ms) : undefined;
  const perda = typeof v?.perda === 'number' && v.perda >= 0 && v.perda <= 1 ? v.perda : undefined;
  let qualidade: QualidadeRede = connectionQuality === 'excellent' ? 'boa' : connectionQuality === 'good' ? 'media'
    : connectionQuality === 'poor' || connectionQuality === 'lost' ? 'ruim' : 'desconhecida';
  // The published numbers can say "bad" before LiveKit does.
  if ((ms !== undefined && ms > 180) || (perda !== undefined && perda >= 0.03)) qualidade = 'ruim';
  return { qualidade, ms, perda };
}

/** Text for the channel body when the network is bad; null when it is fine. */
export function textoRede(r: Rede): string | null {
  if (r.qualidade !== 'ruim') return null;
  return ['rede ruim', r.ms !== undefined && `${r.ms} ms`, r.perda !== undefined && `${Math.round(r.perda * 100)}% perda`].filter(Boolean).join(' · ');
}

/** Bars lit (0..3) for the three network bars. */
export const barrasDe = (q: QualidadeRede) => (q === 'boa' ? 3 : q === 'media' ? 2 : q === 'ruim' ? 1 : 0);

export type Remoto = { id: string; nome: string; attributes?: Record<string, string>; conectado: boolean; redeRuim?: boolean };
export type Receptor = { id: string; nome: string; voz: boolean; motivo?: string; tela: boolean };

/**
 * "Quem recebe você": each remote voice participant, whether my voice reaches them (from their
 * `stackcall.ouve.v1`) and whether they watch my screen. Someone who set my volume to zero still
 * lists me (see `ouveLista`), so "silenced for me" never shows here; only technical reasons do.
 */
export function quemRecebe(remotos: Remoto[], euId: string, meVeem: Set<string>): Receptor[] {
  return remotos.map((r) => {
    const lista = json(r.attributes, ATRIBUTO_OUVE);
    const declarou = Array.isArray(lista);
    const voz = declarou && (lista as unknown[]).includes(euId);
    const motivo = voz ? undefined : !r.conectado ? 'conectando' : r.redeRuim ? 'modo internet ruim' : declarou ? undefined : 'app antigo';
    return { id: r.id, nome: r.nome, voz, motivo, tela: meVeem.has(r.id) };
  });
}

/**
 * What this client publishes in `stackcall.ouve.v1`: every voice participant whose microphone it
 * receives. Deafened = nobody. The per-person volume is left out on purpose: "silenciar para mim"
 * must not be discoverable by the silenced person (docs/design/v05-interface.md, decision 2).
 */
export const ouveLista = (vozes: { id: string; assinado: boolean }[], ensurdecido: boolean) =>
  ensurdecido ? [] : vozes.filter((v) => v.assinado).map((v) => v.id).sort();

/** Names for "Replay ligado: Rafa e Duda". */
export function nomesReplay(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

export type OpcaoMenu = 'volume' | 'perfil' | 'assistir' | 'cutucar' | 'silenciarParaMim' | 'mover' | 'silenciarSala' | 'tirar';
/**
 * Items of the person's menu, in the design order. Moderation only for the owner and admins, and
 * never on the owner (the porteiro refuses it too); watching only when that person is on the air.
 */
export function opcoesMenuPessoa(o: { meuPapel: 'dono' | 'admin' | 'membro'; papelDela?: 'dono' | 'admin' | 'membro'; noAr: boolean }): OpcaoMenu[] {
  const base: OpcaoMenu[] = ['volume', 'perfil', ...(o.noAr ? ['assistir' as const] : []), 'cutucar', 'silenciarParaMim'];
  const modera = (o.meuPapel === 'dono' || o.meuPapel === 'admin') && o.papelDela !== 'dono' && !(o.meuPapel === 'admin' && o.papelDela === 'admin');
  return modera ? [...base, 'mover', 'silenciarSala', 'tirar'] : base;
}
