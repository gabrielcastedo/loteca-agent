import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarTaxaHistorica, TAXA_HISTORICA } from "../src/analysis/historico.js";

test("taxa histórica soma 1", () => {
  const taxa = carregarTaxaHistorica();
  assert.ok(Math.abs(taxa.casa + taxa.empate + taxa.visitante - 1) < 1e-9);
});

test("mandante ganha mais que empate ou visitante (vantagem de campo é um efeito real e conhecido)", () => {
  const taxa = carregarTaxaHistorica();
  assert.ok(taxa.casa > taxa.empate);
  assert.ok(taxa.casa > taxa.visitante);
});

test("nenhum resultado é uma fração absurda (sanity check contra parsing quebrado)", () => {
  const taxa = carregarTaxaHistorica();
  for (const valor of [taxa.casa, taxa.empate, taxa.visitante]) {
    assert.ok(valor > 0.15 && valor < 0.65, `valor ${valor} fora da faixa plausível`);
  }
});

test("TAXA_HISTORICA (calculada uma vez no import) bate com carregarTaxaHistorica() chamada de novo", () => {
  const taxa = carregarTaxaHistorica();
  assert.ok(Math.abs(taxa.casa - TAXA_HISTORICA.casa) < 1e-9);
  assert.ok(Math.abs(taxa.empate - TAXA_HISTORICA.empate) < 1e-9);
  assert.ok(Math.abs(taxa.visitante - TAXA_HISTORICA.visitante) < 1e-9);
});
