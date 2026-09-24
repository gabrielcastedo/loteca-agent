import { test } from "node:test";
import assert from "node:assert/strict";
import { resultadoDoPlacar } from "../src/data/fixtures.js";

test("resultadoDoPlacar: mais gols do mandante = casa", () => {
  assert.equal(resultadoDoPlacar(2, 0), "casa");
  assert.equal(resultadoDoPlacar(1, 0), "casa");
});

test("resultadoDoPlacar: mais gols do visitante = visitante", () => {
  assert.equal(resultadoDoPlacar(0, 2), "visitante");
  assert.equal(resultadoDoPlacar(1, 3), "visitante");
});

test("resultadoDoPlacar: mesmo número de gols = empate", () => {
  assert.equal(resultadoDoPlacar(0, 0), "empate");
  assert.equal(resultadoDoPlacar(2, 2), "empate");
});
