export const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
export const CHANGELOG_URL = 'https://github.com/stackcall/releases/releases/latest/download/changelog.json';
/** Same rule as the porteiro: 1 to 32 characters, no colon (":tela" marks the screen participant). */
export const NAME_PATTERN = /^[^:\p{Cc}]{1,32}$/u;
/** Fake server only: opens one screen directly (entrada, ar, config, novidades, perfil), for review and prints. */
export const demoScreen = () => new URLSearchParams(location.search).get('tela');
const STORE = 'stackcall.';
export const store = {
    get: (key) => localStorage.getItem(STORE + key),
    set: (key, value) => localStorage.setItem(STORE + key, value),
};
