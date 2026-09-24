import type { OddsPorCasa, ProbabilidadePura } from "./types.js";

/** Remove o overround (margem da casa) das odds decimais, retornando probabilidades que somam 100%. */
export function probabilidadesImplicitas(
  oddCasa: number,
  oddEmpate: number,
  oddVisitante: number
): ProbabilidadePura {
  const bruta = { casa: 1 / oddCasa, empate: 1 / oddEmpate, visitante: 1 / oddVisitante };
  const soma = bruta.casa + bruta.empate + bruta.visitante;
  return {
    casa: bruta.casa / soma,
    empate: bruta.empate / soma,
    visitante: bruta.visitante / soma,
  };
}

/**
 * Versão "limpa" da probabilidade implícita: em vez de montar um trio com a
 * melhor odd de cada mercado (que pode vir de até 3 casas diferentes,
 * misturando o overround/viés de cada uma — ver P2 em `plano-melhorias.md`),
 * de-viga as odds de CADA casa individualmente e tira a média simples das
 * probabilidades resultantes. Cada casa continua representando sua própria
 * visão consistente do jogo; só a agregação final é uma média entre elas.
 *
 * Sem dado de confiabilidade/liquidez por casa pra ponderar, média simples é
 * a escolha mais defensável. `oddsPorCasa` vazio lança erro — o chamador
 * deve cair pro trio "melhor odd" (`probabilidadesImplicitas`) nesse caso.
 */
export function probabilidadesImplicitasMedia(oddsPorCasa: OddsPorCasa[]): ProbabilidadePura {
  if (oddsPorCasa.length === 0) {
    throw new Error("probabilidadesImplicitasMedia precisa de pelo menos 1 casa com odds completas.");
  }

  const porCasa = oddsPorCasa.map((o) => probabilidadesImplicitas(o.oddCasa, o.oddEmpate, o.oddVisitante));

  const soma = porCasa.reduce(
    (acc, p) => ({ casa: acc.casa + p.casa, empate: acc.empate + p.empate, visitante: acc.visitante + p.visitante }),
    { casa: 0, empate: 0, visitante: 0 }
  );

  return {
    casa: soma.casa / porCasa.length,
    empate: soma.empate / porCasa.length,
    visitante: soma.visitante / porCasa.length,
  };
}
