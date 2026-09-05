// ============================================================================
// AULA STUDIO — Vista Studente: due caselle (giorno con calendario popup,
// limitato ai prossimi giorni lavorativi prenotabili; fascia oraria con
// popup a scelta multipla), precompilate sul giorno/fascia più vicini
// disponibili. Dati studente presi dal profilo (mai più richiesti
// manualmente dopo il wizard di primo accesso). "Le mie prenotazioni".
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import AulaStudioCalendarioPopup from './aula-studio-calendario-popup';
import { TIPI_REGISTRO_AULA_STUDIO } from './aula-studio-constants';
import {
  cancellaPrenotazioneAulaStudio,
  contaPalliniSemestre,
  creaPrenotazioneAulaStudio,
  ottieniBloccoAttivo,
  trovaConflittoStessaFascia,
  useAulaStudioAule,
  useAulaStudioConfig,
  useAulaStudioMiePrenotazioni,
  useAulaStudioPrenotazioniGiorno,
} from './aula-studio-data';
import {
  AULA_STUDIO_CONFIG_DEFAULT,
  calcolaChiaveStudente,
  calcolaSemestreCorrente,
  fasciaGiaIniziata,
  formattaDataIso,
  isEntroLimiteAnticipo,
  isGiornoLavorativo,
  nomeAulaStudio,
  oggiIso,
  parseDataIso,
} from './aula-studio-utils';
import { AulaStudioSharedProps, BloccoAulaStudio, PrenotazioneAulaStudio } from './aula-studio-types';
import { numArabo, dataArabo } from '../../utils/numeri-arabo';

function generaGiorniPrenotabili(anticipoGiorni: number, ferieExtra: any[]): string[] {
  const risultato: string[] = [];
  let cursore = parseDataIso(oggiIso());
  for (let i = 0; i <= anticipoGiorni + 7 && risultato.length <= anticipoGiorni; i++) {
    const dataStr = formattaDataIso(cursore);
    if (isEntroLimiteAnticipo(dataStr, anticipoGiorni) && isGiornoLavorativo(dataStr, ferieExtra)) {
      risultato.push(dataStr);
    }
    cursore = new Date(cursore.getFullYear(), cursore.getMonth(), cursore.getDate() + 1);
  }
  return risultato;
}

