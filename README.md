# Loteca Agent — Fase 1 + Fase 2 + Fase 3 + Fase 4

Coleta a grade de jogos do concurso aberto da Loteca, busca odds de mercado
já casadas pelo widget do odds.show (com fallback pro The Odds API +
matching de nomes) e calcula a probabilidade implícita (sem overround) de
cada resultado (1 / X / 2). Opcionalmente, busca
notícias recentes de cada time, usa Claude pra classificar desfalques
relevantes (lesões, suspensões) e ajusta a probabilidade implícita com
base nisso. Estima também a popularidade de cada resultado entre
apostadores casuais (heurística) pra sinalizar onde a probabilidade real
diverge do que a maioria provavelmente vai marcar. Por fim, monta um
cartão sugerido (simples/duplo/triplo por jogo) dentro de um orçamento em
reais. Salva tudo em SQLite local.

## Setup

```bash
npm install
cp .env.example .env
# edite .env com sua chave gratuita de https://the-odds-api.com
npm run dev
```

A Fase 2 (desfalques) é opcional: sem `NEWSAPI_KEY` e `ANTHROPIC_API_KEY`
configuradas no `.env`, o app funciona normalmente só com a Fase 1.

## Grade manual (quando a API de resultados está atrasada)

A API de resultados (`fetchConcursoAtual` em `src/data/fixtures.ts`) costuma
ficar alguns dias atrasada em relação ao site de apostas da Caixa, que
publica a grade mais cedo. Não automatizamos a leitura de lá (ver "Pontos
de atenção" #1 — o site tem proteção anti-bot). Em vez disso, o fluxo é:

1. Peça pro assistente (Claude) consultar a grade manualmente, usando o
   navegador de forma assistida — é uma consulta pontual como um humano
   faria, não um script rodando sozinho.
2. Salve o resultado em `manual-grades/concurso-<numero>.json` (ver
   `manual-grades/concurso-1272.json` como exemplo de formato).
3. Configure `CONCURSO_MANUAL_PATH` no `.env` apontando pra esse arquivo —
   o app usa a grade salva em vez de chamar a API.

Validado ao vivo com o concurso 1272: pipeline completo (Fases 1 a 4)
rodou ponta a ponta, incluindo matching de odds, análise de desfalques,
popularidade estimada e cartão sugerido.

## O que este código faz (e o que não faz ainda)

Faz:

- Busca a grade de 14 jogos do concurso aberto direto da API que o site da
  Caixa usa (`src/data/fixtures.ts`) — detecta corretamente quando não há
  concurso aberto no momento (comum entre o fechamento de um concurso e a
  publicação do próximo)
- **Fonte principal de odds:** widget público do odds.show
  (`src/data/oddsShow.ts`), que já casa os jogos com o nome oficial da
  Caixa e mostra a melhor odd de cada mercado (1/X/2) — resolve o
  problema de cobertura e de matching de nomes de uma vez, ver ponto #2
  abaixo
- **Fallback:** odds h2h (1x2) de vários campeonatos via The Odds API
  (`src/data/odds.ts`), casadas por nome de time (`src/data/matcher.ts`)
  — usado só nos jogos que o odds.show não cobrir
- Calcula probabilidade implícita de mercado por jogo (`src/probability.ts`)
- **Fase 2 (opcional):** busca notícias recentes de cada time via
  NewsAPI.org (`src/data/news.ts`), usa Claude Haiku pra classificar o
  nível de impacto de desfalques (`src/analysis/desfalques.ts`) e ajusta a
  probabilidade implícita proporcionalmente (`src/analysis/ajuste.ts`)
- **Fase 3:** estima a popularidade de cada resultado entre apostadores
  casuais via heurística (`src/analysis/popularidade.ts`) e sinaliza no
  relatório qual resultado tem o melhor "valor relativo" (probabilidade
  real ÷ popularidade estimada) — ver aviso importante sobre essa
  heurística abaixo
- **Fase 4:** monta um cartão sugerido (simples/duplo/triplo por jogo)
  dentro de um orçamento em reais (`ORCAMENTO_REAIS` no `.env`), usando um
  algoritmo guloso que prioriza duplos/triplos nos jogos mais equilibrados
  (`src/analysis/otimizador.ts`) — ver aviso sobre limites de duplos/triplos
  abaixo
- Persiste tudo em SQLite (`src/db/schema.ts`), incluindo as análises de
  desfalque na tabela `desfalques`

Próximos passos em aberto (não fazem parte do escopo original das 4 fases):

- Não há testes automatizados (unit tests) — a validação até aqui foi
  manual, com scripts descartáveis e dados reais/sintéticos
- Não há agendamento automático (rodar toda semana sozinho) — é preciso
  rodar `npm run dev` manualmente

## Pontos de atenção conhecidos

1. **Endpoint da Caixa não é documentado oficialmente**, mas o formato de
   resposta em `fixtures.ts` já foi validado ao vivo (2026-09-21). O
   endpoint sem número sempre devolve o último concurso **já apurado**, não
   o aberto pra apostas — `fetchConcursoAtual()` busca `numeroConcursoProximo`
   em seguida e lança erro claro se não houver concurso realmente aberto no
   momento (comum entre o fechamento de um concurso e a publicação do
   próximo). Se a Caixa mudar o formato de novo, o erro de parsing aparece
   rápido (a grade vem com menos de 14 jogos).

   Essa API fica atrasada em relação ao site de apostas
   (loteriasonline.caixa.gov.br), que publica a grade alguns dias antes da
   apuração — confirmado ao vivo em 2026-09-21 (concurso 1272 já visível
   lá, mas ainda 500 nessa API). Cheguei a implementar um fallback via
   navegador headless (Playwright) lendo `localStorage['ngStorage-partidasLoteca']`
   daquele site, mas revertido: o site tem um WAF anti-bot
   (Radware/ShieldSquare) que detecta e bloqueia explicitamente
   `HeadlessChrome` ("comportamento malicioso"). Contornar isso seria
   burlar uma proteção de segurança deliberada de um site do governo
   federal — não fiz, e não recomendo fazer. Na prática, espere alguns
   dias após a abertura do concurso pra essa API sincronizar.

2. **odds.show (`src/data/oddsShow.ts`) é a fonte principal de odds desde
   2026-09-21, e resolveu cobertura + matching de uma vez.** É um widget
   público (`https://odds.show/br/widget_lotteries/?lottery=loteca`) feito
   especificamente pra loterias/bolões brasileiros — mostra a melhor odd
   de cada mercado (1/X/2) entre várias casas, já casada com o nome oficial
   da Caixa. Testado ao vivo com o concurso 1272: **os 14 jogos tiveram
   odds** (incluindo eliminatórias europeias e Série B/C, que o The Odds
   API não cobre). Casamos por número de jogo (sequencial), não por nome —
   muito mais confiável que o matcher de nomes.

   Não é uma API formal: é HTML server-renderizado (Next.js) de uma página
   pensada pra embutir via iframe. `robots.txt` permite (`Allow: /`), os
   dados vêm prontos numa requisição `GET` comum (sem precisar de
   navegador/JS), e o uso é o mesmo do widget público — mas a estrutura
   pode mudar sem aviso em qualquer redeploy. O parser evita depender de
   classes CSS geradas (mudam a cada build) e se apoia em `aria-label` e no
   texto "Oficial: ..." (mais estáveis, mas não imunes a mudança). Se
   quebrar, o app cai pro fallback (Odds API + matcher) automaticamente.

   Detalhe técnico: `cheerio` (parser de HTML) depende de `undici`, que
   exige Node 20+. Como só usamos o parsing (não a parte de rede do
   cheerio), fixei `cheerio` em `1.1.0` e adicionei um polyfill do global
   `File` (via `node:buffer`) em `oddsShow.ts` pra rodar no Node 18 sem
   precisar trocar de versão.

3. **Matching de nomes de time (The Odds API, fallback) ainda é frágil.**
   A Caixa e a Odds API não usam a mesma convenção de nomes (ex: Caixa
   manda `"BRAGANTINO"` puro, Odds API usa `"Bragantino-SP"`; Caixa manda
   `"ATLETICO"` sem distinguir MG/PR/GO, só dá pra desambiguar usando a UF).
   O matcher faz normalização + match exato + overrides manuais (alguns
   fixos por UF) — espere popular `MANUAL_OVERRIDES`/`MANUAL_OVERRIDES_POR_UF`
   aos poucos, concurso a concurso, **se o odds.show ficar fora do ar**
   (com ele funcionando, esse matching quase não entra em ação). Use
   `npm run test-matcher <numero>` pra testar contra dados reais sem
   esperar um concurso estar aberto.

4. **Cobertura de campeonatos (relevante só quando o odds.show falha e
   cai pro The Odds API).** Times de Série B/C brasileira ou competições
   regionais podem não ter odds na Odds API (ou em qualquer provedor
   gratuito). Esses jogos ficam sem odds no relatório — não tem solução
   mágica além de aceitar a lacuna ou pagar por um provedor com cobertura
   maior.

   **Atualização (2026-09-21, concurso 1272):** as eliminatórias de Copa do
   Mundo **existem** como sport key na Odds API
   (`soccer_fifa_world_cup_qualifiers_europe` e `..._south_america`) — só
   não aparecem em `GET /v4/sports` sem o parâmetro `?all=true`, porque
   ficam marcadas como `active: false` quando não há evento populado no
   momento. Já adicionei as duas em `CAMPEONATOS_RELEVANTES`
   (`src/data/odds.ts`) — é de graça, mesmo plano, sem custo extra. Testei
   ao vivo e retornaram 0 eventos pro concurso 1272 (nenhum bookmaker tinha
   posto linha ainda pra jogos como Gibraltar x Andorra) — pode ser que
   populem mais perto da data do jogo, vale reconferir.

   **Série C brasileira não existe na Odds API, nem oculta** — conferi a
   lista completa via `?all=true` e não há chave equivalente. Essa parte da
   lacuna é definitiva com esse provedor.

   Também avaliei dois provedores alternativos e não valeram a pena pro
   nosso caso: **API-Football/api-sports.io** tem tier gratuito, mas ele só
   dá acesso a temporadas de 2022–2024 (não à atual) — inútil pra dados em
   tempo real; o plano pago que desbloqueia a temporada atual custa
   US$19/mês. **Odds-API.io** tem tier gratuito, mas limitado a 2 casas de
   apostas; planos pagos começam em £49/mês. Nenhum dos dois compensa pro
   ganho marginal em cobertura de um projeto pessoal.

5. **Rate limit do tier gratuito da Odds API** é ~500 requisições/mês.
   Como a Loteca é semanal e o código busca 1x por campeonato por execução,
   isso dá margem, mas evite rodar em loop de teste sem necessidade.

6. **Fase 2 já foi validada ponta a ponta com chaves reais** (NewsAPI +
   Claude Haiku, casos Flamengo/Palmeiras). O tier gratuito da NewsAPI é
   restrito a uso não-comercial/dev — releia os termos antes de rodar isso
   com frequência. Os fatores de ajuste em `src/analysis/ajuste.ts`
   (`FATOR_REDUCAO`) são um chute inicial, não uma calibração — ajuste
   conforme validar resultados reais.

7. **A popularidade da Fase 3 é uma heurística sem dado real por trás —
   isso é uma limitação estrutural, não um TODO.** Pesquisei e não existe
   fonte pública de quantos apostadores marcam cada resultado por jogo na
   Loteca (só existe número de acertadores por faixa no cartão inteiro).
   Os fatores em `src/analysis/popularidade.ts`
   (`FATOR_SUBAPOSTA_EMPATE`, `BONUS_TORCIDA_GRANDE`, lista
   `TORCIDAS_GRANDES`) refletem padrões gerais conhecidos de bolões
   esportivos, não uma calibração pra Loteca especificamente. Trate o
   "melhor valor" do relatório como um sinal qualitativo, não uma
   probabilidade validada.

8. **O otimizador da Fase 4 não impõe teto de duplos/triplos.** Pesquisei
   a fórmula de preço da Loteca (`2^duplos × 3^triplos × R$2,00`, aposta
   mínima R$4,00) e as fontes concordam nisso, mas divergem sobre o limite
   máximo de duplos/triplos por cartão — uma fonte diz 5 duplos + 3
   triplos fixo, outra diz uma tabela escalonada que vai até 6 triplos. Em
   vez de codificar um número que pode estar errado, o otimizador só
   respeita o orçamento em reais. **Confira o limite real no site/app da
   Caixa antes de fechar uma aposta de verdade** — o cartão sugerido pode,
   em teoria, propor mais duplos/triplos do que a Caixa aceita num único
   volante. Além disso, é um algoritmo guloso (não uma otimização exata:
   o custo é multiplicativo, então o problema é uma mochila não-linear) —
   funciona bem na prática (testado com dados sintéticos e reais), mas não
   garante a alocação matematicamente ótima.
