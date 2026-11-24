export type TokenResponse = { url: string; token: string; screen_token: string };

const base = (server: string) => server.trim().replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const TOKEN_ERRORS: Record<number, string> = {
  400: 'Nome inválido ou sala indisponível.',
  401: 'Convite não confere.',
  429: 'Muitas tentativas. Espere um minuto.',
};

export async function requestToken(server: string, convite: string, nome: string, sala: string) {
  let response: Response;
  try {
    response = await fetch(base(server) + '/api/token', {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ convite, nome, sala }),
    });
  } catch {
    throw new ApiError(0, 'Servidor fora do ar ou endereço errado.');
  }
  if (!response.ok) {
    throw new ApiError(response.status, TOKEN_ERRORS[response.status] ?? `Erro do servidor (${response.status}).`);
  }
  const body = (await response.json()) as Partial<TokenResponse>;
  if (typeof body.url !== 'string' || typeof body.token !== 'string' || typeof body.screen_token !== 'string') {
    throw new ApiError(502, 'Resposta inesperada do servidor.');
  }
  return body as TokenResponse;
}

/** Round trip to the porteiro in ms, or null when unreachable. */
export async function measureRtt(server: string) {
  try {
    const start = performance.now();
    await fetch(base(server) + '/api/rtt', { cache: 'no-store' });
    return Math.round(performance.now() - start);
  } catch {
    return null;
  }
}

/**
 * Upload speed in Mbit/s: sends growing blocks to `POST /api/upload-test` for about
 * `seconds`. Returns null when the endpoint is missing or unreachable.
 */
export async function measureUpload(server: string, seconds = 5) {
  const url = base(server) + '/api/upload-test';
  let size = 256 * 1024;
  let bytes = 0;
  const start = performance.now();
  try {
    while (performance.now() - start < seconds * 1000) {
      const sent = performance.now();
      const response = await fetch(url, { method: 'POST', body: new Uint8Array(size), cache: 'no-store' });
      if (!response.ok) return null;
      bytes += size;
      // Grow until one request takes ~1 s, capped below the server limit (16 MB).
      if (performance.now() - sent < 1000 && size < 8 * 1024 * 1024) size *= 2;
    }
  } catch {
    return null;
  }
  return (bytes * 8) / ((performance.now() - start) / 1000) / 1e6;
}
