// ============================================================================
// NOMI DELLE CLASSI IN ARABO (solo Scuola Base / classi "medie")
//
// Le classi si scrivono in italiano in Impostazioni → Classi, per esempio
// "1 Elem. A". Nella versione araba la scheda deve leggersi "١ ابتدائى أ":
//   numero + livello + sezione, cifre arabo-indiane.
// Le classi dell'IPI NON passano di qui: restano in italiano.
//
// Se il nome non è riconoscibile (manca il livello, o è scritto in un modo
// che non conosciamo) viene lasciato esattamente com'è: meglio il nome
// originale che una traduzione sbagliata.
// ============================================================================

const CIFRE_ARABE = '٠١٢٣٤٥٦٧٨٩';

/** Livello scolastico → arabo. Le chiavi sono minuscole e senza punto finale. */
const LIVELLI: Record<string, string> = {
  // elementari
  elem: 'ابتدائى',
  elementare: 'ابتدائى',
  elementari: 'ابتدائى',
  primaria: 'ابتدائى',
  primary: 'ابتدائى',
  // medie
  media: 'إعدادى',
  medie: 'إعدادى',
  med: 'إعدادى',
  prep: 'إعدادى',
  preparatoria: 'إعدادى',
  // asilo
  asilo: 'روضة',
  infanzia: 'روضة',
  materna: 'روضة',
  kg: 'روضة',
};

/**
 * Livello scritto anche in forma abbreviata: "ele", "elem", "elementar" → elementari;
 * "med", "medi" → medie; "asi", "asil" → asilo. Serve almeno l'inizio della parola.
 */
function livelloDaToken(low: string): string | null {
  if (low in LIVELLI) return LIVELLI[low];
  const inizio = (parola: string, minimo: number) => low.length >= minimo && parola.startsWith(low);
  if (inizio('elementare', 2) || inizio('elementari', 2)) return LIVELLI.elem;
  if (inizio('media', 3) || inizio('medie', 3)) return LIVELLI.media;
  if (inizio('asilo', 3) || inizio('materna', 3)) return LIVELLI.asilo;
  return null;
}

/** Numeri scritti a parole ("prima", "seconda", …) → cifra. */
const ORDINALI: Record<string, number> = {
  prima: 1, primo: 1, seconda: 2, secondo: 2, terza: 3, terzo: 3,
  quarta: 4, quarto: 4, quinta: 5, quinto: 5, sesta: 6, sesto: 6,
};

/** Sezione A, B, C… → lettera araba usata nelle scuole (أ ب ج د هـ و ز ح). */
const SEZIONI: Record<string, string> = {
  a: 'أ', b: 'ب', c: 'ج', d: 'د', e: 'هـ', f: 'و', g: 'ز', h: 'ح',
};

function cifreArabe(n: number | string): string {
  return String(n).replace(/[0-9]/g, (c) => CIFRE_ARABE[Number(c)]);
}

/** Converte eventuali cifre arabo-indiane in cifre normali, per il riconoscimento. */
function cifreNormali(s: string): string {
  return s.replace(/[٠-٩]/g, (c) => String(CIFRE_ARABE.indexOf(c)));
}

/**
 * "1 Elem. A" → "١ ابتدائى أ". Se il nome non si riconosce, lo restituisce invariato.
 * Riconosce anche "1A Elem", "Prima Elementare B", "2 Media C", "Asilo A", "3° elem. B".
 */
export function traduciNomeClasseAr(nome?: string | null): string {
  const originale = nome ?? '';
  const pulito = cifreNormali(originale).trim();
  if (!pulito) return originale;

  // separa "1A" in "1 A" e toglie punti/segni ordinali (° º ª)
  const token = pulito
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/[.,°ºª\-_/]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let numero: number | null = null;
  let livello: string | null = null;
  let sezione: string | null = null;

  for (const tk of token) {
    const low = tk.toLowerCase();
    if (/^\d+$/.test(tk)) {
      if (numero !== null) return originale;
      numero = Number(tk);
    } else if (low in ORDINALI) {
      if (numero !== null) return originale;
      numero = ORDINALI[low];
    } else if (livelloDaToken(low)) {
      if (livello !== null) return originale;
      livello = livelloDaToken(low);
    } else if (/^[a-z]$/i.test(tk) && low in SEZIONI) {
      if (sezione !== null) return originale;
      sezione = SEZIONI[low];
    } else {
      // parola sconosciuta: non indoviniamo
      return originale;
    }
  }

  if (!livello) return originale;
  return [numero !== null ? cifreArabe(numero) : null, livello, sezione].filter(Boolean).join(' ');
}
