import {
  type ButtonInteraction,
  type Interaction,
  MessageFlags,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type RepliableInteraction,
  type User,
} from 'discord.js';
import { commandMap } from '../commands/index.js';
import { isAdmin, refOf } from '../commands/types.js';
import { config } from '../config.js';
import { TournamentStatus, UserError } from '../lib/types.js';
import { getSetting } from '../services/settings.js';
import { findByMessage, register, unregister } from '../services/tournaments.js';
import { handleAccept, handleConfirm, handleDecline, handleDispute } from './duelActions.js';
import { refreshTournamentMessage } from './tournamentView.js';
import { JOIN_EMOJI } from './weeklyEvent.js';

async function replyError(interaction: RepliableInteraction, message: string) {
  const payload = { content: `❌ ${message}`, flags: MessageFlags.Ephemeral } as const;
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => undefined);
  else await interaction.reply(payload).catch(() => undefined);
}

async function withErrors(interaction: RepliableInteraction, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof UserError) return replyError(interaction, err.message);
    console.error('[interação] erro inesperado:', err);
    await replyError(interaction, 'Algo deu errado. Tente novamente em instantes.');
  }
}

const ADMIN_ANYWHERE = new Set(['setup', 'admin']);

async function handleButton(interaction: ButtonInteraction) {
  const [scope, action, rawId] = interaction.customId.split(':');
  const id = Number(rawId);
  if (scope === 'duel') {
    if (action === 'accept') return handleAccept(interaction, id);
    if (action === 'decline') return handleDecline(interaction, id);
    if (action === 'confirm') return handleConfirm(interaction, id);
    if (action === 'dispute') return handleDispute(interaction, id);
  }
  if (scope === 'tour' && action === 'join') {
    const { tournament, label } = await register(id, refOf(interaction.user));
    await interaction.reply({ content: `📝 ${label} inscrito em **${tournament.name}**!`, flags: MessageFlags.Ephemeral });
    await refreshTournamentMessage(interaction.client, id);
  }
}

export async function onInteraction(interaction: Interaction) {
  if (interaction.isAutocomplete()) {
    const command = commandMap.get(interaction.commandName);
    await command?.autocomplete?.(interaction).catch((err) => console.error('[autocomplete]', err));
    return;
  }

  if (interaction.isButton()) {
    await withErrors(interaction, () => handleButton(interaction));
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = commandMap.get(interaction.commandName);
  if (!command) return;

  await withErrors(interaction, async () => {
    if (config.restrictToCommandsChannel && !isAdmin(interaction) && !ADMIN_ANYWHERE.has(interaction.commandName)) {
      const allowed = await getSetting('channel:commands');
      if (allowed && interaction.channelId !== allowed) throw new UserError(`Use os comandos do bot em <#${allowed}>.`);
    }
    await command.execute(interaction);
  });
}

/** Reagir com ✅ no anúncio de um evento inscreve; tirar a reação desinscreve. */
export async function onReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  added: boolean,
) {
  if (user.bot || reaction.emoji.name !== JOIN_EMOJI) return;
  try {
    const tournament = await findByMessage(reaction.message.id);
    if (!tournament || tournament.status !== TournamentStatus.REGISTRATION || tournament.teamSize !== 1) return;
    const full = user.partial ? await user.fetch() : user;
    if (added) await register(tournament.id, refOf(full));
    else await unregister(tournament.id, full.id);
    await refreshTournamentMessage(reaction.client, tournament.id);
  } catch (err) {
    if (!(err instanceof UserError)) console.error('[reação] erro:', err);
  }
}
