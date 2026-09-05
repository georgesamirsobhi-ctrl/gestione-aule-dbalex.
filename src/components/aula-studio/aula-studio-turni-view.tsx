// ============================================================================
// AULA STUDIO — Vista Insegnante: qualunque insegnante può fare richiesta di
// turno (assistenza volontaria) scegliendo aula/giorno/una o più fasce. La
// richiesta va alla segreteria/preside/vice preside/direttore per conferma;
// una volta confermata, l'insegnante ottiene un pulsante per aprire la pagina
// Appello, con accesso completo, limitato a quella aula/giorno/fascia (e
// sbloccato solo da pochi minuti prima dell'inizio — vedi AulaStudioResponsabileView).
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import AulaStudioCalendarioPopup from './aula-studio-calendario-popup';
import AulaStudioResponsabileView from './aula-studio-responsabile-view';
import { aulaStudioTipoScuolaConsentito, TIPI_REGISTRO_AULA_STUDIO } from './aula-studio-constants';
import { richiediTurno, scaduraTurno, useAulaStudioAule, useAulaStudioConfig, useAulaStudioTurni } from './aula-studio-data';
import {
  AULA_STUDIO_CONFIG_DEFAULT,
  fasciaTerminata,
  formattaSettimana,
  inizioSettimana,
  nomeAulaStudio,
  NOMI_GIORNI_BREVI,
  oggiIso,
  parseFasciaStringa,
  spostaGiorno,
} from './aula-studio-utils';
import { AulaStudioSharedProps, RichiestaTurno } from './aula-studio-types';
import { numArabo, dataArabo } from '../../utils/numeri-arabo';

function coloreStatoTurno(stato: string, colors: Record<string, string>): { bg: string; fg: string } {
  switch (stato) {
    case 'confermata':
      return { bg: colors.success, fg: '#FFFFFF' };
    case 'rifiutata':
      return { bg: colors.danger, fg: '#FFFFFF' };
    case 'scaduta':
      return { bg: colors.surfaceAlt, fg: colors.textMuted };
    default:
      return { bg: colors.warning, fg: colors.warningText };
  }
}

function etichettaStatoTurno(stato: string, lang: 'it' | 'ar'): string {
  const mappa: Record<string, [string, string]> = {
    'in attesa': ['In attesa', 'قيد الانتظار'],
    confermata: ['Confermata', 'مؤكَّدة'],
    rifiutata: ['Rifiutata', 'مرفوضة'],
    scaduta: ['Scaduta', 'منتهية'],
  };
  const coppia = mappa[stato] || [stato, stato];
  return lang === 'ar' ? coppia[1] : coppia[0];
}

