export const DEFAULT_SERVER = 'https://stackcall.80-190-79-129.sslip.io';

/** Fixed rooms. `id` is the LiveKit room name; the porteiro accepts [A-Za-z0-9_-]{1,32}. */
export const ROOMS = [
  { id: 'geral', label: 'Geral' },
  { id: 'cs', label: 'CS' },
  { id: 'filme', label: 'Filme' },
  { id: 'madrugada', label: 'Madrugada' },
] as const;
export type RoomId = (typeof ROOMS)[number]['id'];

/** Same rule as `valid_label` in the porteiro. */
export const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
export const CHANGELOG_URL =
  'https://github.com/stackcall/releases/releases/latest/download/changelog.json';

export const isDemo = () => new URLSearchParams(location.search).has('demo');
/** Demo only: opens one screen directly (entrada, ar, config, novidades), for review and prints. */
export const demoScreen = () => (isDemo() ? new URLSearchParams(location.search).get('tela') : null);

const STORE = 'stackcall.';
export const store = {
  get: (key: string) => localStorage.getItem(STORE + key),
  set: (key: string, value: string) => localStorage.setItem(STORE + key, value),
};
