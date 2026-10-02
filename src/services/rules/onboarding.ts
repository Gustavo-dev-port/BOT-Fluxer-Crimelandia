/**
 * Regras do onboarding (boas-vindas, cargo inicial e progressão), sem banco nem Fluxer.
 */
import { Permission } from '../../fluxer/permissions.js';
import type { Role, Snowflake } from '../../fluxer/types.js';
import type { MissionKind } from './missions.js';

export const DEFAULT_WELCOME_MESSAGE = [
  '🏰 **Um novo aventureiro chegou ao Reino!**',
  '',
  'Seja bem-vindo, {mention}!',
  'Você inicia sua jornada como {role}.',
  '',
  'Explore o reino, conheça a Taverna, participe das jogatinas e conquiste seu lugar entre os guerreiros.',
  '',
  '📜 Leia as regras',
  '⚔️ Participe das disputas',
  '🎮 Entre nas salas',
  '🪙 Conquiste FluxCoins',
  '',
  'Que comece sua jornada por {communityName}.',
].join('\n');

export const PROMOTION_MESSAGE =
  '⚔️ **Uma nova jornada começa!**\n{mention} deixou de ser {fromRole} e agora faz parte dos {role} do Reino.';

/** Nomes dos cargos "do sistema", usados quando nenhum foi configurado (ou o configurado foi excluído). */
export const SYSTEM_DEFAULT_ROLE_NAME = '🌱 Escudeiro';
export const SYSTEM_PROMOTION_ROLE_NAME = '🍺 Mercenário';

export const WELCOME_MESSAGE_MAX = 1500;
const MESSAGE_LIMIT = 2000;

export const PLACEHOLDERS = ['username', 'displayName', 'mention', 'communityName', 'memberCount', 'role'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export type TemplateValues = Partial<Record<Placeholder | 'fromRole', string>>;

/**
 * Troca {placeholder} pelos valores, numa passada só: um nome de usuário que contenha
 * "{role}" não é expandido de novo. Nada do texto é executado; placeholders desconhecidos ficam como estão.
 */
export function renderTemplate(template: string, values: TemplateValues): string {
  const text = template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key as keyof TemplateValues] ?? whole);
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text;
}

/** Placeholders que o texto usa e que não existem (para avisar o admin). */
export function unknownPlaceholders(template: string): string[] {
  const known = new Set<string>([...PLACEHOLDERS, 'fromRole']);
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !known.has(k)))];
}

/**
 * Permissões que um cargo automático (inicial ou de promoção) nunca pode ter:
 * administração, moderação e as "elevadas" da documentação do Fluxer.
 */
const B = (n: number) => 1n << BigInt(n);
export const PRIVILEGED_PERMISSIONS =
  B(1) | // KICK_MEMBERS
  B(2) | // BAN_MEMBERS
  Permission.ADMINISTRATOR |
  Permission.MANAGE_CHANNELS |
  Permission.MANAGE_GUILD |
  B(7) | // VIEW_AUDIT_LOG
  Permission.MANAGE_MESSAGES |
  Permission.MENTION_EVERYONE |
  B(22) | // MUTE_MEMBERS
  B(23) | // DEAFEN_MEMBERS
  Permission.MOVE_MEMBERS |
  Permission.MANAGE_NICKNAMES |
  Permission.MANAGE_ROLES |
  B(29) | // MANAGE_WEBHOOKS
  B(30) | // MANAGE_EXPRESSIONS
  B(40) | // MODERATE_MEMBERS
  Permission.PIN_MESSAGES;

export type RoleProblem = 'missing' | 'everyone' | 'privileged' | 'above_bot';

/**
 * Um cargo pode ser dado automaticamente? Não pode ser o @everyone, ter permissão
 * administrativa/de moderação nem estar acima do cargo mais alto do bot.
 */
export function roleProblem(role: Role | undefined, guildId: Snowflake, botTopPosition: number): RoleProblem | null {
  if (!role) return 'missing';
  if (role.id === guildId) return 'everyone';
  if (BigInt(role.permissions || '0') & PRIVILEGED_PERMISSIONS) return 'privileged';
  if (role.position >= botTopPosition) return 'above_bot';
  return null;
}

export const ROLE_PROBLEM_TEXT: Record<RoleProblem, string> = {
  missing: 'esse cargo não existe neste servidor',
  everyone: 'o @everyone não pode ser usado',
  privileged: 'esse cargo tem permissões de administração ou moderação',
  above_bot: 'esse cargo está acima do cargo do bot (mova o cargo do bot para cima)',
};

/** "🌱┃Escudeiro" → "escudeiro": compara nomes de cargo ignorando emojis, acentos e caixa. */
export function normalizeRoleName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Cargo a usar: o configurado, se ainda existir e for seguro; senão o cargo do sistema
 * com o mesmo nome (o de menor posição, se houver mais de um) que também seja seguro.
 */
export function pickAutomaticRole(
  roles: Role[],
  guildId: Snowflake,
  botTopPosition: number,
  configuredId: Snowflake | null,
  systemName: string,
): { role: Role; source: 'configured' | 'system' } | { role: null; configuredProblem: RoleProblem | null } {
  const safe = (r: Role | undefined) => roleProblem(r, guildId, botTopPosition) === null;
  const configured = configuredId ? roles.find((r) => r.id === configuredId) : undefined;
  if (configured && safe(configured)) return { role: configured, source: 'configured' };
  const wanted = normalizeRoleName(systemName);
  const system = roles.filter((r) => normalizeRoleName(r.name) === wanted && safe(r)).sort((a, b) => a.position - b.position)[0];
  if (system) return { role: system, source: 'system' };
  return { role: null, configuredProblem: configuredId ? roleProblem(configured, guildId, botTopPosition) : null };
}

/** Pontos de atividade por evento (os mesmos eventos das missões, já com intervalo mínimo). */
export const ACTIVITY_POINTS: Record<MissionKind, number> = {
  send_messages: 1,
  react_messages: 1,
  voice_minutes: 1,
  join_voice: 1,
  play_matches: 5,
  win_duels: 0, // a partida já conta em play_matches
  group_invite: 2,
  music_minutes: 0, // o tempo na sala já conta em voice_minutes
};

export interface PromotionRules {
  minimumDays: number;
  minimumActivityPoints: number;
}

const DAY = 86_400_000;

/** Elegível para Mercenário: tempo mínimo na comunidade e atividade mínima. */
export function isPromotionEligible(joinedAt: Date, activityPoints: number, rules: PromotionRules, now = new Date()): boolean {
  return now.getTime() - joinedAt.getTime() >= rules.minimumDays * DAY && activityPoints >= rules.minimumActivityPoints;
}

/** Data de corte: quem entrou até ela já cumpriu os dias mínimos. */
export function joinedCutoff(minimumDays: number, now = new Date()): Date {
  return new Date(now.getTime() - minimumDays * DAY);
}
