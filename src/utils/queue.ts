/**
 * Fila que executa uma tarefa por vez. No SQLite, várias escritas ao mesmo tempo
 * (ex.: muitas reações no anúncio do Night Fluxer) esperam o banco e podem estourar
 * o tempo limite; enfileirando, cada uma espera a anterior terminar.
 */
export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.then(task, task);
    tail = next.catch(() => undefined);
    return next;
  };
}

/** Reações (inscrições, votos, botões ✅/❌/⚠️), uma por vez. */
export const reactionQueue = serialQueue();
/**
 * Progresso das missões, um por vez. É uma fila separada porque uma reação
 * (ex.: ✅ confirmando partida) gera progresso: na mesma fila, ela esperaria a si mesma.
 */
export const missionQueue = serialQueue();
/** Entradas e saídas das salas temporárias, na ordem dos eventos de voz. */
export const roomQueue = serialQueue();
