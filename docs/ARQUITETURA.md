# Arquitetura

O código é dividido em três camadas, de dentro para fora:

```
src/
├── lib/            Lógica pura (sem banco, sem Discord) — fácil de testar
│   ├── elo.ts          cálculo de ELO, times e reset de temporada
│   ├── tiers.ts        ligas (Bronze III … Mestre)
│   ├── bracket.ts      chave simples com seeds/byes, todos contra todos, classificação
│   ├── rivalry.ts      agrupamento de confrontos e datas relativas
│   ├── achievements.ts catálogo de conquistas
│   ├── shop.ts         catálogo da loja
│   └── types.ts        status, formatos e UserError
│
├── services/       Regras de negócio sobre o banco (Prisma) — sem Discord
│   ├── matches.ts      ciclo de vida do duelo e finalização (ELO, pontos, moedas, conquistas)
│   ├── tournaments.ts  inscrições, geração de chave, avanço de vencedores, campeão
│   ├── seasons.ts      temporada ativa, encerramento e reset
│   ├── ranking.ts      ranking por pontos ou ELO
│   ├── profile.ts      perfil e rivalidades
│   ├── teams.ts, games.ts, shop.ts, economy.ts, achievements.ts, players.ts, settings.ts
│
├── bot/            Integração com o Discord
│   ├── interactions.ts roteamento de comandos, botões, autocomplete e reações; tratamento de erros
│   ├── announcer.ts    embeds, #partidas, #placar (mensagem editada), fim de temporada
│   ├── duelActions.ts  aceitar/recusar/confirmar/contestar (compartilhado entre comandos e botões)
│   ├── tournamentView.ts  embed da chave e anúncio com botão de inscrição
│   ├── weeklyEvent.ts  Night Fluxer
│   ├── scheduler.ts    cron: expirações, cargos temporários, fim de temporada, evento semanal
│   ├── channels.ts, format.ts
│
├── commands/       Um arquivo por grupo de slash commands
├── config.ts       Variáveis de ambiente e constantes
├── db.ts           PrismaClient
├── deploy-commands.ts
└── index.ts        Inicialização
```

## Princípios

- **Serviços não conhecem o Discord.** Eles recebem IDs e retornam dados (ex.: `ConfirmedMatch` inclui variação de ELO, conquistas desbloqueadas e progresso do campeonato). A camada `bot/` decide o que anunciar.
- **Erros de regra são `UserError`.** O roteador em `interactions.ts` mostra a mensagem ao usuário de forma efêmera; outros erros são registrados no log com uma mensagem genérica.
- **Operações que mexem em várias tabelas usam transação** (`transaction()` em `db.ts`): confirmar uma partida atualiza stats, moedas, conquistas e a chave de uma vez.
- **Estatísticas são por temporada** (`PlayerSeasonStats`). Encerrar uma temporada não apaga nada: o histórico continua disponível em `/rank temporada:N`.

## Modelo de dados

- `Match` é genérico: um duelo 1v1 e um confronto de times são a mesma coisa, com `MatchParticipant.side` = 1 ou 2. Partidas de campeonato têm `tournamentId`, `round`, `slot` e `entry1Id/entry2Id`.
- Na eliminação simples, todas as partidas da chave são criadas no início; as futuras ficam `WAITING` até os dois vencedores chegarem. Byes são partidas `CONFIRMED` sem participantes.
- `Setting` guarda chave/valor: IDs de canais (`channel:placar`…) e da mensagem do placar.

## Estendendo

- **Novo jogo:** `/jogo adicionar` (ou adicione em `defaultGames` no `config.ts`).
- **Novo item da loja:** acrescente em `SHOP_ITEMS` (`src/lib/shop.ts`). Tipos: `title`, `color`, `event_credit`, `role`.
- **Nova conquista:** acrescente em `ACHIEVEMENTS` (`src/lib/achievements.ts`) com uma função `check`.
- **Novo comando:** crie um `Command` em `src/commands/`, registre em `commands/index.ts` e rode `npm run deploy-commands`.
- **Mudança no banco:** edite `prisma/schema.prisma` e rode `npm run db:migrate -- --name descricao`.
