import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { updateScoreboard } from './bot/announcer.js';
import { onInteraction, onReaction } from './bot/interactions.js';
import { startScheduler } from './bot/scheduler.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { seedDefaultGames } from './services/games.js';
import { getActiveSeason } from './services/seasons.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] conectado como ${c.user.tag}`);
  await seedDefaultGames();
  const season = await getActiveSeason();
  console.log(`[bot] Temporada ${season.number} ativa até ${season.endsAt.toISOString()}`);
  await updateScoreboard(c).catch((err) => console.error('[bot] placar:', err));
  startScheduler(c);
});

client.on(Events.InteractionCreate, onInteraction);
client.on(Events.MessageReactionAdd, (reaction, user) => onReaction(reaction, user, true));
client.on(Events.MessageReactionRemove, (reaction, user) => onReaction(reaction, user, false));

async function shutdown() {
  console.log('[bot] desligando...');
  await client.destroy();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(config.token());
