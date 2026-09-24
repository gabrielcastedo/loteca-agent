import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOddsShowHtml } from "../src/data/oddsShow.js";

/**
 * Fixture reduzida, mas fiel à estrutura real do widget (validada ao vivo
 * em 2026-09-23): cada jogo é um <details> com "Oficial: X x Y - dd/mm" no
 * texto, um trio "destacado" (aria-label começando com 1/X/2) e uma tabela
 * detalhada por casa (aria-label começando pelo nome da casa). A casa KTO
 * aqui só tem os mercados 1 e X de propósito, pra testar que casa
 * incompleta fica de fora de `porCasa`.
 */
const HTML_FIXTURE = `
<html><body>
<details>
  <summary>Jogo 1</summary>
  <div>Oficial: TIME CASA x TIME VISITANTE - 25/09</div>
  <a aria-label="1, Betano, odd 2.50"></a>
  <a aria-label="X, Bet365, odd 3.40"></a>
  <a aria-label="2, KTO, odd 2.80"></a>
  <a aria-label="Betano, 1, odd 2.50"></a>
  <a aria-label="Betano, X, odd 3.30"></a>
  <a aria-label="Betano, 2, odd 2.75"></a>
  <a aria-label="Bet365, 1, odd 2.45"></a>
  <a aria-label="Bet365, X, odd 3.40"></a>
  <a aria-label="Bet365, 2, odd 2.80"></a>
  <a aria-label="KTO, 1, odd 2.40"></a>
  <a aria-label="KTO, X, odd 3.50"></a>
</details>
</body></html>
`;

test("parseOddsShowHtml: extrai o trio destacado (melhor odd por mercado)", () => {
  const [jogo] = parseOddsShowHtml(HTML_FIXTURE);
  assert.equal(jogo.equipeCasaOficial, "TIME CASA");
  assert.equal(jogo.equipeVisitanteOficial, "TIME VISITANTE");
  assert.deepEqual(jogo.mercados.casa, { odd: 2.5, bookmaker: "Betano" });
  assert.deepEqual(jogo.mercados.empate, { odd: 3.4, bookmaker: "Bet365" });
  assert.deepEqual(jogo.mercados.visitante, { odd: 2.8, bookmaker: "KTO" });
});

test("parseOddsShowHtml: extrai a tabela por casa, só das casas com os 3 mercados completos", () => {
  const [jogo] = parseOddsShowHtml(HTML_FIXTURE);

  // KTO só tinha 1 e X na fixture — fica de fora.
  const bookmakers = jogo.porCasa.map((c) => c.bookmaker).sort();
  assert.deepEqual(bookmakers, ["Bet365", "Betano"]);

  const betano = jogo.porCasa.find((c) => c.bookmaker === "Betano")!;
  assert.deepEqual(betano, { bookmaker: "Betano", oddCasa: 2.5, oddEmpate: 3.3, oddVisitante: 2.75 });

  const bet365 = jogo.porCasa.find((c) => c.bookmaker === "Bet365")!;
  assert.deepEqual(bet365, { bookmaker: "Bet365", oddCasa: 2.45, oddEmpate: 3.4, oddVisitante: 2.8 });
});

test("parseOddsShowHtml: sem nenhuma casa com tripla completa, porCasa fica vazio", () => {
  const html = `
  <details>
    <div>Oficial: A x B - 25/09</div>
    <a aria-label="1, Betano, odd 2.00"></a>
    <a aria-label="Betano, 1, odd 2.00"></a>
  </details>`;
  const [jogo] = parseOddsShowHtml(html);
  assert.deepEqual(jogo.porCasa, []);
});
