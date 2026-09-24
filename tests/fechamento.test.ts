import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarFechamento } from "../src/analysis/fechamento.js";
import { jogosComPrioridadePrevisivel } from "./helpers.js";

test("gerarFechamento: com menos de 2 jogos de risco, não gera bilhete nenhum", () => {
  const semJogos = gerarFechamento([]);
  assert.deepEqual(semJogos, { bilhetes: [], custoTotalReais: 0, jogosDeRiscoSequenciais: [] });

  const umJogo = gerarFechamento(jogosComPrioridadePrevisivel(1, 0.5, 0.46, 0.3));
  assert.equal(umJogo.bilhetes.length, 0);
  assert.equal(umJogo.custoTotalReais, 0);
  assert.deepEqual(umJogo.jogosDeRiscoSequenciais, [1]);
});

test("gerarFechamento: com 3 jogos de risco, gera C(3,2) = 3 bilhetes", () => {
  const resultado = gerarFechamento(jogosComPrioridadePrevisivel(3, 0.5, 0.46, 0.3));
  assert.equal(resultado.jogosDeRiscoSequenciais.length, 3);
  assert.equal(resultado.bilhetes.length, 3);
  assert.equal(resultado.custoTotalReais, 3 * 8); // cada bilhete: 2 duplos = 4 combinações = R$8
});

test("gerarFechamento: com 14 jogos, cobre os 8 jogos de risco em C(8,2) = 28 bilhetes de R$8 cada", () => {
  const jogos = jogosComPrioridadePrevisivel(14, 0.5, 0.46, 0.27);
  const resultado = gerarFechamento(jogos);

  assert.equal(resultado.jogosDeRiscoSequenciais.length, 8);
  assert.deepEqual(resultado.jogosDeRiscoSequenciais.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(resultado.bilhetes.length, 28);
  assert.equal(resultado.custoTotalReais, 28 * 8);

  for (const bilhete of resultado.bilhetes) {
    assert.equal(bilhete.marcacoes.length, 14, "cada bilhete marca os 14 jogos, não só os de risco");
    assert.equal(bilhete.jogosDeCoberturaSequenciais.length, 2);

    const duplos = bilhete.marcacoes.filter((m) => m.marcacoes.length === 2);
    const simples = bilhete.marcacoes.filter((m) => m.marcacoes.length === 1);
    assert.equal(duplos.length, 2, "só os 2 jogos cobertos por este bilhete viram duplo");
    assert.equal(simples.length, 12);

    const seqsComDuplo = duplos.map((m) => m.sequencial).sort((a, b) => a - b);
    assert.deepEqual(seqsComDuplo, [...bilhete.jogosDeCoberturaSequenciais].sort((a, b) => a - b));

    // No helper, casa é sempre o favorito (rank0) e empate o 2º colocado (rank1).
    for (const m of simples) assert.deepEqual(m.marcacoes, ["casa"]);
    for (const m of duplos) assert.deepEqual(m.marcacoes, ["casa", "empate"]);
  }
});

test("gerarFechamento: os 28 bilhetes cobrem cada par de jogos de risco exatamente uma vez, sem repetir nem faltar", () => {
  const jogos = jogosComPrioridadePrevisivel(14, 0.5, 0.46, 0.27);
  const resultado = gerarFechamento(jogos);

  const paresGerados = new Set(
    resultado.bilhetes.map((b) => [...b.jogosDeCoberturaSequenciais].sort((a, b) => a - b).join("-"))
  );
  assert.equal(paresGerados.size, 28, "não pode ter par repetido");

  const risco = resultado.jogosDeRiscoSequenciais;
  const paresEsperados = new Set<string>();
  for (let i = 0; i < risco.length; i++) {
    for (let j = i + 1; j < risco.length; j++) {
      paresEsperados.add([risco[i], risco[j]].sort((a, b) => a - b).join("-"));
    }
  }
  assert.deepEqual(paresGerados, paresEsperados);
});
