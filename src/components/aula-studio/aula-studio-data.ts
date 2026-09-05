// ============================================================================
// AULA STUDIO — accesso dati Firestore: hook con onSnapshot (tempo reale) e
// funzioni di scrittura (transazionali dove serve evitare race condition).
// ============================================================================
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import type { AulaStudioAula, ProfiloAulaStudioStudente, RichiestaTurno } from './aula-studio-types';
import { useEffect, useState } from 'react';

import { AULA_STUDIO_CONFIG_DEFAULT, AulaStudioConfig, calcolaSemestreCorrente } from './aula-studio-utils';
import { AULE_STUDIO_SEED, COLLEZIONI_AULA_STUDIO } from './aula-studio-constants';
import { AulaStudioConfigPerAula, BloccoAulaStudio, PrenotazioneAulaStudio, SanzioneAulaStudio } from './aula-studio-types';

// ---------------------------------------------------------------------------
// AULE — elenco gestibile (aggiunta, riordino, rinomina IT/AR, tipo scuola) delle
// aule del modulo Aula Studio. Seminato una sola volta con le 2 aule iniziali
// (Medie/IPI) se la collection è vuota, poi interamente gestito dal gestore.
// ---------------------------------------------------------------------------

function docToAulaStudioAula(d: any): AulaStudioAula {
  return { id: d.id, ...d.data() } as AulaStudioAula;
}

/** Ascolta in tempo reale l'elenco delle aule Aula Studio, ordinate per "ordine". Semina le 2 aule iniziali (Medie/IPI) alla primissima apertura, se la collection è ancora vuota. */
export function useAulaStudioAule(db: Firestore): { aule: AulaStudioAula[]; caricamento: boolean } {
  const [aule, setAule] = useState<AulaStudioAula[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  useEffect(() => {
    let annullato = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, COLLEZIONI_AULA_STUDIO.AULE));
        if (snap.empty && !annullato) {
          for (let i = 0; i < AULE_STUDIO_SEED.length; i++) {
            const seed = AULE_STUDIO_SEED[i];
            await setDoc(doc(db, COLLEZIONI_AULA_STUDIO.AULE, seed.id), {
              nome: seed.nome,
              nomeAr: seed.nomeAr,
              tipoScuola: seed.tipoScuola,
              ordine: i,
            });
          }
        }
      } catch {
        // Semina best-effort: se fallisce (permessi, rete), l'onSnapshot sotto mostra comunque quello che c'è.
      }
    })();
    const unsub = onSnapshot(
      collection(db, COLLEZIONI_AULA_STUDIO.AULE),
      (snap) => {
        setAule(snap.docs.map(docToAulaStudioAula).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)));
        setCaricamento(false);
      },
      () => setCaricamento(false)
    );
    return () => {
      annullato = true;
      unsub();
    };
  }, [db]);

  return { aule, caricamento };
}

export async function aggiungiAulaStudioAula(
  db: Firestore,
  dati: { nome: string; nomeAr: string; tipoScuola: 'medie' | 'ipi'; ordine: number }
): Promise<string> {
  const ref = await addDoc(collection(db, COLLEZIONI_AULA_STUDIO.AULE), dati);
  return ref.id;
}

export async function modificaAulaStudioAula(
  db: Firestore,
  id: string,
  dati: Partial<{ nome: string; nomeAr: string; tipoScuola: 'medie' | 'ipi' }>
): Promise<void> {
  await updateDoc(doc(db, COLLEZIONI_AULA_STUDIO.AULE, id), { ...dati });
}

export async function eliminaAulaStudioAula(db: Firestore, id: string): Promise<void> {
  await deleteDoc(doc(db, COLLEZIONI_AULA_STUDIO.AULE, id));
}

