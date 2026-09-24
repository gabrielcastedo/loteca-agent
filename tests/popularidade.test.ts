import { test } from "node:test";
import assert from "node:assert/strict";
import { estimarPopularidade } from "../src/analysis/popularidade.js";
import type { ProbabilidadePura } from "../src/types.js";

const TIME_PEQUENO_A = { equipeCasa: "OPERARIO", equipeVisitante: "CEARA" };

function somaUm(p: ProbabilidadePura): boolean {
  return Math.abs(p.casa + p.empate + p.visitante - 1) < 1e-9;
}

test("popularidade sempre soma 1 (é uma distribuição, igual a probabilidade)", () => {
  const p = estimarPopularidade({ casa: 0.4, empate: 0.3, visitante: 0.3 }, TIME_PEQUENO_A);
  assert.ok(somaUm(p));
});

test("empate é sub-apostado: popularidade do X cai proporcionalmente mais que a probabilidade real", () => {
  const probabilidade: ProbabilidadePura = { casa: 0.35, empate: 0.35, visitante: 0.3 };
  const popularidade = estimarPopularidade(probabilidade, TIME_PEQUENO_A);
  // Mesmo com probabilidade real igual entre casa e empate, a popularidade do
  // empate deve ficar visivelmente menor que a da casa.
  assert.ok(popularidade.empate < popularidade.casa);
  assert.ok(popularidade.empate < probabilidade.empate);
});

test("time de torcida grande recebe popularidade extra (mandante)", () => {
  const probabilidade: ProbabilidadePura = { casa: 0.4, empate: 0.3, visitante: 0.3 };
  const comTimeGrande = estimarPopularidade(probabilidade, { equipeCasa: "FLAMENGO", equipeVisitante: "CEARA" });
  const semTimeGrande = estimarPopularidade(probabilidade, TIME_PEQUENO_A);

  assert.ok(comTimeGrande.casa > semTimeGrande.casa);
});

test("time de torcida grande recebe popularidade extra (visitante), mesmo sendo azarão", () => {
  const probabilidade: ProbabilidadePura = { casa: 0.5, empate: 0.3, visitante: 0.2 };
  const comTimeGrande = estimarPopularidade(probabilidade, { equipeCasa: "OPERARIO", equipeVisitante: "FLAMENGO" });
  const semTimeGrande = estimarPopularidade(probabilidade, TIME_PEQUENO_A);

  assert.ok(comTimeGrande.visitante > semTimeGrande.visitante);
});

test("nomes de time com acento/caixa diferente ainda são reconhecidos como torcida grande", () => {
  const probabilidade: ProbabilidadePura = { casa: 0.4, empate: 0.3, visitante: 0.3 };
  const comAcento = estimarPopularidade(probabilidade, { equipeCasa: "são paulo", equipeVisitante: "CEARA" });
  const semTimeGrande = estimarPopularidade(probabilidade, TIME_PEQUENO_A);

  assert.ok(comAcento.casa > semTimeGrande.casa);
});

test("âncora histórica: com probabilidade neutra (1/3 cada) e sem torcida grande, mandante ainda sai na frente", () => {
  // Sem nenhum outro sinal (probabilidade real igual, nenhum time grande),
  // a única coisa que deveria desempatar é a âncora na taxa histórica real
  // (mandante ganha mais que empate/visitante historicamente).
  const p = estimarPopularidade({ casa: 1 / 3, empate: 1 / 3, visitante: 1 / 3 }, TIME_PEQUENO_A);
  assert.ok(p.casa > p.visitante);
  assert.ok(p.casa > p.empate);
});
