// ============================================================================
// REGOLE DI APPROVAZIONE DELLE PRENOTAZIONI — un solo posto dove si decide
// "chi può approvare cosa". Se la regola cambia, si cambia solo qui.
//
// Regole attuali:
//  - Direttore (gestore) ed Economo: approvano TUTTO. Le loro prenotazioni
//    nascono già "Approvata" (nessuna attesa).
//  - Scuola Base (asilo, elementari, medie): Preside Base + Segreteria Base.
//  - Scuola Professionale (classi IPI):
//      · classi prime, terze (e senza anno): Preside IPI, Vice Preside IPI,
//        Segreteria IPI;
//      · classi seconde: fino alle 16:00 (ora di INIZIO della prenotazione) gli
//        stessi tre; dalle 16:00 in poi Responsabile TEVT + Segreteria TEVT.
//  - TEVT: Responsabile TEVT + Segreteria TEVT.
//  - Comuni: Oratorio (oltre a Direttore ed Economo).
//  - Sezione sconosciuta (aggiunta a mano): solo Direttore ed Economo.
//
// Le sezioni si riconoscono dalla CHIAVE interna (base, professionale, tevt,
// comuni), non dal nome: si può rinominare una sezione senza rompere le regole.
// ============================================================================

export type ChiaveSezione = 'base' | 'professionale' | 'tevt' | 'comuni';

/** Le 4 sezioni fisse (non eliminabili, ma rinominabili). */
export const CHIAVI_SEZIONI_FISSE: ChiaveSezione[] = ['base', 'professionale', 'tevt', 'comuni'];

/** Ora (HH:MM) dalla quale le prenotazioni delle classi seconde IPI passano al TEVT. */
export const ORA_LIMITE_SECONDE_IPI = '16:00';

export const RUOLI_AUTO_APPROVAZIONE = ['gestore', 'economo'];

const RUOLI_SEMPRE_APPROVATORI = ['gestore', 'economo'];
const RUOLI_IPI = ['presideIpi', 'vicePresideIpi', 'segreteria'];
const RUOLI_TEVT = ['TEVT', 'segreteriaTevt'];
const RUOLI_BASE = ['presideAbm', 'segreteriaSBase'];
const RUOLI_COMUNI = ['oratorio'];

/** Tutti i ruoli citati dalle regole: per questi decide la regola; per gli altri vale il permesso personalizzato. */
export const RUOLI_CON_AMBITO_APPROVAZIONE = [
  ...RUOLI_SEMPRE_APPROVATORI,
  ...RUOLI_IPI,
  ...RUOLI_TEVT,
  ...RUOLI_BASE,
  ...RUOLI_COMUNI,
];

/** Riconosce la sezione fissa dal nome (usato solo se il documento non ha ancora la chiave). */
export function derivaChiaveDaNome(nome?: string | null): ChiaveSezione | null {
  const n = (nome || '').toLowerCase();
  if (!n) return null;
  if (n.includes('tevt') || n.includes('tvet')) return 'tevt';
  if (n.includes('prof') || n.includes('ipi') || n.includes('cfp')) return 'professionale';
  if (n.includes('comun')) return 'comuni';
  if (n.includes('base') || n.includes('medi') || n.includes('element') || n.includes('asilo')) return 'base';
  return null;
}

/** Chiave di una sezione: quella salvata, altrimenti dedotta dal nome. Aula Studio (speciale) → null. */
export function chiaveSezione(sez?: { chiave?: string; nome?: string; speciale?: string } | null): ChiaveSezione | null {
  if (!sez || sez.speciale) return null;
  if (sez.chiave && (CHIAVI_SEZIONI_FISSE as string[]).includes(sez.chiave)) return sez.chiave as ChiaveSezione;
  return derivaChiaveDaNome(sez.nome);
}

