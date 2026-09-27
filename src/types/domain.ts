export const MatchStatus = {
  /** Desafio criado, aguardando aceite do adversário. */
  PENDING: 'PENDING',
  /** Partida aceita (ou gerada por campeonato), aguardando resultado. */
  ACCEPTED: 'ACCEPTED',
  /** Um lado informou o resultado; o outro lado precisa confirmar. */
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  /** O resultado foi contestado; um admin precisa resolver. */
  DISPUTED: 'DISPUTED',
  CONFIRMED: 'CONFIRMED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  /** Partida de chave aguardando os vencedores das rodadas anteriores. */
  WAITING: 'WAITING',
} as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];

/** Estados em que a partida ainda está "viva". */
export const OPEN_STATUSES: MatchStatus[] = [
  MatchStatus.PENDING,
  MatchStatus.ACCEPTED,
  MatchStatus.AWAITING_CONFIRMATION,
  MatchStatus.DISPUTED,
];

export const TournamentFormat = {
  SINGLE_ELIM: 'SINGLE_ELIM',
  ROUND_ROBIN: 'ROUND_ROBIN',
} as const;
export type TournamentFormat = (typeof TournamentFormat)[keyof typeof TournamentFormat];

export const TournamentStatus = {
  REGISTRATION: 'REGISTRATION',
  RUNNING: 'RUNNING',
  FINISHED: 'FINISHED',
  CANCELLED: 'CANCELLED',
} as const;
export type TournamentStatus = (typeof TournamentStatus)[keyof typeof TournamentStatus];

export type Side = 1 | 2;

/** Erro de regra de negócio: a mensagem é mostrada ao usuário. */
export class UserError extends Error {}
