# Arquitetura

O projeto segue a estrutura pedida na especificação, mais a pasta `fluxer/` com o cliente da plataforma. Ela faz o papel que o discord.js faria num bot de Discord.

```
src/
├── commands/        Comandos de texto (`!duelo`, `!rank`…), um arquivo por grupo
│   ├── index.ts         registro de todos os comandos e o `!ajuda`
│   └── types.ts         interface Command e CommandContext (argumentos, menções, responder, checar admin)
│
├── events/          Eventos do Gateway do Fluxer
│   ├── messageCreate.ts MESSAGE_CREATE → acha o comando, checa permissão/canal, executa, trata erros
│   ├── reactions.ts     MESSAGE_REACTION_ADD/REMOVE → ✅/❌/⚠️ nos prompts, ✅ nas inscrições, 1️⃣–5️⃣ na votação do Night Fluxer
│   └── voiceState.ts    GUILD_CREATE / VOICE_STATE_UPDATE / PASSIVE_UPDATES → presença em voz
│
├── services/        Regras de negócio
│   ├── rules/           lógica pura, sem banco nem API: elo, tiers, bracket, rivalry, achievements, shop, honors (títulos e classe),
│   │                    missions (catálogo e sorteio do dia), night (votação e sorteio de equipes), voiceRooms
│   ├── matches.ts       ciclo de vida do duelo: desafio → aceite → resultado → confirmação (ELO, pontos, moedas, conquistas, duração)
│   ├── tournaments.ts   eventos/campeonatos: inscrições, chave, avanço de vencedores, campeão
│   ├── seasons.ts       temporada mensal: ativa, encerramento, reset
│   ├── missions.ts      missões diárias: geração, progresso (fila por jogador) e coleta
│   ├── night.ts         Night Fluxer: evento, votos, fechamento com sorteio de equipes, encerramento
│   ├── voicePresence.ts quem está em qual sala de voz; minutos e entradas (missões) e ocupação (salas temporárias)
│   ├── hallOfFame.ts    Hall do Reino: campeão, MVP da semana, mais ativo, maior sequência, mais vitórias, mais FluxCoins
│   ├── music/           música na voz do Fluxer (LiveKit):
│   │                    voice.ts (op 4 → VOICE_SERVER_UPDATE → sala LiveKit, faixa de áudio), player.ts (quadros de 10 ms,
│   │                    pausa, pular, volume, DataPackets), queue.ts (fila pura), youtube.ts (yt-dlp), spotify.ts (metadados),
│   │                    audio.ts (yt-dlp → ffmpeg → PCM), musicService.ts (pedidos, fila salva, histórico, saída por inatividade)
│   ├── ranking.ts, profile.ts, teams.ts, games.ts, shop.ts, economy.ts, achievements.ts, players.ts, settings.ts
│   ├── promotions/      adaptadores por loja (steam, epic, gog, humble, itad) + promotionService
│   ├── freeGames/       fontes (epic, itadGiveaways) + freeGameService
│   ├── notifications/   o que fala com o Fluxer: announcer (#partidas, #placar, fim de temporada, prompts de reação),
│   │                    duelActions, tournamentAnnouncer, promotionPublisher, freeGamePublisher, hallAnnouncer,
│   │                    missionTracker (eventos → missões, aviso de conclusão), voiceRooms (!grupo e limpeza),
│   │                    pinnedMessage (mensagem fixada sempre atualizada: #placar e #hall-do-reino)
│   └── channels.ts      canal configurado (GuildSettings) ou encontrado pelo nome
│
├── database/        Acesso ao banco (Prisma)
│   ├── client.ts        PrismaClient e transaction()
│   └── *Repository.ts   GuildSettingsRepository, PromotionRepository, FreeGameRepository
│
├── embeds/          Montagem das mensagens: matchEmbeds, tournamentEmbed, promotionEmbed, freeGameEmbed, hallEmbed, musicEmbed, format (menções, datas, barras de progresso, paleta)
├── schedulers/      Tarefas agendadas: manutenção (5 min), voz e salas vazias (1 min), Hall do Reino (10 min), missões (00:00),
│                    Night Fluxer (weeklyEvent.ts), promoções (30 min), jogos grátis (1 h)
├── utils/           logger (Winston, com missions/voice/night.log), queue (filas de escrita), http (fetch com tempo limite e logs sem credenciais), args (parsing), calendar (fuso horário)
├── types/           domain.ts: status, formatos e UserError
│
├── fluxer/          Cliente da API do Fluxer, escrito a partir de docs.fluxer.app
│   ├── rest.ts          descoberta (/.well-known/fluxer) + HTTP API (Authorization: Bot, 429/retry_after)
│   ├── gateway.ts       WebSocket: Hello → Identify/Resume, heartbeat, Reconnect (op 7), Invalid Session (op 9)
│   ├── client.ts        junta REST + Gateway; cache do dono e dos cargos para checar permissões
│   ├── permissions.ts   bits de permissão (BigInt) e cálculo "Permission computation"
│   └── types.ts         tipos dos objetos da API
│
├── config.ts        Variáveis de ambiente e constantes
└── index.ts         Inicialização: conecta, liga eventos e agendadores, tratamento global de erros
```

## Princípios

- **Fluxer, não Discord.** O Fluxer não tem slash commands, botões nem intents. Por isso:
  - Comandos são mensagens com prefixo.
  - As ações de "botão" são reações numa mensagem registrada em `ReactionPrompt` (mensagem → partida + tipo).
  - O bot recebe todas as mensagens e reações do servidor, porque sessões de bot nunca são "passivas" (docs: Event filtering).
