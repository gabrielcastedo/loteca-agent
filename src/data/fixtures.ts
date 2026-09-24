import { readFile } from "node:fs/promises";
import type { LotecaConcurso, LotecaJogo } from "../types.js";
import type { Resultado } from "../analysis/otimizador.js";

/**
 * Endpoint público usado pelo próprio site da Caixa (loterias.caixa.gov.br)
 * para renderizar a página da Loteca. Não é uma API documentada oficialmente
 * — vários projetos open source na comunidade (ex: loterias-caixa-json)
 * dependem dela, mas ela pode mudar de formato sem aviso.
 *
 * Formato validado ao vivo em 2026-09-21 (concursos 1265 e 1270). A lista de
 * jogos vem em `listaResultadoEquipeEsportiva`, não `listaLoteca`, e não há
 * campo de hora do jogo — apenas `dtJogo` (data, formato DD/MM/AAAA).
 */
const CAIXA_LOTECA_URL = "https://servicebus2.caixa.gov.br/portaldeloterias/api/loteca/";

interface CaixaLotecaRawResponse {
  numero: number;
  numeroConcursoProximo?: number;
  dataApuracao?: string;
  dataProximoConcurso?: string;
  valorEstimadoProximoConcurso?: number;
  listaResultadoEquipeEsportiva?: Array<{
    nuSequencial: number;
    nomeEquipeUm: string;
    nomeEquipeDois: string;
    nomeCampeonato?: string;
    siglaUFUm?: string;
    siglaUFDois?: string;
    nuGolEquipeUm?: number | null;
    nuGolEquipeDois?: number | null;
    dtJogo?: string; // formato "DD/MM/AAAA"
  }>;
}

/**
 * Busca o concurso ainda aberto para apostas.
 *
 * Descoberta ao validar ao vivo (2026-09-21): o endpoint sem número sempre
 * devolve o ÚLTIMO concurso JÁ APURADO (jogos com placar preenchido), nunca
 * o que está aberto para apostar. O próprio payload traz
 * `numeroConcursoProximo`, mas isso também não é garantia — em teste real,
 * o "próximo" também já estava apurado (a Caixa publica o placar antes de
 * o ponteiro "atual" rolar pra ele). Por isso conferimos explicitamente se
 * os jogos do "próximo" já têm placar; se tiverem, ou se a grade seguinte
 * ainda nem existe, propagamos um erro claro em vez de devolver
 * silenciosamente um concurso que não está mais aberto.
 *
 * IMPORTANTE: essa API fica atrasada em relação ao site de apostas
 * (loteriasonline.caixa.gov.br), que publica a grade alguns dias antes da
 * apuração. Cheguei a investigar um fallback via navegador headless pra
 * ler a grade de lá, mas o site tem um WAF anti-bot (Radware/ShieldSquare)
 * que bloqueia explicitamente `HeadlessChrome` — contornar isso seria
 * burlar uma proteção de segurança de um site do governo federal, então
 * não implementei. Espere alguns dias após a abertura do concurso pra essa
 * API sincronizar.
 */
