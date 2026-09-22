import { ajustarProbabilidade } from "./analysis/ajuste.js";
import { estimarPopularidade } from "./analysis/popularidade.js";
import type { Resultado } from "./analysis/otimizador.js";
import { probabilidadesImplicitas } from "./probability.js";
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
  return jogosComOdds.map((item) => {
    const base: JogoRelatorio = {
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

    const probabilidadePura = probabilidadesImplicitas(
      item.odds.oddCasa,
      item.odds.oddEmpate,
      item.odds.oddVisitante
    );
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
}

function calcularMelhorValor(
  probabilidade: ProbabilidadePura,
  popularidade: ProbabilidadePura
): { resultado: Resultado; valor: number } {
  const opcoes: Array<{ resultado: Resultado; valor: number }> = [
    { resultado: "casa", valor: probabilidade.casa / popularidade.casa },
    { resultado: "empate", valor: probabilidade.empate / popularidade.empate },
    { resultado: "visitante", valor: probabilidade.visitante / popularidade.visitante },
  ];
  return opcoes.reduce((a, b) => (b.valor > a.valor ? b : a));
}