/** Scambia l'ordine tra un'aula e la sua vicina (su/giù), sull'elenco già ordinato passato in ingresso. */
export async function spostaAulaStudioAula(
  db: Firestore,
  auleOrdinate: AulaStudioAula[],
  id: string,
  direzione: 'su' | 'giu'
): Promise<void> {
  const idx = auleOrdinate.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const target = direzione === 'su' ? idx - 1 : idx + 1;
  if (target < 0 || target >= auleOrdinate.length) return;
  const a = auleOrdinate[idx];
  const b = auleOrdinate[target];
  await Promise.all([
    updateDoc(doc(db, COLLEZIONI_AULA_STUDIO.AULE, a.id), { ordine: b.ordine }),
    updateDoc(doc(db, COLLEZIONI_AULA_STUDIO.AULE, b.id), { ordine: a.ordine }),
  ]);
}

// ---------------------------------------------------------------------------
// CONFIGURAZIONE (fasce, posti, anticipo, ferie extra, semestri) — live per aula
// ---------------------------------------------------------------------------

/** Ascolta in tempo reale la configurazione delle due aule Aula Studio. Manca un doc → si usa il default. */
export function useAulaStudioConfig(db: Firestore): {
  configPerAula: AulaStudioConfigPerAula;
  caricamentoConfig: boolean;
} {
  // Ascolto a livello di collection (non più per singolo id fisso): copre automaticamente
  // qualsiasi aula esistente o aggiunta in seguito dal gestore, senza bisogno di conoscerne
  // gli id in anticipo. Un'aula senza documento di configurazione (non ancora salvata)
  // semplicemente non compare qui: i chiamanti usano configPerAula[aulaId] || AULA_STUDIO_CONFIG_DEFAULT.
  const [configPerAula, setConfigPerAula] = useState<AulaStudioConfigPerAula>({});
  const [caricamentoConfig, setCaricamentoConfig] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, COLLEZIONI_AULA_STUDIO.CONFIG),
      (snap) => {
        const mappa: AulaStudioConfigPerAula = {};
        snap.docs.forEach((d) => {
          mappa[d.id] = { ...AULA_STUDIO_CONFIG_DEFAULT, ...(d.data() as Partial<AulaStudioConfig>) };
        });
        setConfigPerAula(mappa);
        setCaricamentoConfig(false);
      },
      () => setCaricamentoConfig(false)
    );
    return () => unsub();
  }, [db]);

  return { configPerAula, caricamentoConfig };
}

/** Salva (merge) la configurazione di un'aula. Le prenotazioni già create non vengono toccate. */
export async function salvaAulaStudioConfig(
  db: Firestore,
  aulaId: string,
  config: AulaStudioConfig
): Promise<void> {
  await updateDoc(doc(db, COLLEZIONI_AULA_STUDIO.CONFIG, aulaId), { ...config }).catch(async (err: any) => {
    // Il documento potrebbe non esistere ancora al primo salvataggio: fallback a creazione.
    if (err?.code === 'not-found' || /No document to update/i.test(String(err?.message))) {
      const { setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, COLLEZIONI_AULA_STUDIO.CONFIG, aulaId), { ...config });
      return;
    }
    throw err;
  });
}

// ---------------------------------------------------------------------------
// PRENOTAZIONI — live per (aula, giorno) e per (studente loggato)
// ---------------------------------------------------------------------------

function docToPrenotazione(d: any): PrenotazioneAulaStudio {
  return { id: d.id, ...d.data() } as PrenotazioneAulaStudio;
}

/** Tutte le prenotazioni di una data aula in un dato giorno, in tempo reale (usata da Studente per i posti live e da Responsabile per l'appello). */
export function useAulaStudioPrenotazioniGiorno(
  db: Firestore,
  aulaId: string | null,
  dataIso: string | null
): { prenotazioni: PrenotazioneAulaStudio[]; caricamento: boolean } {
  const [prenotazioni, setPrenotazioni] = useState<PrenotazioneAulaStudio[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  useEffect(() => {
    if (!aulaId || !dataIso) {
      setPrenotazioni([]);
      setCaricamento(false);
      return;
    }
    setCaricamento(true);
    const q = query(
      collection(db, COLLEZIONI_AULA_STUDIO.PRENOTAZIONI),
      where('aulaId', '==', aulaId),
      where('data', '==', dataIso)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPrenotazioni(snap.docs.map(docToPrenotazione));
        setCaricamento(false);
      },
      () => setCaricamento(false)
    );
    return () => unsub();
  }, [db, aulaId, dataIso]);

  return { prenotazioni, caricamento };
}