export async function fetchConcursoAtual(): Promise<LotecaConcurso> {
  const ultimoApurado = await fetchRaw();
  const proximoNumero = ultimoApurado.numeroConcursoProximo;

  if (!proximoNumero) {
    throw new Error(
      "A resposta da Caixa não trouxe numeroConcursoProximo — não dá pra saber qual é o concurso aberto para apostas."
    );
  }

  let proximo: CaixaLotecaRawResponse;
  try {
    proximo = await fetchRaw(proximoNumero);
  } catch (err) {
    throw new Error(
      `Concurso ${proximoNumero} (próximo após o ${ultimoApurado.numero}) ainda não foi publicado pela Caixa. ` +
        `Tente novamente mais tarde. Causa original: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (jaApurado(proximo)) {
    throw new Error(
      `Concurso ${proximoNumero} já foi apurado (placar já saiu) e o concurso seguinte ainda não foi publicado. ` +
        `Não há concurso aberto para apostas no momento — tente novamente mais tarde.`
    );
  }

  return parseConcurso(proximo);
}

/** Busca um concurso específico pelo número (pode já estar apurado ou não). */
export async function fetchConcursoPorNumero(
  numero: number
): Promise<LotecaConcurso> {
  const raw = await fetchRaw(numero);
  return parseConcurso(raw);
}

/** Resultado real (placar) de um jogo já apurado, pra conferência (P0, `npm run conferir`). */
export interface ResultadoApurado {
  sequencial: number;
  golsCasa: number;
  golsVisitante: number;
  resultado: Resultado;
}

/**
 * Busca os placares de um concurso já apurado, pra comparar contra as
 * sugestões salvas na época (P0 — ver `scripts/conferir.ts`). Mesma API de
 * `fetchConcursoPorNumero`, mas extrai `nuGolEquipeUm`/`nuGolEquipeDois` em
 * vez de descartá-los. Lança erro claro se o concurso ainda não foi
 * apurado (algum jogo sem placar) — nesse caso não há o que conferir ainda.
 *
 * Usada como FALLBACK por `scripts/conferir.ts` — a fonte principal é
 * `src/data/numerosMegaSena.ts` (dado já vem com o resultado pronto, sem
 * precisar derivar de placar, e a resposta é mais previsível que esse
 * endpoint não documentado da Caixa).
 */
export async function fetchResultadoApuradoCaixa(numero: number): Promise<ResultadoApurado[]> {
  const raw = await fetchRaw(numero);
  const lista = raw.listaResultadoEquipeEsportiva ?? [];

  const semPlacar = lista.filter((j) => j.nuGolEquipeUm == null || j.nuGolEquipeDois == null);
  if (semPlacar.length > 0) {
    throw new Error(
      `Concurso ${numero} ainda não foi totalmente apurado — ${semPlacar.length} de ${lista.length} jogo(s) sem placar.`
    );
  }

  return lista.map((j) => {
    const golsCasa = j.nuGolEquipeUm!;
    const golsVisitante = j.nuGolEquipeDois!;
    return { sequencial: j.nuSequencial, golsCasa, golsVisitante, resultado: resultadoDoPlacar(golsCasa, golsVisitante) };
  });
}

/** Deriva o resultado (1/X/2) a partir do placar — pura, sem depender da API, pra ser testável isoladamente. */
export function resultadoDoPlacar(golsCasa: number, golsVisitante: number): Resultado {
  if (golsCasa > golsVisitante) return "casa";
  if (golsCasa < golsVisitante) return "visitante";
  return "empate";
}

async function fetchRaw(numero?: number): Promise<CaixaLotecaRawResponse> {
  const url = numero ? `${CAIXA_LOTECA_URL}${numero}` : CAIXA_LOTECA_URL;
  const res = await fetch(url, { headers: { Accept: "application/json" } });

  if (!res.ok) {
    throw new Error(
      `Falha ao buscar ${numero ? `concurso ${numero}` : "grade da Loteca"}: HTTP ${res.status} ${res.statusText}`
    );
  }

  return (await res.json()) as CaixaLotecaRawResponse;
}

/** Um concurso é considerado apurado se algum jogo já tem placar preenchido. */
function jaApurado(raw: CaixaLotecaRawResponse): boolean {
  return (raw.listaResultadoEquipeEsportiva ?? []).some(
    (j) => j.nuGolEquipeUm != null || j.nuGolEquipeDois != null
  );
}

function parseConcurso(raw: CaixaLotecaRawResponse): LotecaConcurso {
  const jogos: LotecaJogo[] = (raw.listaResultadoEquipeEsportiva ?? []).map((j) => ({
    concursoNumero: raw.numero,
    sequencial: j.nuSequencial,
    equipeCasa: normalizeTeamName(j.nomeEquipeUm),
    equipeVisitante: normalizeTeamName(j.nomeEquipeDois),
    ufCasa: j.siglaUFUm || undefined,
    ufVisitante: j.siglaUFDois || undefined,
    dataHora: parseDataJogo(j.dtJogo),
    campeonato: j.nomeCampeonato,
  }));

  if (jogos.length !== 14) {
    console.warn(
      `Aviso: concurso ${raw.numero} veio com ${jogos.length} jogos (esperado 14). ` +
        `Confira se o parsing está correto ou se o concurso ainda não foi publicado.`
    );
  }

  return {
    numero: raw.numero,
    dataApuracao: raw.dataApuracao,
    dataProximoConcurso: raw.dataProximoConcurso,
    valorEstimadoProximoConcurso: raw.valorEstimadoProximoConcurso,
    jogos,
  };
}

interface GradeManual {
  numero: number;
  aberturaApostas?: string;
  encerramentoApostas?: string;
  premioEstimado?: number;
  consultadoEm?: string;
  fonte?: string;
  jogos: Array<{
    sequencial: number;
    equipeCasa: string;
    ufCasa?: string;
    equipeVisitante: string;
    ufVisitante?: string;
  }>;
}

/**
 * Lê a grade de um concurso a partir de um arquivo JSON salvo manualmente
 * (pasta `manual-grades/`), em vez de chamar a API. Existe porque a API de
 * resultados (`fetchConcursoAtual`) fica atrasada em relação ao site de
 * apostas, e automatizar a leitura de lá esbarra no WAF anti-bot (ver
 * comentário em `fetchConcursoAtual`). O fluxo pretendido: peça pro
 * assistente consultar a grade manualmente (via navegador assistido, não
 * script automatizado) e salvar em `manual-grades/concurso-<numero>.json`;
 * configure `CONCURSO_MANUAL_PATH` no `.env` apontando pra esse arquivo.
 */
export async function fetchConcursoDeArquivo(caminho: string): Promise<LotecaConcurso> {
  const conteudo = await readFile(caminho, "utf-8");
  const grade = JSON.parse(conteudo) as GradeManual;

  if (grade.jogos.length !== 14) {
    console.warn(
      `Aviso: grade manual "${caminho}" tem ${grade.jogos.length} jogos (esperado 14).`
    );
  }

  const jogos: LotecaJogo[] = grade.jogos.map((j) => ({
    concursoNumero: grade.numero,
    sequencial: j.sequencial,
    equipeCasa: normalizeTeamName(j.equipeCasa),
    equipeVisitante: normalizeTeamName(j.equipeVisitante),
    ufCasa: j.ufCasa,
    ufVisitante: j.ufVisitante,
  }));

  return {
    numero: grade.numero,
    dataProximoConcurso: grade.encerramentoApostas,
    valorEstimadoProximoConcurso: grade.premioEstimado,
    jogos,
  };
}

/** Limpeza básica de nome de time vindo da Caixa (espaços extras, caixa). */
function normalizeTeamName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Converte "DD/MM/AAAA" (formato da Caixa, sem horário) para ISO "AAAA-MM-DD". */
function parseDataJogo(dtJogo?: string): string | undefined {
  if (!dtJogo) return undefined;
  const [dia, mes, ano] = dtJogo.split("/");
  if (!dia || !mes || !ano) return undefined;
  return `${ano}-${mes}-${dia}`;
}
