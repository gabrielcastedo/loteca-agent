import type { NivelImpacto, ProbabilidadePura } from "../types.js";

/**
 * Fatores de redução aplicados ao peso do time com desfalque, antes de
 * renormalizar. São um chute inicial — ajuste conforme validar resultados
 * reais concurso a concurso (não há como calibrar isso sem histórico).
 */
const FATOR_REDUCAO: Record<NivelImpacto, number> = {
  nenhum: 0,
  baixo: 0.05,
  medio: 0.12,
  alto: 0.25,
};

/**
 * Ajusta a probabilidade implícita pura aplicando uma redução proporcional
 * ao peso de cada time com desfalque, redistribuindo a massa liberada pros
 * outros dois resultados via renormalização (a soma continua 1).
 */
export function ajustarProbabilidade(
  pura: ProbabilidadePura,
  impactoCasa: NivelImpacto,
  impactoVisitante: NivelImpacto
): ProbabilidadePura {
  const pesoCasa = pura.casa * (1 - FATOR_REDUCAO[impactoCasa]);
  const pesoVisitante = pura.visitante * (1 - FATOR_REDUCAO[impactoVisitante]);
  const pesoEmpate = pura.empate;

  const soma = pesoCasa + pesoEmpate + pesoVisitante;

  return {
    casa: pesoCasa / soma,
    empate: pesoEmpate / soma,
    visitante: pesoVisitante / soma,
  };
}
