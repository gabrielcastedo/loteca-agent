import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNumerosMegaSenaHtml } from "../src/data/numerosMegaSena.js";

function fixtureComJogos(jogos: unknown[]): string {
  const nextData = { props: { pageProps: { result: { concurso: "1271", jogos } } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;
}

test("parseNumerosMegaSenaHtml: extrai sequencial, placar e resultado derivado do placar", () => {
  const html = fixtureComJogos([
    { jogo: 1, time1: "FLAMENGO", time2: "BRAGANTINO", gols1: 2, gols2: 1, resultado: "1" },
    { jogo: 2, time1: "ATLETICO", time2: "CHAPECOENSE", gols1: 1, gols2: 1, resultado: "X" },
    { jogo: 3, time1: "SEVILLA", time2: "BARCELONA", gols1: 1, gols2: 3, resultado: "2" },
  ]);

  const resultado = parseNumerosMegaSenaHtml(html, 1271);

  assert.deepEqual(resultado, [
    { sequencial: 1, golsCasa: 2, golsVisitante: 1, resultado: "casa" },
    { sequencial: 2, golsCasa: 1, golsVisitante: 1, resultado: "empate" },
    { sequencial: 3, golsCasa: 1, golsVisitante: 3, resultado: "visitante" },
  ]);
});

test("parseNumerosMegaSenaHtml: recusa se algum jogo ainda não tem placar", () => {
  const html = fixtureComJogos([
    { jogo: 1, time1: "A", time2: "B", gols1: 2, gols2: 1, resultado: "1" },
    { jogo: 2, time1: "C", time2: "D", gols1: null, gols2: null, resultado: "" },
  ]);

  assert.throws(() => parseNumerosMegaSenaHtml(html, 1271), /ainda não foi totalmente apurado/);
});

test("parseNumerosMegaSenaHtml: recusa se não achar o bloco __NEXT_DATA__ (estrutura do site mudou)", () => {
  assert.throws(() => parseNumerosMegaSenaHtml("<html><body>nada aqui</body></html>", 1271), /__NEXT_DATA__/);
});

test("parseNumerosMegaSenaHtml: recusa se __NEXT_DATA__ não trouxer 'jogos'", () => {
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: {} } })}</script></body></html>`;
  assert.throws(() => parseNumerosMegaSenaHtml(html, 1271), /não trouxe "jogos"/);
});
