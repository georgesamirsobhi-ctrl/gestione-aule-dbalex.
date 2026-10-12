// ============================================================================
// WIZARD CONFIGURAZIONE — Fasce orarie delle Aule generali (Scuola Base, Scuola
// Media, Scuola Professionale, Comuni). A differenza di Aula Studio (una fascia
// per singola aula), qui è un'UNICA configurazione condivisa da tutte le aule
// di tutte le sezioni insieme: un solo documento Firestore, letto/scritto da
// questo hook e usato al posto della vecchia costante fissa FASCE_ORARIE in
// src/app/index.tsx (form di prenotazione e blocco-aula).
// ============================================================================
import { doc, Firestore, onSnapshot, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { FasciaOraria, formattaFascia } from '../aula-studio/aula-studio-utils';

const COLLEZIONE_CONFIGURAZIONE = 'configurazione';
const DOC_FASCE_AULE = 'fasceAule';

/** Fasce di default finché il gestore non salva una configurazione propria: le stesse 14 fasce
    da un'ora, 08:00–22:00, già in uso prima di questa funzionalità (ex costante FASCE_ORARIE
    in src/app/index.tsx) — nessuna sorpresa per le installazioni già esistenti. */
export const FASCE_AULE_DEFAULT: FasciaOraria[] = Array.from({ length: 14 }, (_, i) => {
  const ora = 8 + i;
  return { inizio: `${String(ora).padStart(2, '0')}:00`, fine: `${String(ora + 1).padStart(2, '0')}:00` };
});

/** Ascolta in tempo reale l'unica configurazione di fasce orarie delle aule generali. Documento
    assente (installazione esistente, mai salvato da qui) → si usa FASCE_AULE_DEFAULT. */
export function useFasceOrarieAule(db: Firestore): { fasce: FasciaOraria[]; caricamento: boolean } {
  const [fasce, setFasce] = useState<FasciaOraria[]>(FASCE_AULE_DEFAULT);
  const [caricamento, setCaricamento] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, COLLEZIONE_CONFIGURAZIONE, DOC_FASCE_AULE),
      (snap) => {
        const dati = snap.data() as { fasce?: FasciaOraria[] } | undefined;
        setFasce(dati?.fasce && dati.fasce.length > 0 ? dati.fasce : FASCE_AULE_DEFAULT);
        setCaricamento(false);
      },
      () => setCaricamento(false)
    );
    return () => unsub();
  }, [db]);

  return { fasce, caricamento };
}

/** Sostituisce (non merge) l'elenco delle fasce orarie delle aule generali. */
export async function salvaFasceOrarieAule(db: Firestore, fasce: FasciaOraria[]): Promise<void> {
  await setDoc(doc(db, COLLEZIONE_CONFIGURAZIONE, DOC_FASCE_AULE), { fasce });
}

/** Le fasce come stringhe stabili 'HH:MM-HH:MM' (stesso formato della vecchia costante
    FASCE_ORARIE), per i punti di src/app/index.tsx che confrontano/salvano etichette invece
    di oggetti {inizio, fine} (chip di selezione nel form di prenotazione, blocco-aula). */
export function fasceOrarieAuleComeStringhe(fasce: FasciaOraria[]): string[] {
  return fasce.map(formattaFascia);
}
