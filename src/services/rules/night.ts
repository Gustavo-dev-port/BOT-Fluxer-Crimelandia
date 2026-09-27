/**
 * Night Fluxer: regras puras da votação e do sorteio de equipes.
 */

/** Emojis das opções da votação, na ordem. */
export const VOTE_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

/** Nomes das equipes sorteadas. */
export const TEAM_NAMES = ['Lobos', 'Dragões', 'Corvos', 'Leões', 'Grifos', 'Serpentes', 'Águias', 'Ursos', 'Falcões', 'Javalis'];

/** Índice da opção de um emoji de voto (com ou sem U+FE0F), ou null. */
export function voteOption(emoji: string, optionCount: number): number | null {
  const bare = (e: string) => e.replace(/️/g, '');
  const index = VOTE_EMOJIS.findIndex((e) => bare(e) === bare(emoji));
  return index >= 0 && index < optionCount ? index : null;
}

/**
 * Jogos da votação: os mais jogados recentemente primeiro, completando com a
 * ordem da lista de jogos. "Livre" fica de fora (não é um jogo).
 */
export function pollOptions(games: string[], playCount: Map<string, number>, max = 4): string[] {
  const candidates = games.filter((g) => g.toLowerCase() !== 'livre');
  return [...candidates]
    .sort((a, b) => (playCount.get(b) ?? 0) - (playCount.get(a) ?? 0) || candidates.indexOf(a) - candidates.indexOf(b))
    .slice(0, Math.min(max, VOTE_EMOJIS.length));
}

/** Votos por opção. */
export function tally(optionCount: number, votes: number[]): number[] {
  const counts = new Array<number>(optionCount).fill(0);
  for (const v of votes) if (v >= 0 && v < optionCount) counts[v]++;
  return counts;
}

/** Opção vencedora; empate (ou nenhum voto) fica com a primeira da lista. */
export function winningOption(optionCount: number, votes: number[]): number {
  const counts = tally(optionCount, votes);
  return counts.reduce((best, n, i) => (n > counts[best] ? i : best), 0);
}

/** Embaralha (Fisher–Yates) com o gerador informado. */
export function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Sorteia equipes de `teamSize`. Com poucos inscritos (menos de 2 equipes),
 * devolve null: o evento roda em 1v1. Quem sobra entra nas primeiras equipes,
 * então as equipes diferem em no máximo 1 jogador.
 */
export function drawTeams(playerIds: string[], teamSize: number, rand: () => number = Math.random): string[][] | null {
  if (teamSize <= 1) return null;
  const teamCount = Math.floor(playerIds.length / teamSize);
  if (teamCount < 2) return null;
  const teams: string[][] = Array.from({ length: teamCount }, () => []);
  shuffle(playerIds, rand).forEach((id, i) => teams[i % teamCount].push(id));
  return teams;
}
