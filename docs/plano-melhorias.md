# Plano de melhorias — qualidade das sugestões

Escrito em 2026-09-22, depois da primeira execução ponta a ponta bem-sucedida
(concurso 1272, 14/14 jogos com odds via odds.show). O pipeline funciona;
esse documento é sobre deixar as *sugestões* melhores, não sobre destravar
dados que faltavam.

## O problema de fundo

Todos os pesos e fatores do projeto hoje são chutes com bom senso, não
calibração:

- `FATOR_SUBAPOSTA_EMPATE` e `BONUS_TORCIDA_GRANDE` (Fase 3, popularidade)
- `FATOR_REDUCAO` do ajuste de desfalque (Fase 2)
- A regra do otimizador de sempre escolher a maior probabilidade pura como
  pick principal, ignorando o "melhor valor" da Fase 3 (Fase 4)

Sem comparar sugestão vs. resultado real, toda melhoria nesses fatores é
só outro chute — por isso o item P0 abaixo vem antes de tudo.

## P0 — Fechar o loop de validação (base pra tudo mais) ✅ implementado em 2026-09-24

**O quê:** depois que um concurso é apurado (a própria API `servicebus2`
já tem isso, com os placares em `nuGolEquipeUm`/`nuGolEquipeDois`), buscar
o resultado real de cada jogo e comparar contra o que o app sugeriu:
- O pick principal (maior probabilidade) acertou?
- O "melhor valor" (Fase 3) teria sido uma escolha melhor?
- O fechamento (Fase 4b) teria acertado quantos jogos?

**Por quê primeiro:** sem isso, qualquer ajuste nos fatores das Fases 2-4
é só um segundo chute em cima do primeiro. Com histórico acumulado
(mesmo que poucos concursos no início), dá pra saber se `FATOR_SUBAPOSTA_EMPATE
= 0.6` está muito forte/fraco, se o otimizador está priorizando os jogos
certos pra duplo/triplo, etc.

**Como foi implementado:**
- Tabela nova `sugestoes` (`src/db/schema.ts`) guarda um SNAPSHOT fixo no
  tempo do que foi exibido (probabilidade pura/final, popularidade, melhor
  valor, prioridade) no momento em que o relatório rodou — não é
  recalculado depois, senão uma recalibração futura de `ajuste.ts`/
  `popularidade.ts` mudaria retroativamente "o que a gente teria sugerido",
  invalidando a comparação. `salvarSugestoes` é chamada em `index.ts` logo
  depois de `construirRelatorio`.
- Tabela nova `resultados_reais` guarda o placar/resultado real de cada
  jogo, uma vez apurado.
- `fetchResultadoApurado` (`src/data/fixtures.ts`) busca o placar na mesma
  API já usada pra grade (`nuGolEquipeUm`/`nuGolEquipeDois`), lança erro
  claro se o concurso ainda não foi totalmente apurado.
- Comando novo `npm run conferir -- <numero>` (`scripts/conferir.ts`):
  busca o resultado real, salva, e imprime três coisas — comparação jogo a
  jogo (pick principal vs. melhor valor vs. resultado real, com resumo de
  acerto), o fechamento RECONSTRUÍDO a partir da probabilidade salva
  (distribuição de acertos entre os 28 bilhetes — limitação conhecida: usa
  a versão ATUAL de `fechamento.ts`, não necessariamente a que rodou na
  época, já que só a probabilidade fica fixa, não o algoritmo), e um
  histórico acumulado (soma de todos os concursos já conferidos até agora).
- Não persiste métricas derivadas separadamente — `sugestoes` +
  `resultados_reais` já são a fonte da verdade; qualquer métrica é
  recalculada on-the-fly a partir delas, então nunca fica dessincronizada.
- **Ainda sem dado real pra validar**: essa sessão não tinha nenhum
  concurso com sugestão salva E já apurado ao mesmo tempo (o pipeline
  ganhou a tabela `sugestoes` só agora; concursos anteriores — 1270, 1271
  — já estão decididos mas foram coletados antes dessa tabela existir).
  Testado com dados fabricados (script descartável, removido) pra validar
  a lógica; o primeiro uso real só vai acontecer quando o concurso 1272
  (ou o próximo coletado com `npm run dev`) for apurado.
