/** GET/POST JSON com tempo limite, usado pelos adaptadores de loja. */

/** Esconde credenciais em URLs antes de irem para mensagens de erro e logs. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:key|api_key|apikey|token)=)[^&]*/gi, '$1***');
}

export class HttpError extends Error {
  readonly url: string;
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} em ${redactUrl(url)}`);
    this.url = redactUrl(url);
  }
}

const USER_AGENT = 'Mozilla/5.0 (compatible; FluxerBot-Crimelandia/1.0; +https://github.com/Gustavo-dev-port/BOT-Fluxer-Crimelandia)';

export async function fetchJson(
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<unknown> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.json();
}

// ─── Leitura defensiva de JSON desconhecido ─────────────────────────────────
// As APIs das lojas não são contratos estáveis: lemos campo a campo e
// descartamos o item quando algo essencial falta, em vez de quebrar.

export type Json = Record<string, unknown>;

export function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** "29.90" / 29.9 → 2990 (centavos). */
export function toCents(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n * 100);
}

/** Desconto inteiro a partir dos preços, quando a loja não informa. */
export function discountFrom(oldPrice: number, currentPrice: number): number {
  if (oldPrice <= 0) return 0;
  return Math.round((1 - currentPrice / oldPrice) * 100);
}

/** Aceita ISO, segundos Unix ou milissegundos Unix. */
export function toDate(v: unknown): Date | null {
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const n = num(v);
  if (n === null || n <= 0) return null;
  return new Date(n < 1e12 ? n * 1000 : n);
}