- **Camadas desacopladas.**
  - `services/rules` não conhece banco nem Fluxer.
  - Os serviços de promoções e jogos grátis recebem por injeção:
    - fontes: interfaces `PromotionAdapter` e `FreeGameSource`;
    - repositório;
    - publicador: interfaces `PromotionPublisher` e `FreeGamePublisher`;
    - logger.
      Isso permite testá-los sem rede e sem Fluxer.
  - Só `services/notifications/` e `events/` falam com o Fluxer.
- **Erros de regra são `UserError`.** `events/messageCreate.ts` responde a mensagem ao usuário. Outros erros vão para o log (Winston) e o usuário recebe uma mensagem genérica. `index.ts` também registra `unhandledRejection` e `uncaughtException`.
- **Rajadas de eventos são enfileiradas.** No SQLite, muitas escritas simultâneas (ex.: todos reagindo ao Night Fluxer) estouram o tempo de espera do banco. Reações, progresso de missões e entradas/saídas das salas temporárias passam por filas próprias (`utils/queue.ts`), uma tarefa por vez. São filas separadas para uma não esperar a outra (uma reação ✅ que confirma partida gera progresso de missão).
- **Operações que mexem em várias tabelas usam transação** (`transaction()` em `database/client.ts`). Confirmar uma partida atualiza estatísticas, moedas, conquistas e a chave de uma vez.
- **Fontes externas são lidas de forma defensiva.** Um item com formato inesperado é descartado, e uma loja com erro não derruba as outras.

## Modelo de dados

| Tabela                                                | Para quê                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GuildSettings`                                       | Canais (inclusive `hallChannelId`), cargos e idioma por servidor (`!config`)                   |
| `Player`                                              | Jogador; saldo de FluxCoins, título equipado                                                   |
| `Transaction`                                         | Extrato da economia (ganhos e gastos de FluxCoins)                                             |
| `Season`, `PlayerSeasonStats`                         | Temporadas mensais e estatísticas por temporada (histórico mantido)                            |
| `Match`, `MatchParticipant`                           | Partidas 1v1 ou em time: vencedor/perdedor (`side`), jogo, duração, datas                      |
| `Tournament`, `TournamentEntry`                       | Eventos/campeonatos e inscrições                                                               |
| `Team`, `TeamMember`                                  | Times                                                                                          |
| `Promotion`                                           | Promoções vistas/publicadas (não repete, edita quando o preço muda)                            |
| `FreeGame`                                            | Jogos grátis vistos/publicados                                                                 |
| `DailyMission`, `PlayerMission`                       | Missões do dia e o progresso/coleta de cada jogador                                            |
| `WeeklyEvent`, `EventVote`, `EventTeam`               | Night Fluxer: votação, votos, equipes sorteadas e suas salas de voz (a chave é o `Tournament`) |
| `VoiceRoom`                                           | Salas de voz temporárias do `!grupo` (líder, limite, privacidade, hash da senha)               |
| `MusicQueue`, `MusicHistory`                          | Fila de músicas salva (volta depois de reiniciar) e músicas tocadas                            |
| `ReactionPrompt`                                      | Mensagens que esperam reação (substitutas dos botões)                                          |
| `TempRole`, `TempNickname`                            | Itens temporários da loja (cargos, cor, apelido especial)                                      |
| `Game`, `PlayerTitle`, `PlayerAchievement`, `Setting` | Jogos disponíveis, títulos comprados, conquistas, valores avulsos (ex.: mensagem do placar)    |

Alguns nomes da especificação correspondem a tabelas com outro nome:

| Na especificação | Aqui                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `Economy`        | `Player.coins` + `Transaction`                                           |
| `Event`          | `Tournament`                                                             |
| `WeeklyVote`     | `EventVote` (a especificação usa os dois nomes)                          |
| `Rivalry`        | calculada na hora a partir das partidas (`rules/rivalry.ts`), sem tabela |

Outras notas:

- **Partidas genéricas:** um duelo 1v1 e um confronto de times são a mesma coisa em `Match`, com `MatchParticipant.side` = 1 ou 2.
- **Chave de mata-mata:** todas as partidas são criadas no início. As das rodadas seguintes ficam `WAITING` até os dois vencedores chegarem.
- **Dois bancos:** `prisma/schema.prisma` é a fonte (SQLite, desenvolvimento). `prisma/postgres/schema.prisma` é gerado a partir dele (PostgreSQL, produção). Cada um tem suas migrações.

## Estendendo

- **Novo comando:** crie um `Command` em `src/commands/` (nome, atalhos, categoria, uso, descrição) e registre em `commands/index.ts`. Ele aparece sozinho no `!ajuda`.
- **Nova loja de promoções:** implemente `PromotionAdapter` em `src/services/promotions/adapters/`, registre em `adapters/index.ts` e crie um teste com uma resposta de exemplo em `tests/fixtures/promotions/`.
- **Nova fonte de jogos grátis:** implemente `FreeGameSource` em `src/services/freeGames/sources/` e registre em `sources/index.ts`.
- **Novo item da loja:** acrescente em `SHOP_ITEMS` (`src/services/rules/shop.ts`). Tipos: `title`, `color`, `event_credit`, `role`, `nickname`.
- **Nova conquista:** acrescente em `ACHIEVEMENTS` (`src/services/rules/achievements.ts`) com uma função `check`.
- **Nova chamada à API do Fluxer:** adicione um método em `src/fluxer/rest.ts` seguindo a rota documentada em docs.fluxer.app, e cubra no servidor falso de `tests/mockFluxer.ts`.
- **Mudança no banco:**
  1. Edite `prisma/schema.prisma`.
  2. Rode `npm run db:migrate -- --name descricao` (SQLite).
  3. Rode `npm run db:postgres:sync`.
  4. Crie a migração do PostgreSQL (veja o README).
  5. Valide com `npm run test:postgres`.
