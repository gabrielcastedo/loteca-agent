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

## P0 — Fechar o loop de validação (base pra tudo mais)

**O quê:** depois que um concurso é apurado (a própria API `servicebus2`
já tem isso, com os placares em `nuGolEquipeUm`/`nuGolEquipeDois`), buscar
o resultado real de cada jogo e comparar contra o que o app sugeriu:
- O pick principal (maior probabilidade) acertou?
- O "melhor valor" (Fase 3) teria sido uma escolha melhor?
- O cartão sugerido (Fase 4) teria acertado quantos jogos?

**Por quê primeiro:** sem isso, qualquer ajuste nos fatores das Fases 2-4
é só um segundo chute em cima do primeiro. Com histórico acumulado
(mesmo que poucos concursos no início), dá pra saber se `FATOR_SUBAPOSTA_EMPATE
= 0.6` está muito forte/fraco, se o otimizador está priorizando os jogos
certos pra duplo/triplo, etc.

**Como:** uma tabela nova (`resultados`) + um comando separado
(`npm run conferir <numero>`) que busca o concurso já apurado, compara com
o que foi salvo no banco na época, e imprime/persiste as métricas de acerto.

## P1 — Usar o "melhor valor" de verdade na escolha do pick

**O quê:** hoje `otimizador.ts` sempre marca o resultado de maior
probabilidade pura pra cada jogo simples, e o "melhor valor" da Fase 3 fica
só como informação no relatório — não influencia a escolha. Isso é
proposital (documentado em `otimizador.ts`), mas vale revisitar agora que
a cobertura de odds está completa.

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

## P2 — Odds por casa de apostas, não só "melhor de cada mercado"

**O quê:** hoje pegamos a melhor odd de 1, a melhor de X e a melhor de 2 do
odds.show — possivelmente de três casas diferentes. Ótimo pra saber o
melhor preço, mas estatisticamente menos limpo que pegar as três odds de
uma mesma casa (o "viés" de cada casa de apostas se mistura).

**O quê fazer:** se o odds.show expuser odds por casa individualmente (não
só a melhor), calcular probabilidade implícita a partir de uma média
ponderada entre casas, ou pelo menos guardar os dados brutos por casa pra
permitir isso depois.

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

**P0 continua a prioridade.** Todo o resto (P1, P4) depende de ter dado
real pra calibrar em vez de mais um chute. P2 e P3 são incrementais e
podem vir em paralelo, sem depender de P0. P5 e a simulação de Monte
Carlo já estão feitos. P6 vale ir fazendo conforme mexer em cada módulo,
não como um projeto à parte.