- **Atualização 2026-09-24:** o usuário trouxe uma fonte melhor pro
  resultado apurado — `numerosmegasena.com.br/loteca/<numero>/`, página
  Next.js com os dados prontos em `__NEXT_DATA__` (`result.jogos`). Virou
  a fonte principal (`src/data/numerosMegaSena.ts`), com o endpoint
  `servicebus2` da Caixa como fallback (`fetchResultadoApuradoCaixa`, ex-
  `fetchResultadoApurado` em `fixtures.ts`) — mesmo padrão de fallback já
  usado pras odds. Testado ao vivo: concurso 1272 (não decidido) deu HTTP
  404 na nova fonte vs. HTTP 500 ambíguo na Caixa; concurso 1271 (decidido)
  bateu os 14 placares certinho nas duas fontes. Ver README item 14.
- **Bug encontrado e corrigido em 2026-09-28, graças ao P0 em uso real:**
  o P0 é exatamente pra isso — expôs que "melhor valor" (usado por P1
  abaixo) estava quebrado desde que foi criado, sempre recomendando
  empate em todo jogo. Ver README item 15 pro detalhe matemático (a razão
  bruta `probabilidade/popularidade` cancelava a probabilidade real do
  jogo, sobrando só o fator fixo de sub-aposta de empate — que é sempre o
  menor dos três). Corrigido comparando posição relativa (rank) em vez de
  razão. Esse mesmo teste também expôs um bug operacional sério: rodar
  `npm run dev` de novo pra um concurso já conferido sobrescrevia a
  sugestão salva com odds obsoletas — corrigido com uma trava em
  `salvarSugestoes` (ver README item 16). **Isso é o P0 funcionando como
  deveria** — sem comparar contra resultado real, esse bug de "melhor
  valor" continuaria invisível indefinidamente.

## P1 — Usar o "melhor valor" de verdade na escolha do pick

**O quê:** hoje `otimizador.ts` sempre marca o resultado de maior
probabilidade pura pra cada jogo simples, e o "melhor valor" da Fase 3 fica
só como informação no relatório — não influencia a escolha. Isso é
proposital (documentado em `otimizador.ts`), mas vale revisitar agora que
a cobertura de odds está completa.

**Atualização 2026-09-28:** o "melhor valor" que esse item usaria tinha
um bug sério (sempre recomendava empate — ver P0 acima e README item 15),
agora corrigido. Isso não muda a prioridade deste item (ainda depende de
P0 acumular dado real pra calibrar X/Y abaixo), mas era um bloqueador
oculto — implementar P1 em cima do "melhor valor" quebrado teria herdado
o mesmo problema.

**Por quê:** é a estratégia clássica de bolão — quando dois resultados têm
probabilidade parecida, mas um é bem menos popular, vale trocar pra ele
(mais gente errando o mesmo jogo que você aumenta seu valor relativo caso
acerte).

**Cuidado:** não é "sempre escolher o de melhor valor" — isso pioraria a
taxa de acerto. Precisa de uma regra explícita e documentada, tipo "só troca
o pick se a perda de probabilidade for menor que X pontos percentuais E o
ganho de valor for maior que Y". Os valores de X/Y são outro chute inicial
— por isso esse item deveria vir depois que P0 já tiver alguns concursos de
histórico pra calibrar com dado real, não only vibes.

## Backteste de estratégias de fechamento (2026-09-30)

O usuário perguntou se dava pra ter mudado algo no modelo pra chegar em
13-14 acertos no concurso 1272. Resposta matemática: não, de forma
confiável — com ~56-57% de acerto por jogo (o que o backteste confirmou),
a chance de acertar os 14 ao mesmo tempo é `0.566^14 ≈ 0.03%`. Isso levou
a uma pergunta melhor: em vez de "qual é o melhor palpite", qual
**estrutura de bilhetes** rende mais, dado o mesmo orçamento?

**Dataset:** sem odds históricas pra Loteca, cruzamos `fetchConcursoPorNumero`
(grade oficial de concursos antigos) com odds reais do `football-data.co.uk`
(Brasil Série A + principais ligas europeias, gratuito). Excluímos
concursos com qualquer jogo de seleção (essa fonte não cobre seleção) —
**limitação real, não cosmética**: o concurso 1272 de verdade (que tinha
seleção) teve resultado bem pior (42.9-50%) que a média do backteste
(55-57%), então os números abaixo não generalizam pra Loteca inteira, só
pra semanas dominadas por futebol de clube. Dataset final: 50 concursos,
546 jogos, `backtest/concursos-2026-sem-selecao.json`.

**Estratégias testadas** (`npm run backtest`, `scripts/lab-estrategias.ts`):
favorito puro sem duplo; fechamento atual (pares por ganho marginal);
duplo único (mesmos jogos, sem parear, 7x mais barato); pares por entropia;
pares por diferença P1-P2; pares por "melhor valor". Resultado: 70.0%
(atual) até 71.4% (melhor valor) de acerto médio do melhor bilhete —
diferenças pequenas o bastante (0.3-1.4pp em 50 amostras) pra não trocar o
critério de produção ainda, mas valorável acompanhar com mais dado do P0.

