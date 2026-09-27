/**
 * Logger central (Winston).
 * - Console colorido para acompanhar o bot rodando.
 * - logs/combined.log: tudo a partir de LOG_LEVEL, em JSON.
 * - logs/error.log: só erros, em JSON.
 * - logs/missions.log, logs/voice.log, logs/night.log: só os escopos de cada módulo (SCOPE_FILES).
 * Nos testes (VITEST) nada é escrito.
 */
import winston from 'winston';

const { combine, timestamp, errors, json, colorize, printf, splat } = winston.format;

const isTest = Boolean(process.env.VITEST);
const level = process.env.LOG_LEVEL ?? 'info';
const logDir = process.env.LOG_DIR ?? 'logs';

const consoleFormat = printf(({ level: lvl, message, timestamp: ts, scope, stack, ...meta }) => {
  const prefix = scope ? `[${String(scope)}] ` : '';
  const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${String(ts)} ${lvl} ${prefix}${String(message)}${extra}${stack ? `\n${String(stack)}` : ''}`;
});

/** Escopo do logger → arquivo próprio, além do combined.log. */
export const SCOPE_FILES: Record<string, string> = {
  missões: 'missions.log',
  voz: 'voice.log',
  'night fluxer': 'night.log',
};

/** Deixa passar só as linhas de um escopo. */
const onlyScope = (scope: string) => winston.format((info) => (info.scope === scope ? info : false))();

export const logger = winston.createLogger({
  level,
  silent: isTest,
  format: combine(errors({ stack: true }), splat(), timestamp(), json()),
  transports: isTest
    ? []
    : [
        new winston.transports.Console({
          format: combine(errors({ stack: true }), timestamp({ format: 'HH:mm:ss' }), colorize(), consoleFormat),
        }),
        new winston.transports.File({ filename: `${logDir}/error.log`, level: 'error' }),
        new winston.transports.File({ filename: `${logDir}/combined.log` }),
        ...Object.entries(SCOPE_FILES).map(
          ([scope, file]) => new winston.transports.File({ filename: `${logDir}/${file}`, format: combine(onlyScope(scope), json()) }),
        ),
      ],
});

/** Logger com um escopo fixo (ex.: "gateway", "agendador"). */
export function scoped(scope: string) {
  return logger.child({ scope });
}

/** Converte qualquer valor lançado em algo que o Winston registra bem. */
export function errorMeta(err: unknown): { error: string; stack?: string } {
  if (err instanceof Error) return { error: err.message, stack: err.stack };
  return { error: String(err) };
}