export default function AulaStudioStudentView(props: AulaStudioSharedProps) {
  const { db, user, lang, colors, t, mostraAlert, registraAttivita, inviaNotificaConPreferenza, profiloAulaStudio } = props;
  const styles = useMemo(() => getStyles(colors), [colors]);

  const { configPerAula } = useAulaStudioConfig(db);
  const { aule } = useAulaStudioAule(db);

  // Lo studente può prenotare solo nelle aule del proprio tipo scuola (Medie/IPI), secondo il profilo.
  const auleConsentite = useMemo(
    () => (profiloAulaStudio ? aule.filter((a) => a.tipoScuola === profiloAulaStudio.tipoScuola) : []),
    [aule, profiloAulaStudio]
  );

  const [scheda, setScheda] = useState<'prenota' | 'mie'>('prenota');
  const [aulaId, setAulaId] = useState<string>('');
  const configAula = configPerAula[aulaId] || AULA_STUDIO_CONFIG_DEFAULT;

  // Sceglie automaticamente la prima aula consentita (per il tipo scuola dello studente) appena disponibile.
  useEffect(() => {
    if (auleConsentite.length === 0) return;
    if (!aulaId || !auleConsentite.some((a) => a.id === aulaId)) {
      setAulaId(auleConsentite[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auleConsentite]);

  const giorniPrenotabili = useMemo(
    () => generaGiorniPrenotabili(configAula.anticipoGiorni, configAula.ferieExtra),
    [configAula]
  );

  const [dataSelezionata, setDataSelezionata] = useState<string | null>(null);
  const [giornoPopupAperto, setGiornoPopupAperto] = useState(false);
  const [fasciaPopupAperto, setFasciaPopupAperto] = useState(false);

  // Precompila automaticamente sul primo giorno prenotabile disponibile.
  useEffect(() => {
    if (giorniPrenotabili.length === 0) {
      setDataSelezionata(null);
      return;
    }
    if (!dataSelezionata || !giorniPrenotabili.includes(dataSelezionata)) {
      setDataSelezionata(giorniPrenotabili[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giorniPrenotabili.join(','), aulaId]);

  const { prenotazioni: prenotazioniGiorno } = useAulaStudioPrenotazioniGiorno(db, aulaId, dataSelezionata);
  const { miePrenotazioni } = useAulaStudioMiePrenotazioni(db, user?.uid || null);

  const [fasceSelezionate, setFasceSelezionate] = useState<string[]>([]);
  const [inviando, setInviando] = useState(false);

  const contaPostiFascia = (fasciaStr: string) => {
    const confermati = prenotazioniGiorno.filter((p) => p.fascia === fasciaStr && p.stato === 'Confermata').length;
    const inAttesa = prenotazioniGiorno.filter((p) => p.fascia === fasciaStr && p.stato === 'In attesa').length;
    return { liberi: Math.max(0, configAula.posti - confermati), inAttesa };
  };

  // Precompila automaticamente sulla prima fascia ancora disponibile per il giorno selezionato.
  useEffect(() => {
    if (!dataSelezionata || configAula.fasce.length === 0) return;
    setFasceSelezionate((prev) => {
      const valide = prev.filter((f) => configAula.fasce.some((cf) => `${cf.inizio}-${cf.fine}` === f));
      if (valide.length > 0) return valide;
      const primaDisponibile = configAula.fasce.find((f) => !fasciaGiaIniziata(dataSelezionata, f));
      const scelta = primaDisponibile || configAula.fasce[0];
      return scelta ? [`${scelta.inizio}-${scelta.fine}`] : [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSelezionata, aulaId]);

  const chiaveStudente = profiloAulaStudio
    ? calcolaChiaveStudente(profiloAulaStudio.classe, profiloAulaStudio.numeroRegistro)
    : null;
  const [statoSanzioni, setStatoSanzioni] = useState<{ pallini: number; blocco: BloccoAulaStudio | null } | null>(null);

  useEffect(() => {
    let annullato = false;
    if (!chiaveStudente) {
      setStatoSanzioni(null);
      return;
    }
    (async () => {
      const semestre = calcolaSemestreCorrente(oggiIso(), configAula.semestre1Inizio, configAula.semestre2Inizio);
      const [pallini, blocco] = await Promise.all([
        contaPalliniSemestre(db, chiaveStudente, semestre),
        ottieniBloccoAttivo(db, chiaveStudente, oggiIso()),
      ]);
      if (!annullato) setStatoSanzioni({ pallini, blocco });
    })();
    return () => {
      annullato = true;
    };
  }, [chiaveStudente, db, configAula.semestre1Inizio, configAula.semestre2Inizio]);

  const toggleFascia = (fasciaStr: string) => {
    setFasceSelezionate((prev) => (prev.includes(fasciaStr) ? prev.filter((f) => f !== fasciaStr) : [...prev, fasciaStr]));
  };

  const inviaPrenotazione = async () => {
    if (!profiloAulaStudio || !dataSelezionata) return;
    if (fasceSelezionate.length === 0) {
      mostraAlert(t('attenzione', lang), t('aulaStudioSelezionaAlmenoUnaFascia', lang));
      return;
    }
    const chiave = calcolaChiaveStudente(profiloAulaStudio.classe, profiloAulaStudio.numeroRegistro);
    if (statoSanzioni?.blocco) {
      mostraAlert(t('attenzione', lang), t('aulaStudioBloccoAttivoMessaggio', lang, statoSanzioni.blocco.bloccatoFino));
      return;
    }

    setInviando(true);
    try {
      const conflitto = await trovaConflittoStessaFascia(db, chiave, dataSelezionata, fasceSelezionate);
      if (conflitto) {
        mostraAlert(t('attenzione', lang), t('aulaStudioConflittoAltraAula', lang, conflitto));
        setInviando(false);
        return;
      }

      const datiStudente = {
        nome: profiloAulaStudio.nomeStudente,
        cognome: profiloAulaStudio.cognomeStudente,
        numero: profiloAulaStudio.numeroRegistro,
        classe: profiloAulaStudio.classe,
        chiaveStudente: chiave,
        utenteUid: user?.uid || null,
        utenteEmail: user?.email || null,
      };

      const aula = auleConsentite.find((a) => a.id === aulaId);
      if (!aula) {
        setInviando(false);
        return;
      }
      let almenoUnaConfermata = false;
      let almenoUnaAttesa = false;
      for (const fasciaStr of fasceSelezionate) {
        const risultato = await creaPrenotazioneAulaStudio(db, aulaId, aula.nome, dataSelezionata, fasciaStr, datiStudente, configAula.posti);
        if (risultato.stato === 'Confermata') almenoUnaConfermata = true;
        else almenoUnaAttesa = true;
      }

      await registraAttivita(
        TIPI_REGISTRO_AULA_STUDIO.PRENOTAZIONE,
        `${aula.nome} il ${dataSelezionata} fasce ${fasceSelezionate.join(', ')} — ${profiloAulaStudio.nomeStudente} ${profiloAulaStudio.cognomeStudente} (${profiloAulaStudio.classe}, n. ${profiloAulaStudio.numeroRegistro})`
      );

      const messaggio =
        almenoUnaConfermata && almenoUnaAttesa
          ? t('aulaStudioPrenotazioneParzialeAttesa', lang)
          : almenoUnaAttesa
          ? t('aulaStudioPrenotazioneInAttesa', lang)
          : t('aulaStudioPrenotazioneConfermata', lang);
      mostraAlert(t('successo', lang), messaggio);
      setScheda('mie');
    } catch (e: any) {
      mostraAlert(t('errore', lang), e?.message || t('aulaStudioErroreGenerico', lang));
    } finally {
      setInviando(false);
    }
  };

  const annullaPrenotazione = async (p: PrenotazioneAulaStudio) => {
    const fascia = { inizio: p.fascia.split('-')[0], fine: p.fascia.split('-')[1] };
    if (fasciaGiaIniziata(p.data, fascia)) {
      mostraAlert(t('attenzione', lang), t('aulaStudioFasciaGiaIniziata', lang));
      return;
    }
    try {
      const promosso = await cancellaPrenotazioneAulaStudio(db, p.id);
      await registraAttivita(
        TIPI_REGISTRO_AULA_STUDIO.CANCELLAZIONE,
        `${p.aulaNome} il ${p.data} fascia ${p.fascia} — ${p.nome} ${p.cognome} (${p.classe}, n. ${p.numero})`
      );
      if (promosso) {
        await registraAttivita(
          TIPI_REGISTRO_AULA_STUDIO.PROMOZIONE_WAITLIST,
          `${promosso.aulaNome} il ${promosso.data} fascia ${promosso.fascia} — ${promosso.nome} ${promosso.cognome} promosso/a da lista d'attesa`
        );
        if (promosso.utenteUid) {
          const titolo = t('aulaStudioNotificaPromossoTitolo', lang);
          const corpo = t('aulaStudioNotificaPromossoCorpo', lang, promosso.aulaNome, promosso.data, promosso.fascia);
          await inviaNotificaConPreferenza(promosso.utenteUid, 'esito_prenotazione', titolo, corpo, {
            tipo: 'aula_studio_promozione',
          });
        }
      }
    } catch (e: any) {
      mostraAlert(t('errore', lang), e?.message || t('aulaStudioErroreGenerico', lang));
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.formWrap}>
        <Text style={styles.titolo}>{t('aulaStudioTitoloSezione', lang)}</Text>

        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tabBtn, scheda === 'prenota' && styles.tabBtnAttivo]} onPress={() => setScheda('prenota')}>
            <Text style={[styles.tabBtnText, scheda === 'prenota' && styles.tabBtnTextAttivo]}>{t('aulaStudioSchedaPrenota', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, scheda === 'mie' && styles.tabBtnAttivo]} onPress={() => setScheda('mie')}>
            <Text style={[styles.tabBtnText, scheda === 'mie' && styles.tabBtnTextAttivo]}>
              {t('aulaStudioSchedaMiePrenotazioni', lang)} {miePrenotazioni.length > 0 ? `(${numArabo(miePrenotazioni.length, lang)})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {scheda === 'prenota' ? (
          <View>
            <Text style={styles.etichetta}>{t('aulaStudioScegliAula', lang)}</Text>
            {auleConsentite.length === 0 ? (
              <Text style={styles.testoInfo}>
                {lang === 'ar' ? 'لا توجد قاعة دراسة متاحة لنوع مدرستك بعد.' : 'Nessuna Aula Studio disponibile ancora per il tuo tipo di scuola.'}
              </Text>
            ) : (
              <View style={styles.rigaAule}>
                {auleConsentite.map((a) => (
                  <TouchableOpacity key={a.id} style={[styles.chipAula, aulaId === a.id && styles.chipAulaAttiva]} onPress={() => setAulaId(a.id)}>
                    <Text style={[styles.chipAulaText, aulaId === a.id && styles.chipAulaTextAttiva]}>{nomeAulaStudio(a, lang)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {auleConsentite.length > 0 && (
              <>
                {giorniPrenotabili.length === 0 ? (
                  <Text style={styles.testoInfo}>{t('aulaStudioNessunGiornoDisponibile', lang)}</Text>
                ) : (
                  <View style={styles.rigaCaselleScelta}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.etichetta}>{t('aulaStudioScegliGiorno', lang)}</Text>
                      <TouchableOpacity style={styles.casellaScelta} onPress={() => setGiornoPopupAperto(true)}>
                        <Text style={styles.casellaSceltaText}>{dataSelezionata ? dataArabo(dataSelezionata, lang) : '—'}</Text>
                        <Text style={styles.casellaSceltaIcona}>📅</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.etichetta}>{t('aulaStudioFasceOrarie', lang)}</Text>
                      <TouchableOpacity style={styles.casellaScelta} onPress={() => setFasciaPopupAperto(true)}>
                        <Text style={styles.casellaSceltaText} numberOfLines={1}>
                          {fasceSelezionate.length === 0
                            ? '—'
                            : fasceSelezionate.length === 1
                            ? numArabo(fasceSelezionate[0], lang)
                            : t('aulaStudioNFasceSelezionate', lang, numArabo(fasceSelezionate.length, lang))}
                        </Text>
                        <Text style={styles.casellaSceltaIcona}>▼</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <AulaStudioCalendarioPopup
                  visible={giornoPopupAperto}
                  onClose={() => setGiornoPopupAperto(false)}
                  dataSelezionata={dataSelezionata}
                  onSeleziona={(d) => setDataSelezionata(d)}
                  giorniAttivi={giorniPrenotabili}
                  colors={colors}
                  lang={lang}
                  titolo={t('aulaStudioScegliGiorno', lang)}
                />

                {statoSanzioni && statoSanzioni.blocco && (
                  <View style={styles.bannerBloccato}>
                    <Text style={styles.bannerBloccatoText}>{t('aulaStudioBloccoAttivoMessaggio', lang, numArabo(statoSanzioni.blocco.bloccatoFino, lang))}</Text>
                  </View>
                )}
                {statoSanzioni && !statoSanzioni.blocco && statoSanzioni.pallini > 0 && (
                  <View style={styles.bannerAvviso}>
                    <Text style={styles.bannerAvvisoText}>
                      {'🔴'.repeat(Math.min(statoSanzioni.pallini, 3))} {t('aulaStudioPalliniMessaggio', lang, numArabo(statoSanzioni.pallini, lang))}
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.bottonePrimario, (inviando || !!statoSanzioni?.blocco || !dataSelezionata) && { opacity: 0.6 }]}
                  onPress={inviaPrenotazione}
                  disabled={inviando || !!statoSanzioni?.blocco || !dataSelezionata}
                >
                  {inviando ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.bottonePrimarioText}>{t('aulaStudioPrenota', lang)}</Text>}
                </TouchableOpacity>

                {/* Popup: scelta fascia oraria (multi-selezione) */}
                <Modal visible={fasciaPopupAperto} animationType="slide" transparent onRequestClose={() => setFasciaPopupAperto(false)}>
                  <View style={styles.overlay}>
                    <View style={styles.modalContentFixed}>
                      <View style={styles.modalHeaderFixed}>
                        <Text style={styles.modalTitle}>{t('aulaStudioFasceOrarie', lang)}</Text>
                        <TouchableOpacity onPress={() => setFasciaPopupAperto(false)}>
                          <Text style={styles.closeText}>✕</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.rigaFasce}>
                        {configAula.fasce.map((f) => {
                          const fasciaStr = `${f.inizio}-${f.fine}`;
                          const { liberi, inAttesa } = contaPostiFascia(fasciaStr);
                          const passata = !!dataSelezionata && dataSelezionata === oggiIso() && fasciaGiaIniziata(dataSelezionata, f);
                          const selezionata = fasceSelezionate.includes(fasciaStr);
                          const piena = liberi <= 0;
                          return (
                            <TouchableOpacity
                              key={fasciaStr}
                              disabled={passata}
                              style={[styles.chipFascia, selezionata && styles.chipFasciaAttiva, passata && styles.chipFasciaDisabilitata]}
                              onPress={() => toggleFascia(fasciaStr)}
                            >
                              <Text style={[styles.chipFasciaOrario, selezionata && styles.chipFasciaTextAttiva]}>{numArabo(fasciaStr, lang)}</Text>
                              <Text style={[styles.chipFasciaPosti, selezionata && styles.chipFasciaTextAttiva, piena && !selezionata && styles.chipFasciaPostiPieno]}>
                                {passata ? t('aulaStudioFasciaGiaIniziata', lang) : piena ? t('aulaStudioListaAttesa', lang, numArabo(inAttesa, lang)) : t('aulaStudioPostiLiberi', lang, numArabo(liberi, lang))}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <TouchableOpacity style={styles.bottonePrimario} onPress={() => setFasciaPopupAperto(false)}>
                        <Text style={styles.bottonePrimarioText}>{t('fatto', lang) || 'Fatto'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </Modal>
              </>
            )}
          </View>
        ) : (
          <View>
            {miePrenotazioni.length === 0 ? (
              <Text style={styles.testoInfo}>{t('aulaStudioNessunaPrenotazione', lang)}</Text>
            ) : (
              miePrenotazioni.map((p) => {
                const fascia = { inizio: p.fascia.split('-')[0], fine: p.fascia.split('-')[1] };
                const puoCancellare = !fasciaGiaIniziata(p.data, fascia);
                const confermata = p.stato === 'Confermata';
                return (
                  <View key={p.id} style={styles.cardPrenotazione}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardPrenotazioneAula}>{nomeAulaStudio(aule.find((a) => a.id === p.aulaId), lang) || p.aulaNome}</Text>
                      <Text style={styles.cardPrenotazioneDettaglio}>
                        {dataArabo(p.data, lang)} · {numArabo(p.fascia, lang)}
                      </Text>
                      <View style={[styles.badgeStato, { backgroundColor: confermata ? colors.success : colors.warning }]}>
                        <Text style={[styles.badgeStatoText, { color: confermata ? '#fff' : colors.warningText }]}>
                          {confermata ? t('aulaStudioStatoConfermata', lang) : t('aulaStudioStatoInAttesa', lang)}
                        </Text>
                      </View>
                    </View>
                    {puoCancellare ? (
                      <TouchableOpacity style={styles.bottoneAnnulla} onPress={() => annullaPrenotazione(p)}>
                        <Text style={styles.bottoneAnnullaText}>{t('cancella', lang) || 'Annulla'}</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.testoFasciaIniziata}>{t('aulaStudioFasciaGiaIniziata', lang)}</Text>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    formWrap: { maxWidth: 480, width: '100%', alignSelf: 'center' },
    titolo: { fontSize: 22, fontWeight: '700', color: colors.textMain, marginBottom: 16 },
    tabRow: { flexDirection: 'row', marginBottom: 20, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 4 },
    tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
    tabBtnAttivo: { backgroundColor: colors.primary },
    tabBtnText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    tabBtnTextAttivo: { color: colors.primaryText },
    etichetta: { color: colors.textSub, fontWeight: '600', marginBottom: 8, marginTop: 14, fontSize: 13 },
    testoInfo: { color: colors.textMuted, fontSize: 14, marginTop: 8 },
    rigaAule: { flexDirection: 'row', gap: 8 },
    chipAula: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginRight: 8,
    },
    chipAulaAttiva: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipAulaText: { color: colors.textMain, fontWeight: '600' },
    chipAulaTextAttiva: { color: colors.primaryText },
    rigaCaselleScelta: { flexDirection: 'row', gap: 10, marginBottom: 6 },
    casellaScelta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 12,
    },
    casellaSceltaText: { color: colors.textMain, fontSize: 14, fontWeight: '600', flex: 1 },
    casellaSceltaIcona: { color: colors.textMuted, fontSize: 13, marginLeft: 6 },
    overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
    modalContentFixed: {
      backgroundColor: colors.bg,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      maxHeight: '85%',
      padding: 18,
      flexDirection: 'column',
      maxWidth: 480,
      width: '100%',
      alignSelf: 'center',
    },
    modalHeaderFixed: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
    modalTitle: { color: colors.textMain, fontSize: 18, fontWeight: '700', flex: 1, paddingRight: 8 },
    closeText: { color: colors.textMain, fontSize: 19 },
    rigaFasce: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    chipFascia: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginRight: 8,
      marginBottom: 8,
      minWidth: 130,
    },
    chipFasciaAttiva: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipFasciaDisabilitata: { opacity: 0.45 },
    chipFasciaOrario: { color: colors.textMain, fontWeight: '700', fontSize: 14 },
    chipFasciaPosti: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    chipFasciaPostiPieno: { color: colors.warning, fontWeight: '600' },
    chipFasciaTextAttiva: { color: colors.primaryText },
    bottonePrimario: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
    bannerBloccato: { backgroundColor: colors.danger, borderRadius: 10, padding: 12, marginTop: 12 },
    bannerBloccatoText: { color: '#fff', fontWeight: '600' },
    bannerAvviso: { backgroundColor: colors.warning, borderRadius: 10, padding: 12, marginTop: 12 },
    bannerAvvisoText: { color: colors.warningText, fontWeight: '600' },
    cardPrenotazione: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 10,
    },
    cardPrenotazioneAula: { color: colors.textMain, fontWeight: '700', fontSize: 15 },
    cardPrenotazioneDettaglio: { color: colors.textMuted, marginTop: 2 },
    badgeStato: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 6 },
    badgeStatoText: { fontWeight: '700', fontSize: 11 },
    bottoneAnnulla: { borderWidth: 1, borderColor: colors.danger, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
    bottoneAnnullaText: { color: colors.danger, fontWeight: '700' },
    testoFasciaIniziata: { color: colors.textMuted, fontSize: 11, maxWidth: 90, textAlign: 'right' },
  });
