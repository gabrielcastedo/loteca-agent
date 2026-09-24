import "dotenv/config";
import { fetchResultadoApurado as fetchResultadoApuradoNumerosMegaSena } from "../src/data/numerosMegaSena.js";
import { fetchResultadoApuradoCaixa } from "../src/data/fixtures.js";
import type { ResultadoApurado } from "../src/data/fixtures.js";
import { openDb, buscarIdsDosJogos, salvarResultadosReais, buscarDadosParaConferencia } from "../src/db/schema.js";
import type { LinhaConferencia } from "../src/db/schema.js";
import { gerarFechamento } from "../src/analysis/fechamento.js";
import { pickFavorito } from "../src/analysis/otimizador.js";
import type { JogoParaOtimizar, Resultado } from "../src/analysis/otimizador.js";

/**
 * P0 do plano de melhorias: fecha o loop de validação. Busca o resultado
 * real de um concurso já apurado e compara contra a sugestão que o app deu
 * NA ÉPOCA (snapshot salvo em `sugestoes` por `salvarSugestoes`, não
 * recalculado agora — ver comentário na tabela em `src/db/schema.ts`).
 *
 * Uso: npx ts-node --esm scripts/conferir.ts <numeroDoConcurso>
 *
 * Sem isso, qualquer ajuste nos fatores de ajuste.ts/popularidade.ts/
 * otimizador.ts é só mais um chute em cima do primeiro — ver P0 em
 * docs/plano-melhorias.md.
 */
async function main() {
  const numero = Number(process.argv[2]);
  if (!numero || Number.isNaN(numero)) {
    console.error("Uso: npm run conferir -- <numeroDoConcurso>");
    process.exit(1);
  }

  const dbPath = process.env.DB_PATH ?? "./data/loteca.db";
  const db = openDb(dbPath);

  const idsPorSequencial = buscarIdsDosJogos(db, numero);
  if (idsPorSequencial.size === 0) {
    console.error(
      `Concurso ${numero} não tem jogos salvos no banco local (${dbPath}). ` +
        `Esse concurso precisa ter sido coletado com "npm run dev" enquanto estava aberto pra ter o que conferir.`
    );
    db.close();
    process.exit(1);
  }

  console.log(`Buscando resultado apurado do concurso ${numero}...`);
  const resultados = await buscarResultadoComFallback(numero);
  if (!resultados) {
    db.close();
    process.exit(1);
  }

  salvarResultadosReais(db, idsPorSequencial, resultados);
  const linhas = buscarDadosParaConferencia(db, numero);
  db.close();

  imprimirComparacaoPorJogo(numero, linhas);
  imprimirFechamento(linhas);
  imprimirHistoricoAcumulado(dbPath, numero);
}

const LABEL_RESULTADO: Record<Resultado, string> = { casa: "1", empate: "X", visitante: "2" };

/**
 * Fonte principal: numerosmegasena.com.br (resultado já vem pronto, HTTP
 * 404 previsível pra "ainda não apurado"). Fallback: endpoint da Caixa
 * (mesma lógica de fallback já usada pras odds — ver `preferirOddsShow`
 * em `index.ts`). Se as duas falharem, imprime os dois erros e retorna
 * `null` pro chamador decidir encerrar.
 */
async function buscarResultadoComFallback(numero: number): Promise<ResultadoApurado[] | null> {
  try {
    return await fetchResultadoApuradoNumerosMegaSena(numero);
  } catch (err1) {
    console.warn(
      `Aviso: falha ao buscar em numerosmegasena.com.br (${err1 instanceof Error ? err1.message : err1}). Tentando a Caixa...`
    );
    try {
      return await fetchResultadoApuradoCaixa(numero);
    } catch (err2) {
      console.error("Falha nas duas fontes de resultado apurado:");
      console.error(`  numerosmegasena.com.br: ${err1 instanceof Error ? err1.message : err1}`);
      console.error(`  Caixa: ${err2 instanceof Error ? err2.message : err2}`);
      return null;
    }
  }
}

function imprimirComparacaoPorJogo(numero: number, linhas: LinhaConferencia[]): void {
  console.log(`\n=== Concurso ${numero} — Sugestão x Resultado real ===\n`);

  let comSugestao = 0;
  let pickAcertos = 0;
  let melhorValorAcertos = 0;

  for (const l of linhas) {
    const label = `${String(l.sequencial).padStart(2, "0")}. ${l.equipeCasa} x ${l.equipeVisitante}`;

    if (!l.resultadoReal) {
      console.log(`${label}\n    (sem resultado apurado pra esse jogo)\n`);
      continue;
    }
    if (!l.probFinal || !l.melhorValorResultado) {
      console.log(`${label}\n    (sem sugestão salva na época — jogo sem odds)  resultado real: ${LABEL_RESULTADO[l.resultadoReal]}\n`);
      continue;
    }

    comSugestao++;
    const pick = pickFavorito(l.probFinal);
    const pickAcertou = pick === l.resultadoReal;
    const valorAcertou = l.melhorValorResultado === l.resultadoReal;
    if (pickAcertou) pickAcertos++;
    if (valorAcertou) melhorValorAcertos++;

    console.log(
      `${label}\n` +
        `    prob. final:  1=${(l.probFinal.casa * 100).toFixed(1)}%  X=${(l.probFinal.empate * 100).toFixed(1)}%  2=${(l.probFinal.visitante * 100).toFixed(1)}%\n` +
        `    pick principal: ${LABEL_RESULTADO[pick]}  ${pickAcertou ? "✅ acertou" : "❌ errou"}\n` +
        `    melhor valor:   ${LABEL_RESULTADO[l.melhorValorResultado]} (${l.melhorValorNumero?.toFixed(2)}x)  ${valorAcertou ? "✅ acertou" : "❌ errou"}\n` +
        `    resultado real: ${LABEL_RESULTADO[l.resultadoReal]}\n`
    );
  }

  if (comSugestao === 0) {
    console.log(
      `Resumo: nenhum jogo desse concurso tinha sugestão salva (concurso coletado antes do P0 existir, ou todos sem odds).`
    );
    return;
  }

  console.log(
    `Resumo: ${comSugestao} jogos com sugestão salva. ` +
      `Pick principal: ${pickAcertos}/${comSugestao} (${((pickAcertos / comSugestao) * 100).toFixed(1)}%). ` +
      `Melhor valor: ${melhorValorAcertos}/${comSugestao} (${((melhorValorAcertos / comSugestao) * 100).toFixed(1)}%).`
  );
}

