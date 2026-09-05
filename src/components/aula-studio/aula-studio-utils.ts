// ============================================================================
// AULA STUDIO — funzioni di utilità pure (nessuna dipendenza da React/Firebase)
// Condivise tra la vista Studente, la vista Responsabile e le Impostazioni.
// ============================================================================

/** Una fascia oraria configurabile, es. { inizio: '15:00', fine: '16:00' }. */
export interface FasciaOraria {
  inizio: string; // 'HH:MM'
  fine: string; // 'HH:MM'
}

/** Un intervallo di ferie extra configurato dal responsabile (inizio/fine incluse). */
export interface IntervalloFerie {
  inizio: string; // 'YYYY-MM-DD'
  fine: string; // 'YYYY-MM-DD'
  etichetta?: string;
}

export interface AulaStudioConfig {
  posti: number;
  fasce: FasciaOraria[];
  anticipoGiorni: number;
  ferieExtra: IntervalloFerie[];
  semestre1Inizio: string; // 'MM-DD', default '09-01'
  semestre2Inizio: string; // 'MM-DD', default '02-01'
}

export const AULA_STUDIO_CONFIG_DEFAULT: AulaStudioConfig = {
  posti: 20,
  fasce: [
    { inizio: '15:00', fine: '16:00' },
    { inizio: '16:00', fine: '17:00' },
    { inizio: '17:00', fine: '18:00' },
  ],
  anticipoGiorni: 2,
  ferieExtra: [],
  semestre1Inizio: '09-01',
  semestre2Inizio: '02-01',
};

export type StatoPrenotazioneAulaStudio = 'Confermata' | 'In attesa';

export type StatoPresenzaAulaStudio =
  | 'Non verificato'
  | 'Presente'
  | 'Assente'
  | 'In Ritardo'
  | 'Uscito Anticipo';

/** Formatta una fascia come stringa stabile da salvare sui documenti, es. '15:00-16:00'. */
export function formattaFascia(fascia: FasciaOraria): string {
  return `${fascia.inizio}-${fascia.fine}`;
}

/** Estrae { inizio, fine } da una stringa 'HH:MM-HH:MM' salvata su un documento. */
export function parseFasciaStringa(fasciaStr: string): FasciaOraria | null {
  const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(fasciaStr || '');
  if (!match) return null;
  return { inizio: match[1], fine: match[2] };
}

