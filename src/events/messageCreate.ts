/** MESSAGE_CREATE: comandos de texto (`!duelo`, `!rank`…). */
import { findCommand } from '../commands/index.js';
import { CommandContext, usageOf } from '../commands/types.js';
import { config } from '../config.js';
import type { FluxerClient } from '../fluxer/client.js';
import type { MessageCreateEvent } from '../fluxer/types.js';
import { parseCommand } from '../utils/args.js';
import { UserError } from '../types/domain.js';
import { getChannelId } from '../services/channels.js';
import { errorMeta, scoped } from '../utils/logger.js';

const log = scoped('eventos');

/** Comandos que admins usam em qualquer canal, mesmo com a restrição a #comandos. */
const ANYWHERE = new Set(['setup', 'admin']);

export async function onMessageCreate(client: FluxerClient, message: MessageCreateEvent) {
  if (message.guild_id !== client.guildId) return; // só o servidor configurado; ignora DMs
  if (message.author.bot || message.webhook_id) return;

  const parsed = parseCommand(message.content, config.prefix);
  if (!parsed) return;
  const command = findCommand(parsed.name);
  if (!command) return;

  const ctx = new CommandContext(client, message, parsed.name, parsed.args, parsed.rest);
  ctx.usageText = usageOf(command);
  try {
    if (command.adminOnly) await ctx.requireAdmin();
    if (config.restrictToCommandsChannel && !ANYWHERE.has(command.name) && !(await ctx.isAdmin())) {
      const allowed = await getChannelId(client, 'commands');
      if (allowed && message.channel_id !== allowed) throw new UserError(`Use os comandos do bot em <#${allowed}>.`);
    }
    log.info(`!${command.name}`, { user: message.author.id, channel: message.channel_id, args: parsed.args.length });
    await command.execute(ctx);
  } catch (err) {
    const text = err instanceof UserError ? `❌ ${err.message}` : '❌ Algo deu errado. Tente novamente em instantes.';
    if (!(err instanceof UserError))
      log.error(`comando ${command.name} falhou`, { user: message.author.id, content: message.content, ...errorMeta(err) });
    await ctx.reply(text).catch((e: unknown) => log.error('falha ao responder comando', errorMeta(e)));
  }
}