/** Elenco (una tantum, non in tempo reale) delle date che hanno almeno una prenotazione per una data aula — usato dallo "Storico appelli" del responsabile. */
export async function elencaGiorniConAppelloAulaStudio(db: Firestore, aulaId: string): Promise<string[]> {
  const q = query(collection(db, COLLEZIONI_AULA_STUDIO.PRENOTAZIONI), where('aulaId', '==', aulaId));
  const snap = await getDocs(q);
  const date = new Set<string>();
  snap.docs.forEach((d) => {
    const data = (d.data() as any).data;
    if (data) date.add(data);
  });
  return Array.from(date).sort((a, b) => b.localeCompare(a));
}

/** Le prenotazioni Aula Studio dell'utente loggato (usata dalla schermata "Le mie prenotazioni"), in tempo reale. */
export function useAulaStudioMiePrenotazioni(
  db: Firestore,
  uid: string | null
): { miePrenotazioni: PrenotazioneAulaStudio[]; caricamento: boolean } {
  const [miePrenotazioni, setMiePrenotazioni] = useState<PrenotazioneAulaStudio[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  useEffect(() => {
    if (!uid) {
      setMiePrenotazioni([]);
      setCaricamento(false);
      return;
    }
    const q = query(collection(db, COLLEZIONI_AULA_STUDIO.PRENOTAZIONI), where('utenteUid', '==', uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const righe = snap.docs.map(docToPrenotazione).sort((a, b) => (a.data + a.fascia).localeCompare(b.data + b.fascia));
        setMiePrenotazioni(righe);
        setCaricamento(false);
      },
      () => setCaricamento(false)
    );
    return () => unsub();
  }, [db, uid]);

  return { miePrenotazioni, caricamento };
}

// ---------------------------------------------------------------------------
// CREAZIONE PRENOTAZIONE (transazionale: conta i posti "Confermata" e decide
// Confermata/In attesa in modo atomico, evitando overbooking da richieste simultanee)
// ---------------------------------------------------------------------------

export interface DatiStudentePrenotazione {
  nome: string;
  cognome: string;
  numero: string;
  classe: string;
  chiaveStudente: string;
  utenteUid: string | null;
  utenteEmail: string | null;
}

/**
 * Chiave del documento "contatore posti" per una data aula/giorno/fascia
 * (collection aulaStudioContatori). Non contiene "/" quindi è sempre un id
 * documento valido; usato per contare i "Confermata" in modo atomico senza
 * dover leggere una query dentro la transazione (il Firestore Web SDK
 * lato client NON supporta transaction.get() su una Query, solo su un
 * singolo DocumentReference — usarlo su una query causava l'errore
 * "Cannot read properties of undefined (reading 'path')" ad ogni tentativo
 * di prenotazione).
 */
function chiaveContatorePosti(aulaId: string, dataIso: string, fasciaStr: string): string {
  return `${aulaId}__${dataIso}__${fasciaStr}`;
}

export async function creaPrenotazioneAulaStudio(
  db: Firestore,
  aulaId: string,
  aulaNome: string,
  dataIso: string,
  fasciaStr: string,
  dati: DatiStudentePrenotazione,
  postiTotali: number
): Promise<{ id: string; stato: 'Confermata' | 'In attesa' }> {
  const prenRef = doc(collection(db, COLLEZIONI_AULA_STUDIO.PRENOTAZIONI));
  const contatoreRef = doc(db, COLLEZIONI_AULA_STUDIO.CONTATORI, chiaveContatorePosti(aulaId, dataIso, fasciaStr));
  const stato = await runTransaction(db, async (transaction) => {
    // Solo get() su DocumentReference dentro la transazione (mai su Query):
    // è l'unica forma supportata dal Firestore Web SDK lato client.
    const contatoreSnap = await transaction.get(contatoreRef);
    const postiOccupati = contatoreSnap.exists() ? (contatoreSnap.data().confermate as number) || 0 : 0;
    const nuovoStato: 'Confermata' | 'In attesa' = postiOccupati < postiTotali ? 'Confermata' : 'In attesa';
    transaction.set(prenRef, {
      aulaId,
      aulaNome,
      data: dataIso,
      fascia: fasciaStr,
      ...dati,
      stato: nuovoStato,
      statoPresenza: 'Non verificato',
      prenotazioneManuale: false,
      timestampCreazione: Date.now(),
      createdAt: new Date().toISOString(),
    });
    if (nuovoStato === 'Confermata') {
      transaction.set(contatoreRef, { confermate: postiOccupati + 1 }, { merge: true });
    }
    return nuovoStato;
  });
  return { id: prenRef.id, stato };
}

/** Aggiunta manuale di uno studente non prenotato, fatta dal Responsabile durante l'appello. Sempre "Confermata" (non conta contro i posti configurati, riflette chi è fisicamente presente). */
export async function aggiungiManualmenteAulaStudio(
  db: Firestore,
  aulaId: string,
  aulaNome: string,
  dataIso: string,
  fasciaStr: string,
  dati: DatiStudentePrenotazione
): Promise<string> {
  const ref = await addDoc(collection(db, COLLEZIONI_AULA_STUDIO.PRENOTAZIONI), {
    aulaId,
    aulaNome,
    data: dataIso,
    fascia: fasciaStr,
    ...dati,
    stato: 'Confermata',
    statoPresenza: 'Non verificato',
    prenotazioneManuale: true,
    timestampCreazione: Date.now(),
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

// ---------------------------------------------------------------------------
// CANCELLAZIONE + PROMOZIONE AUTOMATICA DALLA WAITLIST (transazionale)
// ---------------------------------------------------------------------------

export interface PrenotazionePromossa {
  id: string;
  utenteUid: string | null;
  nome: string;
  cognome: string;
  aulaNome: string;
  data: string;
  fascia: string;
}

/**
 * Cancella una prenotazione. Se era "Confermata", promuove atomicamente il primo
 * studente in lista d'attesa per la stessa aula/data/fascia (se presente).
 * Ritorna i dati dello studente promosso (per inviare la notifica), o null.
 */
export async function cancellaPrenotazioneAulaStudio(
  db: Firestore,
  prenotazioneId: string
): Promise<PrenotazionePromossa | null> {
  const prenRef = doc(db, COLLEZIONI_AULA_STUDIO.PRENOTAZIONI, prenotazioneId);

  // Pre-lettura FUORI dalla transazione (una Query non è mai leggibile dentro
  // una transazione lato client): trova il primo candidato in lista d'attesa
  // per la stessa aula/data/fascia. Viene poi ri-verificato con un get() sul
  // suo DocumentReference dentro la transazione, quindi resta al sicuro da
  // race condition (se nel frattempo è stato cancellato o già promosso da
  // un'altra richiesta concorrente, la promozione viene semplicemente saltata).
  const prenSnapFuori = await getDoc(prenRef);
  if (!prenSnapFuori.exists()) return null;
  const datiCancellata: any = prenSnapFuori.data();

  let candidatoRef: ReturnType<typeof doc> | null = null;
  let contatoreRef: ReturnType<typeof doc> | null = null;
  if (datiCancellata.stato === 'Confermata') {
    contatoreRef = doc(
      db,
      COLLEZIONI_AULA_STUDIO.CONTATORI,
      chiaveContatorePosti(datiCancellata.aulaId, datiCancellata.data, datiCancellata.fascia)
    );
    const q = query(
      collection(db, COLLEZIONI_AULA_STUDIO.PRENOTAZIONI),
      where('aulaId', '==', datiCancellata.aulaId),
      where('data', '==', datiCancellata.data),
      where('fascia', '==', datiCancellata.fascia),
      where('stato', '==', 'In attesa')
    );
    const snapAttesa = await getDocs(q);
    if (!snapAttesa.empty) {
      const candidati = snapAttesa.docs
        .map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as any) }))
        .sort((a, b) => (a.timestampCreazione ?? 0) - (b.timestampCreazione ?? 0));
      candidatoRef = candidati[0].ref;
    }
  }

  return runTransaction(db, async (transaction) => {
    // --- Tutte le letture (get su DocumentReference) prima di ogni scrittura ---
    const prenSnap = await transaction.get(prenRef);
    if (!prenSnap.exists()) return null;
    const dati: any = prenSnap.data();

    let candSnap: Awaited<ReturnType<typeof transaction.get>> | null = null;
    if (dati.stato === 'Confermata' && candidatoRef) {
      candSnap = await transaction.get(candidatoRef);
    }
    let confermateAttuali = 0;
    const promozioneValida = !!(candSnap && candSnap.exists() && (candSnap.data() as any).stato === 'In attesa');
    if (dati.stato === 'Confermata' && !promozioneValida && contatoreRef) {
      const contatoreSnap = await transaction.get(contatoreRef);
      confermateAttuali = contatoreSnap.exists() ? (contatoreSnap.data().confermate as number) || 0 : 0;
    }

    // --- Scritture ---
    transaction.delete(prenRef);
    let promosso: any = null;
    if (promozioneValida && candidatoRef && candSnap) {
      promosso = { id: candSnap.id, ...(candSnap.data() as any) };
      transaction.update(candidatoRef, { stato: 'Confermata' });
      // Conteggio "Confermata" invariato: una prenotazione esce, una entra.
    } else if (dati.stato === 'Confermata' && contatoreRef) {
      transaction.set(contatoreRef, { confermate: Math.max(0, confermateAttuali - 1) }, { merge: true });
    }

    return promosso
      ? {
          id: promosso.id,
          utenteUid: promosso.utenteUid ?? null,
          nome: promosso.nome,
          cognome: promosso.cognome,
          aulaNome: promosso.aulaNome,
          data: promosso.data,
          fascia: promosso.fascia,
        }
      : null;
  });
}

