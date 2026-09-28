import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openDb,
  salvarConcursoComOdds,
  salvarSugestoes,
  salvarResultadosReais,
  buscarDadosParaConferencia,
} from "../src/db/schema.js";
import type { JogoComOdds, LotecaConcurso } from "../src/types.js";
import type { JogoRelatorio } from "../src/report.js";

/**
 * Regressão do incidente de 2026-09-28: rodar `npm run dev` de novo pra um
 * concurso já apurado sobrescrevia a sugestão salva com odds novas/
 * obsoletas, corrompendo o snapshot histórico já usado numa comparação
 * real (pick principal mudou de 6/14 pra 7/14 só por causa da odd
 * diferente, sem nenhuma mudança de modelo). `salvarSugestoes` agora
 * recusa sobrescrever jogos que já têm resultado real conferido.
 */

function concursoFixture(): { concurso: LotecaConcurso; jogosComOdds: JogoComOdds[] } {
  const concurso: LotecaConcurso = {
    numero: 9999,
    jogos: [
      { concursoNumero: 9999, sequencial: 1, equipeCasa: "TIME A", equipeVisitante: "TIME B" },
    ],
  };
  const jogosComOdds: JogoComOdds[] = [
    {
      jogo: concurso.jogos[0],
      matchConfidence: 1,
      odds: {
        timeCasa: "TIME A",
        timeVisitante: "TIME B",
        bookmaker: "CASA TESTE",
        oddCasa: 2,
        oddEmpate: 3,
        oddVisitante: 4,
      },
    },
  ];
  return { concurso, jogosComOdds };
}

function relatorioFixture(probCasa: number): JogoRelatorio[] {
  const empate = (1 - probCasa) / 2;
  const visitante = (1 - probCasa) / 2;
  return [
    {
      sequencial: 1,
      equipeCasa: "TIME A",
      equipeVisitante: "TIME B",
      matchConfidence: 1,
      odds: null,
      probabilidadePura: { casa: probCasa, empate, visitante },
      probabilidadeFinal: { casa: probCasa, empate, visitante },
      desfalques: null,
      popularidade: { casa: probCasa, empate, visitante },
      melhorValor: { resultado: "casa", valor: 1.5 },
      prioridade: "nenhuma",
    },
  ];
}

test("salvarSugestoes: não sobrescreve um jogo que já tem resultado real conferido", () => {
  const db = openDb(":memory:");
  const { concurso, jogosComOdds } = concursoFixture();
  const ids = salvarConcursoComOdds(db, concurso, jogosComOdds);

  // Sugestão original, salva "antes do jogo".
  const primeira = salvarSugestoes(db, ids, relatorioFixture(0.6));
  assert.deepEqual(primeira.sequenciaisPulados, []);

  // Jogo já aconteceu e foi conferido.
  salvarResultadosReais(db, ids, [{ sequencial: 1, golsCasa: 1, golsVisitante: 0, resultado: "casa" }]);

  // Alguém roda o pipeline de novo pro mesmo concurso (ex: testando código) —
  // isso NÃO pode sobrescrever a sugestão que já foi conferida.
  const segunda = salvarSugestoes(db, ids, relatorioFixture(0.9));
  assert.deepEqual(segunda.sequenciaisPulados, [1]);

  const linhas = buscarDadosParaConferencia(db, 9999);
  assert.equal(linhas.length, 1);
  assert.ok(Math.abs(linhas[0].probFinal!.casa - 0.6) < 1e-9, "probabilidade deveria continuar sendo a original (0.6), não a nova (0.9)");

  db.close();
});

test("salvarSugestoes: salva normalmente quando o jogo ainda não tem resultado real", () => {
  const db = openDb(":memory:");
  const { concurso, jogosComOdds } = concursoFixture();
  const ids = salvarConcursoComOdds(db, concurso, jogosComOdds);

  const primeira = salvarSugestoes(db, ids, relatorioFixture(0.6));
  assert.deepEqual(primeira.sequenciaisPulados, []);

  // Ainda sem resultado real — rodar de novo (odds atualizaram durante a semana) deve atualizar normalmente.
  const segunda = salvarSugestoes(db, ids, relatorioFixture(0.7));
  assert.deepEqual(segunda.sequenciaisPulados, []);

  const linhas = buscarDadosParaConferencia(db, 9999);
  assert.ok(Math.abs(linhas[0].probFinal!.casa - 0.7) < 1e-9, "sem resultado real, a sugestão deveria atualizar normalmente");

  db.close();
});