/** Chiave della sezione a partire dal suo nome (come salvato nelle aule/prenotazioni). */
export function chiaveDaNomeSezione(nomeSezione: string | null | undefined, sezioniLista: any[]): ChiaveSezione | null {
  if (!nomeSezione) return null;
  const sez = (sezioniLista || []).find((s) => s.nome === nomeSezione);
  return sez ? chiaveSezione(sez) : derivaChiaveDaNome(nomeSezione);
}

const CIFRE_ARABE = '٠١٢٣٤٥٦٧٨٩';

/** Anno della classe dal nome ("2B" → 2, "٣أ" → 3, "Seconda A" → 2). null se non riconoscibile. */
export function annoDaNomeClasse(nome?: string | null): number | null {
  const s = (nome || '').trim().toLowerCase();
  if (!s) return null;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') return Number(ch);
    const idx = CIFRE_ARABE.indexOf(ch);
    if (idx >= 0) return idx;
  }
  if (/\bprima\b|\bfirst\b|^i[^a-z]/.test(s)) return 1;
  if (/\bseconda\b|\bsecond\b|^ii[^a-z]/.test(s)) return 2;
  if (/\bterza\b|\bthird\b|^iii[^a-z]/.test(s)) return 3;
  return null;
}

/** Anno effettivo di una classe: quello scelto a mano se c'è, altrimenti quello dedotto dal nome. */
export function annoClasse(classe?: { nome?: string; anno?: number | string | null } | null): number | null {
  if (!classe) return null;
  const manuale = classe.anno === '' || classe.anno == null ? null : Number(classe.anno);
  if (manuale && !isNaN(manuale)) return manuale;
  return annoDaNomeClasse(classe.nome);
}

/** Ora di inizio (HH:MM) più presto tra le fasce 'HH:MM-HH:MM' scelte. null se non ce ne sono. */
export function oraInizioDaFasce(fasce?: string[] | null): string | null {
  const inizi = (fasce || [])
    .map((f) => (f || '').split('-')[0].trim())
    .filter((s) => /^\d{1,2}:\d{2}$/.test(s))
    .map((s) => s.padStart(5, '0'))
    .sort();
  return inizi.length > 0 ? inizi[0] : null;
}

export interface ContestoApprovazione {
  sezione: ChiaveSezione | null;
  /** Anno della classe prenotata (solo Scuola Professionale). */
  anno?: number | null;
  /** Ora di inizio della prenotazione, 'HH:MM'. */
  oraInizio?: string | null;
}

/** Elenco dei ruoli che possono approvare una prenotazione con questo contesto. */
export function ruoliApprovatori(ctx: ContestoApprovazione): string[] {
  const ruoli = [...RUOLI_SEMPRE_APPROVATORI];
  switch (ctx.sezione) {
    case 'base':
      ruoli.push(...RUOLI_BASE);
      break;
    case 'tevt':
      ruoli.push(...RUOLI_TEVT);
      break;
    case 'comuni':
      ruoli.push(...RUOLI_COMUNI);
      break;
    case 'professionale': {
      const dopoLimite = !!ctx.oraInizio && ctx.oraInizio >= ORA_LIMITE_SECONDE_IPI;
      if (ctx.anno === 2 && dopoLimite) ruoli.push(...RUOLI_TEVT);
      else ruoli.push(...RUOLI_IPI);
      break;
    }
    default:
      break;
  }
  return ruoli;
}

/** Questo ruolo può approvare/rifiutare una prenotazione con questo contesto? */
export function puoApprovareRuolo(ruolo: string | null | undefined, ctx: ContestoApprovazione): boolean {
  if (!ruolo) return false;
  return ruoliApprovatori(ctx).includes(ruolo);
}

/** Le prenotazioni di questo ruolo nascono già approvate? */
export function approvazioneAutomatica(ruolo: string | null | undefined): boolean {
  return !!ruolo && RUOLI_AUTO_APPROVAZIONE.includes(ruolo);
}
