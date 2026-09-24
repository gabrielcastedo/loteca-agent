import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DesfalqueAnalise, JogoComOdds, LotecaConcurso } from "../types.js";
import type { Resultado } from "../analysis/otimizador.js";
import type { JogoRelatorio } from "../report.js";

export function openDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS concursos (
      numero INTEGER PRIMARY KEY,
      data_apuracao TEXT,
      data_proximo_concurso TEXT,
      valor_estimado_proximo REAL,
      coletado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jogos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      concurso_numero INTEGER NOT NULL,
      sequencial INTEGER NOT NULL,
      equipe_casa TEXT NOT NULL,
      equipe_visitante TEXT NOT NULL,
      uf_casa TEXT,
      uf_visitante TEXT,
      data_hora TEXT,
      UNIQUE(concurso_numero, sequencial),
      FOREIGN KEY (concurso_numero) REFERENCES concursos(numero)
    );

    CREATE TABLE IF NOT EXISTS odds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jogo_id INTEGER NOT NULL,
      bookmaker TEXT NOT NULL,
      odd_casa REAL NOT NULL,
      odd_empate REAL NOT NULL,
      odd_visitante REAL NOT NULL,
      match_confidence REAL NOT NULL,
      coletado_em TEXT NOT NULL,
      FOREIGN KEY (jogo_id) REFERENCES jogos(id)
    );

    CREATE TABLE IF NOT EXISTS desfalques (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jogo_id INTEGER NOT NULL,
      time TEXT NOT NULL,
      impacto TEXT NOT NULL,
      motivo TEXT NOT NULL,
      coletado_em TEXT NOT NULL,
      FOREIGN KEY (jogo_id) REFERENCES jogos(id)
    );

    -- P0: snapshot da sugestão exibida ao usuário no momento da geração do
    -- relatório (não recalculada depois — senão uma futura recalibração dos
    -- fatores de ajuste.ts/popularidade.ts mudaria retroativamente o que a
    -- gente "teria sugerido", invalidando a comparação com o resultado real).
    CREATE TABLE IF NOT EXISTS sugestoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jogo_id INTEGER NOT NULL UNIQUE,
      prob_pura_casa REAL NOT NULL,
      prob_pura_empate REAL NOT NULL,
      prob_pura_visitante REAL NOT NULL,
      prob_final_casa REAL NOT NULL,
      prob_final_empate REAL NOT NULL,
      prob_final_visitante REAL NOT NULL,
      popularidade_casa REAL NOT NULL,
      popularidade_empate REAL NOT NULL,
      popularidade_visitante REAL NOT NULL,
      melhor_valor_resultado TEXT NOT NULL,
      melhor_valor_numero REAL NOT NULL,
      prioridade TEXT NOT NULL,
      coletado_em TEXT NOT NULL,
      FOREIGN KEY (jogo_id) REFERENCES jogos(id)
    );

    -- P0: resultado real de cada jogo, depois de apurado (vem da mesma API
    -- de fixtures.ts, mas só chamada explicitamente via "npm run conferir").
    CREATE TABLE IF NOT EXISTS resultados_reais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jogo_id INTEGER NOT NULL UNIQUE,
      gols_casa INTEGER NOT NULL,
      gols_visitante INTEGER NOT NULL,
      resultado TEXT NOT NULL,
      apurado_em TEXT NOT NULL,
      FOREIGN KEY (jogo_id) REFERENCES jogos(id)
    );
  `);
}

/**
 * Persiste um concurso completo (grade) + as odds já casadas por jogo.
 * Retorna o id de cada jogo salvo, indexado pelo `sequencial` (1 a 14),
 * pra permitir persistir dados adicionais (ex: desfalques) em seguida.
 */
export function salvarConcursoComOdds(
  db: Database.Database,
  concurso: LotecaConcurso,
  jogosComOdds: JogoComOdds[]
): Map<number, number> {
  const agora = new Date().toISOString();
  const idsPorSequencial = new Map<number, number>();

  const upsertConcurso = db.prepare(`
    INSERT INTO concursos (numero, data_apuracao, data_proximo_concurso, valor_estimado_proximo, coletado_em)
    VALUES (@numero, @dataApuracao, @dataProximoConcurso, @valorEstimado, @coletadoEm)
    ON CONFLICT(numero) DO UPDATE SET
      data_apuracao = excluded.data_apuracao,
      data_proximo_concurso = excluded.data_proximo_concurso,
      valor_estimado_proximo = excluded.valor_estimado_proximo,
      coletado_em = excluded.coletado_em
  `);

  const upsertJogo = db.prepare(`
    INSERT INTO jogos (concurso_numero, sequencial, equipe_casa, equipe_visitante, uf_casa, uf_visitante, data_hora)
    VALUES (@concursoNumero, @sequencial, @equipeCasa, @equipeVisitante, @ufCasa, @ufVisitante, @dataHora)
    ON CONFLICT(concurso_numero, sequencial) DO UPDATE SET
      equipe_casa = excluded.equipe_casa,
      equipe_visitante = excluded.equipe_visitante
    RETURNING id
  `);

  const insertOdds = db.prepare(`
    INSERT INTO odds (jogo_id, bookmaker, odd_casa, odd_empate, odd_visitante, match_confidence, coletado_em)
    VALUES (@jogoId, @bookmaker, @oddCasa, @oddEmpate, @oddVisitante, @matchConfidence, @coletadoEm)
  `);

  const transacao = db.transaction(() => {
    upsertConcurso.run({
      numero: concurso.numero,
      dataApuracao: concurso.dataApuracao ?? null,
      dataProximoConcurso: concurso.dataProximoConcurso ?? null,
      valorEstimado: concurso.valorEstimadoProximoConcurso ?? null,
      coletadoEm: agora,
    });

    for (const item of jogosComOdds) {
      const row = upsertJogo.get({
        concursoNumero: item.jogo.concursoNumero,
        sequencial: item.jogo.sequencial,
        equipeCasa: item.jogo.equipeCasa,
        equipeVisitante: item.jogo.equipeVisitante,
        ufCasa: item.jogo.ufCasa ?? null,
        ufVisitante: item.jogo.ufVisitante ?? null,
        dataHora: item.jogo.dataHora ?? null,
      }) as { id: number };

      idsPorSequencial.set(item.jogo.sequencial, row.id);

      if (item.odds) {
        insertOdds.run({
          jogoId: row.id,
          bookmaker: item.odds.bookmaker,
          oddCasa: item.odds.oddCasa,
          oddEmpate: item.odds.oddEmpate,
          oddVisitante: item.odds.oddVisitante,
          matchConfidence: item.matchConfidence,
          coletadoEm: agora,
        });
      }
    }
  });

  transacao();

  return idsPorSequencial;
}

/** Persiste as análises de desfalque (Fase 2) de um jogo específico. */
export function salvarDesfalques(
  db: Database.Database,
  jogoId: number,
  analises: DesfalqueAnalise[]
): void {
  const agora = new Date().toISOString();

  const insertDesfalque = db.prepare(`
    INSERT INTO desfalques (jogo_id, time, impacto, motivo, coletado_em)
    VALUES (@jogoId, @time, @impacto, @motivo, @coletadoEm)
  `);

  const transacao = db.transaction(() => {
    for (const analise of analises) {
      insertDesfalque.run({
        jogoId,
        time: analise.time,
        impacto: analise.impacto,
        motivo: analise.motivo,
        coletadoEm: agora,
      });
    }
  });

  transacao();
}

/**
 * P0: persiste a sugestão exibida (probabilidade pura/final, popularidade,
 * melhor valor, prioridade) pra cada jogo do relatório — snapshot fixo no
 * tempo, ver comentário na criação da tabela `sugestoes`. Só salva jogos
 * com probabilidade calculada (com odds); jogos sem odds não têm sugestão.
 */
export function salvarSugestoes(
  db: Database.Database,
  idsPorSequencial: Map<number, number>,
  relatorio: JogoRelatorio[]
): void {
  const agora = new Date().toISOString();

  const upsertSugestao = db.prepare(`
    INSERT INTO sugestoes (
      jogo_id, prob_pura_casa, prob_pura_empate, prob_pura_visitante,
      prob_final_casa, prob_final_empate, prob_final_visitante,
      popularidade_casa, popularidade_empate, popularidade_visitante,
      melhor_valor_resultado, melhor_valor_numero, prioridade, coletado_em
    )
    VALUES (
      @jogoId, @probPuraCasa, @probPuraEmpate, @probPuraVisitante,
      @probFinalCasa, @probFinalEmpate, @probFinalVisitante,
      @popularidadeCasa, @popularidadeEmpate, @popularidadeVisitante,
      @melhorValorResultado, @melhorValorNumero, @prioridade, @coletadoEm
    )
    ON CONFLICT(jogo_id) DO UPDATE SET
      prob_pura_casa = excluded.prob_pura_casa,
      prob_pura_empate = excluded.prob_pura_empate,
      prob_pura_visitante = excluded.prob_pura_visitante,
      prob_final_casa = excluded.prob_final_casa,
      prob_final_empate = excluded.prob_final_empate,
      prob_final_visitante = excluded.prob_final_visitante,
      popularidade_casa = excluded.popularidade_casa,
      popularidade_empate = excluded.popularidade_empate,
      popularidade_visitante = excluded.popularidade_visitante,
      melhor_valor_resultado = excluded.melhor_valor_resultado,
      melhor_valor_numero = excluded.melhor_valor_numero,
      prioridade = excluded.prioridade,
      coletado_em = excluded.coletado_em
  `);

  const transacao = db.transaction(() => {
    for (const j of relatorio) {
      if (!j.probabilidadePura || !j.probabilidadeFinal || !j.popularidade || !j.melhorValor) continue;
      const jogoId = idsPorSequencial.get(j.sequencial);
      if (!jogoId) continue;

      upsertSugestao.run({
        jogoId,
        probPuraCasa: j.probabilidadePura.casa,
        probPuraEmpate: j.probabilidadePura.empate,
        probPuraVisitante: j.probabilidadePura.visitante,
        probFinalCasa: j.probabilidadeFinal.casa,
        probFinalEmpate: j.probabilidadeFinal.empate,
        probFinalVisitante: j.probabilidadeFinal.visitante,
        popularidadeCasa: j.popularidade.casa,
        popularidadeEmpate: j.popularidade.empate,
        popularidadeVisitante: j.popularidade.visitante,
        melhorValorResultado: j.melhorValor.resultado,
        melhorValorNumero: j.melhorValor.valor,
        prioridade: j.prioridade ?? "nenhuma",
        coletadoEm: agora,
      });
    }
  });

  transacao();
}

/** P0: persiste o resultado real (apurado) de cada jogo de um concurso. */
export function salvarResultadosReais(
  db: Database.Database,
  idsPorSequencial: Map<number, number>,
  resultados: Array<{ sequencial: number; golsCasa: number; golsVisitante: number; resultado: Resultado }>
): void {
  const agora = new Date().toISOString();

  const upsertResultado = db.prepare(`
    INSERT INTO resultados_reais (jogo_id, gols_casa, gols_visitante, resultado, apurado_em)
    VALUES (@jogoId, @golsCasa, @golsVisitante, @resultado, @apuradoEm)
    ON CONFLICT(jogo_id) DO UPDATE SET
      gols_casa = excluded.gols_casa,
      gols_visitante = excluded.gols_visitante,
      resultado = excluded.resultado,
      apurado_em = excluded.apurado_em
  `);

  const transacao = db.transaction(() => {
    for (const r of resultados) {
      const jogoId = idsPorSequencial.get(r.sequencial);
      if (!jogoId) continue;
      upsertResultado.run({
        jogoId,
        golsCasa: r.golsCasa,
        golsVisitante: r.golsVisitante,
        resultado: r.resultado,
        apuradoEm: agora,
      });
    }
  });

  transacao();
}

/** Ids dos jogos de um concurso já salvo, indexados por sequencial (1 a 14). */
export function buscarIdsDosJogos(db: Database.Database, concursoNumero: number): Map<number, number> {
  const linhas = db
    .prepare(`SELECT id, sequencial FROM jogos WHERE concurso_numero = ?`)
    .all(concursoNumero) as Array<{ id: number; sequencial: number }>;
  return new Map(linhas.map((l) => [l.sequencial, l.id]));
}

/** Linha combinada de jogo + sugestão salva + resultado real (quando existirem), pra conferência (P0). */
export interface LinhaConferencia {
  sequencial: number;
  equipeCasa: string;
  equipeVisitante: string;
  probFinal: { casa: number; empate: number; visitante: number } | null;
  melhorValorResultado: Resultado | null;
  melhorValorNumero: number | null;
  prioridade: string | null;
  resultadoReal: Resultado | null;
  golsCasa: number | null;
  golsVisitante: number | null;
}

/** Busca tudo que `npm run conferir` precisa pra um concurso, já casado por jogo. */
export function buscarDadosParaConferencia(db: Database.Database, concursoNumero: number): LinhaConferencia[] {
  const linhas = db
    .prepare(
      `
      SELECT
        j.sequencial, j.equipe_casa, j.equipe_visitante,
        s.prob_final_casa, s.prob_final_empate, s.prob_final_visitante,
        s.melhor_valor_resultado, s.melhor_valor_numero, s.prioridade,
        r.resultado, r.gols_casa, r.gols_visitante
      FROM jogos j
      LEFT JOIN sugestoes s ON s.jogo_id = j.id
      LEFT JOIN resultados_reais r ON r.jogo_id = j.id
      WHERE j.concurso_numero = ?
      ORDER BY j.sequencial
      `
    )
    .all(concursoNumero) as Array<{
    sequencial: number;
    equipe_casa: string;
    equipe_visitante: string;
    prob_final_casa: number | null;
    prob_final_empate: number | null;
    prob_final_visitante: number | null;
    melhor_valor_resultado: Resultado | null;
    melhor_valor_numero: number | null;
    prioridade: string | null;
    resultado: Resultado | null;
    gols_casa: number | null;
    gols_visitante: number | null;
  }>;

  return linhas.map((l) => ({
    sequencial: l.sequencial,
    equipeCasa: l.equipe_casa,
    equipeVisitante: l.equipe_visitante,
    probFinal:
      l.prob_final_casa != null && l.prob_final_empate != null && l.prob_final_visitante != null
        ? { casa: l.prob_final_casa, empate: l.prob_final_empate, visitante: l.prob_final_visitante }
        : null,
    melhorValorResultado: l.melhor_valor_resultado,
    melhorValorNumero: l.melhor_valor_numero,
    prioridade: l.prioridade,
    resultadoReal: l.resultado,
    golsCasa: l.gols_casa,
    golsVisitante: l.gols_visitante,
  }));
}
