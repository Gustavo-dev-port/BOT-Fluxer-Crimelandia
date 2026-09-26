/** Registra os slash commands no servidor (instantâneo, ao contrário do registro global). */
import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';
import { config } from './config.js';

const rest = new REST().setToken(config.token());
const body = commands.map((c) => c.data.toJSON());

const result = (await rest.put(Routes.applicationGuildCommands(config.clientId(), config.guildId()), { body })) as unknown[];
console.log(`✅ ${result.length} comandos registrados no servidor ${config.guildId()}.`);
