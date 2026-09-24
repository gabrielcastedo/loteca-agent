import { test } from "node:test";
import assert from "node:assert/strict";
import { probabilidadesImplicitas, probabilidadesImplicitasMedia } from "../src/probability.js";

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

test("probabilidadesImplicitasMedia: recusa lista vazia", () => {
  assert.throws(() => probabilidadesImplicitasMedia([]));
});

test("probabilidadesImplicitasMedia: com 1 casa só, é idêntico ao de-vig direto dela", () => {
  const unica = { bookmaker: "KTO", oddCasa: 2, oddEmpate: 3, oddVisitante: 4 };
  const media = probabilidadesImplicitasMedia([unica]);
  const direto = probabilidadesImplicitas(unica.oddCasa, unica.oddEmpate, unica.oddVisitante);

  assert.ok(Math.abs(media.casa - direto.casa) < 1e-9);
  assert.ok(Math.abs(media.empate - direto.empate) < 1e-9);
  assert.ok(Math.abs(media.visitante - direto.visitante) < 1e-9);
});

test("probabilidadesImplicitasMedia: é a média aritmética das probabilidades de-vigadas por casa, não das odds cruas", () => {
  const casas = [
    { bookmaker: "A", oddCasa: 2, oddEmpate: 3, oddVisitante: 4 },
    { bookmaker: "B", oddCasa: 1.8, oddEmpate: 3.5, oddVisitante: 4.5 },
  ];
  const media = probabilidadesImplicitasMedia(casas);
  const p1 = probabilidadesImplicitas(2, 3, 4);
  const p2 = probabilidadesImplicitas(1.8, 3.5, 4.5);

  assert.ok(Math.abs(media.casa - (p1.casa + p2.casa) / 2) < 1e-9);
  assert.ok(Math.abs(media.empate - (p1.empate + p2.empate) / 2) < 1e-9);
  assert.ok(Math.abs(media.visitante - (p1.visitante + p2.visitante) / 2) < 1e-9);
});

test("probabilidadesImplicitasMedia: resultado sempre soma 1", () => {
  const casas = [
    { bookmaker: "A", oddCasa: 2, oddEmpate: 3, oddVisitante: 4 },
    { bookmaker: "B", oddCasa: 1.5, oddEmpate: 4, oddVisitante: 6 },
    { bookmaker: "C", oddCasa: 2.5, oddEmpate: 3.2, oddVisitante: 3 },
  ];
  const media = probabilidadesImplicitasMedia(casas);
  assert.ok(Math.abs(media.casa + media.empate + media.visitante - 1) < 1e-9);
});

test("probabilidadesImplicitasMedia: uma casa destoante puxa a média na direção dela, mas não domina sozinha", () => {
  // 3 casas concordam que o mandante tem ~50%; 1 casa destoante acha 70%+.
  const concordantes = [
    { bookmaker: "A", oddCasa: 2, oddEmpate: 3.4, oddVisitante: 3.8 },
    { bookmaker: "B", oddCasa: 2.05, oddEmpate: 3.3, oddVisitante: 3.7 },
    { bookmaker: "C", oddCasa: 1.95, oddEmpate: 3.5, oddVisitante: 3.9 },
  ];
  const destoante = { bookmaker: "D", oddCasa: 1.3, oddEmpate: 4.5, oddVisitante: 8 };

  const semDestoante = probabilidadesImplicitasMedia(concordantes);
  const comDestoante = probabilidadesImplicitasMedia([...concordantes, destoante]);
  const soDestoante = probabilidadesImplicitas(destoante.oddCasa, destoante.oddEmpate, destoante.oddVisitante);

  assert.ok(comDestoante.casa > semDestoante.casa, "a média deveria subir com a casa destoante");
  assert.ok(comDestoante.casa < soDestoante.casa, "mas não deveria chegar no valor da casa destoante sozinha");
});
