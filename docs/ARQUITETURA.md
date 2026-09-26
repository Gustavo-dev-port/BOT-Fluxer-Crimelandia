# Arquitetura

O código é dividido em três camadas, de dentro para fora:

```
src/
├── lib/            Lógica pura (sem banco, sem API) — fácil de testar
│   ├── elo.ts          cálculo de ELO, times e reset de temporada
│   ├── tiers.ts        ligas (Bronze III … Mestre)
│   ├── bracket.ts      chave simples com seeds/byes, todos contra todos, classificação
│   ├── rivalry.ts      agrupamento de confrontos e datas relativas
│   ├── achievements.ts catálogo de conquistas
│   ├── shop.ts         catálogo da loja
│   └── types.ts        status, formatos e UserError
│
├── services/       Regras de negócio sobre o banco (Prisma) — sem API do Fluxer
│   ├── matches.ts      ciclo de vida do duelo e finalização (ELO, pontos, moedas, conquistas)
│   ├── tournaments.ts  inscrições, geração de chave, avanço de vencedores, campeão
│   ├── seasons.ts      temporada ativa, encerramento e reset
│   ├── ranking.ts      ranking por pontos ou ELO
│   ├── profile.ts      perfil e rivalidades
│   ├── teams.ts, games.ts, shop.ts, economy.ts, achievements.ts, players.ts, settings.ts
│
├── fluxer/         Cliente da API do Fluxer, escrito a partir de docs.fluxer.app
│   ├── rest.ts         descoberta (/.well-known/fluxer) + HTTP API (Authorization: Bot, 429/retry_after)
│   ├── gateway.ts      WebSocket: Hello → Identify/Resume, heartbeat, Reconnect (op 7), Invalid Session (op 9)
│   ├── client.ts       junta REST + Gateway; cache do dono e dos cargos para checar permissões
│   ├── permissions.ts  bits de permissão (BigInt) e cálculo "Permission computation"
│   └── types.ts        tipos mínimos dos objetos da API
│
├── bot/            Integração com o Fluxer
│   ├── events.ts       MESSAGE_CREATE → comandos; MESSAGE_REACTION_ADD/REMOVE → ✅/❌/⚠️; tratamento de erros
│   ├── announcer.ts    embeds, prompts de reação, #partidas, #placar (mensagem editada e fixada), fim de temporada
│   ├── duelActions.ts  aceitar/recusar/confirmar/contestar (compartilhado entre comandos e reações)
│   ├── tournamentView.ts  embed da chave e anúncio com ✅ para inscrição
│   ├── weeklyEvent.ts  Night Fluxer
│   ├── scheduler.ts    cron: expirações, cargos temporários, fim de temporada, evento semanal
│   ├── channels.ts, format.ts
│
├── commands/       Comandos de texto (`!duelo`…), um arquivo por grupo; `index.ts` tem o registro e o `!ajuda`
├── lib/args.ts     parsing dos comandos: prefixo, aspas, menções `<@id>`, `#partida`
├── config.ts       Variáveis de ambiente e constantes
├── db.ts           PrismaClient
└── index.ts        Inicialização
```

## Princípios

- **Fluxer, não Discord.** O Fluxer não tem slash commands, botões nem intents. Comandos são mensagens com prefixo; as ações de "botão" são reações numa mensagem registrada em `ReactionPrompt` (mensagem → partida + tipo). O bot recebe todas as mensagens e reações do servidor porque sessões de bot nunca são "passivas" (docs: Event filtering).
- **Serviços não conhecem o Fluxer.** Eles recebem IDs e retornam dados (ex.: `ConfirmedMatch` inclui variação de ELO, conquistas desbloqueadas e progresso do campeonato). A camada `bot/` decide o que anunciar.
- **Erros de regra são `UserError`.** O roteador em `interactions.ts` mostra a mensagem ao usuário de forma efêmera; outros erros são registrados no log com uma mensagem genérica.
- **Operações que mexem em várias tabelas usam transação** (`transaction()` em `db.ts`): confirmar uma partida atualiza stats, moedas, conquistas e a chave de uma vez.
- **Estatísticas são por temporada** (`PlayerSeasonStats`). Encerrar uma temporada não apaga nada: o histórico continua disponível em `/rank temporada:N`.

## Modelo de dados

- `Match` é genérico: um duelo 1v1 e um confronto de times são a mesma coisa, com `MatchParticipant.side` = 1 ou 2. Partidas de campeonato têm `tournamentId`, `round`, `slot` e `entry1Id/entry2Id`.
- Na eliminação simples, todas as partidas da chave são criadas no início; as futuras ficam `WAITING` até os dois vencedores chegarem. Byes são partidas `CONFIRMED` sem participantes.
- `Setting` guarda chave/valor: IDs de canais (`channel:placar`…) e da mensagem do placar.
- `ReactionPrompt` liga uma mensagem do bot a uma partida: `challenge` (✅ aceitar / ❌ recusar) ou `confirm` (✅ confirmar / ⚠️ contestar). É apagado quando a partida muda de estado.

## Estendendo

- **Novo jogo:** `/jogo adicionar` (ou adicione em `defaultGames` no `config.ts`).
- **Novo item da loja:** acrescente em `SHOP_ITEMS` (`src/lib/shop.ts`). Tipos: `title`, `color`, `event_credit`, `role`.
- **Nova conquista:** acrescente em `ACHIEVEMENTS` (`src/lib/achievements.ts`) com uma função `check`.
- **Novo comando:** crie um `Command` em `src/commands/` (nome, atalhos, categoria, uso, descrição) e registre em `commands/index.ts`. Ele aparece sozinho no `!ajuda`.
- **Nova chamada à API do Fluxer:** adicione um método em `src/fluxer/rest.ts` seguindo a rota documentada em docs.fluxer.app, e cubra no servidor falso de `tests/mockFluxer.ts`.
- **Mudança no banco:** edite `prisma/schema.prisma` e rode `npm run db:migrate -- --name descricao`.
