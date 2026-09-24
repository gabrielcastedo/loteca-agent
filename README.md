# Loteca Agent — Fase 1 + Fase 2 + Fase 3 + Fase 4

Coleta a grade de jogos do concurso aberto da Loteca, busca odds de mercado
já casadas pelo widget do odds.show (com fallback pro The Odds API +
matching de nomes) e calcula a probabilidade implícita (sem overround) de
cada resultado (1 / X / 2). Opcionalmente, busca
notícias recentes de cada time, usa Claude pra classificar desfalques
relevantes (lesões, suspensões) e ajusta a probabilidade implícita com
base nisso. Estima também a popularidade de cada resultado entre
apostadores casuais (heurística) pra sinalizar onde a probabilidade real
diverge do que a maioria provavelmente vai marcar. Classifica cada jogo
com um rótulo de prioridade de upgrade (Alta/Média/Não vale upgrade —
ranking relativo por posição entre os 14 jogos da semana) e monta um
fechamento (bilhetes separados cobrindo pares dos jogos mais incertos)
com a chance **real** de 13/14 acertos, calculada por simulação — não
uma garantia combinatória maquiada de probabilidade. Salva tudo em
SQLite local.

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
popularidade estimada e fechamento.

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
  casuais via heurística (`src/analysis/popularidade.ts`), incluindo uma
  âncora fraca na taxa histórica real de mandante/empate/visitante desde
  2002 (`src/analysis/historico.ts`, dado em `src/data/historico-loteca.json`)
  — e sinaliza no relatório qual resultado tem o melhor "valor relativo"
  (probabilidade real ÷ popularidade estimada) — ver aviso importante sobre
  essa heurística abaixo
- **Fase 4:** classifica cada jogo com um rótulo de
  "Prioridade Alta/Média/Não vale upgrade" (`src/analysis/otimizador.ts`,
  função `classificarPrioridade`) — ranking relativo por posição entre os
  14 jogos daquela semana, não um limiar fixo, então funciona igual numa
  rodada equilibrada ou numa cheia de favoritos óbvios. Esse rótulo
  alimenta o Fechamento abaixo. O `otimizador.ts` também tem um algoritmo
  guloso de cartão único (`otimizarCartao`) que respeita o teto oficial de
  duplos/triplos da tabela de preços real da Loteca
  (`MAX_DUPLOS_POR_TRIPLOS`) — a capacidade continua no código, mas não é
  mais chamada pelo relatório padrão (ver item 8 abaixo)
- **Fechamento:** bilhetes separados cobrindo pares de jogos de
  "Prioridade Alta/Média" desviando ao mesmo tempo
  (`src/analysis/fechamento.ts`), com a chance real de 13/14 acertos
  calculada por simulação de Monte Carlo (`src/analysis/monteCarlo.ts`) —
  ver aviso importante sobre garantia combinatória vs. probabilidade real
  abaixo. É a única estratégia de aposta que aparece no relatório hoje
- Persiste tudo em SQLite (`src/db/schema.ts`), incluindo as análises de
  desfalque na tabela `desfalques`

Próximos passos em aberto (não fazem parte do escopo original das 4 fases):

- Não há testes automatizados (unit tests) — a validação até aqui foi
  manual, com scripts descartáveis e dados reais/sintéticos
- Não há agendamento automático (rodar toda semana sozinho) — é preciso
  rodar `npm run dev` manualmente
- **Não há loop de validação** (comparar sugestão vs. resultado real depois
  do concurso apurado) — é o maior limitador de qualidade hoje, já que
  todos os fatores de ajuste/popularidade/otimização são chutes com bom
  senso, não calibração. Plano detalhado em
  [`docs/plano-melhorias.md`](docs/plano-melhorias.md).

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
   `TORCIDAS_GRANDES`, `INFLUENCIA_HISTORICO`) refletem padrões gerais
   conhecidos de bolões esportivos, não uma calibração pra Loteca
   especificamente. Trate o "melhor valor" do relatório como um sinal
   qualitativo, não uma probabilidade validada.

   **Adicionado em 2026-09-23: âncora na taxa histórica real (não é
   popularidade de aposta, é frequência de resultado).** O usuário trouxe
   o histórico completo da Loteca (2002 até hoje, 1.261 concursos, 17.654
   jogos — `src/data/historico-loteca.json`), que dá a taxa real de
   1=47.25% / X=26.20% / 2=26.55%. Isso NÃO é dado de popularidade (não
   sabemos o que os apostadores marcam), é a frequência real dos
   resultados — mas serve de âncora fraca pra "senso comum de bolão" tipo
   "mandante costuma ganhar", que um apostador casual carrega mesmo sem
   saber a odd do jogo específico. `carregarTaxaHistorica()` em
   `src/analysis/historico.ts` computa isso a partir do JSON; `popularidade.ts`
   usa `fatorHistorico(resultado) = (taxaHistorica / (1/3)) ^ INFLUENCIA_HISTORICO`
   como multiplicador extra no peso de cada resultado, com
   `INFLUENCIA_HISTORICO = 0.5` (mais um chute documentado — a
   probabilidade real do jogo continua sendo o sinal dominante). O usuário
   também pediu que outra IA calculasse a mesma taxa a partir da mesma
   base — bateu com o nosso número, o que confirma a aritmética mas não é
   uma segunda fonte de dados independente.

