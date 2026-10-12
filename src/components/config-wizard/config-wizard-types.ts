// ============================================================================
// WIZARD DI CONFIGURAZIONE INIZIALE — tipi condivisi tra il container e i 4
// passi (Classi, Aule, Fasce orarie Aula Studio, Ferie). Il wizard non ha uno
// stato proprio salvato: ogni passo legge/scrive direttamente le collection
// Firestore già esistenti (classi, aule, sezioni, aulaStudioAule,
// aulaStudioConfig), quindi riaprendolo mostra sempre lo stato reale attuale
// — mai vuoto se i dati esistono già, coerentemente in ogni punto dell'app.
// ============================================================================
import type { Firestore } from 'firebase/firestore';

import type { ClasseConTipo } from '../aula-studio/aula-studio-types';

/** Una "sezione scolastica" (collection Firestore "sezioni"): Scuola Base, Scuola Media, Scuola Professionale, Comuni, più la riga speciale "Aula Studio" usata solo per la navigazione. */
export interface SezioneScolastica {
  id: string;
  nome: string;
  nomeAr?: string;
  ordine: number;
  speciale?: 'aulaStudio';
}

/** Una "aula" generale (collection Firestore "aule"): capienza qui è solo informativa, nessuna logica del sistema di prenotazione generale la usa. */
export interface AulaGenerale {
  id: string;
  nome: string;
  nomeAr?: string;
  capienza: string;
  sezione: string; // nome della sezione scolastica di appartenenza
  ordine: number;
}

/** Props condivise da tutti i passi del wizard, passate dal container (config-wizard.tsx). */
export interface ConfigWizardSharedProps {
  db: Firestore;
  lang: 'it' | 'ar';
  isRTL: boolean;
  colors: Record<string, string>;
  t: (key: string, lang: string, ...args: any[]) => any;
  mostraAlert: (titolo: string, messaggio: string) => void;
  registraAttivita: (tipo: string, dettaglio: string) => Promise<void>;
  /** Permessi già calcolati dal parent (haPermesso + tabella permessi personalizzati): decidono quali passo/tab del wizard sono visibili. */
  canGestireClassi: boolean;
  canGestireAule: boolean;
  canGestireAulaStudio: boolean;
  /** Elenco classi aggiornato (ricaricato dal parent dopo ogni scrittura del wizard). */
  classiLista: ClasseConTipo[];
  /** Elenco aule generali aggiornato (ricaricato dal parent dopo ogni scrittura del wizard). */
  aule: AulaGenerale[];
  /** Elenco sezioni scolastiche (incluse le eventuali aggiunte dal gestore), riga "Aula Studio" inclusa. */
  sezioniLista: SezioneScolastica[];
  /** Richiamata dopo ogni scrittura su classi/aule/sezioni, per far ricaricare classiLista/aule/sezioniLista nel parent (stesso pattern di caricaDatiGenerali già usato in tutta l'app). */
  onRicaricaDatiGenerali: () => void;
}
