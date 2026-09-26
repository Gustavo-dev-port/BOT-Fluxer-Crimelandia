/**
 * Geração de chaves de campeonato (funções puras, sem banco).
 * As entradas são identificadas por número (ID da inscrição); `null` = bye.
 */

export interface BracketSlot {
  round: number; // começa em 1
  slot: number; // posição dentro da rodada, começa em 0
  entry1: number | null;
  entry2: number | null;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Ordem padrão de seeds numa chave de tamanho `size` (potência de 2),
 * ex.: 8 → [1, 8, 4, 5, 2, 7, 3, 6]. Garante que os melhores seeds só se
 * encontrem nas fases finais e que os byes caiam com os melhores seeds.
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const total = order.length * 2 + 1;
    order = order.flatMap((s) => [s, total - s]);
  }
  return order;
}

/** Número de rodadas numa eliminação simples com `entries` participantes. */
export function roundCount(entries: number): number {
  return Math.log2(nextPowerOfTwo(Math.max(2, entries)));
}

/**
 * Primeira rodada da eliminação simples. `entries` já deve estar ordenado por
 * seed (índice 0 = seed 1). Nenhuma partida terá bye contra bye.
 */
export function singleEliminationFirstRound(entries: number[]): BracketSlot[] {
  if (entries.length < 2) throw new Error('São necessários ao menos 2 participantes');
  const size = nextPowerOfTwo(entries.length);
  const order = seedOrder(size);
  const slots: BracketSlot[] = [];
  for (let i = 0; i < size; i += 2) {
    const a = order[i] <= entries.length ? entries[order[i] - 1] : null;
    const b = order[i + 1] <= entries.length ? entries[order[i + 1] - 1] : null;
    slots.push({ round: 1, slot: i / 2, entry1: a, entry2: b });
  }
  return slots;
}

/** Todas as partidas da eliminação simples (rodadas futuras com entradas vazias). */
export function singleEliminationBracket(entries: number[]): BracketSlot[] {
  const first = singleEliminationFirstRound(entries);
  const rounds = roundCount(entries.length);
  const all = [...first];
  let matchesInRound = first.length;
  for (let round = 2; round <= rounds; round++) {
    matchesInRound /= 2;
    for (let slot = 0; slot < matchesInRound; slot++) all.push({ round, slot, entry1: null, entry2: null });
  }
  return all;
}

/** Para onde vai o vencedor de (round, slot). */
export function advanceTarget(round: number, slot: number): { round: number; slot: number; position: 1 | 2 } {
  return { round: round + 1, slot: Math.floor(slot / 2), position: slot % 2 === 0 ? 1 : 2 };
}

/**
 * Todos contra todos pelo método do círculo. Retorna rodadas equilibradas,
 * sem partidas contra bye.
 */
export function roundRobin(entries: number[]): BracketSlot[] {
  if (entries.length < 2) throw new Error('São necessários ao menos 2 participantes');
  const list: (number | null)[] = [...entries];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const result: BracketSlot[] = [];
  for (let round = 0; round < n - 1; round++) {
    let slot = 0;
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a !== null && b !== null) result.push({ round: round + 1, slot: slot++, entry1: a, entry2: b });
    }
    // Gira todos menos o primeiro.
    list.splice(1, 0, list.pop()!);
  }
  return result;
}

export interface Standing {
  entry: number;
  wins: number;
  losses: number;
}

/** Classificação do todos contra todos: vitórias, depois menos derrotas, depois confronto direto. */
export function roundRobinStandings(
  entries: number[],
  results: { winner: number; loser: number }[],
): Standing[] {
  const table = new Map<number, Standing>(entries.map((e) => [e, { entry: e, wins: 0, losses: 0 }]));
  for (const r of results) {
    const w = table.get(r.winner);
    const l = table.get(r.loser);
    if (w) w.wins++;
    if (l) l.losses++;
  }
  const headToHead = (a: number, b: number) =>
    results.filter((r) => r.winner === a && r.loser === b).length -
    results.filter((r) => r.winner === b && r.loser === a).length;
  return [...table.values()].sort(
    (a, b) => b.wins - a.wins || a.losses - b.losses || headToHead(b.entry, a.entry) || entries.indexOf(a.entry) - entries.indexOf(b.entry),
  );
}