export default function AulaStudioTurniView(props: AulaStudioSharedProps) {
  const {
    db,
    user,
    userName,
    lang,
    colors,
    t,
    mostraAlert,
    registraAttivita,
    inviaNotificaConPreferenza,
    gestoriAulaStudio,
    richiestaTurnoDaAprireId,
    onRichiestaTurnoAperta,
  } = props;
  const styles = useMemo(() => getStyles(colors), [colors]);

  const { configPerAula } = useAulaStudioConfig(db);
  const { turni } = useAulaStudioTurni(db);
  const { aule } = useAulaStudioAule(db);

  const [aulaId, setAulaId] = useState<string>('');
  const configAula = configPerAula[aulaId] || AULA_STUDIO_CONFIG_DEFAULT;
  const [dataSelezionata, setDataSelezionata] = useState<string>(oggiIso());

  // Sceglie automaticamente la prima aula disponibile appena l'elenco (dinamico) è pronto.
  useEffect(() => {
    if (aulaId || aule.length === 0) return;
    setAulaId(aule[0].id);
  }, [aulaId, aule]);
  const [giornoPopupAperto, setGiornoPopupAperto] = useState(false);
  const [fasceScelte, setFasceScelte] = useState<string[]>([]);
  const [invioInCorso, setInvioInCorso] = useState(false);
  const [appelloAperto, setAppelloAperto] = useState<{ aulaId: string; data: string; fascia: string } | null>(null);
  const [settimanaVisualizzata, setSettimanaVisualizzata] = useState<string>(inizioSettimana(oggiIso()));
  const [giornoDettaglioAperto, setGiornoDettaglioAperto] = useState<string | null>(null);

  const toggleFascia = (fasciaStr: string) => {
    setFasceScelte((prev) => (prev.includes(fasciaStr) ? prev.filter((f) => f !== fasciaStr) : [...prev, fasciaStr]));
  };

  const mieRichieste = useMemo(
    () => turni.filter((r) => r.insegnanteUid === user?.uid).sort((a, b) => b.creatoTimestamp - a.creatoTimestamp),
    [turni, user?.uid]
  );

  // Giorni confermati raggruppati per data, per il calendario "I tuoi giorni confermati".
  const richiesteConfermatePerGiorno = useMemo(() => {
    const mappa: Record<string, RichiestaTurno[]> = {};
    mieRichieste
      .filter((r) => r.stato === 'confermata')
      .forEach((r) => {
        if (!mappa[r.data]) mappa[r.data] = [];
        mappa[r.data].push(r);
      });
    return mappa;
  }, [mieRichieste]);
  const haGiorniConfermati = Object.keys(richiesteConfermatePerGiorno).length > 0;

  // Deep-link da una notifica (nuova richiesta/esito): apre direttamente il giorno confermato in questione.
  useEffect(() => {
    if (!richiestaTurnoDaAprireId) return;
    const r = mieRichieste.find((x) => x.id === richiestaTurnoDaAprireId);
    if (r && r.stato === 'confermata') {
      setSettimanaVisualizzata(inizioSettimana(r.data));
      setGiornoDettaglioAperto(r.data);
    }
    onRichiestaTurnoAperta?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [richiestaTurnoDaAprireId]);

  const inviaRichiesta = async () => {
    if (!user?.uid || fasceScelte.length === 0) {
      mostraAlert(t('attenzione', lang), lang === 'ar' ? 'اختر حصة واحدة على الأقل' : 'Seleziona almeno una fascia.');
      return;
    }
    setInvioInCorso(true);
    try {
      const aula = aule.find((a) => a.id === aulaId);
      if (!aula) {
        setInvioInCorso(false);
        return;
      }
      const id = await richiediTurno(db, {
        insegnanteUid: user.uid,
        insegnanteNome: userName,
        insegnanteEmail: user.email || null,
        aulaId,
        aulaNome: aula.nome,
        data: dataSelezionata,
        fasce: fasceScelte,
      });
      await registraAttivita(
        TIPI_REGISTRO_AULA_STUDIO.RICHIESTA_TURNO,
        `${userName} — ${aula.nome} ${dataSelezionata} ${fasceScelte.join(', ')}`
      );
      const gestoriDaAvvisare = (gestoriAulaStudio || []).filter((g) => {
        const tipoConsentito = aulaStudioTipoScuolaConsentito(g.role || '');
        return !tipoConsentito || tipoConsentito === aula.tipoScuola;
      });
      await Promise.all(
        gestoriDaAvvisare.map((g) =>
          inviaNotificaConPreferenza(
            g.uid,
            'richiesta_turno_aula_studio',
            lang === 'ar' ? 'طلب مناوبة جديد' : 'Nuova richiesta di turno',
            `${userName} — ${aula.nome} — ${dataSelezionata} — ${fasceScelte.join(', ')}`,
            { richiestaTurnoId: id }
          )
        )
      );
      setFasceScelte([]);
      mostraAlert('', lang === 'ar' ? 'تم إرسال الطلب' : 'Richiesta inviata.');
    } finally {
      setInvioInCorso(false);
    }
  };

  // Scadenza automatica lato client (ridondante rispetto a quella nella vista Responsabile, innocua).
  const scaduteProcessate = useRef<Set<string>>(new Set());
  useEffect(() => {
    const adesso = new Date();
    mieRichieste
      .filter((r) => r.stato === 'in attesa')
      .forEach((r) => {
        if (scaduteProcessate.current.has(r.id)) return;
        const tutteTerminate = r.fasce.every((fStr) => {
          const f = parseFasciaStringa(fStr);
          return f ? fasciaTerminata(r.data, f, adesso) : true;
        });
        if (!tutteTerminate) return;
        scaduteProcessate.current.add(r.id);
        scaduraTurno(db, r.id).catch(() => {});
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mieRichieste]);

  // Fasce attualmente accessibili: richieste confermate la cui fascia non è ancora terminata.
  const fasceAttiveConfermate = useMemo(() => {
    const adesso = new Date();
    const elenco: { aulaId: string; aulaNome: string; data: string; fascia: string }[] = [];
    mieRichieste
      .filter((r) => r.stato === 'confermata')
      .forEach((r) => {
        r.fasce.forEach((fStr) => {
          const f = parseFasciaStringa(fStr);
          if (f && !fasciaTerminata(r.data, f, adesso)) {
            elenco.push({ aulaId: r.aulaId, aulaNome: r.aulaNome, data: r.data, fascia: fStr });
          }
        });
      });
    return elenco;
  }, [mieRichieste]);

  // Date che hanno almeno una fascia confermata con accesso ancora attivo (non terminata) — per il pallino sul calendario.
  const dateConAccessoAttivo = useMemo(() => new Set(fasceAttiveConfermate.map((f) => f.data)), [fasceAttiveConfermate]);

  if (appelloAperto) {
    return (
      <View style={{ flex: 1 }}>
        <TouchableOpacity style={styles.bottoneChiudiAppello} onPress={() => setAppelloAperto(null)}>
          <Text style={styles.bottoneChiudiAppelloText}>{`‹ ${lang === 'ar' ? 'رجوع' : 'Indietro'}`}</Text>
        </TouchableOpacity>
        <AulaStudioResponsabileView {...props} restrizione={appelloAperto} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.contenutoWrap}>
        <Text style={styles.titolo}>{lang === 'ar' ? 'مناوبة قاعة الدراسة' : 'Turno Aula Studio'}</Text>

        {haGiorniConfermati && (
          <View style={styles.sezione}>
            <Text style={styles.titoloSezione}>{lang === 'ar' ? 'أيامك المؤكدة' : 'I tuoi giorni confermati'}</Text>
            <View style={styles.navMese}>
              <TouchableOpacity style={styles.freccia} onPress={() => setSettimanaVisualizzata((s) => spostaGiorno(s, -7))}>
                <Text style={styles.frecciaText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.testoMese}>{numArabo(formattaSettimana(settimanaVisualizzata, lang), lang)}</Text>
              <TouchableOpacity style={styles.freccia} onPress={() => setSettimanaVisualizzata((s) => spostaGiorno(s, 7))}>
                <Text style={styles.frecciaText}>›</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.dayGrid}>
              {Array.from({ length: 7 }, (_, i) => i).map((i) => {
                const giornoStr = spostaGiorno(settimanaVisualizzata, i);
                const giornoNum = parseInt(giornoStr.substring(8, 10), 10);
                const nomeGiorno = (NOMI_GIORNI_BREVI[lang] || NOMI_GIORNI_BREVI.it)[i];
                const confermato = !!richiesteConfermatePerGiorno[giornoStr];
                const accessoAttivo = dateConAccessoAttivo.has(giornoStr);
                return (
                  <TouchableOpacity
                    key={giornoStr}
                    disabled={!confermato}
                    style={[styles.dayButtonSettimana, confermato ? styles.dayButtonFree : styles.dayButtonPast]}
                    onPress={() => setGiornoDettaglioAperto(giornoStr)}
                  >
                    <Text style={[styles.dayButtonNomeGiorno, !confermato && styles.dayButtonTextPast]}>{nomeGiorno}</Text>
                    <Text style={[styles.dayButtonText, !confermato && styles.dayButtonTextPast]}>{numArabo(giornoNum, lang)}</Text>
                    {accessoAttivo && <View style={styles.pallinoAccessoAttivo} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.sezione}>
          <Text style={styles.titoloSezione}>{lang === 'ar' ? 'طلب مناوبة جديدة' : 'Richiedi un turno'}</Text>

          <View style={styles.rigaAule}>
            {aule.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[styles.chipAula, aulaId === a.id && styles.chipAulaAttiva]}
                onPress={() => {
                  setAulaId(a.id);
                  setFasceScelte([]);
                }}
              >
                <Text style={[styles.chipAulaText, aulaId === a.id && styles.chipAulaTextAttiva]}>{nomeAulaStudio(a, lang)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.casellaGiorno} onPress={() => setGiornoPopupAperto(true)}>
            <Text style={styles.casellaGiornoText}>{dataArabo(dataSelezionata, lang)}</Text>
            <Text style={styles.casellaSceltaIcona}>📅</Text>
          </TouchableOpacity>
          <AulaStudioCalendarioPopup
            visible={giornoPopupAperto}
            onClose={() => setGiornoPopupAperto(false)}
            dataSelezionata={dataSelezionata}
            onSeleziona={(d) => {
              setDataSelezionata(d);
              setFasceScelte([]);
            }}
            colors={colors}
            lang={lang}
            titolo={t('aulaStudioScegliGiorno', lang)}
          />

          <Text style={styles.etichetta}>{lang === 'ar' ? 'الحصص' : 'Fasce'}</Text>
          <View style={styles.rigaFasce}>
            {(configAula?.fasce || []).map((f) => {
              const fasciaStr = `${f.inizio}-${f.fine}`;
              const attiva = fasceScelte.includes(fasciaStr);
              return (
                <TouchableOpacity key={fasciaStr} style={[styles.chipFascia, attiva && styles.chipFasciaAttiva]} onPress={() => toggleFascia(fasciaStr)}>
                  <Text style={[styles.chipFasciaText, attiva && styles.chipFasciaTextAttiva]}>{numArabo(fasciaStr, lang)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={[styles.bottonePrimario, invioInCorso && { opacity: 0.6 }]} onPress={inviaRichiesta} disabled={invioInCorso}>
            <Text style={styles.bottonePrimarioText}>{lang === 'ar' ? 'إرسال الطلب' : 'Invia richiesta'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sezione}>
          <Text style={styles.titoloSezione}>{lang === 'ar' ? 'طلباتي' : 'Le mie richieste'}</Text>
          {mieRichieste.length === 0 ? (
            <Text style={styles.testoInfo}>{lang === 'ar' ? 'لا توجد طلبات' : 'Nessuna richiesta inviata finora.'}</Text>
          ) : (
            mieRichieste.map((r: RichiestaTurno) => {
              const c = coloreStatoTurno(r.stato, colors);
              return (
                <View key={r.id} style={styles.rigaRichiesta}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rigaRichiestaTesto}>
                      {nomeAulaStudio(aule.find((a) => a.id === r.aulaId), lang) || r.aulaNome} — {dataArabo(r.data, lang)}
                    </Text>
                    <Text style={styles.rigaRichiestaSub}>{numArabo(r.fasce.join(', '), lang)}</Text>
                  </View>
                  <View style={[styles.badgeStato, { backgroundColor: c.bg }]}>
                    <Text style={[styles.badgeStatoText, { color: c.fg }]}>{etichettaStatoTurno(r.stato, lang)}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </View>

      <Modal visible={!!giornoDettaglioAperto} transparent animationType="fade" onRequestClose={() => setGiornoDettaglioAperto(null)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setGiornoDettaglioAperto(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.boxDettaglioGiorno} onPress={() => {}}>
            <Text style={styles.titoloDettaglioGiorno}>{numArabo(giornoDettaglioAperto, lang)}</Text>
            {(richiesteConfermatePerGiorno[giornoDettaglioAperto || ''] || []).map((r) => (
              <View key={r.id} style={styles.rigaDettaglioGiorno}>
                <Text style={styles.rigaDettaglioGiornoAula}>{r.aulaNome}</Text>
                {r.fasce.map((fascia) => {
                  const attiva = fasceAttiveConfermate.some((f) => f.data === r.data && f.aulaId === r.aulaId && f.fascia === fascia);
                  return (
                    <TouchableOpacity
                      key={fascia}
                      disabled={!attiva}
                      style={styles.rigaDettaglioGiornoFasciaRiga}
                      onPress={() => {
                        setAppelloAperto({ aulaId: r.aulaId, data: r.data, fascia });
                        setGiornoDettaglioAperto(null);
                      }}
                    >
                      <Text style={styles.rigaDettaglioGiornoFasce}>{numArabo(fascia, lang)}</Text>
                      {attiva && <Text style={styles.rigaDettaglioGiornoAzione}>{lang === 'ar' ? 'فتح الحضور ›' : 'Apri Appello ›'}</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
            <TouchableOpacity style={styles.bottonePrimario} onPress={() => setGiornoDettaglioAperto(null)}>
              <Text style={styles.bottonePrimarioText}>{lang === 'ar' ? 'إغلاق' : 'Chiudi'}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    contenutoWrap: { maxWidth: 480, width: '100%', alignSelf: 'center' },
    titolo: { fontSize: 22, fontWeight: '700', color: colors.textMain, marginBottom: 16 },
    sezione: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 16 },
    titoloSezione: { fontSize: 14, fontWeight: '700', color: colors.textMain, marginBottom: 10 },
    rigaAule: { flexDirection: 'row', marginBottom: 10, flexWrap: 'wrap', gap: 8 },
    chipAula: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    chipAulaAttiva: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipAulaText: { color: colors.textMain, fontWeight: '600' },
    chipAulaTextAttiva: { color: colors.primaryText },
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
      marginBottom: 10,
    },
    casellaGiornoText: { color: colors.textMain, fontSize: 14, fontWeight: '700' },
    casellaSceltaIcona: { color: colors.textMuted, fontSize: 13, marginLeft: 6 },
    etichetta: { color: colors.textSub, fontWeight: '600', fontSize: 12, marginBottom: 6 },
    rigaFasce: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
    chipFascia: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    chipFasciaAttiva: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipFasciaText: { color: colors.textMain, fontSize: 12, fontWeight: '600' },
    chipFasciaTextAttiva: { color: colors.primaryText },
    bottonePrimario: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700' },
    testoInfo: { color: colors.textMuted, fontSize: 13 },
    rigaRichiesta: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border },
    rigaRichiestaTesto: { color: colors.textMain, fontSize: 13, fontWeight: '600' },
    rigaRichiestaSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    badgeStato: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
    badgeStatoText: { fontSize: 10, fontWeight: '700' },
    bottoneChiudiAppello: { padding: 16, paddingBottom: 0 },
    bottoneChiudiAppelloText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
    navMese: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    freccia: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    frecciaText: { fontSize: 18, color: colors.textMain },
    testoMese: { color: colors.textMain, fontWeight: '700', fontSize: 14 },
    dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
    dayButton: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, position: 'relative' },
    dayButtonSettimana: {
      flex: 1,
      minWidth: 40,
      height: 52,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      position: 'relative',
      paddingVertical: 4,
    },
    dayButtonNomeGiorno: { color: '#FFFFFF', fontWeight: '600', fontSize: 10, marginBottom: 2, textTransform: 'uppercase' },
    dayButtonFree: { backgroundColor: colors.success },
    dayButtonPast: { backgroundColor: colors.surface, opacity: 0.35 },
    dayButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
    dayButtonTextPast: { color: colors.textMuted },
    pallinoAccessoAttivo: {
      position: 'absolute',
      top: 3,
      right: 3,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: colors.warning,
      borderWidth: 1,
      borderColor: '#FFFFFF',
    },
    overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
    boxDettaglioGiorno: {
      backgroundColor: colors.bg,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      maxWidth: 360,
      width: '100%',
      alignSelf: 'center',
    },
    titoloDettaglioGiorno: { color: colors.textMain, fontSize: 16, fontWeight: '700', marginBottom: 10 },
    rigaDettaglioGiorno: { paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border },
    rigaDettaglioGiornoAula: { color: colors.textMain, fontSize: 13, fontWeight: '700', marginBottom: 4 },
    rigaDettaglioGiornoFasciaRiga: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    rigaDettaglioGiornoFasce: { color: colors.textMuted, fontSize: 12 },
    rigaDettaglioGiornoAzione: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  });
