import { ajustarProbabilidade } from "./analysis/ajuste.js";
import { estimarPopularidade } from "./analysis/popularidade.js";
import { classificarPrioridade } from "./analysis/otimizador.js";
import type { PrioridadeUpgrade, Resultado } from "./analysis/otimizador.js";
import { probabilidadesImplicitas, probabilidadesImplicitasMedia } from "./probability.js";
import type {
  DesfalqueAnalise,
  JogoComOdds,
  OddsJogo,
  PopularidadeEstimada,
  ProbabilidadePura,
} from "./types.js";

/** Dados já calculados de um jogo, prontos pra exibição (console ou HTML). */
export interface JogoRelatorio {
  sequencial: number;
  equipeCasa: string;
  equipeVisitante: string;
  matchConfidence: number;
  odds: OddsJogo | null;
  probabilidadePura: ProbabilidadePura | null;
  probabilidadeFinal: ProbabilidadePura | null;
  desfalques: [DesfalqueAnalise, DesfalqueAnalise] | null;
  popularidade: PopularidadeEstimada | null;
  melhorValor: { resultado: Resultado; valor: number } | null;
  /** Prioridade de upgrade (duplo/triplo) relativa aos outros jogos da semana — ver `classificarPrioridade`. */
  prioridade: PrioridadeUpgrade | null;
}

/**
 * Calcula tudo que os dois formatos de saída (console e HTML) precisam,
 * uma única vez, pra eles não recalcularem probabilidade/ajuste/popularidade
 * cada um por conta própria.
 */
export function construirRelatorio(
  jogosComOdds: JogoComOdds[],
  desfalquesPorSequencial: Map<number, DesfalqueAnalise[]>
): JogoRelatorio[] {
  const semPrioridade = jogosComOdds.map((item) => {
    const base: Omit<JogoRelatorio, "prioridade"> = {
      sequencial: item.jogo.sequencial,
      equipeCasa: item.jogo.equipeCasa,
      equipeVisitante: item.jogo.equipeVisitante,
      matchConfidence: item.matchConfidence,
      odds: item.odds,
      probabilidadePura: null,
      probabilidadeFinal: null,
      desfalques: null,
      popularidade: null,
      melhorValor: null,
    };

    if (!item.odds) return base;

    // Quando a fonte expõe odds por casa (hoje só o odds.show), de-viga cada
    // casa individualmente e tira a média — mais limpo estatisticamente que
    // misturar a melhor odd de cada mercado (P2, ver probability.ts). Sem
    // isso (ex: fallback via The Odds API), cai pro trio único de sempre.
    const probabilidadePura =
      item.odds.porCasa && item.odds.porCasa.length > 0
        ? probabilidadesImplicitasMedia(item.odds.porCasa)
        : probabilidadesImplicitas(item.odds.oddCasa, item.odds.oddEmpate, item.odds.oddVisitante);
    let probabilidadeFinal = probabilidadePura;
    let desfalques: [DesfalqueAnalise, DesfalqueAnalise] | null = null;

    const analises = desfalquesPorSequencial.get(item.jogo.sequencial);
    if (analises && analises.length === 2 && (analises[0].impacto !== "nenhum" || analises[1].impacto !== "nenhum")) {
      probabilidadeFinal = ajustarProbabilidade(probabilidadePura, analises[0].impacto, analises[1].impacto);
      desfalques = [analises[0], analises[1]];
    }

    const popularidade = estimarPopularidade(probabilidadeFinal, item.jogo);
    const melhorValor = calcularMelhorValor(probabilidadeFinal, popularidade);

    return { ...base, probabilidadePura, probabilidadeFinal, desfalques, popularidade, melhorValor };
  });

  // Prioridade é relativa entre todos os jogos com probabilidade calculada,
  // então só dá pra classificar depois de ter o probabilidadeFinal de todos.
  const prioridades = classificarPrioridade(
    semPrioridade
      .filter((j): j is typeof j & { probabilidadeFinal: ProbabilidadePura } => Boolean(j.probabilidadeFinal))
      .map((j) => ({
        sequencial: j.sequencial,
        equipeCasa: j.equipeCasa,
        equipeVisitante: j.equipeVisitante,
        probabilidade: j.probabilidadeFinal,
      }))
  );

  return semPrioridade.map((j) => ({ ...j, prioridade: prioridades.get(j.sequencial) ?? null }));
}

const RESULTADOS: Resultado[] = ["casa", "empate", "visitante"];

/** Ordena os 3 resultados por probabilidade decrescente e devolve o rank de cada um (0 = mais provável). */
function rankPorResultado(dist: ProbabilidadePura): Record<Resultado, number> {
  const ordenado = [...RESULTADOS].sort((a, b) => dist[b] - dist[a]);
  const rank = {} as Record<Resultado, number>;
  ordenado.forEach((resultado, indice) => {
    rank[resultado] = indice;
  });
  return rank;
}

/**
 * "Melhor valor" = o resultado que a probabilidade REAL considera mais
 * provável do que a popularidade estimada sugere — ou seja, o resultado
 * que sobe de posição (rank) saindo da popularidade pra probabilidade.
 *
 * IMPORTANTE: isso não pode ser feito comparando a razão bruta
 * `probabilidade / popularidade` (versão anterior, com bug confirmado
 * contra dado real em 2026-09-28 — ver README). Como
 * `popularidade.X = probabilidade.X × fatorX / soma` (ver popularidade.ts),
 * a razão sempre se simplifica pra `soma / fatorX`: o `probabilidade.X` do
 * numerador CANCELA com o do denominador, sobrando só os fatores fixos
 * (torcida grande, âncora histórica, sub-aposta de empate). Como o fator
 * do empate é sempre o menor de todos os três, `soma / fatorEmpate` é
 * sempre o maior — ou seja, a razão bruta sempre escolhia "empate",
 * ignorando completamente o jogo real. Comparar por RANK evita isso: o
 * rank de cada resultado dentro de uma distribuição não é afetado pela
 * escala dos fatores, só pela ordem — então o resultado escolhido varia
 * de verdade conforme o jogo.
 */
export function calcularMelhorValor(
  probabilidade: ProbabilidadePura,
  popularidade: ProbabilidadePura
): { resultado: Resultado; valor: number } {
  const rankProbabilidade = rankPorResultado(probabilidade);
  const rankPopularidade = rankPorResultado(popularidade);

  const candidatos = RESULTADOS.map((resultado) => ({
    resultado,
    // positivo = a probabilidade real acha esse resultado mais provável do que a popularidade estimada sugere
    ganhoDeRank: rankPopularidade[resultado] - rankProbabilidade[resultado],
    valor: probabilidade[resultado] / popularidade[resultado],
  }));

  return candidatos.reduce((melhor, atual) => {
    if (atual.ganhoDeRank > melhor.ganhoDeRank) return atual;
    // Empate no ganho de rank (comum: nenhum resultado "subiu de posição") —
    // desempata pelo favorito real, não pela razão bruta (isso reintroduziria o bug).
    if (atual.ganhoDeRank === melhor.ganhoDeRank && probabilidade[atual.resultado] > probabilidade[melhor.resultado]) {
      return atual;
    }
    return melhor;
  });
}
