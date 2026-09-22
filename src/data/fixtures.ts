import type { LotecaConcurso, LotecaJogo } from "../types.js";

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
