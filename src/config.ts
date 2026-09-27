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
  /** Token do bot, no formato `<application_id>.<secret>` (sem o prefixo "Bot"). */
  token: () => env('FLUXER_TOKEN'),
  /** ID do servidor (guild) onde o bot funciona. */
  guildId: () => env('FLUXER_GUILD_ID'),
  /** Instância do Fluxer; os endpoints vêm de `/.well-known/fluxer`. */
  instanceUrl: env('FLUXER_INSTANCE', 'https://fluxer.app'),
  /** Prefixo dos comandos de texto (o Fluxer não tem slash commands). */
  prefix: env('COMMAND_PREFIX', '!'),

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
    /** "monthly": termina à meia-noite do dia 1º do mês seguinte. "days": dura SEASON_DAYS dias. */
    mode: env('SEASON_MODE', 'monthly') as 'monthly' | 'days',
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

  promotions: {
    enabled: envBool('PROMO_ENABLED', true),
    /** A cada 30 minutos. */
    cron: env('PROMO_CRON', '*/30 * * * *'),
    /** Descontos abaixo disso são ignorados. */
    minDiscount: envInt('PROMO_MIN_DISCOUNT', 40),
    /** A partir deste desconto, o cargo de promoções é mencionado. */
    mentionDiscount: envInt('PROMO_MENTION_DISCOUNT', 80),
    /** Evita inundar o canal: o excedente sai nas próximas rodadas. */
    maxPostsPerRun: envInt('PROMO_MAX_POSTS_PER_RUN', 10),
    staleDays: envInt('PROMO_STALE_DAYS', 3),
    /** Lojas ativas: steam, epic, gog, humble, itad (Nuuvem/GMG via IsThereAnyDeal). */
    sources: env('PROMO_SOURCES', 'steam,epic,gog,humble,itad')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    country: env('PROMO_COUNTRY', 'BR'),
    currency: env('PROMO_CURRENCY', 'BRL'),
    itad: {
      apiKey: process.env.ITAD_API_KEY ?? '',
      /** Nomes das lojas como a IsThereAnyDeal chama. */
      shops: env('ITAD_SHOPS', 'Nuuvem,GreenManGaming')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  },

  freeGames: {
    enabled: envBool('FREE_GAMES_ENABLED', true),
    /** A cada 1 hora. */
    cron: env('FREE_GAMES_CRON', '0 * * * *'),
    maxPostsPerRun: envInt('FREE_GAMES_MAX_POSTS_PER_RUN', 10),
    staleDays: envInt('FREE_GAMES_STALE_DAYS', 2),
    /** epic (freeGamesPromotions) e itad (giveaways da Steam/GOG). */
    sources: env('FREE_GAMES_SOURCES', 'epic,itad')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    country: env('PROMO_COUNTRY', 'BR'),
    itad: {
      apiKey: process.env.ITAD_API_KEY ?? '',
      /** Lojas dos giveaways da IsThereAnyDeal (vazio = todas). */
      shops: env('FREE_GAMES_ITAD_SHOPS', 'Steam,GOG')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  },

  /**
   * Nomes padrão dos canais, usados pelo !setup e para achar canais já existentes.
   * A comparação ignora emojis e separadores, então "📜┃eventos" também casa com "eventos".
   */
  channels: {
    commands: 'comandos',
    scoreboard: 'placar',
    matches: 'partidas',
    events: 'eventos',
    promo: 'promocoes',
    freeGames: 'jogos-gratis',
    music: 'musica',
    hall: 'hall-do-reino',
  },

  defaultGames: ['Valorant', 'CS2', 'League of Legends', 'Fortnite', 'Rocket League', 'EA FC', 'Livre'],
} as const;
