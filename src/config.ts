import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Variável ${name} deve ser numérica`);
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'sim', 'yes'].includes(raw.toLowerCase());
}

export const config = {
  token: () => env('DISCORD_TOKEN'),
  clientId: () => env('DISCORD_CLIENT_ID'),
  guildId: () => env('DISCORD_GUILD_ID'),

  timezone: env('TIMEZONE', 'America/Sao_Paulo'),

  /** 'pontos' ordena o ranking por pontos da temporada; 'elo' ordena por rating. */
  rankingMode: env('RANKING_MODE', 'pontos') as 'pontos' | 'elo',
  /** Restringe comandos ao canal #comandos (exceto admins). */
  restrictToCommandsChannel: envBool('RESTRICT_COMMANDS_CHANNEL', false),

  elo: {
    initial: 1000,
    kFactor: envInt('ELO_K_FACTOR', 32),
  },

  points: {
    win: envInt('POINTS_WIN', 3),
    loss: envInt('POINTS_LOSS', 1),
  },

  season: {
    durationDays: envInt('SEASON_DAYS', 30),
    /** 0 = reset total para 1000; 0.5 = mantém metade da distância até 1000. */
    carryOver: Number(process.env.SEASON_CARRY_OVER ?? '0'),
    championRoleId: process.env.CHAMPION_ROLE_ID || undefined,
  },

  coins: {
    win: 25,
    participation: 10,
    champion: 150,
    specialEvent: 50,
  },

  duel: {
    /** Horas até um desafio pendente expirar. */
    pendingExpiryHours: envInt('DUEL_EXPIRY_HOURS', 24),
  },

  weeklyEvent: {
    enabled: envBool('WEEKLY_EVENT_ENABLED', true),
    /** Sexta, 20h */
    openCron: env('WEEKLY_EVENT_CRON', '0 20 * * 5'),
    /** Minutos de inscrição antes de gerar a chave. */
    registrationMinutes: envInt('WEEKLY_EVENT_REGISTRATION_MINUTES', 30),
    name: env('WEEKLY_EVENT_NAME', 'Night Fluxer'),
    game: env('WEEKLY_EVENT_GAME', 'Livre'),
  },

  channels: {
    commands: 'comandos',
    scoreboard: 'placar',
    matches: 'partidas',
    events: 'eventos',
  },

  defaultGames: ['Valorant', 'CS2', 'League of Legends', 'Fortnite', 'Rocket League', 'EA FC', 'Livre'],
} as const;