/**
 * Reconstrói o fechamento a partir da probabilidade final SALVA na época
 * (não recalculada) e mede quantos jogos cada bilhete teria acertado contra
 * o resultado real. Usa a versão ATUAL do algoritmo de `fechamento.ts` —
 * se esse algoritmo mudar no futuro, isso deixa de refletir exatamente o
 * que apareceu no relatório daquela semana (limitação conhecida; o que
 * importa ficar fixo no tempo é a probabilidade, que é o dado bruto).
 */
function imprimirFechamento(linhas: LinhaConferencia[]): void {
  const jogosParaOtimizar: JogoParaOtimizar[] = linhas
    .filter((l): l is LinhaConferencia & { probFinal: NonNullable<LinhaConferencia["probFinal"]> } =>
      Boolean(l.probFinal)
    )
    .map((l) => ({
      sequencial: l.sequencial,
      equipeCasa: l.equipeCasa,
      equipeVisitante: l.equipeVisitante,
      probabilidade: l.probFinal,
    }));

  const resultadoPorSequencial = new Map(
    linhas.filter((l) => l.resultadoReal).map((l) => [l.sequencial, l.resultadoReal!])
  );

  const fechamento = gerarFechamento(jogosParaOtimizar);
  if (fechamento.bilhetes.length === 0) {
    console.log(`\n=== Fechamento (reconstruído) ===\n\nJogos de risco insuficientes — sem fechamento pra conferir.`);
    return;
  }

  const distribuicaoAcertos: Record<number, number> = {};
  let melhorBilhete = 0;

  for (const bilhete of fechamento.bilhetes) {
    let acertos = 0;
    for (const m of bilhete.marcacoes) {
      const real = resultadoPorSequencial.get(m.sequencial);
      if (real && m.marcacoes.includes(real)) acertos++;
    }
    distribuicaoAcertos[acertos] = (distribuicaoAcertos[acertos] ?? 0) + 1;
    if (acertos > melhorBilhete) melhorBilhete = acertos;
  }

  console.log(`\n=== Fechamento (reconstruído da sugestão salva) ===\n`);
  console.log(`${fechamento.bilhetes.length} bilhetes. Melhor bilhete: ${melhorBilhete}/14 acertos.`);
  console.log(`Distribuição de acertos entre os ${fechamento.bilhetes.length} bilhetes:`);
  for (const acertos of Object.keys(distribuicaoAcertos).map(Number).sort((a, b) => b - a)) {
    console.log(`  ${acertos}/14: ${distribuicaoAcertos[acertos]} bilhete(s)`);
  }
}

/** Acumula pick-principal e melhor-valor hit rate de TODOS os concursos já conferidos até agora, incluindo este. */
function imprimirHistoricoAcumulado(dbPath: string, numeroAtual: number): void {
  const db = openDb(dbPath);
  const linhas = db
    .prepare(
      `
      SELECT j.concurso_numero, s.prob_final_casa, s.prob_final_empate, s.prob_final_visitante,
             s.melhor_valor_resultado, r.resultado
      FROM jogos j
      JOIN sugestoes s ON s.jogo_id = j.id
      JOIN resultados_reais r ON r.jogo_id = j.id
      `
    )
    .all() as Array<{
    concurso_numero: number;
    prob_final_casa: number;
    prob_final_empate: number;
    prob_final_visitante: number;
    melhor_valor_resultado: Resultado;
    resultado: Resultado;
  }>;
  db.close();

  if (linhas.length === 0) return;

  const concursos = new Set(linhas.map((l) => l.concurso_numero));
  let pickAcertos = 0;
  let valorAcertos = 0;
  for (const l of linhas) {
    const pick = pickFavorito({ casa: l.prob_final_casa, empate: l.prob_final_empate, visitante: l.prob_final_visitante });
    if (pick === l.resultado) pickAcertos++;
    if (l.melhor_valor_resultado === l.resultado) valorAcertos++;
  }

  console.log(
    `\n=== Histórico acumulado (${concursos.size} concurso(s) conferido(s), incluindo o ${numeroAtual}) ===\n\n` +
      `${linhas.length} jogos no total. ` +
      `Pick principal: ${pickAcertos}/${linhas.length} (${((pickAcertos / linhas.length) * 100).toFixed(1)}%). ` +
      `Melhor valor: ${valorAcertos}/${linhas.length} (${((valorAcertos / linhas.length) * 100).toFixed(1)}%).`
  );
}

main().catch((err) => {
  console.error("Erro na execução:", err);
  process.exit(1);
});
