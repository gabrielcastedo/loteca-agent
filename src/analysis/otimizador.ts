import type { ProbabilidadePura } from "../types.js";

export type TipoAposta = "simples" | "duplo" | "triplo";
export type Resultado = "casa" | "empate" | "visitante";
export type PrioridadeUpgrade = "alta" | "media" | "nenhuma";

export interface JogoParaOtimizar {
  sequencial: number;
  equipeCasa: string;
  equipeVisitante: string;
  probabilidade: ProbabilidadePura;
}

export interface AlocacaoJogo {
  sequencial: number;
  equipeCasa: string;
  equipeVisitante: string;
  tipo: TipoAposta;
  marcacoes: Resultado[]; // ordenadas da maior pra menor probabilidade
}

export interface ResultadoOtimizacao {
  alocacoes: AlocacaoJogo[];
  totalCombinacoes: number;
  custoReais: number;
}

/** Um cartão sugerido calculado pra um orçamento específico (ver `index.ts`, múltiplos cenários). */
export interface CenarioCartao {
  orcamentoReais: number;
  cartao: ResultadoOtimizacao | null;
}

const PRECO_POR_COMBINACAO = 2;
const APOSTA_MINIMA_REAIS = 4;

/**
 * Teto oficial de duplos por quantidade de triplos, direto da tabela de
 * preços real da Loteca (o usuário mandou a tabela completa em
 * 2026-09-23). Fórmula de combinações (`2^duplos × 3^triplos`) já estava
 * certa; o que faltava era esse teto — antes o otimizador não impunha
 * nenhum limite de quantidade, só de orçamento.
 */
const MAX_DUPLOS_POR_TRIPLOS: Record<number, number> = {
  0: 9,
  1: 8,
  2: 6,
  3: 5,
  4: 3,
  5: 1,
  6: 0,
};
const MAX_TRIPLOS = 6;

/** Quantos jogos entram em cada faixa de prioridade de upgrade (ver `classificarPrioridade`). */
const QTD_PRIORIDADE_ALTA = 4;
const QTD_PRIORIDADE_MEDIA = 4;

const QTD_MARCACOES: Record<TipoAposta, number> = { simples: 1, duplo: 2, triplo: 3 };

interface RankingJogo {
  jogo: JogoParaOtimizar;
  ordenado: Array<{ resultado: Resultado; prob: number }>;
}

interface CandidatoUpgrade {
  para: TipoAposta;
  ganho: number; // probabilidade adicional capturada ao aplicar o upgrade
  fatorIncremento: number; // quanto o total de combinações multiplica (2 ou 1.5)
}

function construirRanking(jogos: JogoParaOtimizar[]): RankingJogo[] {
  return jogos.map((jogo) => ({
    jogo,
    ordenado: (["casa", "empate", "visitante"] as Resultado[])
      .map((resultado) => ({ resultado, prob: jogo.probabilidade[resultado] }))
      .sort((a, b) => b.prob - a.prob),
  }));
}

function combinacoesValidas(duplos: number, triplos: number): boolean {
  if (triplos > MAX_TRIPLOS || triplos < 0 || duplos < 0) return false;
  return duplos <= MAX_DUPLOS_POR_TRIPLOS[triplos];
}

/**
 * Classifica cada jogo por prioridade de upgrade (duplo/triplo), ordenando
 * pelo "ganho marginal" de virar duplo (a probabilidade do 2º colocado —
 * é a mesma pontuação que `otimizarCartao` usa internamente pra decidir
 * onde gastar) e rotulando por posição relativa, não por um limiar fixo:
 * os `QTD_PRIORIDADE_ALTA` primeiros da fila = "alta", os próximos
 * `QTD_PRIORIDADE_MEDIA` = "media", o resto = "nenhuma".
 *
 * Isso é independente de orçamento — funciona igual numa semana em que
 * a rodada inteira está equilibrada ou numa em que está cheia de
 * favoritos óbvios, porque é sempre relativo aos outros jogos daquela
 * semana. Serve como explicação do que `otimizarCartao` provavelmente vai
 * priorizar, não uma garantia — o resultado final ainda depende do
 * orçamento e do teto oficial de duplos/triplos.
 */
export function classificarPrioridade(jogos: JogoParaOtimizar[]): Map<number, PrioridadeUpgrade> {
  const ranking = construirRanking(jogos)
    .map((r) => ({ sequencial: r.jogo.sequencial, ganhoMarginal: r.ordenado[1].prob }))
    .sort((a, b) => b.ganhoMarginal - a.ganhoMarginal);

  const resultado = new Map<number, PrioridadeUpgrade>();
  ranking.forEach((item, indice) => {
    const prioridade: PrioridadeUpgrade =
      indice < QTD_PRIORIDADE_ALTA
        ? "alta"
        : indice < QTD_PRIORIDADE_ALTA + QTD_PRIORIDADE_MEDIA
          ? "media"
          : "nenhuma";
    resultado.set(item.sequencial, prioridade);
  });

  return resultado;
}