**Achado mais importante — retorno decrescente forte:** testamos cobrir
de 4 até os 14 jogos em pares. Dobrar o orçamento de R$224 (8 jogos) pra
R$444 (14 jogos, o máximo possível nessa estrutura) rendeu só +2.5 pontos
percentuais (70%→72.5%), e **nenhuma configuração, em nenhum orçamento
testado, chegou a 13/14 em nenhum dos 50 concursos**. Cobertura em pares
tem um teto estrutural (nunca cobre o 3º colocado, só cobre até 2 desvios
simultâneos) que dinheiro sozinho não resolve — trocar de formato
(triplos, cobrir 3+ desvios) escalaria exponencialmente em custo pro
mesmo tipo de limitação de fundo (incerteza real do futebol).

## P2 — Odds por casa de apostas, não só "melhor de cada mercado" ✅ feito em 2026-09-23

**O quê:** hoje pegamos a melhor odd de 1, a melhor de X e a melhor de 2 do
odds.show — possivelmente de três casas diferentes. Ótimo pra saber o
melhor preço, mas estatisticamente menos limpo que pegar as três odds de
uma mesma casa (o "viés" de cada casa de apostas se mistura).

**Resolvido:** o widget do odds.show já expõe uma tabela detalhada por
casa (`aria-label="Bet365, 1, odd 2.90"`, formato invertido do trio
"destacado" que já usávamos) — só não estávamos capturando. Agora
`src/data/oddsShow.ts` extrai as duas coisas: o trio "melhor odd" (mantido
só como referência de preço no relatório) e a tabela completa por casa
(`OddsShowJogo.porCasa`, só entram casas com os 3 mercados presentes — na
prática 5 a 7 casas por jogo). `probabilidadesImplicitasMedia`
(`src/probability.ts`) de-viga cada casa individualmente e tira a média
aritmética simples entre elas (sem dado de confiabilidade/liquidez por
casa pra ponderar, média simples é a escolha mais defensável — decisão
confirmada com o usuário). `report.ts` usa isso automaticamente quando
disponível, caindo pro trio único de sempre nos jogos sem essa tabela (ou
nos jogos resolvidos via The Odds API, fallback, que já entrega uma linha
por bookmaker mas o matcher pega só a primeira — ficou de fora do escopo
desse P2, é uma oportunidade parecida pra revisitar depois). O relatório
(console e HTML) agora rotula "prob. implícita (média de N casas)" quando
esse caminho é usado, pra não parecer que é o de-vig direto da odd
"melhor" mostrada ao lado. Testes em `tests/oddsShow.test.ts` (parsing) e
`tests/probability.test.ts` (a média em si).

## P3 — Mais sinais na Fase 2 (além de desfalque por notícia)

**O quê:** hoje só olhamos manchetes recentes via NewsAPI pra desfalques.
Sinais adicionais checáveis e que a arquitetura já suporta encadear (mesmo
padrão de `ajustarProbabilidade`):
- Forma recente (sequência de resultados) de cada time
- Histórico de confrontos diretos
- Fator casa mais robusto que só a odd do mercado

## P4 — Calibrar os chutes da Fase 3 com qualquer dado real disponível

Mesmo sem dado de popularidade real por jogo (não existe publicamente, já
confirmado), dá pra aproximar melhor:
- Trocar a lista fixa `TORCIDAS_GRANDES` por uma pesquisa de torcida real
  (Datafolha/Pluri) em vez de uma lista chutada por mim.
- Usar `listaRateioPremio` (número de acertadores por faixa, que a própria
  API da Caixa já devolve) como sinal agregado indireto — não dá pra saber
  por jogo, mas dá pra inferir se um concurso inteiro foi "fácil" (favoritos
  óbvios) e ajustar a confiança geral da heurística naquela semana.

**Parcialmente feito em 2026-09-23:** o usuário trouxe o histórico
completo de resultados da Loteca (2002-2026, `src/data/historico-loteca.json`).
Não é dado de popularidade (continua sem existir publicamente), mas é
frequência REAL de 1/X/2 — usada como âncora fraca em `popularidade.ts`
(`fatorHistorico`, `INFLUENCIA_HISTORICO = 0.5`). Ainda um chute quanto à
força da âncora, mas pelo menos o valor histórico em si (47.25/26.20/26.55%)
é dado real, não estimativa. Ver README item 7.

## P5 — Teto real de duplos/triplos no otimizador ✅ feito em 2026-09-23

