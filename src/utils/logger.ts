/**
 * Logger central (Winston).
 * - Console colorido para acompanhar o bot rodando.
 * - logs/combined.log: tudo a partir de LOG_LEVEL, em JSON.
 * - logs/error.log: só erros, em JSON.
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
