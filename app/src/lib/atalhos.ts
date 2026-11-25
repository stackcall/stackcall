import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { tocarSom, type Som } from './sons';
import { lerVoz } from './voz';

/**
 * Global shortcuts (they work with the game in front). The Rust side listens to the keys:
 * `atalhos_definir` replaces the whole list, the `atalho` event says pressed/released and
 * `atalhos_gravar` returns the next combination (null on Esc). Nothing comes on by default,
 * so a game key is never taken without the person choosing it.
 */
export type AcaoId = 'mic' | 'silenciar' | 'falar' | 'arEntrar' | 'arSair' | 'assistir' | 'pararAssistir' | 'mostrar'
  | 'clipe' | 'redeRuim' | 'quemFala' | 'cutucarUltimo';
export type Estado = 'pressionado' | 'solto';
export type Acao = { id: AcaoId; rotulo: string; ajuda: string; sugestao: string; segurar?: boolean };

export const ACOES: Acao[] = [
  { id: 'mic', rotulo: 'Ligar e desligar o microfone', ajuda: 'Um toque liga, outro desliga.', sugestao: 'Ctrl+Shift+M' },
  { id: 'silenciar', rotulo: 'Silenciar tudo', ajuda: 'Desliga o microfone e o som da sala. Outro toque devolve os dois.', sugestao: 'Ctrl+Shift+D' },
  { id: 'falar', rotulo: 'Apertar para falar', ajuda: 'Segure para falar. Vale no modo "Apertar para falar" (Voz e tema).', sugestao: 'Mouse4', segurar: true },
  { id: 'arEntrar', rotulo: 'Entrar no ar', ajuda: 'Abre Entrar no ar com a última escolha. Se ela já está guardada, o segundo toque confirma.', sugestao: 'Ctrl+Shift+L' },
  { id: 'arSair', rotulo: 'Sair do ar', ajuda: 'Para a sua transmissão.', sugestao: 'Ctrl+Shift+K' },
  { id: 'assistir', rotulo: 'Assistir a tela no ar', ajuda: 'Começa a receber a tela que está no palco.', sugestao: 'Ctrl+Shift+W' },
  { id: 'pararAssistir', rotulo: 'Parar de assistir', ajuda: 'Para de receber a tela (economiza internet no jogo).', sugestao: 'Ctrl+Shift+E' },
  { id: 'mostrar', rotulo: 'Abrir o Stackcall', ajuda: 'Traz a janela para a frente.', sugestao: 'Ctrl+Shift+S' },
  { id: 'clipe', rotulo: 'Salvar clipe', ajuda: 'Guarda os últimos segundos do replay. O app da NVIDIA também usa Alt+F10.', sugestao: 'Alt+F10' },
  { id: 'redeRuim', rotulo: 'Modo internet ruim', ajuda: 'Para de receber vídeo e dá prioridade à voz. Outro toque volta.', sugestao: 'Ctrl+Shift+B' },
  { id: 'quemFala', rotulo: 'Mostrar ou esconder a janela quem fala', ajuda: 'Sem sugestão boa que não colida com jogo.', sugestao: '—' },
  { id: 'cutucarUltimo', rotulo: 'Cutucar o último de novo', ajuda: 'Cutuca a última pessoa que você cutucou, sem recado.', sugestao: 'Ctrl+Shift+P' },
];

export type ConfigAtalhos = { teclas: Partial<Record<AcaoId, string>>; som: boolean };
const CHAVE = 'stackcall.atalhos';
const IDS = new Set<string>(ACOES.map((a) => a.id));

export function lerAtalhos(): ConfigAtalhos {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? '{}');
    const teclas: ConfigAtalhos['teclas'] = {};
    for (const [id, t] of Object.entries(v.teclas ?? {})) if (IDS.has(id) && typeof t === 'string' && t) teclas[id as AcaoId] = t;
    return { teclas, som: v.som !== false };
  } catch {
    return { teclas: {}, som: true };
  }
}

/** The list the Rust side listens to; the wire format of `atalhos_definir`. */
export const listaParaRust = (c: ConfigAtalhos) =>
  ACOES.flatMap((a) => (c.teclas[a.id] ? [{ id: a.id, teclas: c.teclas[a.id]! }] : []));

async function enviar(c: ConfigAtalhos) {
  // The Rust listener may come in a later build: a missing command must not break the screen.
  if (isTauri()) await invoke('atalhos_definir', { atalhos: listaParaRust(c) }).catch(() => undefined);
}

const ouvintesConfig = new Set<(c: ConfigAtalhos) => void>();
export function aoMudarAtalhos(f: (c: ConfigAtalhos) => void) {
  ouvintesConfig.add(f);
  return () => void ouvintesConfig.delete(f);
}

export function salvarAtalhos(mudanca: Partial<ConfigAtalhos>) {
  const c = { ...lerAtalhos(), ...mudanca };
  try {
    localStorage.setItem(CHAVE, JSON.stringify(c));
  } catch {
    // Storage blocked: the shortcuts still work until the app closes.
  }
  ouvintesConfig.forEach((f) => f(c));
  void enviar(c);
  return c;
}

const normal = (t: string) => t.toLowerCase().replace(/\s+/g, '');

