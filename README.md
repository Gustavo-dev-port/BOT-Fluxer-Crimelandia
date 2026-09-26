# ⚔️ Fluxer BOT — Crimelândia

Bot de Discord que registra disputas entre amigos, cria temporadas, mantém rankings e organiza eventos de jogos automaticamente.

- **Rankings** — pontos por temporada e ELO (com ligas: Bronze III → Mestre)
- **Duelos 1v1** — desafio com aceite e resultado validado pelos dois lados
- **Times** — 2v2, 3v3 ou squads de até 10
- **Campeonatos** — chave simples (mata-mata) ou todos contra todos
- **Temporadas** — reset automático, cargo exclusivo do campeão e histórico arquivado
- **Eventos semanais** — toda sexta às 20h: *Night Fluxer*, inscrição reagindo com ✅
- **FluxCoins** — moeda da comunidade, loja com títulos, cor de nick e eventos personalizados
- **Conquistas** — medalhas desbloqueadas automaticamente
- **Rivalidades** — `/rival` descobre quem vocês mais enfrentam

## Stack

| Tecnologia | Uso |
| --- | --- |
| Node.js 22 + TypeScript | Linguagem |
| Discord.js v14 | Bot |
| SQLite | Banco local (suficiente para 20–100 membros) |
| Prisma 6 | ORM e migrações |
| node-cron | Temporadas, expirações e evento semanal |
| Vitest | Testes |
| Docker | Hospedagem |

## Instalação

### 1. Criar o bot no Discord

1. Acesse <https://discord.com/developers/applications> → **New Application**.
2. Em **Bot**, gere o token (`DISCORD_TOKEN`). Nenhum *privileged intent* é necessário.
3. Em **General Information**, copie o **Application ID** (`DISCORD_CLIENT_ID`).
4. Convide o bot com os escopos `bot` e `applications.commands` e as permissões:
   *Ver canais, Enviar mensagens, Inserir links, Adicionar reações, Ler histórico, Gerenciar mensagens (fixar o placar), Gerenciar cargos, Gerenciar canais* (só para o `/setup`).
5. Ative o modo desenvolvedor no Discord e copie o ID do servidor (`DISCORD_GUILD_ID`).

### 2. Rodar localmente

```bash
cp .env.example .env     # preencha DISCORD_TOKEN, DISCORD_CLIENT_ID e DISCORD_GUILD_ID
npm install
npx prisma migrate deploy   # cria o banco SQLite em prisma/fluxer.db
npm run deploy-commands     # registra os slash commands no servidor
npm run dev
```

No Discord, rode **/setup** (admin) para criar os canais `#comandos`, `#placar`, `#partidas` e `#eventos`.

### 3. Docker

```bash
cp .env.example .env   # preencha
docker compose up -d --build
docker compose exec fluxer-bot node dist/deploy-commands.js   # uma vez, ou quando os comandos mudarem
```

O banco fica no volume `fluxer-data` (`/data/fluxer.db`). As migrações rodam sozinhas ao subir o container.

## Canais

| Canal | Função |
| --- | --- |
| `#comandos` | Todos os comandos do bot (restrinja com `RESTRICT_COMMANDS_CHANNEL=true`) |
| `#placar` | Ranking atualizado automaticamente — o bot edita a mesma mensagem fixada |
| `#partidas` | Histórico das disputas confirmadas e das disputas contestadas |
| `#eventos` | Campeonatos, evento semanal e fim de temporada |

## Comandos

### Duelos

| Comando | Função |
| --- | --- |
| `/duelo @amigo jogo` | Cria um desafio (com botões Aceitar/Recusar) |
| `/aceitar [partida]` | Aceita o duelo |
| `/recusar [partida]` | Recusa o duelo |
| `/cancelar [partida]` | Cancela um desafio que você criou |
| `/resultado vencedor [partida]` | Registra quem venceu — **o outro lado precisa confirmar** |
| `/confirmar [partida]` | Confirma o resultado informado pelo adversário |
| `/contestar [partida]` | Contesta; a partida vai para um admin |
| `/partidas` | Suas partidas em aberto |

`partida` só é necessário se você tiver mais de uma partida aberta.

### Ranking e perfil

| Comando | Função |
| --- | --- |
| `/rank [temporada] [modo]` | Ranking da temporada atual ou de uma anterior, por pontos ou ELO |
| `/top10` | Os 10 melhores jogadores |
| `/perfil [jogador]` | Liga, colocação, vitórias (+ na semana), derrotas, win rate, sequência, jogos favoritos, conquistas |
| `/rival [contra] [jogador]` | Maior rivalidade ou confronto direto |

### Times e campeonatos

