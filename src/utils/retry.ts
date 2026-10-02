/**
 * Tenta de novo com espera exponencial (1 s, 2 s, 4 s… até `maxMs`, com variação aleatória
 * para vários processos não baterem juntos). Usado na inicialização do worker
 * (descoberta da instância do Fluxer e conexão com o banco).
 */
export interface RetryOptions {
  /** Tentativas no total (padrão 8). */
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Para testes. */
  sleep?: (ms: number) => Promise<unknown>;
}

export function backoffDelay(attempt: number, baseMs = 1000, maxMs = 30_000, random = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(exp * (0.8 + random() * 0.4));
}

export async function retry<T>(task: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 8;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await task(attempt);
    } catch (err) {
      if (attempt + 1 >= attempts) throw err;
      const delay = backoffDelay(attempt, opts.baseMs, opts.maxMs);
      opts.onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}
