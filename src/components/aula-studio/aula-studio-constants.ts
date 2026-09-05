// ============================================================================
// AULA STUDIO — costanti condivise (nomi collection Firestore, id aule, ruoli).
// ============================================================================

/** Nomi delle collection Firestore dedicate al modulo Aula Studio. */
export const COLLEZIONI_AULA_STUDIO = {
  CONFIG: 'aulaStudioConfig',
  PRENOTAZIONI: 'aulaStudioPrenotazioni',
  SANZIONI: 'aulaStudioSanzioni',
  BLOCCHI: 'aulaStudioBlocchi',
  /** Contatori "posti confermati" per aula/giorno/fascia — vedi chiaveContatorePosti in aula-studio-data.ts. */
  CONTATORI: 'aulaStudioContatori',
  /** Richieste di turno degli insegnanti (assistenza volontaria in Aula Studio). */
  TURNI: 'aulaStudioTurni',
  /** Aule del modulo Aula Studio (gestibili: aggiunta, riordino, rinomina IT/AR, tipo scuola). */
  AULE: 'aulaStudioAule',
} as const;

/** Minuti di anticipo entro cui una fascia diventa "sbloccata" (azioni consentite) rispetto al suo orario di inizio. */
export const MINUTI_ANTICIPO_SBLOCCO_FASCIA = 5;

/** Id stabili delle due aule Aula Studio iniziali, usati come chiave di aulaStudioConfig e come aulaId sulle prenotazioni. */
export const AULA_STUDIO_MEDIE_ID = 'aula-studio-medie';
export const AULA_STUDIO_IPI_ID = 'aula-studio-ipi';

/**
 * Dati di semina (usati una sola volta, alla prima apertura del modulo, per creare
 * i documenti iniziali nella collection aulaStudioAule se è vuota). Da lì in poi le
 * aule sono gestite dal gestore (aggiunta, riordino, rinomina IT/AR) tramite
 * useAulaStudioAule/aggiungiAulaStudioAula in aula-studio-data.ts — questo array
 * NON va più usato direttamente dai componenti.
 */
export const AULE_STUDIO_SEED = [
  { id: AULA_STUDIO_MEDIE_ID, nome: 'Aula Studio Medie', nomeAr: 'قاعة دراسة الإعدادية', tipoScuola: 'medie' as const },
  { id: AULA_STUDIO_IPI_ID, nome: 'Aula Studio IPI', nomeAr: 'قاعة دراسة المعهد الصناعي', tipoScuola: 'ipi' as const },
];

export const SEZIONE_AULA_STUDIO = 'Aula Studio';

/**
 * Ruoli che di default possono gestire l'Aula Studio (appello, pallini, sanzioni,
 * impostazioni): Gestore, Preside IPI, Vice Preside IPI, Segreteria e i ruoli
 * "tipo segreteria". Resta comunque sovrascrivibile dalla tabella permessi esistente
 * (Impostazioni Avanzate), come tutti gli altri permessi dell'app.
 */
export function puoGestireAulaStudio(ruolo: string): boolean {
  return (
    ruolo === 'gestore' ||
    ruolo === 'presideIpi' ||
    ruolo === 'vicePresideIpi' ||
    ruolo === 'segreteria'
  );
}

/** Le 3 azioni disponibili al responsabile quando uno studente raggiunge 3 pallini nel semestre. */
export const AZIONI_TERZO_PALLINO = {
  BLOCCA: 'blocco',
  RIFIUTA: 'rifiuto',
  ALTRA_POSSIBILITA: 'altra_possibilita',
} as const;

export type AzioneTerzoPallino = (typeof AZIONI_TERZO_PALLINO)[keyof typeof AZIONI_TERZO_PALLINO];

/** Chiavi del registro attività (registraAttivita) usate dal modulo Aula Studio. */
export const TIPI_REGISTRO_AULA_STUDIO = {
  PRENOTAZIONE: 'aula_studio_prenotazione',
  CANCELLAZIONE: 'aula_studio_cancellazione',
  PROMOZIONE_WAITLIST: 'aula_studio_promozione_waitlist',
  AGGIUNTA_MANUALE: 'aula_studio_aggiunta_manuale',
  PRESENZA_AGGIORNATA: 'aula_studio_presenza_aggiornata',
  PALLINO_ROSSO: 'aula_studio_pallino_rosso',
  AZIONE_TERZO_PALLINO: 'aula_studio_azione_terzo_pallino',
  MODIFICA_CONFIG: 'aula_studio_modifica_config',
  RIMOZIONE_PALLINO: 'aula_studio_rimozione_pallino',
  RICHIESTA_TURNO: 'aula_studio_richiesta_turno',
  CONFERMA_TURNO: 'aula_studio_conferma_turno',
  RIFIUTO_TURNO: 'aula_studio_rifiuto_turno',
  SCADENZA_TURNO: 'aula_studio_scadenza_turno',
  GESTIONE_AULE: 'aula_studio_gestione_aule',
} as const;