/**
 * Aloca duplos/triplos entre os jogos disponíveis (com probabilidade já
 * calculada) pra maximizar a cobertura de probabilidade dentro de um
 * orçamento em reais, respeitando o teto oficial de duplos/triplos da
 * Loteca.
 *
 * Algoritmo guloso: a cada passo, escolhe o upgrade (simples→duplo ou
 * duplo→triplo, em qualquer jogo) com maior "ganho de probabilidade por
 * unidade de orçamento combinatório gasto" (log2 do fator de multiplicação),
 * entre os que ainda cabem no orçamento E no teto oficial, e aplica.
 * Repete até não caber mais nenhum upgrade. É a mesma pontuação exposta
 * de forma legível por `classificarPrioridade`.
 *
 * Isso NÃO é uma otimização exata — o custo é multiplicativo (2^duplos ×
 * 3^triplos), então o problema é uma mochila não-linear sem solução
 * gulosa provadamente ótima. É uma heurística simples e auditável,
 * suficiente pro objetivo do projeto (ver `simples`-first: a escolha
 * principal de cada jogo é sempre o resultado de maior probabilidade real,
 * não o de melhor "valor" da Fase 3 — misturar os dois objetivos exigiria
 * dado de popularidade real que não temos, ver `popularidade.ts`).
 *
 * Jogos sem probabilidade calculada (sem odds) devem ser filtrados pelo
 * chamador antes de passar pra esta função — ficam de fora do cartão
 * otimizado e precisam de escolha manual.
 */
export function otimizarCartao(jogos: JogoParaOtimizar[], orcamentoReais: number): ResultadoOtimizacao {
  if (orcamentoReais < APOSTA_MINIMA_REAIS) {
    throw new Error(
      `Orçamento de R$${orcamentoReais.toFixed(2)} é menor que a aposta mínima da Loteca (R$${APOSTA_MINIMA_REAIS.toFixed(2)}).`
    );
  }

  const maxCombinacoes = Math.floor(orcamentoReais / PRECO_POR_COMBINACAO);
  const rankings = construirRanking(jogos);

  const tipos: TipoAposta[] = rankings.map(() => "simples");
  let duplos = 0;
  let triplos = 0;

  const combinacoes = (d: number, t: number) => 2 ** d * 3 ** t;

  function proximoCandidato(indice: number): CandidatoUpgrade | null {
    const tipo = tipos[indice];
    const ranking = rankings[indice].ordenado;
    if (tipo === "simples") {
      return { para: "duplo", ganho: ranking[1].prob, fatorIncremento: 2 };
    }
    if (tipo === "duplo") {
      return { para: "triplo", ganho: ranking[2].prob, fatorIncremento: 1.5 };
    }
    return null;
  }

  while (true) {
    let melhorIndice = -1;
    let melhorScore = -Infinity;
    let melhorDuplos = duplos;
    let melhorTriplos = triplos;
    let melhorPara: TipoAposta = "simples";

    for (let i = 0; i < tipos.length; i++) {
      const candidato = proximoCandidato(i);
      if (!candidato) continue;

      const novoDuplos = candidato.para === "duplo" ? duplos + 1 : duplos - 1;
      const novoTriplos = candidato.para === "triplo" ? triplos + 1 : triplos;
      if (combinacoes(novoDuplos, novoTriplos) > maxCombinacoes) continue;
      if (!combinacoesValidas(novoDuplos, novoTriplos)) continue;

      const score = candidato.ganho / Math.log2(candidato.fatorIncremento);
      if (score > melhorScore) {
        melhorScore = score;
        melhorIndice = i;
        melhorDuplos = novoDuplos;
        melhorTriplos = novoTriplos;
        melhorPara = candidato.para;
      }
    }

    if (melhorIndice === -1) break;

    tipos[melhorIndice] = melhorPara;
    duplos = melhorDuplos;
    triplos = melhorTriplos;
  }

  const alocacoes: AlocacaoJogo[] = rankings.map((r, i) => ({
    sequencial: r.jogo.sequencial,
    equipeCasa: r.jogo.equipeCasa,
    equipeVisitante: r.jogo.equipeVisitante,
    tipo: tipos[i],
    marcacoes: r.ordenado.slice(0, QTD_MARCACOES[tipos[i]]).map((o) => o.resultado),
  }));

  const totalCombinacoes = combinacoes(duplos, triplos);

  return {
    alocacoes,
    totalCombinacoes,
    custoReais: totalCombinacoes * PRECO_POR_COMBINACAO,
  };
}