/** Aggiorna lo stato di presenza (appello) di una prenotazione. */
export async function aggiornaStatoPresenza(
  db: Firestore,
  prenotazioneId: string,
  statoPresenza: string
): Promise<void> {
  await updateDoc(doc(db, COLLEZIONI_AULA_STUDIO.PRENOTAZIONI, prenotazioneId), { statoPresenza });
}

// ---------------------------------------------------------------------------
// SANZIONI (pallini rossi) e BLOCCHI
// ---------------------------------------------------------------------------

export async function aggiungiPallinoRosso(
  db: Firestore,
  sanzione: Omit<SanzioneAulaStudio, 'id'>
): Promise<void> {
  await addDoc(collection(db, COLLEZIONI_AULA_STUDIO.SANZIONI), { ...sanzione });
}

/** Rimuove un pallino (sanzione) già assegnato — riservato a Preside/Vice Preside IPI. */
export async function rimuoviPallino(db: Firestore, sanzioneId: string): Promise<void> {
  await deleteDoc(doc(db, COLLEZIONI_AULA_STUDIO.SANZIONI, sanzioneId));
}

/** Numero di pallini rossi dello studente nel semestre corrente. */
export async function contaPalliniSemestre(db: Firestore, chiaveStudente: string, semestre: string): Promise<number> {
  const q = query(
    collection(db, COLLEZIONI_AULA_STUDIO.SANZIONI),
    where('chiaveStudente', '==', chiaveStudente),
    where('semestre', '==', semestre)
  );
  const snap = await getDocs(q);
  return snap.size;
}

