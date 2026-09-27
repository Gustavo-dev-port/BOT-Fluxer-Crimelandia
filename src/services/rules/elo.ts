/** Probabilidade esperada de A vencer B. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * Variação de ELO para o vencedor (o perdedor recebe o valor negativo).
 * Sempre pelo menos 1 ponto, para que toda vitória conte.
 */
export function eloDelta(winnerRating: number, loserRating: number, k: number): number {
  const delta = Math.round(k * (1 - expectedScore(winnerRating, loserRating)));
  return Math.max(1, delta);
}

/**
 * Partidas em time usam a média de rating de cada lado; todos os membros
 * recebem a mesma variação.
 */
export function teamEloDelta(winnerRatings: number[], loserRatings: number[], k: number): number {
  return eloDelta(average(winnerRatings), average(loserRatings), k);
}

/** Reset de temporada: aproxima o rating do valor inicial. carry=0 → reset total. */
export function softReset(rating: number, initial: number, carry: number): number {
  const c = Math.min(1, Math.max(0, carry));
  return Math.round(initial + (rating - initial) * c);
}

function average(values: number[]): number {
  if (values.length === 0) throw new Error('Lista de ratings vazia');
  return values.reduce((a, b) => a + b, 0) / values.length;
}