8. **O otimizador de cartão único da Fase 4 (`otimizarCartao`) já respeita
   o teto oficial de duplos/triplos** — resolvido em 2026-09-23 com a
   tabela de preços real que o usuário forneceu (confirma a fórmula
   `2^duplos × 3^triplos × R$2,00`, aposta mínima R$4,00, e o teto exato:
   9 duplos com 0 triplos, 8 com 1, 6 com 2, 5 com 3, 3 com 4, 1 com 5, 0
   com 6 — ver `MAX_DUPLOS_POR_TRIPLOS` em `src/analysis/otimizador.ts`).
   As fontes pesquisadas antes divergiam nisso; a tabela real bateu
   exatamente com uma delas (kotasplus.com.br). Ainda é um algoritmo
   guloso (não uma otimização exata: o custo é multiplicativo, então o
   problema é uma mochila não-linear) — funciona bem na prática (testado
   com dados sintéticos e reais, inclusive confirmando que o teto é
   respeitado mesmo com orçamento artificialmente alto), mas não garante
   a alocação matematicamente ótima. **Desde 2026-09-23 essa função não é
   mais chamada pelo relatório** — decisão do usuário de simplificar o
   relatório em torno só do Fechamento, que cobre mais cenários. O código
   (e a tabela de preços validada) ficou no repositório de propósito, caso
   valha reativar um cartão único simples no futuro.

9. **Simulação de Monte Carlo (`src/analysis/monteCarlo.ts`) não é
   validação externa.** Ela sorteia rodadas usando a própria probabilidade
   que o modelo calculou — se a probabilidade estiver errada, a simulação
   herda o mesmo erro. Responde "dado o que o modelo acha, qual a chance
   desse cartão/fechamento bater 13/14?", não "o modelo está certo?" (isso
   segue sendo o P0 do plano de melhorias). Também só simula os jogos que
   entraram no cartão/fechamento (com odds) — se algum jogo ficou de fora,
   os percentuais não correspondem literalmente aos acertos oficiais de
   13/14, e o relatório avisa isso quando acontece. `simularCartao`
   (voltada pro cartão único) ficou sem chamador junto com `otimizarCartao`
   (item 8); `simularFechamento` continua ativa e é a usada no relatório.

10. **Um "modelo quantitativo" gerado por outra IA foi avaliado e
    parcialmente aproveitado em 2026-09-23.** O código colado (pilares como
    Poisson+Elo, Kelly Criterion, classificação por entropia com limiar
    fixo) tinha um bug real e verificado (`self.rawOdds = ...` — `self` não
    existe no Node.js, não compila) e várias ideias que já fazíamos
    (de-vigging, EV vs. popularidade) ou que já tínhamos decidido evitar
    por bom motivo (limiar fixo em vez do ranking relativo por posição, que
    já resolvia o mesmo problema melhor). O que sobreviveu: a simulação de
    Monte Carlo (item 9) e uma versão corrigida do fechamento combinatório
    (item 11). Poisson+Elo e Kelly ficaram de fora — o primeiro exige fonte
    de dados históricos que não temos, o segundo exige confiança no EV que
    ainda não temos (depende do P0).

11. **Fechamento (`src/analysis/fechamento.ts`) corrige uma alegação falsa
    de "100% de garantia" que o modelo de outra IA fazia.** O exemplo
    original (29 bilhetes, "100% de 13 acertos") confundia duas coisas
    diferentes: cobertura combinatória condicional (se os jogos "secos"
    acertarem E o desvio for de no máximo 1 jogo entre os cobertos, algum
    bilhete acerta tudo) com probabilidade real de ganhar. Não é a mesma
    coisa — se qualquer jogo "seco" falhar, todos os bilhetes erram juntos,
    e a chance real de todos os secos acertarem raramente chega perto de
    100%. Nossa versão gera 1 bilhete por PAR de jogos de "Prioridade
    Alta/Média" (2 duplos por bilhete, cobrindo favorito + segundo
    colocado em cada um dos 2), cobrindo até 2 desvios simultâneos — no
    concurso 1272 isso deu 28 bilhetes (C(8,2)) por R$224, próximo da
    escala do exemplo original (29 bilhetes, R$116), mas com cobertura
    real de pares em vez de uma construção mais opaca. Mostra a chance
    **real**, calculada por simulação de Monte Carlo (`simularFechamento`),
    em vez de uma garantia maquiada de probabilidade — nos testes ficou
    bem menor que "100%" (< 1%), mesmo cobrindo mais cenários que a versão
    inicial de 1 desvio por vez. Isso não é um bug, é a heurística sendo
    honesta sobre o que ela de fato garante.
