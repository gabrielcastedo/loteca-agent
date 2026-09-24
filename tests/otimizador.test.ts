import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarPrioridade, otimizarCartao, pickFavorito } from "../src/analysis/otimizador.js";
import { jogosComPrioridadePrevisivel } from "./helpers.js";

test("pickFavorito: escolhe o resultado de maior probabilidade", () => {
  assert.equal(pickFavorito({ casa: 0.5, empate: 0.3, visitante: 0.2 }), "casa");
  assert.equal(pickFavorito({ casa: 0.2, empate: 0.5, visitante: 0.3 }), "empate");
  assert.equal(pickFavorito({ casa: 0.2, empate: 0.3, visitante: 0.5 }), "visitante");
});

test("pickFavorito: em empate técnico, desempata na ordem casa > empate > visitante", () => {
  assert.equal(pickFavorito({ casa: 1 / 3, empate: 1 / 3, visitante: 1 / 3 }), "casa");
  assert.equal(pickFavorito({ casa: 0.2, empate: 0.4, visitante: 0.4 }), "empate");
});

test("classificarPrioridade: 4 primeiros = alta, próximos 4 = média, resto = nenhuma", () => {
  const jogos = jogosComPrioridadePrevisivel(14, 0.5, 0.46, 0.27);
  const prioridades = classificarPrioridade(jogos);

  for (let seq = 1; seq <= 4; seq++) assert.equal(prioridades.get(seq), "alta", `seq ${seq} deveria ser alta`);
  for (let seq = 5; seq <= 8; seq++) assert.equal(prioridades.get(seq), "media", `seq ${seq} deveria ser media`);
  for (let seq = 9; seq <= 14; seq++) assert.equal(prioridades.get(seq), "nenhuma", `seq ${seq} deveria ser nenhuma`);
});

test("classificarPrioridade: é por posição relativa, não por limiar fixo — mesma divisão numa rodada equilibrada e numa cheia de favoritos óbvios", () => {
  const equilibrada = jogosComPrioridadePrevisivel(14, 0.5, 0.46, 0.27);
  const favoritosObvios = jogosComPrioridadePrevisivel(14, 0.9, 0.088, 0.052);

  const prioridadesEquilibrada = classificarPrioridade(equilibrada);
  const prioridadesFavoritos = classificarPrioridade(favoritosObvios);

  for (let seq = 1; seq <= 14; seq++) {
    assert.equal(
      prioridadesEquilibrada.get(seq),
      prioridadesFavoritos.get(seq),
      `seq ${seq} deveria ter a mesma prioridade nos dois cenários`
    );
  }
});

test("classificarPrioridade: com menos de 8 jogos, só preenche alta e o que sobrar de média", () => {
  const jogos = jogosComPrioridadePrevisivel(5, 0.5, 0.46, 0.3);
  const prioridades = classificarPrioridade(jogos);

  for (let seq = 1; seq <= 4; seq++) assert.equal(prioridades.get(seq), "alta");
  assert.equal(prioridades.get(5), "media");
});

test("otimizarCartao: recusa orçamento abaixo da aposta mínima (R$4)", () => {
  const jogos = jogosComPrioridadePrevisivel(14, 0.5, 0.46, 0.27);
  assert.throws(() => otimizarCartao(jogos, 3));
});

test("otimizarCartao: com o orçamento mínimo (R$4), faz exatamente 1 duplo, no jogo de maior ganho marginal", () => {
  const jogos = jogosComPrioridadePrevisivel(14, 0.5, 0.46, 0.27);
  const resultado = otimizarCartao(jogos, 4);

  assert.equal(resultado.totalCombinacoes, 2);
  assert.equal(resultado.custoReais, 4);

  const duplos = resultado.alocacoes.filter((a) => a.tipo === "duplo");
  assert.equal(duplos.length, 1);
  assert.equal(duplos[0].sequencial, 1); // sequencial 1 tem o maior ganho marginal na construção do helper
  assert.deepEqual(duplos[0].marcacoes, ["casa", "empate"]); // rank0 + rank1 do jogo 1

  const simples = resultado.alocacoes.filter((a) => a.tipo === "simples");
  assert.equal(simples.length, 13);
  for (const s of simples) assert.deepEqual(s.marcacoes, ["casa"]);
});

test("otimizarCartao: nunca gasta mais que o orçamento, e custoReais bate com totalCombinacoes", () => {
  const jogos = jogosComPrioridadePrevisivel(14, 0.5, 0.46, 0.27);
  for (const orcamento of [4, 10, 16, 50, 200, 9999]) {
    const resultado = otimizarCartao(jogos, orcamento);
    assert.ok(resultado.custoReais <= orcamento, `custou R$${resultado.custoReais} com orçamento R$${orcamento}`);
    assert.equal(resultado.custoReais, resultado.totalCombinacoes * 2);

    const duplos = resultado.alocacoes.filter((a) => a.tipo === "duplo").length;
    const triplos = resultado.alocacoes.filter((a) => a.tipo === "triplo").length;
    assert.equal(resultado.totalCombinacoes, 2 ** duplos * 3 ** triplos);
  }
});

test("otimizarCartao: orçamento maior nunca resulta em menos combinações (monotônico)", () => {
  const jogos = jogosComPrioridadePrevisivel(14, 0.5, 0.46, 0.27);
  const orcamentos = [4, 8, 16, 32, 64, 128, 256, 512, 1024];
  let anterior = 0;
  for (const orcamento of orcamentos) {
    const resultado = otimizarCartao(jogos, orcamento);
    assert.ok(resultado.totalCombinacoes >= anterior);
    anterior = resultado.totalCombinacoes;
  }
});

test("otimizarCartao: respeita o teto oficial de duplos/triplos mesmo com orçamento artificialmente alto", () => {
  const jogos = jogosComPrioridadePrevisivel(14, 0.5, 0.46, 0.27);
  const resultadoAlto = otimizarCartao(jogos, 100_000);
  const resultadoMaisAlto = otimizarCartao(jogos, 1_000_000);

  // Se o teto oficial (não o orçamento) é o limitador, os dois batem igual —
  // provando que o algoritmo para de comprar upgrade mesmo sobrando dinheiro.
  assert.equal(resultadoAlto.totalCombinacoes, resultadoMaisAlto.totalCombinacoes);
  assert.deepEqual(resultadoAlto.alocacoes, resultadoMaisAlto.alocacoes);

  const triplos = resultadoAlto.alocacoes.filter((a) => a.tipo === "triplo").length;
  assert.ok(triplos <= 6, "MAX_TRIPLOS da tabela oficial é 6");
});
