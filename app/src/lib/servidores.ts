import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
import { isTauri } from '@tauri-apps/api/core';
import { lerConvite, type LinkConvite } from './convite';

/** Our group's server. Others come in by invite link (one server = one group). */
export const SERVIDOR_OFICIAL = 'https://stackcall.80-190-79-129.sslip.io';

export type ServidorSalvo = { url: string; nome: string };

// Only addresses and names: not secret. Sessions live in the Credential Manager.
const CHAVE = 'stackcall.servidores';
const ATUAL = 'stackcall.servidorAtual';

export function lerServidores(): ServidorSalvo[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? '[]');
    return Array.isArray(v) ? v.filter((s) => typeof s?.url === 'string' && typeof s?.nome === 'string') : [];
  } catch {
    return [];
  }
}

export function salvarServidor(s: ServidorSalvo) {
  const lista = [...lerServidores().filter((x) => x.url !== s.url), s];
  localStorage.setItem(CHAVE, JSON.stringify(lista));
  localStorage.setItem(ATUAL, s.url);
  return lista;
}

export function esquecerServidor(url: string) {
  const lista = lerServidores().filter((x) => x.url !== url);
  localStorage.setItem(CHAVE, JSON.stringify(lista));
  if (localStorage.getItem(ATUAL) === url) localStorage.removeItem(ATUAL);
  return lista;
}

export const servidorAtual = () => localStorage.getItem(ATUAL) ?? lerServidores()[0]?.url ?? null;
export const escolherServidor = (url: string) => localStorage.setItem(ATUAL, url);

/** Calls `aoReceber` for `stackcall://entrar` links: the one that opened the app and later ones. */
export async function ouvirDeepLinks(aoReceber: (link: LinkConvite) => void) {
  if (!isTauri()) return () => undefined;
  const tratar = (urls: string[] | null) => {
    for (const u of urls ?? []) {
      const link = lerConvite(u);
      if (link) aoReceber(link);
    }
  };
  tratar(await getCurrent().catch(() => null));
  return onOpenUrl(tratar).catch(() => () => undefined);
}