/** Ascolta in tempo reale tutte le sanzioni Aula Studio (usato dal Responsabile per calcolare i pallini per fascia durante l'appello). */
export function useAulaStudioSanzioni(db: Firestore): { sanzioni: SanzioneAulaStudio[]; caricamento: boolean } {
  const [sanzioni, setSanzioni] = useState<SanzioneAulaStudio[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, COLLEZIONI_AULA_STUDIO.SANZIONI),
      (snap) => {
        setSanzioni(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setCaricamento(false);
      },
      () => setCaricamento(false)
    );
    return () => unsub();
  }, [db]);
  return { sanzioni, caricamento };
}

export async function creaBloccoAulaStudio(db: Firestore, blocco: Omit<BloccoAulaStudio, 'id'>): Promise<void> {
  await addDoc(collection(db, COLLEZIONI_AULA_STUDIO.BLOCCHI), { ...blocco });
}

/** Elimina un singolo documento di blocco (usato per "sblocca" / cambio provvedimento). */
export async function eliminaBloccoAulaStudio(db: Firestore, id: string): Promise<void> {
  await deleteDoc(doc(db, COLLEZIONI_AULA_STUDIO.BLOCCHI, id));
}

/** Il blocco attivo più recente per uno studente (bloccatoFino >= oggi), o null se non bloccato. */
export async function ottieniBloccoAttivo(
  db: Firestore,
  chiaveStudente: string,
  oggiIsoStr: string
): Promise<BloccoAulaStudio | null> {
  const q = query(collection(db, COLLEZIONI_AULA_STUDIO.BLOCCHI), where('chiaveStudente', '==', chiaveStudente));
  const snap = await getDocs(q);
  const blocchi = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }) as BloccoAulaStudio)
    .filter((b) => b.bloccatoFino >= oggiIsoStr)
    .sort((a, b) => (a.bloccatoFino < b.bloccatoFino ? 1 : -1));
  return blocchi[0] || null;
}