| Comando | Função |
| --- | --- |
| `/time criar nome @membros…` | Cria um time (você é o capitão) |
| `/time desafiar meu_time adversario jogo` | Desafio entre times do mesmo tamanho |
| `/time info` · `listar` · `sair` · `desfazer` | Gestão de times |
| `/campeonato criar nome jogo formato [tamanho_time]` | Cria torneio (admin, ou com crédito da loja) |
| `/campeonato iniciar id` | Fecha inscrições, define seeds pelo rating e gera a chave |
| `/campeonato chave id` | Mostra chave / classificação |
| `/campeonato listar` · `sair` · `cancelar` | Gestão de campeonatos |
| `/inscrever campeonato [time]` | Entra no evento (ou clique em **Inscrever-se** no anúncio) |

### Economia

| Comando | Função |
| --- | --- |
| `/loja` | Itens disponíveis |
| `/comprar item [cor]` | Compra um item |
| `/titulo equipar/remover/listar` | Título exibido no perfil |
| `/saldo` | Saldo e últimas movimentações |

### Administração

| Comando | Função |
| --- | --- |
| `/setup [categoria]` | Cria/configura os canais |
| `/temporada info` · `encerrar` | Informações / encerra a temporada agora |
| `/jogo listar` · `adicionar` · `remover` | Jogos disponíveis para disputas |
| `/admin resultado partida vencedor` | Resolve disputas |
| `/admin cancelar partida` | Cancela uma partida não confirmada |
| `/admin moedas jogador quantidade` | Ajusta FluxCoins |
| `/admin placar` | Recria a mensagem do placar |
| `/admin evento-semanal` | Abre o evento semanal agora |

## Como funciona um duelo

```
/duelo @Lucas Valorant ──► PENDENTE ──(Lucas: /aceitar)──► ACEITO
                              │                              │
                         (/recusar, 24h)            (um lado: /resultado)
                              ▼                              ▼
                     RECUSADO / EXPIRADO       AGUARDANDO CONFIRMAÇÃO
                                                 │                 │
                                     (outro lado: /confirmar) (/contestar)
                                                 ▼                 ▼
                                            CONFIRMADO ◄──admin── EM DISPUTA
```

Isso evita que apenas uma pessoa registre vitória. Se os dois lados usarem `/resultado` com o mesmo vencedor, a partida é confirmada; com vencedores diferentes, vai para disputa.

Na confirmação, o bot atualiza ELO/pontos, paga FluxCoins, verifica conquistas, avança a chave (se for de campeonato), posta em `#partidas` e edita o `#placar`.

## Regras

**Ranking** — `RANKING_MODE=pontos` (padrão: vitória +3, derrota +1) ou `elo`. O ELO é sempre calculado (K=32, início 1000) e define a liga:

| Liga | Rating |
| --- | --- |
| Ferro | < 1000 |
| Bronze III/II/I | 1000–1199 |
| Prata | 1200–1399 |
| Ouro | 1400–1599 |
| Platina | 1600–1799 |
| Diamante | 1800–1999 |
| Mestre | 2000+ |

Em partidas de time, usa-se a média de rating de cada lado e todos recebem a mesma variação.

**Temporadas** — duram `SEASON_DAYS` (30). No fim: 🥇 o campeão recebe o cargo `CHAMPION_ROLE_ID` (retirado do campeão anterior) e +150 FluxCoins; 📊 as estatísticas ficam arquivadas (`/rank temporada:N`); 🔄 o ranking recomeça do zero, ou parcialmente com `SEASON_CARRY_OVER` (ex.: `0.5` mantém metade da distância até 1000).

**FluxCoins** — vitória +25 · participação +10 · campeão (torneio ou temporada) +150 · evento especial (Night Fluxer) +50 para cada participante.

**Loja** — títulos (Rei do Rush, Fantasma, Sniper, Senhor do Clutch, Tryhard), cor do nickname por 7 dias, evento personalizado (permite criar um campeonato) e cargo VIP (`SHOP_VIP_ROLE_ID`). Itens ficam em `src/lib/shop.ts`.

**Evento semanal** — `WEEKLY_EVENT_CRON` (padrão `0 20 * * 5`, sexta 20h no fuso `TIMEZONE`). Quem reagir com ✅ entra na chave; após `WEEKLY_EVENT_REGISTRATION_MINUTES` (30) a chave é gerada automaticamente. Com menos de 2 inscritos, o evento é cancelado.

## Desenvolvimento

```bash
npm run dev          # bot com hot reload
npm test             # testes (lógica pura + serviços contra um SQLite de teste)
npm run typecheck
npm run build
npm run db:studio    # navegar no banco
```

Veja [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) para a estrutura do código e como estender (novos jogos, itens, conquistas, comandos).
