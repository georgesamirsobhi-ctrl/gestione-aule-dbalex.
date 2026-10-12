// ============================================================================
// WIZARD CONFIGURAZIONE — Regole di prenotazione delle Aule generali (Scuola
// Base, Scuola Media, Scuola Professionale, Comuni). Per ora un solo campo:
// il numero minimo di giorni di anticipo richiesto per prenotare (impedisce
// prenotazioni "last minute"). Come le Fasce Orarie delle aule generali
// (config-wizard-fasce-aule-data.ts), è un'UNICA configurazione condivisa da
// tutte le aule di tutte le sezioni insieme — un solo documento Firestore
// nella stessa collection "configurazione", stesso pattern realtime.
// ============================================================================
import { doc, Firestore, onSnapshot, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';

const COLLEZIONE_CONFIGURAZIONE = 'configurazione';
const DOC_REGOLE_PRENOTAZIONE_AULE = 'regolePrenotazioneAule';

export interface RegolePrenotazioneAule {
  /** Giorni minimi di anticipo richiesti per prenotare un'aula generale (0 = nessun minimo). */
  anticipoMinimoGiorni: number;
}

/** Valore di default finché il gestore non salva una configurazione propria. */
export const REGOLE_PRENOTAZIONE_AULE_DEFAULT: RegolePrenotazioneAule = {
  anticipoMinimoGiorni: 2,
};

/** Ascolta in tempo reale l'unica configurazione delle regole di prenotazione delle aule generali.
    Documento assente (installazione esistente, mai salvato da qui) → si usa il default. */
export function useRegolePrenotazioneAule(db: Firestore): { regole: RegolePrenotazioneAule; caricamento: boolean } {
  const [regole, setRegole] = useState<RegolePrenotazioneAule>(REGOLE_PRENOTAZIONE_AULE_DEFAULT);
  const [caricamento, setCaricamento] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, COLLEZIONE_CONFIGURAZIONE, DOC_REGOLE_PRENOTAZIONE_AULE),
      (snap) => {
        const dati = snap.data() as Partial<RegolePrenotazioneAule> | undefined;
        setRegole({
          anticipoMinimoGiorni:
            typeof dati?.anticipoMinimoGiorni === 'number' && dati.anticipoMinimoGiorni >= 0
              ? dati.anticipoMinimoGiorni
              : REGOLE_PRENOTAZIONE_AULE_DEFAULT.anticipoMinimoGiorni,
        });
        setCaricamento(false);
      },
      () => setCaricamento(false)
    );
    return () => unsub();
  }, [db]);

  return { regole, caricamento };
}

/** Sostituisce (non merge) la configurazione delle regole di prenotazione delle aule generali. */
export async function salvaRegolePrenotazioneAule(db: Firestore, regole: RegolePrenotazioneAule): Promise<void> {
  await setDoc(doc(db, COLLEZIONE_CONFIGURAZIONE, DOC_REGOLE_PRENOTAZIONE_AULE), regole);
}