/** Ascolta in tempo reale tutti i blocchi Aula Studio (usato dal Responsabile/Studente per mostrare subito lo stato). */
export function useAulaStudioBlocchi(db: Firestore): { blocchi: BloccoAulaStudio[]; caricamento: boolean } {
  const [blocchi, setBlocchi] = useState<BloccoAulaStudio[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, COLLEZIONI_AULA_STUDIO.BLOCCHI),
      (snap) => {
        setBlocchi(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setCaricamento(false);
      },
      () => setCaricamento(false)
    );
    return () => unsub();
  }, [db]);
  return { blocchi, caricamento };
}

/** Controlla, tra tutte le prenotazioni Aula Studio dello stesso studente in quel giorno, se una delle fasce richieste è già occupata (in un'aula qualsiasi). Evita la doppia prenotazione stessa fascia tra Medie e IPI. */
export async function trovaConflittoStessaFascia(
  db: Firestore,
  chiaveStudente: string,
  dataIso: string,
  fasceRichieste: string[]
): Promise<string | null> {
  const q = query(
    collection(db, COLLEZIONI_AULA_STUDIO.PRENOTAZIONI),
    where('chiaveStudente', '==', chiaveStudente),
    where('data', '==', dataIso)
  );
  const snap = await getDocs(q);
  const esistente = snap.docs.map((d) => d.data() as any).find((p) => fasceRichieste.includes(p.fascia));
  return esistente ? esistente.fascia : null;
}

// ---------------------------------------------------------------------------
// PROFILO STUDENTE AULA STUDIO — wizard di primo accesso (tipo scuola, classe,
// numero di registro, nome/cognome), salvato una sola volta sul profilo utente
// (users/{uid}) e riusato per tutte le prenotazioni future senza richiederlo più.
// ---------------------------------------------------------------------------

