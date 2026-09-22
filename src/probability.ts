import type { ProbabilidadePura } from "./types.js";

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
