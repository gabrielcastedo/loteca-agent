import { test } from "node:test";
import assert from "node:assert/strict";
import { probabilidadesImplicitas } from "../src/probability.js";

test("odds justas (sem overround) viram probabilidade igual quando as 3 são iguais", () => {
  const p = probabilidadesImplicitas(3, 3, 3);
  assert.ok(Math.abs(p.casa - 1 / 3) < 1e-9);
  assert.ok(Math.abs(p.empate - 1 / 3) < 1e-9);
  assert.ok(Math.abs(p.visitante - 1 / 3) < 1e-9);
});

test("resultado sempre soma 1, com ou sem overround", () => {
  const casos: [number, number, number][] = [
    [2, 3, 4],
    [1.5, 4, 6],
    [1.01, 15, 25],
    [10, 10, 1.05],
  ];
  for (const [c, x, v] of casos) {
    const p = probabilidadesImplicitas(c, x, v);
    const soma = p.casa + p.empate + p.visitante;
    assert.ok(Math.abs(soma - 1) < 1e-9, `soma deveria ser 1, deu ${soma} pra odds ${c}/${x}/${v}`);
  }
});

test("remove o overround proporcionalmente (mantém a razão entre os brutos)", () => {
  // odds com ~10% de overround: 1/2 + 1/3 + 1/4 = 1.0833...
  const p = probabilidadesImplicitas(2, 3, 4);
  const brutoCasa = 1 / 2;
  const brutoEmpate = 1 / 3;
  const brutoVisitante = 1 / 4;
  const somaBruta = brutoCasa + brutoEmpate + brutoVisitante;

  assert.ok(Math.abs(p.casa - brutoCasa / somaBruta) < 1e-9);
  assert.ok(Math.abs(p.empate - brutoEmpate / somaBruta) < 1e-9);
  assert.ok(Math.abs(p.visitante - brutoVisitante / somaBruta) < 1e-9);
});

test("odd menor (favorito) sempre vira probabilidade maior", () => {
  // Casa é clara favorita (odd baixa); visitante é zebra (odd alta).
  const p = probabilidadesImplicitas(1.5, 4, 6);
  assert.ok(p.casa > p.empate);
  assert.ok(p.casa > p.visitante);
  assert.ok(p.empate > 0 && p.visitante > 0);
});