/** Salva sul profilo utente i dati raccolti dal wizard di registrazione Aula Studio. */
export async function salvaProfiloAulaStudio(
  db: Firestore,
  uid: string,
  dati: ProfiloAulaStudioStudente
): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    aulaStudioTipoScuola: dati.tipoScuola,
    aulaStudioClasse: dati.classe,
    aulaStudioNumeroRegistro: dati.numeroRegistro,
    aulaStudioNomeStudente: dati.nomeStudente,
    aulaStudioCognomeStudente: dati.cognomeStudente,
    aulaStudioProfiloCompletato: true,
  });
}

// ---------------------------------------------------------------------------
// RICHIESTE TURNO INSEGNANTI — un insegnante richiede di fare assistenza
// volontaria in Aula Studio (aula/giorno/una o più fasce); un gestore Aula
// Studio conferma o rifiuta; se nessuno decide entro la fine dell'ultima
// fascia richiesta, la richiesta scade automaticamente (vedi scaduraTurno,
// chiamata lato client dai componenti che ascoltano useAulaStudioTurni).
// ---------------------------------------------------------------------------

/** Ascolta in tempo reale tutte le richieste di turno (usato sia dall'insegnante per "le mie richieste" sia dai gestori per la coda di approvazione). */
export function useAulaStudioTurni(db: Firestore): { turni: RichiestaTurno[]; caricamento: boolean } {
  const [turni, setTurni] = useState<RichiestaTurno[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, COLLEZIONI_AULA_STUDIO.TURNI),
      (snap) => {
        setTurni(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as RichiestaTurno));
        setCaricamento(false);
      },
      () => setCaricamento(false)
    );
    return () => unsub();
  }, [db]);
  return { turni, caricamento };
}

export async function richiediTurno(
  db: Firestore,
  dati: Omit<RichiestaTurno, 'id' | 'stato' | 'creatoTimestamp'>
): Promise<string> {
  const ref = await addDoc(collection(db, COLLEZIONI_AULA_STUDIO.TURNI), {
    ...dati,
    stato: 'in attesa',
    creatoTimestamp: Date.now(),
  });
  return ref.id;
}

/** Il responsabile assegna direttamente un turno a un insegnante (senza passare da una sua richiesta): il documento viene creato già "confermata". */
export async function assegnaTurno(
  db: Firestore,
  dati: Omit<RichiestaTurno, 'id' | 'stato' | 'creatoTimestamp' | 'decisoDaUid' | 'decisoDaNome' | 'decisoTimestamp'>,
  decisoDaUid: string,
  decisoDaNome: string
): Promise<string> {
  const ref = await addDoc(collection(db, COLLEZIONI_AULA_STUDIO.TURNI), {
    ...dati,
    stato: 'confermata',
    creatoTimestamp: Date.now(),
    decisoDaUid,
    decisoDaNome,
    decisoTimestamp: Date.now(),
  });
  return ref.id;
}

export async function confermaTurno(db: Firestore, id: string, decisoDaUid: string, decisoDaNome: string): Promise<void> {
  await updateDoc(doc(db, COLLEZIONI_AULA_STUDIO.TURNI, id), {
    stato: 'confermata',
    decisoDaUid,
    decisoDaNome,
    decisoTimestamp: Date.now(),
  });
}

export async function rifiutaTurno(db: Firestore, id: string, decisoDaUid: string, decisoDaNome: string): Promise<void> {
  await updateDoc(doc(db, COLLEZIONI_AULA_STUDIO.TURNI, id), {
    stato: 'rifiutata',
    decisoDaUid,
    decisoDaNome,
    decisoTimestamp: Date.now(),
  });
}

/** Marca una richiesta come scaduta (nessuna decisione presa entro la fine della fascia). */
export async function scaduraTurno(db: Firestore, id: string): Promise<void> {
  await updateDoc(doc(db, COLLEZIONI_AULA_STUDIO.TURNI, id), { stato: 'scaduta' });
}

export { calcolaSemestreCorrente };
