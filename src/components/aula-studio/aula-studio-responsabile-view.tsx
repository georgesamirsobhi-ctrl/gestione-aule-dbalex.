// ============================================================================
// AULA STUDIO — Vista Responsabile: appello per giorno/aula/fascia (giorno
// scelto con calendario popup, fascia scelta con selettore a chip così si
// vede solo quella fascia — niente più righe duplicate/miste), stato presenza
// scelto da un menu a tendina colorato, pallini a 3 colori (bianco/giallo/
// rosso) con la stessa logica di sempre (motivo obbligatorio, azione al 3°,
// rimozione riservata a Preside/Vice Preside IPI), legenda in popup (icona
// "i"), coda di approvazione richieste turno insegnanti, export con colonna
// insegnante di turno.
//
// Se la prop `restrizione` è presente, il componente è montato per un
// insegnante con accesso temporaneo confermato: aula/giorno/fascia sono
// bloccati su quei valori, i selettori sono nascosti, e le azioni (presenza,
// pallini) restano disabilitate finché non mancano meno di
// MINUTI_ANTICIPO_SBLOCCO_FASCIA minuti all'inizio della fascia.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AulaStudioCalendarioPopup from './aula-studio-calendario-popup';
import {
  AZIONI_TERZO_PALLINO,
  MINUTI_ANTICIPO_SBLOCCO_FASCIA,
  TIPI_REGISTRO_AULA_STUDIO,
} from './aula-studio-constants';
import { numArabo, dataArabo } from '../../utils/numeri-arabo';
import {
  aggiornaStatoPresenza,
  aggiungiManualmenteAulaStudio,
  aggiungiPallinoRosso,
  assegnaTurno,
  cancellaPrenotazioneAulaStudio,
  confermaTurno,
  creaBloccoAulaStudio,
  elencaGiorniConAppelloAulaStudio,
  eliminaBloccoAulaStudio,
  rifiutaTurno,
  rimuoviPallino,
  scaduraTurno,
  useAulaStudioAule,
  useAulaStudioBlocchi,
  useAulaStudioConfig,
  useAulaStudioPrenotazioniGiorno,
  useAulaStudioSanzioni,
  useAulaStudioTurni,
} from './aula-studio-data';
import {
  AULA_STUDIO_CONFIG_DEFAULT,
  aggiungiGiorniLavorativi,
  calcolaChiaveStudente,
  calcolaSemestreCorrente,
  fasciaGiaIniziata,
  fasciaSbloccataAnticipo,
  fasciaTerminata,
  nomeAulaStudio,
  oggiIso,
  parseFasciaStringa,
  spostaGiorno,
  StatoPresenzaAulaStudio,
} from './aula-studio-utils';
import { AulaStudioSharedProps, PrenotazioneAulaStudio, RichiestaTurno, SanzioneAulaStudio } from './aula-studio-types';

const STATI_PRESENZA: StatoPresenzaAulaStudio[] = ['Presente', 'Assente', 'In Ritardo', 'Uscito Anticipo'];

function coloreStatoPresenza(stato: StatoPresenzaAulaStudio, colors: Record<string, string>): { bg: string; fg: string; border?: string } {
  switch (stato) {
    case 'Presente':
      return { bg: colors.success, fg: '#FFFFFF' };
    case 'Assente':
      return { bg: colors.danger, fg: '#FFFFFF' };
    case 'In Ritardo':
      return { bg: colors.warning, fg: colors.warningText };
    case 'Uscito Anticipo':
      return { bg: '#FFFFFF', fg: '#1F2937', border: colors.border };
    default:
      return { bg: colors.surfaceAlt, fg: colors.textMuted, border: colors.border };
  }
}

/** Colore del pallino in base al conteggio nel semestre: 1°=bianco, 2°=giallo, 3°(o più)=rosso. */
function coloreConteggioPallini(n: number, colors: Record<string, string>): string {
  if (n >= 3) return colors.danger;
  if (n === 2) return colors.warning;
  return '#FFFFFF';
}

interface RestrizioneAppello {
  aulaId: string;
  data: string;
  fascia: string;
}