/** Normalizza il valore "classe" per confronti stabili (spazi, maiuscole). */
export function normalizzaClasse(classe: string): string {
  return (classe || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Normalizza il "numero in classe" (accetta stringa o numero, toglie zeri iniziali). */
export function normalizzaNumero(numero: string | number): string {
  const s = String(numero ?? '').trim();
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? String(n) : s;
}

/**
 * Identità stabile dello studente per pallini/sanzioni/blocchi/appello,
 * indipendente dall'account con cui prenota: Classe + Numero.
 * Il nome NON entra nella chiave (potrebbe essere scritto in modo diverso
 * ogni volta), ma va sempre salvato sul documento per la visualizzazione.
 */
export function calcolaChiaveStudente(classe: string, numero: string | number): string {
  return `${normalizzaClasse(classe)}#${normalizzaNumero(numero)}`;
}

/** 'YYYY-MM-DD' di oggi, nel fuso orario locale del dispositivo. */
export function oggiIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const gg = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${gg}`;
}

/** Converte 'YYYY-MM-DD' in un Date a mezzanotte locale (evita problemi di fuso con new Date(str)). */
export function parseDataIso(dataIso: string): Date {
  const [anno, mese, giorno] = (dataIso || '').split('-').map((v) => parseInt(v, 10));
  return new Date(anno || 1970, (mese || 1) - 1, giorno || 1);
}

export function formattaDataIso(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const gg = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${gg}`;
}

/** Sposta una data (YYYY-MM-DD) di `delta` giorni di calendario (può essere negativo). */
export function spostaGiorno(dataIso: string, delta: number): string {
  const d = parseDataIso(dataIso);
  d.setDate(d.getDate() + delta);
  return formattaDataIso(d);
}

/** Il lunedì della settimana civile (lun-dom) a cui appartiene `dataIso`. */
export function inizioSettimana(dataIso: string): string {
  const d = parseDataIso(dataIso);
  const giornoSettimana = d.getDay(); // 0=domenica..6=sabato
  const offset = giornoSettimana === 0 ? -6 : 1 - giornoSettimana; // porta al lunedì
  d.setDate(d.getDate() + offset);
  return formattaDataIso(d);
}

/** true se la data cade in uno degli intervalli di ferie extra configurati. */
export function isFerieExtra(dataIso: string, ferieExtra: IntervalloFerie[]): boolean {
  return (ferieExtra || []).some((f) => dataIso >= f.inizio && dataIso <= f.fine);
}

/**
 * Giorni di vacanza fissi per l'Aula Studio: venerdì e domenica (non il weekend
 * "standard" sabato/domenica), più le eventuali ferie extra configurate.
 */
export function isGiornoVacanza(dataIso: string, ferieExtra: IntervalloFerie[] = []): boolean {
  const giornoSettimana = parseDataIso(dataIso).getDay(); // 0=Domenica ... 5=Venerdì, 6=Sabato
  if (giornoSettimana === 0 || giornoSettimana === 5) return true;
  return isFerieExtra(dataIso, ferieExtra);
}

export function isGiornoLavorativo(dataIso: string, ferieExtra: IntervalloFerie[] = []): boolean {
  return !isGiornoVacanza(dataIso, ferieExtra);
}

/** Aggiunge N giorni LAVORATIVI (esclude venerdì/domenica/ferie extra) a una data 'YYYY-MM-DD'. */
export function aggiungiGiorniLavorativi(
  dataIsoPartenza: string,
  numeroGiorni: number,
  ferieExtra: IntervalloFerie[] = []
): string {
  let corrente = parseDataIso(dataIsoPartenza);
  let rimanenti = numeroGiorni;
  let sicurezza = 0;
  while (rimanenti > 0 && sicurezza < 3650) {
    corrente = new Date(corrente.getFullYear(), corrente.getMonth(), corrente.getDate() + 1);
    sicurezza++;
    if (isGiornoLavorativo(formattaDataIso(corrente), ferieExtra)) {
      rimanenti--;
    }
  }
  return formattaDataIso(corrente);
}

/**
 * true se `dataIso` è entro il limite di anticipo massimo consentito per la
 * prenotazione (oggi compreso, fino a `anticipoGiorni` giorni di calendario avanti).
 */
export function isEntroLimiteAnticipo(dataIso: string, anticipoGiorni: number): boolean {
  const oggi = parseDataIso(oggiIso());
  const target = parseDataIso(dataIso);
  const diffMs = target.getTime() - oggi.getTime();
  const diffGiorni = Math.round(diffMs / 86400000);
  return diffGiorni >= 0 && diffGiorni <= anticipoGiorni;
}

/** true se l'orario di inizio della fascia, per la data indicata, è già passato rispetto a ora. */
export function fasciaGiaIniziata(dataIso: string, fascia: FasciaOraria, adesso: Date = new Date()): boolean {
  const [oreStr, minStr] = fascia.inizio.split(':');
  const inizio = parseDataIso(dataIso);
  inizio.setHours(parseInt(oreStr, 10) || 0, parseInt(minStr, 10) || 0, 0, 0);
  return adesso.getTime() >= inizio.getTime();
}

/** true se manca meno di `minutiAnticipo` minuti (o è già iniziata) all'inizio della fascia — usato per sbloccare in anticipo azioni/tabelle delle fasce successive. */
export function fasciaSbloccataAnticipo(
  dataIso: string,
  fascia: FasciaOraria,
  minutiAnticipo: number,
  adesso: Date = new Date()
): boolean {
  const [oreStr, minStr] = fascia.inizio.split(':');
  const inizio = parseDataIso(dataIso);
  inizio.setHours(parseInt(oreStr, 10) || 0, parseInt(minStr, 10) || 0, 0, 0);
  const sogliaMs = inizio.getTime() - minutiAnticipo * 60000;
  return adesso.getTime() >= sogliaMs;
}

/** true se l'orario di fine della fascia, per la data indicata, è già passato rispetto a ora — usato per la scadenza automatica delle richieste di turno. */
export function fasciaTerminata(dataIso: string, fascia: FasciaOraria, adesso: Date = new Date()): boolean {
  const [oreStr, minStr] = fascia.fine.split(':');
  const fine = parseDataIso(dataIso);
  fine.setHours(parseInt(oreStr, 10) || 0, parseInt(minStr, 10) || 0, 0, 0);
  return adesso.getTime() >= fine.getTime();
}

/**
 * Identificativo del semestre corrente (per il reset dei pallini rossi), es. '2026-S1'.
 * S1 va da semestre1Inizio (default 1 settembre) a un giorno prima di semestre2Inizio;
 * S2 va da semestre2Inizio (default 1 febbraio) a un giorno prima di semestre1Inizio.
 * L'anno nell'etichetta è l'anno scolastico di inizio (es. l'anno di settembre per S1,
 * lo stesso anno di settembre precedente per S2).
 */
export function calcolaSemestreCorrente(
  dataIso: string,
  semestre1Inizio: string = '09-01',
  semestre2Inizio: string = '02-01'
): string {
  const data = parseDataIso(dataIso);
  const anno = data.getFullYear();
  const meseGiorno = `${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;

  // Caso normale: semestre1 inizia prima nell'anno solare del semestre2 (es. 09-01 vs 02-01,
  // che "scavalca" l'anno) — gestiamo esplicitamente lo scavalco.
  const scavalcaAnno = semestre1Inizio > semestre2Inizio;

  if (scavalcaAnno) {
    // Es: S1 dal 09-01, S2 dal 02-01. Da 02-01 (incl.) a 08-31 → S2 dell'anno scolastico
    // iniziato a settembre dell'anno precedente. Da 09-01 (incl.) a 01-31 → S1 dell'anno corrente.
    if (meseGiorno >= semestre1Inizio) {
      return `${anno}-S1`;
    }
    if (meseGiorno >= semestre2Inizio) {
      return `${anno - 1}-S2`;
    }
    // Prima di semestre2Inizio (es. gennaio, prima del 02-01): ancora S1 dell'anno scolastico
    // iniziato a settembre dell'anno precedente.
    return `${anno - 1}-S1`;
  }

  // Caso semplice: semestre1Inizio < semestre2Inizio nello stesso anno solare.
  if (meseGiorno >= semestre2Inizio) return `${anno}-S2`;
  if (meseGiorno >= semestre1Inizio) return `${anno}-S1`;
  return `${anno - 1}-S2`;
}

/** Testo/colore da mostrare per lo stato "sanzionato" di uno studente nel semestre corrente. */
export function calcolaStatoSanzioni(numeroPalliniSemestre: number): {
  sottoAvviso: boolean;
} {
  return { sottoAvviso: numeroPalliniSemestre >= 3 };
}

// ---------------------------------------------------------------------------
// Formattazione mesi (condivisa da tutti i calendari popup del modulo)
// ---------------------------------------------------------------------------

export const NOMI_MESI_BREVI: Record<'it' | 'ar', string[]> = {
  it: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
};

export function formattaMeseAnno(ym: string, lang: 'it' | 'ar'): string {
  const [anno, mese] = ym.split('-');
  const mesi = NOMI_MESI_BREVI[lang] || NOMI_MESI_BREVI.it;
  return `${mesi[parseInt(mese, 10) - 1] || mese} ${anno}`;
}

/** Il mese 'YYYY-MM' successivo (o precedente, con delta negativo) a quello indicato. */
export function spostaMese(ym: string, delta: number): string {
  const [anno, mese] = ym.split('-').map((v) => parseInt(v, 10));
  const d = new Date(anno, mese - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Numero di giorni nel mese 'YYYY-MM'. */
export function giorniNelMese(ym: string): number {
  const [anno, mese] = ym.split('-').map((v) => parseInt(v, 10));
  return new Date(anno, mese, 0).getDate();
}

export const NOMI_GIORNI_BREVI: Record<'it' | 'ar', string[]> = {
  it: ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'],
  ar: ['إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت', 'أحد'],
};

/** Etichetta "1 - 7 Settembre 2026" (o "28 Ago - 3 Set 2026" se la settimana attraversa due mesi) per la settimana che inizia al lunedì `lunediIso`. */
export function formattaSettimana(lunediIso: string, lang: 'it' | 'ar'): string {
  const domenicaIso = spostaGiorno(lunediIso, 6);
  const mesi = NOMI_MESI_BREVI[lang] || NOMI_MESI_BREVI.it;
  const dLun = parseDataIso(lunediIso);
  const dDom = parseDataIso(domenicaIso);
  const meseLun = mesi[dLun.getMonth()].substring(0, 3);
  const meseDom = mesi[dDom.getMonth()].substring(0, 3);
  if (dLun.getMonth() === dDom.getMonth() && dLun.getFullYear() === dDom.getFullYear()) {
    return `${dLun.getDate()} - ${dDom.getDate()} ${mesi[dLun.getMonth()]} ${dLun.getFullYear()}`;
  }
  return `${dLun.getDate()} ${meseLun} - ${dDom.getDate()} ${meseDom} ${dDom.getFullYear()}`;
}

/** Nome da mostrare per un'aula Aula Studio, nella lingua corrente (nomeAr se presente e lang='ar', altrimenti nome). */
export function nomeAulaStudio(aula: { nome: string; nomeAr?: string } | undefined | null, lang: 'it' | 'ar'): string {
  if (!aula) return '';
  return lang === 'ar' && aula.nomeAr && aula.nomeAr.trim() ? aula.nomeAr : aula.nome;
}
