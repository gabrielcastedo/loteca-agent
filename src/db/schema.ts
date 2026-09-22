import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DesfalqueAnalise, JogoComOdds, LotecaConcurso } from "../types.js";

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