export default function AulaStudioResponsabileView(props: AulaStudioSharedProps & { restrizione?: RestrizioneAppello | null }) {
  const {
    db,
    user,
    userName,
    userRole,
    lang,
    isRTL,
    colors,
    t,
    mostraAlert,
    registraAttivita,
    inviaNotificaConPreferenza,
    scriviECondividiExcel,
    restrizione,
    richiestaTurnoDaAprireId,
    onRichiestaTurnoAperta,
    insegnantiAulaStudio,
  } = props;
  const styles = useMemo(() => getStyles(colors, isRTL), [colors, isRTL]);

  const { configPerAula } = useAulaStudioConfig(db);
  const { aule } = useAulaStudioAule(db);
  const [aulaId, setAulaId] = useState<string>(restrizione?.aulaId || '');
  const configAula = configPerAula[aulaId] || AULA_STUDIO_CONFIG_DEFAULT;
  const [dataSelezionata, setDataSelezionata] = useState<string>(restrizione?.data || oggiIso());
  const [fasciaSelezionata, setFasciaSelezionata] = useState<string | null>(restrizione?.fascia || null);
  const [giornoPopupAperto, setGiornoPopupAperto] = useState(false);
  const [legendaPopupAperto, setLegendaPopupAperto] = useState(false);
  const [turniPopupAperto, setTurniPopupAperto] = useState(false);
  const [storicoPopupAperto, setStoricoPopupAperto] = useState(false);
  const [storicoGiorni, setStoricoGiorni] = useState<string[]>([]);
  const [storicoCaricamento, setStoricoCaricamento] = useState(false);
  const [assegnaAperto, setAssegnaAperto] = useState(false);
  const [assegnaInsegnanteUid, setAssegnaInsegnanteUid] = useState('');
  const [assegnaData, setAssegnaData] = useState(oggiIso());
  const [assegnaGiornoPopupAperto, setAssegnaGiornoPopupAperto] = useState(false);
  const [assegnaFasceScelte, setAssegnaFasceScelte] = useState<string[]>([]);
  const [assegnaInCorso, setAssegnaInCorso] = useState(false);
  const [assegnaInsegnanteDropdownAperto, setAssegnaInsegnanteDropdownAperto] = useState(false);
  const [assegnaInsegnanteRicerca, setAssegnaInsegnanteRicerca] = useState('');

  // Sceglie automaticamente la prima aula disponibile appena l'elenco (dinamico) è pronto.
  useEffect(() => {
    if (restrizione || aulaId || aule.length === 0) return;
    setAulaId(aule[0].id);
  }, [restrizione, aulaId, aule]);

  // Deep-link da una notifica di nuova richiesta turno: apre direttamente la coda di approvazione.
  useEffect(() => {
    if (!richiestaTurnoDaAprireId || restrizione) return;
    setTurniPopupAperto(true);
    onRichiestaTurnoAperta?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [richiestaTurnoDaAprireId, restrizione]);

  const puoRimuoverePallini = userRole === 'presideIpi' || userRole === 'vicePresideIpi' || userRole === 'gestore';

  // Sceglie automaticamente la fascia più vicina non ancora iniziata (per oggi) o la prima del giorno (altre date).
  useEffect(() => {
    if (restrizione) {
      setFasciaSelezionata(restrizione.fascia);
      return;
    }
    if (!configAula || !configAula.fasce.length) return;
    const oggi = oggiIso();
    if (dataSelezionata === oggi) {
      const prossima = configAula.fasce.find((f) => !fasciaGiaIniziata(dataSelezionata, f));
      const scelta = prossima || configAula.fasce[configAula.fasce.length - 1];
      setFasciaSelezionata(`${scelta.inizio}-${scelta.fine}`);
    } else {
      setFasciaSelezionata(`${configAula.fasce[0].inizio}-${configAula.fasce[0].fine}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aulaId, dataSelezionata, restrizione]);

  const { prenotazioni } = useAulaStudioPrenotazioniGiorno(db, aulaId, dataSelezionata);
  const { sanzioni } = useAulaStudioSanzioni(db);
  const { blocchi } = useAulaStudioBlocchi(db);
  const { turni } = useAulaStudioTurni(db);

  const semestreCorrente = calcolaSemestreCorrente(dataSelezionata, configAula.semestre1Inizio, configAula.semestre2Inizio);

  const palliniPerStudente = useMemo(() => {
    const mappa: Record<string, number> = {};
    sanzioni
      .filter((s) => s.semestre === semestreCorrente)
      .forEach((s) => {
        mappa[s.chiaveStudente] = (mappa[s.chiaveStudente] || 0) + 1;
      });
    return mappa;
  }, [sanzioni, semestreCorrente]);

  const ultimaSanzionePerStudente = useMemo(() => {
    const mappa: Record<string, SanzioneAulaStudio> = {};
    sanzioni
      .filter((s) => s.semestre === semestreCorrente)
      .forEach((s) => {
        if (!mappa[s.chiaveStudente] || s.timestamp > mappa[s.chiaveStudente].timestamp) {
          mappa[s.chiaveStudente] = s;
        }
      });
    return mappa;
  }, [sanzioni, semestreCorrente]);

  const bloccoPerStudente = useMemo(() => {
    const mappa: Record<string, string> = {};
    const oggi = oggiIso();
    blocchi
      .filter((b) => b.bloccatoFino >= oggi)
      .forEach((b) => {
        if (!mappa[b.chiaveStudente] || b.bloccatoFino > mappa[b.chiaveStudente]) {
          mappa[b.chiaveStudente] = b.bloccatoFino;
        }
      });
    return mappa;
  }, [blocchi]);

  const gruppiPerFascia = useMemo(() => {
    const fasceConfigurate = configAula.fasce.map((f) => `${f.inizio}-${f.fine}`);
    const fasceExtra = Array.from(new Set(prenotazioni.map((p) => p.fascia))).filter((f) => !fasceConfigurate.includes(f));
    const tutteFasce = [...fasceConfigurate, ...fasceExtra];
    return tutteFasce.map((fasciaStr) => ({
      fascia: fasciaStr,
      studenti: prenotazioni
        .filter((p) => p.fascia === fasciaStr)
        .sort((a, b) => `${a.classe}${a.numero}`.localeCompare(`${b.classe}${b.numero}`)),
    }));
  }, [configAula.fasce, prenotazioni]);

  // Solo la fascia selezionata è mostrata nella tabella principale (niente più righe miste/duplicate tra fasce).
  const righeTabella = useMemo(
    () => gruppiPerFascia.find((g) => g.fascia === fasciaSelezionata)?.studenti || [],
    [gruppiPerFascia, fasciaSelezionata]
  );

  // Azioni consentite: sempre per un gestore reale; per un insegnante con accesso a turno, solo da
  // MINUTI_ANTICIPO_SBLOCCO_FASCIA minuti prima dell'inizio della propria fascia confermata.
  const azioniConsentite = useMemo(() => {
    if (!restrizione) return true;
    const f = parseFasciaStringa(restrizione.fascia);
    if (!f) return true;
    return fasciaSbloccataAnticipo(restrizione.data, f, MINUTI_ANTICIPO_SBLOCCO_FASCIA);
  }, [restrizione]);

  // ---- Cambio stato presenza (menu a tendina colorato) ----
  const [dropdownPresenzaId, setDropdownPresenzaId] = useState<string | null>(null);

  const cambiaPresenza = async (p: PrenotazioneAulaStudio, stato: StatoPresenzaAulaStudio) => {
    setDropdownPresenzaId(null);
    await aggiornaStatoPresenza(db, p.id, stato);
    await registraAttivita(
      TIPI_REGISTRO_AULA_STUDIO.PRESENZA_AGGIORNATA,
      `${p.nome} ${p.cognome} (${p.classe}, n. ${p.numero}) → ${stato} — ${p.aulaNome} ${p.data} ${p.fascia}`
    );
  };

  // ---- Aggiunta manuale ----
  const [modaleAggiungiAperto, setModaleAggiungiAperto] = useState(false);
  const [formFascia, setFormFascia] = useState<string>('');
  const [formNome, setFormNome] = useState('');
  const [formCognome, setFormCognome] = useState('');
  const [formClasse, setFormClasse] = useState('');
  const [formNumero, setFormNumero] = useState('');

  const apriModaleAggiungi = () => {
    setFormFascia(fasciaSelezionata || (configAula.fasce[0] ? `${configAula.fasce[0].inizio}-${configAula.fasce[0].fine}` : ''));
    setModaleAggiungiAperto(true);
  };

  const confermaAggiungiManuale = async () => {
    if (!formNome.trim() || !formCognome.trim() || !formClasse.trim() || !formNumero.trim() || !formFascia) {
      mostraAlert(t('attenzione', lang), t('aulaStudioCompilaDatiStudente', lang));
      return;
    }
    const aula = aule.find((a) => a.id === aulaId);
    if (!aula) return;
    const chiave = calcolaChiaveStudente(formClasse, formNumero);
    await aggiungiManualmenteAulaStudio(db, aulaId, aula.nome, dataSelezionata, formFascia, {
      nome: formNome.trim(),
      cognome: formCognome.trim(),
      classe: formClasse.trim(),
      numero: formNumero.trim(),
      chiaveStudente: chiave,
      utenteUid: null,
      utenteEmail: null,
    });
    await registraAttivita(
      TIPI_REGISTRO_AULA_STUDIO.AGGIUNTA_MANUALE,
      `${formNome.trim()} ${formCognome.trim()} (${formClasse.trim()}, n. ${formNumero.trim()}) aggiunto/a manualmente — ${aula.nome} ${dataSelezionata} ${formFascia}`
    );
    setFormNome('');
    setFormCognome('');
    setFormClasse('');
    setFormNumero('');
    setModaleAggiungiAperto(false);
  };

  // ---- Pallino (stessa logica di sempre: motivo obbligatorio, azione al 3°) ----
  const [modalePallino, setModalePallino] = useState<PrenotazioneAulaStudio | null>(null);
  const [motivoPallino, setMotivoPallino] = useState('');
  const [studenteAzione, setStudenteAzione] = useState<PrenotazioneAulaStudio | null>(null); // apre le 3 azioni al 3° pallino
  const [giorniBlocco, setGiorniBlocco] = useState('5');
  const [modaleRimuoviPallino, setModaleRimuoviPallino] = useState<PrenotazioneAulaStudio | null>(null);
  const [storicoPalliniStudente, setStoricoPalliniStudente] = useState<PrenotazioneAulaStudio | null>(null);

  // ---- Storico pallini (popup di sola lettura, aperto toccando la pallina di uno studente) ----
  const sanzioniStoricoStudente = useMemo(() => {
    if (!storicoPalliniStudente) return [];
    return sanzioni
      .filter((s) => s.chiaveStudente === storicoPalliniStudente.chiaveStudente && s.semestre === semestreCorrente)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [sanzioni, storicoPalliniStudente, semestreCorrente]);

  // Tutti i blocchi attualmente attivi per lo studente (di norma uno solo, ma "sblocca" li rimuove tutti per sicurezza).
  const blocchiAttiviStoricoStudente = useMemo(() => {
    if (!storicoPalliniStudente) return [];
    const oggi = oggiIso();
    return blocchi
      .filter((b) => b.chiaveStudente === storicoPalliniStudente.chiaveStudente && b.bloccatoFino >= oggi)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [blocchi, storicoPalliniStudente]);

  const bloccoAttivoStoricoStudente = blocchiAttiviStoricoStudente[0] || null;

  const [sbloccoInCorso, setSbloccoInCorso] = useState(false);

  const sbloccaStoricoStudente = async () => {
    if (blocchiAttiviStoricoStudente.length === 0) return;
    setSbloccoInCorso(true);
    try {
      await Promise.all(blocchiAttiviStoricoStudente.map((b) => eliminaBloccoAulaStudio(db, b.id)));
      await registraAttivita(
        TIPI_REGISTRO_AULA_STUDIO.AZIONE_TERZO_PALLINO,
        `${storicoPalliniStudente?.nome} ${storicoPalliniStudente?.cognome} — blocco rimosso manualmente`
      );
    } catch (e: any) {
      mostraAlert(t('errore', lang), e?.message || t('aulaStudioErroreGenerico', lang));
    } finally {
      setSbloccoInCorso(false);
    }
  };

  const confermaPallino = async () => {
    if (!modalePallino || !motivoPallino.trim()) {
      mostraAlert(t('attenzione', lang), t('aulaStudioMotivoObbligatorio', lang));
      return;
    }
    const p = modalePallino;
    await aggiungiPallinoRosso(db, {
      chiaveStudente: p.chiaveStudente,
      nome: p.nome,
      cognome: p.cognome,
      classe: p.classe,
      numero: p.numero,
      data: dataSelezionata,
      motivo: motivoPallino.trim(),
      semestre: semestreCorrente,
      creatoDaUid: user?.uid || '',
      creatoDaNome: userName,
      timestamp: Date.now(),
    });
    await registraAttivita(
      TIPI_REGISTRO_AULA_STUDIO.PALLINO_ROSSO,
      `Pallino a ${p.nome} ${p.cognome} (${p.classe}, n. ${p.numero}): ${motivoPallino.trim()}`
    );
    const nuovoConteggio = (palliniPerStudente[p.chiaveStudente] || 0) + 1;
    setModalePallino(null);
    setMotivoPallino('');
    if (nuovoConteggio >= 3) {
      setStudenteAzione(p);
    }
  };

  const confermaRimozionePallino = async () => {
    if (!modaleRimuoviPallino) return;
    const p = modaleRimuoviPallino;
    const sanzione = ultimaSanzionePerStudente[p.chiaveStudente];
    setModaleRimuoviPallino(null);
    if (!sanzione) return;
    await rimuoviPallino(db, sanzione.id);
    await registraAttivita(
      TIPI_REGISTRO_AULA_STUDIO.RIMOZIONE_PALLINO,
      `Pallino rimosso a ${p.nome} ${p.cognome} (${p.classe}, n. ${p.numero})`
    );
  };

  const eseguiAzioneTerzoPallino = async (azione: (typeof AZIONI_TERZO_PALLINO)[keyof typeof AZIONI_TERZO_PALLINO]) => {
    if (!studenteAzione) return;
    const p = studenteAzione;
    try {
      // Se lo studente ha già un blocco attivo (es. si sta cambiando provvedimento dal popup storico
      // pallini), lo rimuove prima di applicare la nuova scelta, così non restano blocchi vecchi/duplicati.
      const oggi = oggiIso();
      const blocchiAttiviStudente = blocchi.filter((b) => b.chiaveStudente === p.chiaveStudente && b.bloccatoFino >= oggi);
      if (blocchiAttiviStudente.length > 0 && (azione === AZIONI_TERZO_PALLINO.BLOCCA || azione === AZIONI_TERZO_PALLINO.ALTRA_POSSIBILITA)) {
        await Promise.all(blocchiAttiviStudente.map((b) => eliminaBloccoAulaStudio(db, b.id)));
      }
      if (azione === AZIONI_TERZO_PALLINO.BLOCCA) {
        const n = parseInt(giorniBlocco, 10) || 1;
        const bloccatoFino = aggiungiGiorniLavorativi(oggiIso(), n, configAula.ferieExtra);
        await creaBloccoAulaStudio(db, {
          chiaveStudente: p.chiaveStudente,
          nome: `${p.nome} ${p.cognome}`,
          classe: p.classe,
          numero: p.numero,
          bloccatoFino,
          motivo: t('aulaStudioMotivoBloccoAutomatico', lang, 3),
          azione: 'blocco',
          creatoDaUid: user?.uid || '',
          creatoDaNome: userName,
          timestamp: Date.now(),
        });
      } else if (azione === AZIONI_TERZO_PALLINO.RIFIUTA) {
        await cancellaPrenotazioneAulaStudio(db, p.id);
      }
      // ALTRA_POSSIBILITA: nessun blocco attivo (rimosso sopra se presente), solo registro attività.
      await registraAttivita(
        TIPI_REGISTRO_AULA_STUDIO.AZIONE_TERZO_PALLINO,
        `${p.nome} ${p.cognome} (${p.classe}, n. ${p.numero}) — azione: ${azione}`
      );
    } catch (e: any) {
      mostraAlert(t('errore', lang), e?.message || t('aulaStudioErroreGenerico', lang));
    } finally {
      setStudenteAzione(null);
      setGiorniBlocco('5');
    }
  };

  // ---- Richieste turno insegnanti: coda di approvazione (segreteria/preside/vice preside/direttore) ----
  const richiesteInAttesa = useMemo(
    () => turni.filter((r) => r.stato === 'in attesa').sort((a, b) => a.creatoTimestamp - b.creatoTimestamp),
    [turni]
  );

  const decidiTurno = async (r: RichiestaTurno, esito: 'confermata' | 'rifiutata') => {
    if (esito === 'confermata') {
      await confermaTurno(db, r.id, user?.uid || '', userName);
    } else {
      await rifiutaTurno(db, r.id, user?.uid || '', userName);
    }
    await registraAttivita(
      esito === 'confermata' ? TIPI_REGISTRO_AULA_STUDIO.CONFERMA_TURNO : TIPI_REGISTRO_AULA_STUDIO.RIFIUTO_TURNO,
      `${r.insegnanteNome} — ${r.aulaNome} ${r.data} ${r.fasce.join(', ')}`
    );
    await inviaNotificaConPreferenza(
      r.insegnanteUid,
      'esito_turno_aula_studio',
      esito === 'confermata'
        ? lang === 'ar'
          ? 'تم تأكيد طلب الدور'
          : 'Richiesta turno confermata'
        : lang === 'ar'
        ? 'تم رفض طلب الدور'
        : 'Richiesta turno rifiutata',
      `${r.aulaNome} — ${r.data} — ${r.fasce.join(', ')}`,
      { richiestaTurnoId: r.id }
    );
  };

  // ---- Storico appelli: elenco dei giorni con almeno una prenotazione per l'aula corrente ----
  const apriStorico = async () => {
    setStoricoPopupAperto(true);
    setStoricoCaricamento(true);
    try {
      const giorni = await elencaGiorniConAppelloAulaStudio(db, aulaId);
      setStoricoGiorni(giorni);
    } finally {
      setStoricoCaricamento(false);
    }
  };

  // ---- Assegnazione diretta di un turno a un insegnante (senza attendere una sua richiesta) ----
  const apriAssegna = () => {
    setAssegnaInsegnanteUid('');
    setAssegnaData(oggiIso());
    setAssegnaFasceScelte([]);
    setAssegnaAperto(true);
  };

  const toggleAssegnaFascia = (fasciaStr: string) => {
    setAssegnaFasceScelte((prev) => (prev.includes(fasciaStr) ? prev.filter((f) => f !== fasciaStr) : [...prev, fasciaStr]));
  };

  const insegnantiFiltrati = useMemo(() => {
    const query = assegnaInsegnanteRicerca.trim().toLowerCase();
    const lista = insegnantiAulaStudio || [];
    if (!query) return lista;
    return lista.filter((i) => i.nome.toLowerCase().includes(query));
  }, [insegnantiAulaStudio, assegnaInsegnanteRicerca]);

  const confermaAssegnaTurno = async () => {
    const insegnante = (insegnantiAulaStudio || []).find((i) => i.uid === assegnaInsegnanteUid);
    if (!insegnante || !aulaCorrente || assegnaFasceScelte.length === 0) {
      mostraAlert(t('attenzione', lang), lang === 'ar' ? 'اكمل كل الحقول' : 'Completa tutti i campi.');
      return;
    }
    setAssegnaInCorso(true);
    try {
      const id = await assegnaTurno(
        db,
        {
          insegnanteUid: insegnante.uid,
          insegnanteNome: insegnante.nome,
          insegnanteEmail: insegnante.email,
          aulaId: aulaCorrente.id,
          aulaNome: aulaCorrente.nome,
          data: assegnaData,
          fasce: assegnaFasceScelte,
        },
        user?.uid || '',
        userName
      );
      await registraAttivita(
        TIPI_REGISTRO_AULA_STUDIO.CONFERMA_TURNO,
        `${insegnante.nome} — ${aulaCorrente.nome} ${assegnaData} ${assegnaFasceScelte.join(', ')} (assegnato direttamente)`
      );
      await inviaNotificaConPreferenza(
        insegnante.uid,
        'esito_turno_aula_studio',
        lang === 'ar' ? 'تم تعيين مناوبة لك' : 'Ti è stato assegnato un turno',
        `${aulaCorrente.nome} — ${assegnaData} — ${assegnaFasceScelte.join(', ')}`,
        { richiestaTurnoId: id }
      );
      setAssegnaAperto(false);
      mostraAlert('', lang === 'ar' ? 'تم تعيين المناوبة' : 'Turno assegnato.');
    } finally {
      setAssegnaInCorso(false);
    }
  };

  // Scadenza automatica: se nessuno decide entro la fine dell'ultima fascia richiesta, la richiesta scade
  // e viene inviata comunque una notifica all'insegnante (best-effort, lato client).
  const scaduteProcessate = useRef<Set<string>>(new Set());
  useEffect(() => {
    const adesso = new Date();
    turni
      .filter((r) => r.stato === 'in attesa')
      .forEach((r) => {
        if (scaduteProcessate.current.has(r.id)) return;
        const tutteTerminate = r.fasce.every((fStr) => {
          const f = parseFasciaStringa(fStr);
          return f ? fasciaTerminata(r.data, f, adesso) : true;
        });
        if (!tutteTerminate) return;
        scaduteProcessate.current.add(r.id);
        scaduraTurno(db, r.id)
          .then(() => {
            registraAttivita(
              TIPI_REGISTRO_AULA_STUDIO.SCADENZA_TURNO,
              `${r.insegnanteNome} — ${r.aulaNome} ${r.data} ${r.fasce.join(', ')}`
            );
            inviaNotificaConPreferenza(
              r.insegnanteUid,
              'esito_turno_aula_studio',
              lang === 'ar' ? 'انتهت صلاحية طلب الدور' : 'Richiesta turno scaduta',
              `${r.aulaNome} — ${r.data} — ${r.fasce.join(', ')}`
            );
          })
          .catch(() => {});
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turni]);

  // Nota: l'esportazione Excel di questa schermata si fa ora da Impostazioni → Esporta
  // (vedi aula-studio-esporta-panel.tsx), non più da un pulsante qui.

  const aulaCorrente = aule.find((a) => a.id === aulaId);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.contenutoWrap}>
        <View style={styles.rigaTitolo}>
          <Text style={styles.titolo}>{t('aulaStudioTitoloAppello', lang)}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {!restrizione && (
              <TouchableOpacity style={styles.iconaTonda} onPress={apriStorico}>
                <Text style={styles.iconaTondaText}>🗓</Text>
              </TouchableOpacity>
            )}
            {!restrizione && (
              <TouchableOpacity style={styles.iconaTonda} onPress={() => setTurniPopupAperto(true)}>
                <Text style={styles.iconaTondaText}>👤</Text>
                {richiesteInAttesa.length > 0 && (
                  <View style={styles.badgeContatore}>
                    <Text style={styles.badgeContatoreText}>{numArabo(richiesteInAttesa.length, lang)}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.iconaTonda} onPress={() => setLegendaPopupAperto(true)}>
              <Text style={styles.iconaTondaText}>ⓘ</Text>
            </TouchableOpacity>
          </View>
        </View>

        {restrizione ? (
          <View style={styles.bannerRestrizione}>
            <Text style={styles.bannerRestrizioneText}>
              {(lang === 'ar' ? 'وصول مؤكَّد: ' : 'Accesso confermato: ') +
                `${nomeAulaStudio(aulaCorrente, lang) || aulaId} — ${dataArabo(dataSelezionata, lang)} — ${numArabo(restrizione.fascia, lang)}`}
            </Text>
            {!azioniConsentite && (
              <Text style={styles.bannerRestrizioneSub}>
                {lang === 'ar'
                  ? `الإجراءات متاحة قبل ${numArabo(MINUTI_ANTICIPO_SBLOCCO_FASCIA, lang)} دقائق من بداية الحصة`
                  : `Azioni disponibili da ${MINUTI_ANTICIPO_SBLOCCO_FASCIA} minuti prima dell'inizio della fascia.`}
              </Text>
            )}
          </View>
        ) : (
          <>
            <View style={styles.selettoreCard}>
              <Text style={styles.selettoreEtichetta}>{lang === 'ar' ? 'القاعة' : 'Aula'}</Text>
              <View style={[styles.rigaAule, { marginBottom: 0 }]}>
                {aule.map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.chipAula, aulaId === a.id && styles.chipAulaAttiva]}
                    onPress={() => setAulaId(a.id)}
                  >
                    <Text style={[styles.chipAulaText, aulaId === a.id && styles.chipAulaTextAttiva]}>{nomeAulaStudio(a, lang)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.selettoreEtichetta, { marginTop: 14 }]}>{lang === 'ar' ? 'اليوم' : 'Giorno'}</Text>
              <View style={[styles.rigaGiornoScelta, { marginBottom: 0 }]}>
                <TouchableOpacity style={styles.casellaGiorno} onPress={() => setGiornoPopupAperto(true)}>
                  <Text style={styles.casellaGiornoText}>{dataArabo(dataSelezionata, lang)}</Text>
                  <Text style={styles.casellaSceltaIcona}>📅</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bottoneOggi} onPress={() => setDataSelezionata(spostaGiorno(dataSelezionata, -1))}>
                  <Text style={styles.bottoneOggiText}>{lang === 'ar' ? 'أمس' : 'Ieri'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bottoneOggi} onPress={() => setDataSelezionata(oggiIso())}>
                  <Text style={styles.bottoneOggiText}>{t('oggi', lang) || 'Oggi'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bottoneOggi} onPress={() => setDataSelezionata(spostaGiorno(dataSelezionata, 1))}>
                  <Text style={styles.bottoneOggiText}>{lang === 'ar' ? 'غدًا' : 'Domani'}</Text>
                </TouchableOpacity>
              </View>

              <AulaStudioCalendarioPopup
                visible={giornoPopupAperto}
                onClose={() => setGiornoPopupAperto(false)}
                dataSelezionata={dataSelezionata}
                onSeleziona={(d) => setDataSelezionata(d)}
                colors={colors}
                lang={lang}
                titolo={t('aulaStudioScegliGiorno', lang)}
              />

              {gruppiPerFascia.length > 0 && (
                <>
                  <Text style={[styles.selettoreEtichetta, { marginTop: 14 }]}>{lang === 'ar' ? 'الحصة' : 'Fascia'}</Text>
                  <View style={[styles.rigaFasceSelettore, { marginBottom: 0 }]}>
                    {gruppiPerFascia.map((g) => (
                      <TouchableOpacity
                        key={g.fascia}
                        style={[styles.chipFasciaSelettore, fasciaSelezionata === g.fascia && styles.chipFasciaSelettoreAttiva]}
                        onPress={() => setFasciaSelezionata(g.fascia)}
                      >
                        <Text style={[styles.chipFasciaSelettoreText, fasciaSelezionata === g.fascia && styles.chipFasciaSelettoreTextAttiva]}>
                          {numArabo(g.fascia, lang)} ({numArabo(g.studenti.length, lang)})
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </View>

            <View style={styles.rigaBottoniAlto}>
              <TouchableOpacity style={styles.bottoneAggiungi} onPress={apriModaleAggiungi}>
                <Text style={styles.bottoneAggiungiText}>+ {t('aulaStudioAggiungiManualmente', lang)}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Popup legenda (icona ⓘ) */}
        <Modal visible={legendaPopupAperto} transparent animationType="fade" onRequestClose={() => setLegendaPopupAperto(false)}>
          <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setLegendaPopupAperto(false)}>
            <TouchableOpacity activeOpacity={1} style={styles.legendaPopupBox} onPress={() => {}}>
              <Text style={styles.modaleTitolo}>{lang === 'ar' ? 'مفتاح الألوان' : 'Legenda'}</Text>
              <View style={styles.legendaBox}>
                <View style={styles.legendaRiga}>
                  {STATI_PRESENZA.map((stato) => {
                    const c = coloreStatoPresenza(stato, colors);
                    return (
                      <View key={stato} style={styles.legendaVoce}>
                        <View style={[styles.legendaPallino, { backgroundColor: c.bg, borderColor: c.border || c.bg }]} />
                        <Text style={styles.legendaText}>{t(`aulaStudioPresenza${stato.replace(/\s/g, '')}`, lang)}</Text>
                      </View>
                    );
                  })}
                </View>
                <View style={styles.legendaRiga}>
                  <View style={styles.legendaVoce}>
                    <View style={[styles.legendaPallino, { backgroundColor: '#FFFFFF', borderColor: colors.border }]} />
                    <Text style={styles.legendaText}>{t('aulaStudioPallino1', lang)}</Text>
                  </View>
                  <View style={styles.legendaVoce}>
                    <View style={[styles.legendaPallino, { backgroundColor: colors.warning, borderColor: colors.warning }]} />
                    <Text style={styles.legendaText}>{t('aulaStudioPallino2', lang)}</Text>
                  </View>
                  <View style={styles.legendaVoce}>
                    <View style={[styles.legendaPallino, { backgroundColor: colors.danger, borderColor: colors.danger }]} />
                    <Text style={styles.legendaText}>{t('aulaStudioPallino3', lang)}</Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity style={[styles.bottonePrimario, { alignSelf: 'flex-end', marginTop: 8 }]} onPress={() => setLegendaPopupAperto(false)}>
                <Text style={styles.bottonePrimarioText}>{t('fatto', lang) || 'Fatto'}</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {righeTabella.length === 0 ? (
          <Text style={styles.testoInfo}>{t('aulaStudioNessunaPrenotazione', lang)}</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS === 'web'} style={styles.tableScrollWrap}>
            <View style={[styles.tableCard, { minWidth: 960, width: '100%' }]}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.tableHeaderCell, { width: 150 }]}>{t('aulaStudioColNome', lang)}</Text>
                <Text style={[styles.tableHeaderCell, { width: 70 }]}>{t('aulaStudioClasse', lang)}</Text>
                <Text style={[styles.tableHeaderCell, { width: 60 }]}>{t('aulaStudioColNumero', lang)}</Text>
                <Text style={[styles.tableHeaderCell, { width: 90 }]}>{t('aulaStudioColGiorno', lang)}</Text>
                <Text style={[styles.tableHeaderCell, { width: 110 }]}>{t('aulaStudioFasceOrarie', lang)}</Text>
                <Text style={[styles.tableHeaderCell, { width: 100 }]}>{t('aulaStudioColStato', lang)}</Text>
                <Text style={[styles.tableHeaderCell, { width: 170 }]}>{t('aulaStudioColPallini', lang)}</Text>
                <Text style={[styles.tableHeaderCell, { width: 180 }]}>{t('aulaStudioColPresenza', lang)}</Text>
              </View>
              {righeTabella.map((p, idx) => {
                const pallini = palliniPerStudente[p.chiaveStudente] || 0;
                const bloccatoFino = bloccoPerStudente[p.chiaveStudente];
                const sottoAvviso = pallini >= 3;
                const colorePresenza = coloreStatoPresenza(p.statoPresenza, colors);
                return (
                  <View key={p.id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                    <View style={{ width: 150 }}>
                      <Text style={[styles.tableCell, sottoAvviso && { color: colors.danger, fontWeight: '700' }]} numberOfLines={2}>
                        {p.nome} {p.cognome}
                      </Text>
                      {p.stato === 'In attesa' && <Text style={styles.tableSubBadge}>{t('aulaStudioStatoInAttesa', lang)}</Text>}
                      {p.prenotazioneManuale && <Text style={styles.tableSubBadge}>{t('aulaStudioAggiuntaManuale', lang)}</Text>}
                      {bloccatoFino && <Text style={[styles.tableSubBadge, { color: colors.danger }]}>{t('aulaStudioBloccoAttivoMessaggio', lang, numArabo(bloccatoFino, lang))}</Text>}
                    </View>
                    <Text style={[styles.tableCell, { width: 70 }]}>{numArabo(p.classe, lang)}</Text>
                    <Text style={[styles.tableCell, { width: 60 }]}>{numArabo(p.numero, lang)}</Text>
                    <Text style={[styles.tableCell, { width: 90 }]}>{dataArabo(p.data, lang)}</Text>
                    <Text style={[styles.tableCell, { width: 110 }]}>{numArabo(p.fascia, lang)}</Text>
                    <Text style={[styles.tableCell, { width: 100 }]}>{p.stato === 'Confermata' ? t('aulaStudioStatoConfermata', lang) : t('aulaStudioStatoInAttesa', lang)}</Text>
                    <TouchableOpacity style={{ width: 170, alignItems: 'center' }} onPress={() => setStoricoPalliniStudente(p)} disabled={pallini === 0}>
                      {pallini > 0 ? (
                        <View style={[styles.pallinoTondo, { backgroundColor: coloreConteggioPallini(pallini, colors), borderColor: pallini === 1 ? colors.border : coloreConteggioPallini(pallini, colors) }]} />
                      ) : (
                        <Text style={styles.tableCell}>—</Text>
                      )}
                    </TouchableOpacity>
                    <View style={{ width: 180, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <TouchableOpacity
                        style={[styles.tendinaPresenza, { backgroundColor: colorePresenza.bg, borderColor: colorePresenza.border || colorePresenza.bg }, !azioniConsentite && { opacity: 0.4 }]}
                        onPress={() => azioniConsentite && setDropdownPresenzaId(p.id)}
                        disabled={!azioniConsentite}
                      >
                        <Text style={[styles.tendinaPresenzaText, { color: colorePresenza.fg }]} numberOfLines={1}>
                          {p.statoPresenza === 'Non verificato' ? t('aulaStudioSceglieStato', lang) : t(`aulaStudioPresenza${p.statoPresenza.replace(/\s/g, '')}`, lang)}
                        </Text>
                        <Text style={[styles.tendinaPresenzaFreccia, { color: colorePresenza.fg }]}>▼</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.bottonePallino} onPress={() => setModalePallino(p)} disabled={!azioniConsentite}>
                        <Text style={[styles.bottonePallinoText, !azioniConsentite && { opacity: 0.4 }]}>●+</Text>
                      </TouchableOpacity>
                      {puoRimuoverePallini && pallini > 0 && (
                        <TouchableOpacity style={styles.bottonePallino} onPress={() => setModaleRimuoviPallino(p)} disabled={!azioniConsentite}>
                          <Text style={[styles.bottonePallinoText, { color: colors.danger }, !azioniConsentite && { opacity: 0.4 }]}>−</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Menu a tendina: scelta stato presenza colorata */}
                    <Modal visible={dropdownPresenzaId === p.id} transparent animationType="fade" onRequestClose={() => setDropdownPresenzaId(null)}>
                      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setDropdownPresenzaId(null)}>
                        <View style={styles.dropdownPresenzaBox}>
                          {STATI_PRESENZA.map((stato) => {
                            const c = coloreStatoPresenza(stato, colors);
                            return (
                              <TouchableOpacity
                                key={stato}
                                style={[styles.opzionePresenza, { backgroundColor: c.bg, borderColor: c.border || c.bg }]}
                                onPress={() => cambiaPresenza(p, stato)}
                              >
                                <Text style={[styles.opzionePresenzaText, { color: c.fg }]}>{t(`aulaStudioPresenza${stato.replace(/\s/g, '')}`, lang)}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </TouchableOpacity>
                    </Modal>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>

      {/* Modale: aggiungi manualmente */}
      <Modal visible={modaleAggiungiAperto} transparent animationType="fade" onRequestClose={() => setModaleAggiungiAperto(false)}>
        <View style={styles.overlay}>
          <View style={styles.modaleBox}>
            <Text style={styles.modaleTitolo}>{t('aulaStudioAggiungiManualmente', lang)}</Text>
            <Text style={styles.etichettaModale}>{t('aulaStudioFasceOrarie', lang)}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {configAula.fasce.map((f) => {
                const fasciaStr = `${f.inizio}-${f.fine}`;
                return (
                  <TouchableOpacity
                    key={fasciaStr}
                    style={[styles.chipPresenza, formFascia === fasciaStr && styles.chipPresenzaAttiva]}
                    onPress={() => setFormFascia(fasciaStr)}
                  >
                    <Text style={[styles.chipPresenzaText, formFascia === fasciaStr && styles.chipPresenzaTextAttiva]}>{numArabo(fasciaStr, lang)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput style={styles.input} placeholder={t('nome', lang) || 'Nome'} placeholderTextColor={colors.placeholder} value={formNome} onChangeText={setFormNome} />
            <TextInput style={styles.input} placeholder={t('cognome', lang) || 'Cognome'} placeholderTextColor={colors.placeholder} value={formCognome} onChangeText={setFormCognome} />
            <View style={{ flexDirection: 'row' }}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="3B" placeholderTextColor={colors.placeholder} value={formClasse} onChangeText={setFormClasse} autoCapitalize="characters" />
              <TextInput style={[styles.input, { flex: 1, marginLeft: 8 }]} placeholder="12" placeholderTextColor={colors.placeholder} value={formNumero} onChangeText={setFormNumero} keyboardType="number-pad" />
            </View>
            <View style={styles.rigaBottoniModale}>
              <TouchableOpacity style={styles.bottoneSecondario} onPress={() => setModaleAggiungiAperto(false)}>
                <Text style={styles.bottoneSecondarioText}>{t('annulla', lang) || 'Annulla'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bottonePrimario} onPress={confermaAggiungiManuale}>
                <Text style={styles.bottonePrimarioText}>{t('salva', lang) || 'Salva'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modale: pallino con nota obbligatoria */}
      <Modal visible={!!modalePallino} transparent animationType="fade" onRequestClose={() => setModalePallino(null)}>
        <View style={styles.overlay}>
          <View style={styles.modaleBox}>
            <Text style={styles.modaleTitolo}>{t('aulaStudioNuovoPallino', lang)}</Text>
            {modalePallino && (
              <Text style={styles.testoInfo}>
                {modalePallino.nome} {modalePallino.cognome} ({modalePallino.classe}, n. {numArabo(modalePallino.numero, lang)})
              </Text>
            )}
            <TextInput
              style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
              placeholder={t('aulaStudioMotivoPlaceholder', lang)}
              placeholderTextColor={colors.placeholder}
              value={motivoPallino}
              onChangeText={setMotivoPallino}
              multiline
            />
            <View style={styles.rigaBottoniModale}>
              <TouchableOpacity
                style={styles.bottoneSecondario}
                onPress={() => {
                  setModalePallino(null);
                  setMotivoPallino('');
                }}
              >
                <Text style={styles.bottoneSecondarioText}>{t('annulla', lang) || 'Annulla'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.bottonePrimario, { backgroundColor: colors.danger }]} onPress={confermaPallino}>
                <Text style={styles.bottonePrimarioText}>{t('aulaStudioAggiungiPallino', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modale: conferma rimozione pallino (solo Preside/Vice Preside IPI) */}
      <Modal visible={!!modaleRimuoviPallino} transparent animationType="fade" onRequestClose={() => setModaleRimuoviPallino(null)}>
        <View style={styles.overlay}>
          <View style={styles.modaleBox}>
            <Text style={styles.modaleTitolo}>{lang === 'ar' ? 'إزالة نقطة' : 'Rimuovi pallino'}</Text>
            {modaleRimuoviPallino && (
              <Text style={styles.testoInfo}>
                {modaleRimuoviPallino.nome} {modaleRimuoviPallino.cognome} ({modaleRimuoviPallino.classe}, n. {numArabo(modaleRimuoviPallino.numero, lang)})
                {'\n'}
                {ultimaSanzionePerStudente[modaleRimuoviPallino.chiaveStudente]?.motivo
                  ? `${lang === 'ar' ? 'آخر سبب: ' : 'Ultimo motivo: '}${ultimaSanzionePerStudente[modaleRimuoviPallino.chiaveStudente].motivo}`
                  : ''}
              </Text>
            )}
            <View style={styles.rigaBottoniModale}>
              <TouchableOpacity style={styles.bottoneSecondario} onPress={() => setModaleRimuoviPallino(null)}>
                <Text style={styles.bottoneSecondarioText}>{t('annulla', lang) || 'Annulla'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.bottonePrimario, { backgroundColor: colors.danger }]} onPress={confermaRimozionePallino}>
                <Text style={styles.bottonePrimarioText}>{lang === 'ar' ? 'إزالة' : 'Rimuovi'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modale: storico pallini dello studente (sola lettura, aperto toccando la pallina) */}
      <Modal visible={!!storicoPalliniStudente} transparent animationType="fade" onRequestClose={() => setStoricoPalliniStudente(null)}>
        <View style={styles.overlay}>
          <View style={[styles.modaleBox, { maxHeight: '80%' }]}>
            {storicoPalliniStudente && (
              <>
                <Text style={styles.modaleTitolo}>
                  {storicoPalliniStudente.nome} {storicoPalliniStudente.cognome}
                </Text>
                <Text style={[styles.testoInfo, { marginBottom: 10 }]}>
                  {storicoPalliniStudente.classe}, n. {numArabo(storicoPalliniStudente.numero, lang)}
                </Text>
                <ScrollView>
                  {sanzioniStoricoStudente.length === 0 ? (
                    <Text style={styles.testoInfo}>{lang === 'ar' ? 'لا توجد نقاط' : 'Nessun pallino registrato.'}</Text>
                  ) : (
                    sanzioniStoricoStudente.map((s, idx) => (
                      <View key={s.id} style={styles.rigaStoricoPallino}>
                        <Text style={styles.rigaStoricoPallinoNumero}>{numArabo(idx + 1, lang)}°</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rigaStoricoPallinoData}>{dataArabo(s.data, lang)}</Text>
                          <Text style={styles.rigaStoricoPallinoMotivo}>{s.motivo}</Text>
                          {!!s.creatoDaNome && (
                            <Text style={styles.rigaStoricoPallinoAutore}>
                              {lang === 'ar' ? `بواسطة: ${s.creatoDaNome}` : `Inserito da: ${s.creatoDaNome}`}
                            </Text>
                          )}
                        </View>
                      </View>
                    ))
                  )}
                  {bloccoAttivoStoricoStudente && (
                    <View style={styles.rigaStoricoBlocco}>
                      <Text style={styles.rigaStoricoBloccoTitolo}>
                        {lang === 'ar' ? `محظور حتى ${numArabo(bloccoAttivoStoricoStudente.bloccatoFino, lang)}` : `Bloccato fino al ${bloccoAttivoStoricoStudente.bloccatoFino}`}
                      </Text>
                      {!!bloccoAttivoStoricoStudente.motivo && (
                        <Text style={styles.rigaStoricoPallinoMotivo}>{bloccoAttivoStoricoStudente.motivo}</Text>
                      )}
                      {!!bloccoAttivoStoricoStudente.creatoDaNome && (
                        <Text style={styles.rigaStoricoPallinoAutore}>
                          {lang === 'ar' ? `بواسطة: ${bloccoAttivoStoricoStudente.creatoDaNome}` : `Inserito da: ${bloccoAttivoStoricoStudente.creatoDaNome}`}
                        </Text>
                      )}
                    </View>
                  )}
                </ScrollView>

                {/* Punto 5: cambiare/annullare il provvedimento anche dopo averlo già preso. */}
                {azioniConsentite && (
                  <View style={styles.rigaProvvedimento}>
                    {bloccoAttivoStoricoStudente ? (
                      <TouchableOpacity
                        style={[styles.bottoneProvvedimento, { backgroundColor: colors.success }, sbloccoInCorso && { opacity: 0.6 }]}
                        onPress={sbloccaStoricoStudente}
                        disabled={sbloccoInCorso}
                      >
                        <Text style={styles.bottoneProvvedimentoText}>{lang === 'ar' ? 'إلغاء الحظر' : 'Sblocca'}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {sanzioniStoricoStudente.length >= 3 && (
                      <TouchableOpacity
                        style={[styles.bottoneProvvedimento, { backgroundColor: colors.moveBtn }]}
                        onPress={() => {
                          if (!storicoPalliniStudente) return;
                          setStudenteAzione(storicoPalliniStudente);
                          setStoricoPalliniStudente(null);
                        }}
                      >
                        <Text style={styles.bottoneProvvedimentoText}>
                          {bloccoAttivoStoricoStudente
                            ? (lang === 'ar' ? 'تغيير الإجراء' : 'Cambia provvedimento')
                            : (lang === 'ar' ? 'تطبيق إجراء' : 'Applica provvedimento')}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </>
            )}
            <TouchableOpacity style={{ marginTop: 10, alignItems: 'center' }} onPress={() => setStoricoPalliniStudente(null)}>
              <Text style={styles.bottoneSecondarioText}>{t('fatto', lang) || 'Fatto'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modale: azioni al 3° pallino nel semestre */}
      <Modal visible={!!studenteAzione} transparent animationType="fade" onRequestClose={() => setStudenteAzione(null)}>
        <View style={styles.overlay}>
          <View style={styles.modaleBox}>
            <Text style={styles.modaleTitolo}>{t('aulaStudioTerzoPallinoTitolo', lang)}</Text>
            {studenteAzione && (
              <Text style={styles.testoInfo}>
                {studenteAzione.nome} {studenteAzione.cognome} ({studenteAzione.classe}, n. {numArabo(studenteAzione.numero, lang)})
              </Text>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 4 }}>
              <Text style={{ color: colors.textSub, marginRight: 8 }}>{t('aulaStudioGiorniLavorativi', lang)}</Text>
              <TextInput
                style={[styles.input, { width: 60, textAlign: 'center' }]}
                value={giorniBlocco}
                onChangeText={setGiorniBlocco}
                keyboardType="number-pad"
              />
            </View>
            <TouchableOpacity style={[styles.bottoneAzioneTerza, { backgroundColor: colors.danger }]} onPress={() => eseguiAzioneTerzoPallino(AZIONI_TERZO_PALLINO.BLOCCA)}>
              <Text style={styles.bottonePrimarioText}>{t('aulaStudioAzioneBlocca', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.bottoneAzioneTerza, { backgroundColor: colors.warning }]} onPress={() => eseguiAzioneTerzoPallino(AZIONI_TERZO_PALLINO.RIFIUTA)}>
              <Text style={[styles.bottonePrimarioText, { color: colors.warningText }]}>{t('aulaStudioAzioneRifiuta', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.bottoneAzioneTerza, { backgroundColor: colors.moveBtn }]} onPress={() => eseguiAzioneTerzoPallino(AZIONI_TERZO_PALLINO.ALTRA_POSSIBILITA)}>
              <Text style={[styles.bottonePrimarioText, { color: colors.textMain }]}>{t('aulaStudioAzioneAltraPossibilita', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ marginTop: 10, alignItems: 'center' }} onPress={() => setStudenteAzione(null)}>
              <Text style={styles.bottoneSecondarioText}>{t('annulla', lang) || 'Annulla'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modale: storico appelli (elenco giorni con dati per l'aula corrente) */}
      <Modal visible={storicoPopupAperto} transparent animationType="fade" onRequestClose={() => setStoricoPopupAperto(false)}>
        <View style={styles.overlay}>
          <View style={[styles.modaleBox, { maxHeight: '80%' }]}>
            <Text style={styles.modaleTitolo}>{lang === 'ar' ? 'سجل الحضور' : 'Storico appelli'}</Text>
            <Text style={[styles.testoInfo, { marginBottom: 8 }]}>{nomeAulaStudio(aulaCorrente, lang)}</Text>
            <ScrollView>
              {storicoCaricamento ? (
                <Text style={styles.testoInfo}>{lang === 'ar' ? 'تحميل...' : 'Caricamento...'}</Text>
              ) : storicoGiorni.length === 0 ? (
                <Text style={styles.testoInfo}>{lang === 'ar' ? 'لا يوجد سجل بعد' : 'Nessun giorno registrato ancora.'}</Text>
              ) : (
                storicoGiorni.map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={styles.rigaStorico}
                    onPress={() => {
                      setDataSelezionata(g);
                      setStoricoPopupAperto(false);
                    }}
                  >
                    <Text style={styles.rigaStoricoTesto}>{numArabo(g, lang)}</Text>
                    <Text style={styles.rigaStoricoFreccia}>{lang === 'ar' ? '‹' : '›'}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <TouchableOpacity style={{ marginTop: 10, alignItems: 'center' }} onPress={() => setStoricoPopupAperto(false)}>
              <Text style={styles.bottoneSecondarioText}>{t('fatto', lang) || 'Fatto'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modale: coda approvazione richieste turno insegnanti + assegnazione diretta */}
      <Modal
        visible={turniPopupAperto}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setAssegnaAperto(false);
          setTurniPopupAperto(false);
        }}
      >
        <View style={styles.overlay}>
          <View style={[styles.modaleBox, { maxHeight: '80%' }]}>
            <Text style={styles.modaleTitolo}>
              {assegnaAperto ? (lang === 'ar' ? 'تعيين مناوبة' : 'Assegna un turno') : lang === 'ar' ? 'طلبات المناوبة' : 'Richieste di turno'}
            </Text>

            {!assegnaAperto && (
              <TouchableOpacity style={[styles.bottonePrimario, { marginBottom: 10 }]} onPress={apriAssegna}>
                <Text style={styles.bottonePrimarioText}>+ {lang === 'ar' ? 'تعيين مناوبة' : 'Assegna un turno'}</Text>
              </TouchableOpacity>
            )}

            {assegnaAperto ? (
              <ScrollView>
                <Text style={[styles.testoInfo, { marginBottom: 10 }]}>
                  {lang === 'ar'
                    ? 'عيّن مناوبة مساعدة مباشرة لمعلم، دون انتظار طلب منه — سيتلقى إشعارًا بذلك.'
                    : "Assegna direttamente un turno di assistenza a un insegnante, senza aspettare una sua richiesta — riceverà una notifica."}
                </Text>

                <Text style={styles.etichettaAssegna}>{lang === 'ar' ? 'المعلم' : 'Insegnante'}</Text>
                <TouchableOpacity
                  style={styles.dropdownTrigger}
                  onPress={() => {
                    setAssegnaInsegnanteRicerca('');
                    setAssegnaInsegnanteDropdownAperto(true);
                  }}
                >
                  <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                    {(insegnantiAulaStudio || []).find((i) => i.uid === assegnaInsegnanteUid)?.nome ||
                      (lang === 'ar' ? 'اختر معلمًا' : 'Scegli un insegnante')}
                  </Text>
                  <Text style={styles.casellaSceltaIcona}>▼</Text>
                </TouchableOpacity>
                <Modal
                  visible={assegnaInsegnanteDropdownAperto}
                  animationType="fade"
                  transparent
                  onRequestClose={() => setAssegnaInsegnanteDropdownAperto(false)}
                >
                  <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setAssegnaInsegnanteDropdownAperto(false)}>
                    <TouchableOpacity activeOpacity={1} style={styles.dropdownRicercaBox} onPress={() => {}}>
                      <TextInput
                        style={styles.input}
                        placeholder={lang === 'ar' ? 'بحث عن معلم...' : 'Cerca insegnante...'}
                        placeholderTextColor={colors.placeholder}
                        value={assegnaInsegnanteRicerca}
                        onChangeText={setAssegnaInsegnanteRicerca}
                        autoFocus
                      />
                      <ScrollView style={{ maxHeight: 260 }}>
                        {insegnantiFiltrati.length === 0 ? (
                          <Text style={styles.testoInfo}>{lang === 'ar' ? 'لا نتائج' : 'Nessun insegnante trovato.'}</Text>
                        ) : (
                          insegnantiFiltrati.map((ins) => (
                            <TouchableOpacity
                              key={ins.uid}
                              style={[styles.dropdownOption, assegnaInsegnanteUid === ins.uid && styles.dropdownOptionActive]}
                              onPress={() => {
                                setAssegnaInsegnanteUid(ins.uid);
                                setAssegnaInsegnanteDropdownAperto(false);
                              }}
                            >
                              <Text style={[styles.dropdownOptionText, assegnaInsegnanteUid === ins.uid && styles.dropdownOptionTextActive]}>
                                {ins.nome}
                              </Text>
                            </TouchableOpacity>
                          ))
                        )}
                      </ScrollView>
                    </TouchableOpacity>
                  </TouchableOpacity>
                </Modal>

                <Text style={styles.etichettaAssegna}>{lang === 'ar' ? 'اليوم' : 'Giorno'}</Text>
                <TouchableOpacity style={styles.casellaGiorno} onPress={() => setAssegnaGiornoPopupAperto(true)}>
                  <Text style={styles.casellaGiornoText}>{numArabo(assegnaData, lang)}</Text>
                  <Text style={styles.casellaSceltaIcona}>📅</Text>
                </TouchableOpacity>
                <AulaStudioCalendarioPopup
                  visible={assegnaGiornoPopupAperto}
                  onClose={() => setAssegnaGiornoPopupAperto(false)}
                  dataSelezionata={assegnaData}
                  onSeleziona={(d) => setAssegnaData(d)}
                  colors={colors}
                  lang={lang}
                  titolo={t('aulaStudioScegliGiorno', lang)}
                />

                <Text style={styles.etichettaAssegna}>{lang === 'ar' ? 'الحصص' : 'Fasce'}</Text>
                <View style={styles.rigaFasceSelettore}>
                  {(configAula?.fasce || []).map((f) => {
                    const fasciaStr = `${f.inizio}-${f.fine}`;
                    const attiva = assegnaFasceScelte.includes(fasciaStr);
                    return (
                      <TouchableOpacity
                        key={fasciaStr}
                        style={[styles.chipFasciaSelettore, attiva && styles.chipFasciaSelettoreAttiva]}
                        onPress={() => toggleAssegnaFascia(fasciaStr)}
                      >
                        <Text style={[styles.chipFasciaSelettoreText, attiva && styles.chipFasciaSelettoreTextAttiva]}>{numArabo(fasciaStr, lang)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <TouchableOpacity style={[styles.bottoneSecondario, { flex: 1 }]} onPress={() => setAssegnaAperto(false)}>
                    <Text style={styles.bottoneSecondarioText}>{t('annulla', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.bottonePrimario, { flex: 1 }, assegnaInCorso && { opacity: 0.6 }]}
                    onPress={confermaAssegnaTurno}
                    disabled={assegnaInCorso}
                  >
                    <Text style={styles.bottonePrimarioText}>{lang === 'ar' ? 'تعيين' : 'Assegna'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : (
              <ScrollView>
                {richiesteInAttesa.length === 0 ? (
                  <Text style={styles.testoInfo}>{lang === 'ar' ? 'لا توجد طلبات معلقة' : 'Nessuna richiesta in attesa.'}</Text>
                ) : (
                  richiesteInAttesa.map((r) => (
                    <View key={r.id} style={styles.rigaRichiestaTurno}>
                      <Text style={styles.rigaRichiestaTurnoTesto}>
                        {r.insegnanteNome} — {nomeAulaStudio(aule.find((a) => a.id === r.aulaId), lang) || r.aulaNome}
                        {'\n'}
                        {dataArabo(r.data, lang)} — {numArabo(r.fasce.join(', '), lang)}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                        <TouchableOpacity style={[styles.bottonePrimario, { backgroundColor: colors.danger, flex: 1 }]} onPress={() => decidiTurno(r, 'rifiutata')}>
                          <Text style={styles.bottonePrimarioText}>{lang === 'ar' ? 'رفض' : 'Rifiuta'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.bottonePrimario, { backgroundColor: colors.success, flex: 1 }]} onPress={() => decidiTurno(r, 'confermata')}>
                          <Text style={styles.bottonePrimarioText}>{lang === 'ar' ? 'تأكيد' : 'Conferma'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            )}

            <TouchableOpacity
              style={{ marginTop: 10, alignItems: 'center' }}
              onPress={() => {
                setAssegnaAperto(false);
                setTurniPopupAperto(false);
              }}
            >
              <Text style={styles.bottoneSecondarioText}>{t('fatto', lang) || 'Fatto'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const getStyles = (colors: Record<string, string>, isRTL: boolean) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    contenutoWrap: { maxWidth: 940, width: '100%', alignSelf: 'center' },
    rigaTitolo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    titolo: { fontSize: 22, fontWeight: '700', color: colors.textMain },
    iconaTonda: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
    iconaTondaText: { fontSize: 15, color: colors.textMain },
    badgeContatore: { position: 'absolute', top: -4, right: -4, backgroundColor: colors.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
    badgeContatoreText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
    bannerRestrizione: { backgroundColor: colors.surfaceAlt, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, padding: 12, marginBottom: 14 },
    bannerRestrizioneText: { color: colors.textMain, fontWeight: '700', fontSize: 13 },
    bannerRestrizioneSub: { color: colors.warning, fontSize: 12, marginTop: 4, fontWeight: '600' },
    selettoreCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 14,
    },
    selettoreEtichetta: {
      color: colors.textSub,
      fontWeight: '700',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 8,
      textAlign: isRTL ? 'right' : 'left',
    },
    rigaAule: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    chipAula: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    chipAulaAttiva: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipAulaText: { color: colors.textMain, fontWeight: '600' },
    chipAulaTextAttiva: { color: colors.primaryText },
    rigaGiornoScelta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
    casellaGiorno: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      minWidth: 150,
    },
    casellaGiornoText: { color: colors.textMain, fontSize: 14, fontWeight: '700' },
    casellaSceltaIcona: { color: colors.textMuted, fontSize: 13, marginLeft: 6 },
    bottoneOggi: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.surfaceAlt },
    bottoneOggiText: { color: colors.textMain, fontWeight: '600', fontSize: 12 },
    rigaFasceSelettore: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
    chipFasciaSelettore: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    chipFasciaSelettoreAttiva: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipFasciaSelettoreText: { color: colors.textMain, fontSize: 12, fontWeight: '600' },
    chipFasciaSelettoreTextAttiva: { color: colors.primaryText },
    rigaBottoniAlto: { flexDirection: 'row', gap: 10, marginBottom: 14 },
    bottoneEsporta: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
    bottoneEsportaText: { color: colors.textMain, fontWeight: '600' },
    bottoneAggiungi: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    bottoneAggiungiText: { color: colors.primaryText, fontWeight: '700', fontSize: 13 },
    testoInfo: { color: colors.textMuted, fontSize: 13 },
    etichettaModale: { color: colors.textSub, fontWeight: '600', fontSize: 12, marginBottom: 6 },
    legendaPopupBox: { backgroundColor: colors.surface, borderRadius: 16, padding: 18, width: '100%', maxWidth: 380 },
    legendaBox: { marginTop: 10, gap: 10 },
    legendaRiga: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    legendaVoce: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendaPallino: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
    legendaText: { color: colors.textMuted, fontSize: 11 },
    tableScrollWrap: { marginBottom: 20 },
    tableCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    tableHeaderRow: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceAlt,
      borderBottomWidth: 1,
      borderColor: colors.border,
      paddingVertical: 10,
      paddingHorizontal: 8,
    },
    tableHeaderCell: { color: colors.textMuted, fontWeight: '700', fontSize: 11, paddingHorizontal: 4, textAlign: isRTL ? 'right' : 'left' },
    tableRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    tableRowAlt: { backgroundColor: colors.surfaceAlt },
    tableCell: { color: colors.textMain, fontSize: 12, paddingHorizontal: 4, textAlign: isRTL ? 'right' : 'left' },
    tableSubBadge: { color: colors.textMuted, fontSize: 10, paddingHorizontal: 4, marginTop: 1, textAlign: isRTL ? 'right' : 'left' },
    pallinoTondo: { width: 16, height: 16, borderRadius: 8, borderWidth: 1 },
    tendinaPresenza: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: 8,
      borderWidth: 1,
      paddingVertical: 6,
      paddingHorizontal: 8,
    },
    tendinaPresenzaText: { fontSize: 11, fontWeight: '700', flex: 1, textAlign: isRTL ? 'right' : 'left' },
    tendinaPresenzaFreccia: { fontSize: 9, marginLeft: isRTL ? 0 : 4, marginRight: isRTL ? 4 : 0 },
    chipPresenza: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginRight: 6, marginBottom: 4 },
    chipPresenzaAttiva: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipPresenzaText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
    chipPresenzaTextAttiva: { color: colors.primaryText },
    bottonePallino: { paddingVertical: 6, paddingHorizontal: 8 },
    bottonePallinoText: { fontSize: 16, color: colors.textMuted },
    overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 20 },
    dropdownPresenzaBox: { backgroundColor: colors.surface, borderRadius: 14, padding: 10, width: '100%', maxWidth: 300, gap: 8 },
    opzionePresenza: { borderRadius: 10, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
    opzionePresenzaText: { fontWeight: '700', fontSize: 14 },
    modaleBox: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 420 },
    modaleTitolo: { fontWeight: '700', fontSize: 16, color: colors.textMain, marginBottom: 12 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.textMain, backgroundColor: colors.surfaceAlt, marginBottom: 10 },
    rigaBottoniModale: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
    bottoneSecondario: { paddingVertical: 10, paddingHorizontal: 14 },
    bottoneSecondarioText: { color: colors.textMuted, fontWeight: '600' },
    bottonePrimario: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700', textAlign: 'center' },
    bottoneAzioneTerza: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
    rigaRichiestaTurno: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, marginBottom: 8, backgroundColor: colors.surfaceAlt },
    rigaRichiestaTurnoTesto: { color: colors.textMain, fontSize: 12, fontWeight: '600' },
    etichettaAssegna: { color: colors.textSub, fontWeight: '600', fontSize: 12, marginBottom: 6, marginTop: 10 },
    dropdownTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    dropdownTriggerText: { color: colors.textMain, fontSize: 14, fontWeight: '700', flex: 1, paddingRight: 8 },
    dropdownRicercaBox: {
      backgroundColor: colors.bg,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      maxWidth: 360,
      width: '100%',
      alignSelf: 'center',
    },
    dropdownOption: { paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8 },
    dropdownOptionActive: { backgroundColor: colors.primary },
    dropdownOptionText: { color: colors.textMain, fontSize: 14, fontWeight: '600' },
    dropdownOptionTextActive: { color: colors.primaryText },
    rigaStorico: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    rigaStoricoTesto: { color: colors.textMain, fontSize: 13, fontWeight: '600' },
    rigaStoricoFreccia: { color: colors.primary, fontSize: 14, fontWeight: '700' },
    rigaStoricoPallino: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border },
    rigaStoricoPallinoNumero: { color: colors.textMuted, fontWeight: '700', fontSize: 12, width: 24 },
    rigaStoricoPallinoData: { color: colors.textMain, fontSize: 12, fontWeight: '700' },
    rigaStoricoPallinoMotivo: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    rigaStoricoPallinoAutore: { color: colors.textMuted, fontSize: 11, fontStyle: 'italic', marginTop: 2 },
    rigaStoricoBlocco: { backgroundColor: colors.surfaceAlt, borderRadius: 10, borderWidth: 1, borderColor: colors.danger, padding: 10, marginTop: 10 },
    rigaStoricoBloccoTitolo: { color: colors.danger, fontWeight: '700', fontSize: 12 },
    rigaProvvedimento: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
    bottoneProvvedimento: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center', minWidth: 120 },
    bottoneProvvedimentoText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  });