/** For each action, the other actions that use the same combination. */
export function conflitos(teclas: ConfigAtalhos['teclas']) {
  const por = new Map<string, AcaoId[]>();
  for (const a of ACOES) {
    const t = teclas[a.id];
    if (t) por.set(normal(t), [...(por.get(normal(t)) ?? []), a.id]);
  }
  const res: Partial<Record<AcaoId, AcaoId[]>> = {};
  for (const ids of por.values()) if (ids.length > 1) for (const id of ids) res[id] = ids.filter((x) => x !== id);
  return res;
}

/** A plain key (M, Space) would stop working in chat and in the game: worth a warning. */
export const semModificador = (t: string) => !/^(ctrl|alt|shift|win|meta)\+/i.test(t) && !/^(f1[3-9]|f2[0-4]|mouse\d)$/i.test(t);

/** Combination text from a browser event, in the Rust format (Ctrl+Shift+M, F13, Mouse4). */
export function comboDeEvento(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return null;
  const tecla = e.code.startsWith('Key') ? e.code.slice(3)
    : e.code.startsWith('Digit') ? e.code.slice(5)
      : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win', tecla].filter(Boolean).join('+');
}

/** Outside the app (browser, demo) the next key or side mouse button is read from the page. */
function gravarNaPagina(): Promise<string | null> {
  return new Promise((resolve) => {
    const fim = (v: string | null) => {
      window.removeEventListener('keydown', tecla, true);
      window.removeEventListener('mousedown', mouse, true);
      resolve(v);
    };
    const tecla = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return fim(null);
      const c = comboDeEvento(e);
      if (c) fim(c);
    };
    const mouse = (e: MouseEvent) => {
      if (e.button >= 3) {
        e.preventDefault();
        fim(`Mouse${e.button + 1}`);
      }
    };
    window.addEventListener('keydown', tecla, true);
    window.addEventListener('mousedown', mouse, true);
  });
}

export const gravarAtalho = (): Promise<string | null> =>
  isTauri() ? invoke<string | null>('atalhos_gravar') : gravarNaPagina();

const ouvintes = new Set<(id: AcaoId, estado: Estado) => void>();
/** The room listens here; the "show the app" action is handled below, room or not. */
export function aoAtalho(f: (id: AcaoId, estado: Estado) => void) {
  ouvintes.add(f);
  return () => void ouvintes.delete(f);
}
export function dispararAtalho(id: AcaoId, estado: Estado) {
  if (id === 'mostrar') {
    if (estado === 'pressionado') void mostrarApp();
    return;
  }
  ouvintes.forEach((f) => f(id, estado));
}

async function mostrarApp() {
  if (!isTauri()) return;
  const w = getCurrentWindow();
  await w.unminimize().catch(() => undefined);
  await w.show().catch(() => undefined);
  await w.setFocus().catch(() => undefined);
}

let iniciado = false;
/** At start: sends the saved list to Rust and routes its events. */
export function iniciarAtalhos() {
  if (iniciado) return;
  iniciado = true;
  void enviar(lerAtalhos());
  if (isTauri()) {
    void listen<{ id: string; estado: string }>('atalho', ({ payload }) => {
      if (IDS.has(payload.id) && (payload.estado === 'pressionado' || payload.estado === 'solto')) dispararAtalho(payload.id as AcaoId, payload.estado);
    }).catch(() => undefined);
  }
}

/** Confirmation beep for an action that came from a global shortcut (the person is in the game). */
export const bipe = (som: Som) => {
  if (lerAtalhos().som) tocarSom(som);
};

/** What the room exposes to the voice shortcuts. */
export type AlvoVoz = { micAberto(): boolean; abrirMic(on: boolean): void; silenciado(): boolean; alternarSilencio(): void };

/**
 * Microphone, silence and push to talk, the same for the global and the local shortcuts (only the
 * global ones beep). Returns false for actions it does not handle.
 */
export function criarControleVoz(
  alvo: AlvoVoz,
  opcoes: () => { modo: 'voz' | 'ptt'; soltura: number } = () => lerVoz(),
  som: (s: Som) => void = bipe,
) {
  let soltar: ReturnType<typeof setTimeout> | undefined;
  return {
    executar(id: AcaoId, estado: Estado, global = true): boolean {
      const avisa = (s: Som) => global && som(s);
      if (id === 'falar') {
        const { modo, soltura } = opcoes();
        if (modo !== 'ptt') return true;
        clearTimeout(soltar);
        if (estado === 'pressionado') {
          if (!alvo.silenciado()) alvo.abrirMic(true);
        } else {
          // Release delay: the end of the word is not cut when the key comes up a little early.
          soltar = setTimeout(() => alvo.abrirMic(false), soltura);
        }
        return true;
      }
      if (estado !== 'pressionado') return id === 'mic' || id === 'silenciar';
      if (id === 'mic') {
        const on = !alvo.micAberto();
        alvo.abrirMic(on);
        avisa(on ? 'liga' : 'desliga');
        return true;
      }
      if (id === 'silenciar') {
        const vaiSilenciar = !alvo.silenciado();
        alvo.alternarSilencio();
        avisa(vaiSilenciar ? 'silenciou' : 'liga');
        return true;
      }
      return false;
    },
    parar: () => clearTimeout(soltar),
  };
}