Resolvido: o usuário mandou a tabela de preços oficial completa. O
otimizador respeita o teto exato (`MAX_DUPLOS_POR_TRIPLOS` em
`src/analysis/otimizador.ts`) e classifica cada jogo por rótulo de
prioridade de upgrade (ranking relativo por posição — os 4 primeiros
"Prioridade Alta", os próximos 4 "Prioridade Média", resto "Não vale
upgrade"). Esse rótulo continua sendo a base do Fechamento (abaixo).

**Atualização 2026-09-23 (mesmo dia):** o relatório de múltiplos cenários
de orçamento (`ORCAMENTOS_REAIS`, `otimizarCartao`, `simularCartao`) foi
removido do relatório a pedido do usuário — o Fechamento cobre mais
cenários e ele decidiu apostar só nele. O código ficou no repositório
(não foi deletado), só parou de ser chamado por `src/index.ts`. Ver
README, itens 8-9 dos "Pontos de atenção".

## P6 — Testes automatizados

**Começado em 2026-09-23.** `npm test` roda o test runner nativo do Node
(`node:test`, zero dependência nova) sobre `probability.ts`, `historico.ts`,
`popularidade.ts`, `otimizador.ts` e `fechamento.ts` (26 casos, ver pasta
`tests/`) — cobre a de-vigagem de odds, a âncora histórica nova, a
classificação de prioridade por posição relativa (inclusive um teste que
prova que é por ranking e não por limiar fixo, comparando rodada
equilibrada vs. cheia de favoritos óbvios), o teto oficial de
duplos/triplos (inclusive com orçamento artificialmente alto, confirmando
que quem limita é a tabela oficial e não o dinheiro) e a construção do
fechamento (cobertura de pares sem repetir nem faltar nenhuma combinação).
`tests/helpers.ts` tem um gerador de jogos sintéticos com ganho marginal
controlado, reutilizável pelos dois arquivos. Ainda falta `ajuste.ts`
(Fase 2, ajuste por desfalque) — próximo candidato.

## Modelo quantitativo de terceiros (avaliado em 2026-09-23)

O usuário trouxe um "modelo quantitativo" com 9 pilares gerado por outra
IA (Poisson+Elo, entropia de Shannon com limiar fixo, filtragem
combinatória, fechamento por covering design, Kelly Criterion etc.),
código TypeScript incluído. Avaliação (detalhada no README, item 10):

- Tinha um bug real e confirmado (`self.rawOdds = ...`, não compila —
  `self` não existe no Node.js) — sinal de que o código nunca rodou.
- Vários pilares já fazíamos (de-vigging, EV vs. popularidade) ou já
  tínhamos decidido evitar por bom motivo (entropia com limiar fixo é
  pior que o ranking relativo por posição que já implementamos).
- Poisson+Elo ficou fora de escopo — precisa de fonte de dados históricos
  que não temos.
- O que sobreviveu e foi implementado: **simulação de Monte Carlo**
  (`src/analysis/monteCarlo.ts`) — estima a chance de acerto do cartão
  sugerido simulando N rodadas com a probabilidade que o próprio modelo
  calculou. Não é validação externa (não substitui o P0), é uma leitura
  estatística do que o modelo já acha.
- **"Fechamento combinatório"** também foi implementado
  (`src/analysis/fechamento.ts`), mas corrigindo um erro sério do exemplo
  original: a outra IA alegava "100% de chance de 13 acertos", que na
  verdade é uma garantia combinatória CONDICIONAL (só vale se os jogos
  "secos" acertarem) sendo apresentada como se fosse a probabilidade real
  de ganhar — não é a mesma coisa, e a diferença importa muito num
  contexto de dinheiro real. Nossa versão cobre pares de jogos de
  "Prioridade Alta/Média" desviando ao mesmo tempo (2 duplos por bilhete)
  — no concurso 1272 deu 28 bilhetes (C(8,2)) por R$224, escala parecida
  com o exemplo original (29 bilhetes, R$116). Mostra a chance real via
  `simularFechamento` (Monte Carlo do conjunto de bilhetes, pegando o
  melhor bilhete por rodada simulada) — mesmo cobrindo pares de desvios
  simultâneos, essa chance real ficou abaixo de 1%, bem longe do "100%"
  original.

## Por onde eu começaria

**P0 está implementado, falta só dado real acumular.** Rode
`npm run conferir -- <numero>` toda vez que um concurso coletado com
`npm run dev` for apurado — cada execução acumula mais uma linha de
histórico real pra eventualmente calibrar P1/P4 com dado de verdade em
vez de mais um chute. P2, P5, P6 e a simulação de Monte Carlo já estão
feitos. P3 é incremental e pode vir em paralelo.
