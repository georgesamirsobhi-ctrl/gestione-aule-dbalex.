// ============================================================================
// AULA STUDIO — tipi condivisi tra i componenti del modulo.
// ============================================================================
import type { Firestore } from 'firebase/firestore';

import type { AulaStudioConfig, StatoPresenzaAulaStudio, StatoPrenotazioneAulaStudio } from './aula-studio-utils';

/** Un documento della collection aulaStudioPrenotazioni. */
export interface PrenotazioneAulaStudio {
  id: string;
  aulaId: string;
  aulaNome: string;
  data: string; // 'YYYY-MM-DD'
  fascia: string; // 'HH:MM-HH:MM'
  nome: string;
  cognome: string;
  numero: string;
  classe: string;
  chiaveStudente: string;
  utenteUid: string | null;
  utenteEmail: string | null;
  stato: StatoPrenotazioneAulaStudio;
  statoPresenza: StatoPresenzaAulaStudio;
  prenotazioneManuale: boolean;
  timestampCreazione: number; // Date.now(), usato per l'ordine FIFO della waitlist
  createdAt?: string; // ISO, informativo
}

/** Un documento della collection aulaStudioSanzioni (un pallino rosso). */
export interface SanzioneAulaStudio {
  id: string;
  chiaveStudente: string;
  nome: string;
  cognome: string;
  classe: string;
  numero: string;
  data: string; // 'YYYY-MM-DD' del giorno in cui è stato dato
  motivo: string;
  semestre: string; // es. '2026-S1', da calcolaSemestreCorrente
  creatoDaUid: string;
  creatoDaNome: string;
  timestamp: number;
}

/** Un documento della collection aulaStudioBlocchi. */
export interface BloccoAulaStudio {
  id: string;
  chiaveStudente: string;
  nome: string;
  classe: string;
  numero: string;
  bloccatoFino: string; // 'YYYY-MM-DD', ultimo giorno di blocco incluso
  motivo: string;
  azione: 'blocco' | 'rifiuto' | 'altra_possibilita';
  creatoDaUid: string;
  creatoDaNome: string;
  timestamp: number;
}

/** Una classe (collection Firestore "classi"), con l'eventuale divisione Medie/IPI usata dal wizard Aula Studio. */
export interface ClasseConTipo {
  id: string;
  nome: string;
  tipo?: 'medie' | 'ipi' | null;
}

/**
 * Una "aula" del modulo Aula Studio (collection Firestore aulaStudioAule), gestibile
 * dal gestore: si può aggiungere più di un'aula per ciascun tipo scuola (es. "Aula
 * Studio Medie 1", "Aula Studio Medie 2"), riordinare e rinominare in italiano/arabo.
 * Ogni aula ha la propria configurazione (fasce/posti/ferie) tramite aulaStudioConfig,
 * chiave = id di questo documento.
 */
export interface AulaStudioAula {
  id: string;
  nome: string;
  nomeAr?: string;
  tipoScuola: 'medie' | 'ipi';
  ordine: number;
}

/** Dati raccolti dal wizard di registrazione Aula Studio (primo accesso), salvati una sola volta sul profilo. */
export interface ProfiloAulaStudioStudente {
  tipoScuola: 'medie' | 'ipi';
  classe: string;
  numeroRegistro: string;
  nomeStudente: string;
  cognomeStudente: string;
}

export type StatoRichiestaTurno = 'in attesa' | 'confermata' | 'rifiutata' | 'scaduta';

/**
 * Richiesta di un insegnante di fare da assistenza volontaria in Aula Studio
 * per una data/fasce specifiche. Una volta confermata da un gestore Aula Studio
 * (gestore/presideIpi/vicePresideIpi/segreteria), l'insegnante ottiene accesso
 * completo alla pagina Appello per quella aula/giorno/fascia.
 */
export interface RichiestaTurno {
  id: string;
  insegnanteUid: string;
  insegnanteNome: string;
  insegnanteEmail: string | null;
  aulaId: string;
  aulaNome: string;
  data: string; // 'YYYY-MM-DD'
  fasce: string[]; // una o più fasce 'HH:MM-HH:MM' richieste per quel giorno
  stato: StatoRichiestaTurno;
  creatoTimestamp: number;
  decisoDaUid?: string;
  decisoDaNome?: string;
  decisoTimestamp?: number;
}

/** Props condivise da tutti i componenti del modulo Aula Studio, passate dal parent (index.tsx). */
export interface AulaStudioSharedProps {
  db: Firestore;
  user: { uid: string; email: string | null } | null;
  userName: string;
  userRole: string;
  lang: 'it' | 'ar';
  isRTL: boolean;
  colors: Record<string, string>;
  t: (key: string, lang: string, ...args: any[]) => any;
  mostraAlert: (titolo: string, messaggio: string) => void;
  canGestireAulaStudio: boolean;
  registraAttivita: (tipo: string, dettaglio: string) => Promise<void>;
  inviaNotificaConPreferenza: (
    destinatarioUid: string,
    categoria: string,
    titolo: string,
    corpo: string,
    extra?: Record<string, any>
  ) => Promise<void>;
  scriviECondividiExcel: (nomeFile: string, righe: Record<string, any>[]) => Promise<void>;
  /** Elenco classi (collection "classi"), con tipo Medie/IPI se assegnato — usato dal wizard per filtrare la lista classi. */
  classiLista: ClasseConTipo[];
  /** Profilo Aula Studio già salvato per lo studente loggato (null se non ancora completato). */
  profiloAulaStudio: ProfiloAulaStudioStudente | null;
  /** Richiamata dal wizard dopo il salvataggio riuscito, per far ricaricare il profilo utente nel parent. */
  onProfiloAulaStudioSalvato: () => void;
  /** Utenti che possono gestire l'Aula Studio (gestore/presideIpi/vicePresideIpi/segreteria), usato per notificare le nuove richieste di turno insegnanti. */
  gestoriAulaStudio: { uid: string; nome: string }[];
  /** Id della richiesta di turno da aprire automaticamente (deep-link da una notifica), o null/assente. */
  richiestaTurnoDaAprireId?: string | null;
  /** Richiamata dal componente dopo aver "consumato" richiestaTurnoDaAprireId, per pulire lo stato nel parent. */
  onRichiestaTurnoAperta?: () => void;
  /** Insegnanti (utenti con role 'insegnante'), usato dal responsabile per assegnare direttamente un turno. */
  insegnantiAulaStudio?: { uid: string; nome: string; email: string | null }[];
}

export type AulaStudioConfigPerAula = Record<string, AulaStudioConfig>;
