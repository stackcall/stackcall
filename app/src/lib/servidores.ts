import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
import { isTauri } from '@tauri-apps/api/core';
import { lerConvite, type LinkConvite } from './convite';
import { naWeb } from './ambiente';

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

// The web app belongs to the server that serves it.
export const servidorAtual = () => (naWeb() ? location.origin : localStorage.getItem(ATUAL) ?? lerServidores()[0]?.url ?? null);
export const escolherServidor = (url: string) => localStorage.setItem(ATUAL, url);

/** Calls `aoReceber` for `stackcall://entrar` links: the one that opened the app and later ones. */
export async function ouvirDeepLinks(aoReceber: (link: LinkConvite) => void) {
  if (naWeb()) {
    const link = linkDoEndereco();
    if (link) aoReceber(link);
    return () => undefined;
  }
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

/**
 * Web app links: `/app/#convite=CODE` (invite opened on the phone) and `/app/#entrar=CODE`
 * (QR code from the PC). The code leaves the address bar as soon as it is read.
 */
export function linkDoEndereco(): LinkConvite | null {
  const params = new URLSearchParams(location.hash.slice(1));
  const convite = params.get('convite');
  const entrar = params.get('entrar');
  const codigo = convite ?? entrar;
  if (!codigo || !/^[A-Za-z0-9_-]{6,128}$/.test(codigo)) return null;
  history.replaceState(null, '', location.pathname);
  return { servidor: location.origin, codigo, aparelho: !convite };
}
