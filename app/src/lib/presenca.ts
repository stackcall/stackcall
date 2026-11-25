const DEBOUNCE_MS = 1000;
const WINDOW_MS = 60_000;
// Two calls per refresh. Leave 10 of the 30 requests/min for tokens and other actions.
const REFRESHES_PER_MINUTE = 10;

export function agendarPresenca(atualizar: () => Promise<boolean>, visivel: boolean) {
  const interval = () => visivel ? 20_000 : 60_000;
  let evento = Infinity;
  let consulta = performance.now() + interval();
  let limite = 0;
  let iniciadas: number[] = [];
  let ocupada = false;
  let parada = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function programar() {
    clearTimeout(timer);
    if (parada || ocupada) return;
    const now = performance.now();
    iniciadas = iniciadas.filter((inicio) => inicio > now - WINDOW_MS);
    const disponivel = iniciadas.length < REFRESHES_PER_MINUTE ? 0 : iniciadas[0] + WINDOW_MS;
    const quando = Math.max(limite, disponivel, Math.min(evento, consulta));
    timer = setTimeout(() => void executar(), Math.max(0, Math.ceil(quando - now)));
  }

  async function executar() {
    const now = performance.now();
    ocupada = true;
    iniciadas.push(now);
    if (evento <= now) evento = Infinity;
    consulta = now + interval();
    // A 429 can also come from other clients sharing the same IP.
    const limitada = await atualizar().catch(() => false);
    if (limitada) limite = performance.now() + WINDOW_MS;
    ocupada = false;
    programar();
  }

  function avisar() {
    evento = performance.now() + DEBOUNCE_MS;
    programar();
  }

  programar();
  return {
    avisar,
    visibilidade(valor: boolean) {
      if (visivel === valor) return;
      visivel = valor;
      consulta = performance.now() + interval();
      if (visivel) avisar();
      else programar();
    },
    parar() {
      parada = true;
      clearTimeout(timer);
    },
  };
}
