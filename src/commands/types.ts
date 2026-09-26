import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  PermissionFlagsBits,
  type SharedSlashCommand,
  type User,
} from 'discord.js';
import { listGames } from '../services/games.js';
import type { PlayerRef } from '../services/players.js';

export interface Command {
  data: SharedSlashCommand;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

export function refOf(user: User): PlayerRef {
  return { id: user.id, username: user.globalName ?? user.username };
}

export function isAdmin(interaction: Interaction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

/** Autocomplete para opções `jogo`. */
export async function autocompleteGame(interaction: AutocompleteInteraction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const games = await listGames();
  await interaction.respond(
    games
      .filter((g) => g.name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((g) => ({ name: g.name, value: g.name })),
  );
}
