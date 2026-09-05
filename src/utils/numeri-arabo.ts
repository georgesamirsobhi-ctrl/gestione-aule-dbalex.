// ============================================================================
// Conversione cifre 0-9 → cifre arabo-indiane (٠١٢٣٤٥٦٧٨٩), usata in tutta
// l'app quando la lingua attiva è l'arabo: date, orari, capienze, numeri di
// classe/registro, contatori/badge — così i numeri appaiono in arabo invece
// di restare in cifre occidentali quando lang === 'ar'.
//
// Isolamento bidirezionale: un blocco come "16:00-17:00" o "2026-09-05",
// messo dentro una frase araba (RTL) senza precauzioni, viene visualmente
// rimescolato dal browser (i gruppi separati da "-"/":" vengono invertiti,
// es. "17:00-16:00" invece di "16:00-17:00"). Per evitarlo avvolgiamo ogni
// blocco convertito tra i caratteri Unicode LRI (Left-to-Right Isolate,
// U+2066) e PDI (Pop Directional Isolate, U+2069): sono invisibili, non
// alterano il testo visibile, ma dicono al motore di rendering "tratta
// questo blocco come un'unità da sinistra a destra, non riordinarne i
// gruppi in base al testo arabo intorno". Così l'ordine resta sempre quello
// scritto, qualunque sia il punto della frase araba in cui compare.
// ============================================================================
const CIFRE_ARABE = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const LRI = '⁦';
const PDI = '⁩';

/**
 * Converte ogni cifra 0-9 presente in `valore` nella corrispondente cifra
 * arabo-indiana, solo se `lang === 'ar'`, e isola il blocco da sinistra a
 * destra (vedi sopra) così l'ordine dei gruppi non viene invertito dal testo
 * arabo circostante. Con qualunque altra lingua restituisce `valore` così
 * com'è (convertito a stringa). Utile per date 'YYYY-MM-DD', orari
 * 'HH:MM-HH:MM', numeri semplici, conteggi in una frase, ecc.
 */
export function numArabo(valore: string | number | null | undefined, lang: string): string {
  if (valore === null || valore === undefined) return '';
  const str = String(valore);
  if (lang !== 'ar') return str;
  const convertito = str.replace(/[0-9]/g, (cifra) => CIFRE_ARABE[Number(cifra)]);
  return `${LRI}${convertito}${PDI}`;
}

/**
 * Formatta una data ISO 'YYYY-MM-DD' per la visualizzazione: in italiano
 * resta invariata (2026-09-05); in arabo diventa '٢٠٢٦/٠٩/٠٥' — stesso ordine
 * anno/mese/giorno, cifre arabo-indiane, separatore "/" invece di "-", e
 * isolata da sinistra a destra (vedi numArabo) così l'ordine non viene mai
 * invertito dal testo arabo intorno.
 */
export function dataArabo(dataIso: string | null | undefined, lang: string): string {
  if (!dataIso) return '';
  if (lang !== 'ar') return dataIso;
  const parti = dataIso.split('-');
  const formattata = parti.length === 3 ? parti.join('/') : dataIso;
  return numArabo(formattata, lang);
}
