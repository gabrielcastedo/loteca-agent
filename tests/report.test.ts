import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularMelhorValor } from "../src/report.js";
import { estimarPopularidade } from "../src/analysis/popularidade.js";
import type { ProbabilidadePura } from "../src/types.js";

/**
 * Regressão do bug confirmado contra dado real (concurso 1272,
 * 2026-09-28): a versão antiga de `calcularMelhorValor` comparava a razão
 * bruta `probabilidade / popularidade`, que sempre se simplificava pra
 * `soma / fatorDoResultado` — cancelando a probabilidade real do jogo e
 * sobrando só os fatores fixos de `popularidade.ts`. Como o fator do
 * empate é sempre o menor dos três, "melhor valor" era sempre "empate",
 * em TODOS os jogos, sempre — confirmado nos 14 jogos do concurso 1272.
 */

const TIME_SEM_TORCIDA = { equipeCasa: "TIME A", equipeVisitante: "TIME B" };

test("calcularMelhorValor: quando a popularidade não inverte a ordem, escolhe o favorito real (não sempre empate)", () => {
  // Ordem idêntica nas duas distribuições (casa > empate > visitante) —
  // não há "valor" de verdade aqui, o favorito real deveria vencer.
  const probabilidade: ProbabilidadePura = { casa: 0.5, empate: 0.3, visitante: 0.2 };
  const popularidade: ProbabilidadePura = { casa: 0.7, empate: 0.2, visitante: 0.1 };

  const resultado = calcularMelhorValor(probabilidade, popularidade);
  assert.equal(resultado.resultado, "casa");
});

test("calcularMelhorValor: ainda escolhe empate quando ele É genuinamente subestimado pela popularidade (caso legítimo)", () => {
  // Popularidade empurra empate pra último (era 2º na probabilidade real) —
  // aqui empate vencer é o comportamento CORRETO, não o bug.
  const probabilidade: ProbabilidadePura = { casa: 0.34, empate: 0.33, visitante: 0.33 };
  const popularidade: ProbabilidadePura = { casa: 0.5, empate: 0.1, visitante: 0.4 };

  const resultado = calcularMelhorValor(probabilidade, popularidade);
  assert.equal(resultado.resultado, "empate");
});

test("calcularMelhorValor: escolhe visitante quando é ele que sobe de posição da popularidade pra probabilidade real", () => {
  const probabilidade: ProbabilidadePura = { casa: 0.4, empate: 0.25, visitante: 0.35 };
  const popularidade: ProbabilidadePura = { casa: 0.6, empate: 0.15, visitante: 0.25 }; // mesma ordem casa>visitante>empate nas duas — sem inversão, favorito vence
  const resultadoSemInversao = calcularMelhorValor(probabilidade, popularidade);
  assert.equal(resultadoSemInversao.resultado, "casa");

  // Agora com popularidade colocando visitante em último (pior que na probabilidade real, que o tinha em 2º) —
  // isso SOBE o rank de visitante indo da popularidade pra probabilidade, deveria vencer.
  const popularidadeComInversao: ProbabilidadePura = { casa: 0.6, empate: 0.25, visitante: 0.15 };
  const resultadoComInversao = calcularMelhorValor(probabilidade, popularidadeComInversao);
  assert.equal(resultadoComInversao.resultado, "visitante");
});

test("calcularMelhorValor: empate no ganho de rank desempata pelo favorito real, não pela razão bruta", () => {
  // Nenhum resultado muda de posição (mesma ordem nas duas distribuições) —
  // ganhoDeRank = 0 pros 3. Antes do fix, a razão bruta escolheria sempre
  // empate aqui; agora deve desempatar pelo de maior probabilidade real.
  const probabilidade: ProbabilidadePura = { casa: 0.2, empate: 0.35, visitante: 0.45 };
  const popularidade: ProbabilidadePura = { casa: 0.1, empate: 0.3, visitante: 0.6 };

  const resultado = calcularMelhorValor(probabilidade, popularidade);
  assert.equal(resultado.resultado, "visitante");
});

test("regressão: com a popularidade real (popularidade.ts), melhor valor NÃO é sempre empate numa amostra variada de jogos", () => {
  const cenarios: ProbabilidadePura[] = [
    { casa: 0.7, empate: 0.18, visitante: 0.12 }, // favorito claro em casa
    { casa: 0.12, empate: 0.18, visitante: 0.7 }, // favorito claro em visitante
    { casa: 0.38, empate: 0.3, visitante: 0.32 }, // jogo equilibrado
    { casa: 0.55, empate: 0.25, visitante: 0.2 },
    { casa: 0.2, empate: 0.25, visitante: 0.55 },
    { casa: 0.45, empate: 0.28, visitante: 0.27 },
  ];

  const resultados = cenarios.map((p) => {
    const popularidade = estimarPopularidade(p, TIME_SEM_TORCIDA);
    return calcularMelhorValor(p, popularidade).resultado;
  });

  const distintos = new Set(resultados);
  assert.ok(
    distintos.size > 1,
    `esperava resultados variados, mas todos vieram iguais (${resultados.join(", ")}) — sinal do bug antigo de volta`
  );
  // O bug antigo especificamente sempre escolhia "empate" — confirma que isso não domina mais sozinho.
  assert.ok(resultados.some((r) => r !== "empate"), "pelo menos um cenário deveria escolher algo diferente de empate");
});

test("calcularMelhorValor: valor retornado é sempre positivo e o resultado é um dos três válidos", () => {
  const probabilidade: ProbabilidadePura = { casa: 0.33, empate: 0.34, visitante: 0.33 };
  const popularidade = estimarPopularidade(probabilidade, TIME_SEM_TORCIDA);
  const resultado = calcularMelhorValor(probabilidade, popularidade);

  assert.ok(resultado.valor > 0);
  assert.ok(["casa", "empate", "visitante"].includes(resultado.resultado));
});
