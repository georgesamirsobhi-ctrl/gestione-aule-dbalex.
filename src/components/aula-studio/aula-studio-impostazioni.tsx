// ============================================================================
// AULA STUDIO — Impostazioni: fasce orarie, posti, anticipo massimo, ferie
// extra (con calendario popup) e date semestri (con menu mese+giorno), per
// aula (Medie e IPI separatamente). Caselle vincolate in larghezza come nel
// resto dell'app.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AulaStudioFasceEditor from './aula-studio-fasce-editor';
import AulaStudioFerieEditor from './aula-studio-ferie-editor';
import { numArabo } from '../../utils/numeri-arabo';
import { aulaStudioTipoScuolaConsentito, TIPI_REGISTRO_AULA_STUDIO } from './aula-studio-constants';
import {
  aggiungiAulaStudioAula,
  eliminaAulaStudioAula,
  modificaAulaStudioAula,
  salvaAulaStudioConfig,
  salvaAulaStudioPrenotazioniAttive,
  spostaAulaStudioAula,
  useAulaStudioAule,
  useAulaStudioConfig,
  useAulaStudioPrenotazioniAttive,
} from './aula-studio-data';
import { AULA_STUDIO_CONFIG_DEFAULT, AulaStudioConfig, NOMI_MESI_BREVI, nomeAulaStudio } from './aula-studio-utils';
import { AulaStudioAula, AulaStudioSharedProps } from './aula-studio-types';

const GIORNI_MESE = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const MESI_NUMERO = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

/** Menu a tendina generico (usato per mese/giorno del semestre). */
function TendinaSemplice({
  valore,
  opzioni,
  etichette,
  onScegli,
  colors,
  lang,
}: {
  valore: string;
  opzioni: string[];
  etichette?: string[];
  onScegli: (v: string) => void;
  colors: Record<string, string>;
  lang: 'it' | 'ar';
}) {
  const [aperto, setAperto] = useState(false);
  const styles = getStylesTendina(colors);
  const indice = opzioni.indexOf(valore);
  const testo = etichette && indice >= 0 ? etichette[indice] : numArabo(valore, lang);
  return (
    <>
      <TouchableOpacity style={styles.trigger} onPress={() => setAperto(true)}>
        <Text style={styles.triggerText}>{testo || '—'}</Text>
        <Text style={styles.triggerFreccia}>▼</Text>
      </TouchableOpacity>
      <Modal visible={aperto} transparent animationType="fade" onRequestClose={() => setAperto(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setAperto(false)}>
          <View style={styles.lista}>
            <ScrollView style={{ maxHeight: 320 }}>
              {opzioni.map((op, i) => (
                <TouchableOpacity
                  key={op}
                  style={[styles.opzione, valore === op && styles.opzioneAttiva]}
                  onPress={() => {
                    onScegli(op);
                    setAperto(false);
                  }}
                >
                  <Text style={[styles.opzioneText, valore === op && styles.opzioneTextAttiva]}>{etichette ? etichette[i] : numArabo(op, lang)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const getStylesTendina = (colors: Record<string, string>) =>
  StyleSheet.create({
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surface,
    },
    triggerText: { color: colors.textMain, fontSize: 14 },
    triggerFreccia: { color: colors.textMuted, fontSize: 11 },
    overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
    lista: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 6, maxWidth: 260, width: '100%', alignSelf: 'center' },
    opzione: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
    opzioneAttiva: { backgroundColor: colors.primary },
    opzioneText: { color: colors.textMain, fontSize: 14 },
    opzioneTextAttiva: { color: colors.primaryText, fontWeight: '700' },
  });

export default function AulaStudioImpostazioni(props: AulaStudioSharedProps) {
  const { db, userRole, lang, isRTL, colors, t, mostraAlert, registraAttivita } = props;
  const styles = useMemo(() => getStyles(colors), [colors]);
  const nomiMesi = NOMI_MESI_BREVI[lang] || NOMI_MESI_BREVI.it;

  const { configPerAula } = useAulaStudioConfig(db);
  const { aule } = useAulaStudioAule(db);

  // ---- Interruttori prenotazioni attive/sospese per tipo scuola (Medie/IPI) ----
  // null = nessuna restrizione di ambito (es. Gestore): mostra entrambi gli interruttori.
  const ambitoRuolo = aulaStudioTipoScuolaConsentito(userRole);
  const { prenotazioniAttive } = useAulaStudioPrenotazioniAttive(db);
  const [cambiandoPrenotazioni, setCambiandoPrenotazioni] = useState<'medie' | 'ipi' | null>(null);

  const cambiaPrenotazioniAttive = async (tipoScuola: 'medie' | 'ipi', nuovoValore: boolean) => {
    setCambiandoPrenotazioni(tipoScuola);
    try {
      await salvaAulaStudioPrenotazioniAttive(db, tipoScuola, nuovoValore);
      await registraAttivita(
        TIPI_REGISTRO_AULA_STUDIO.PRENOTAZIONI_ATTIVE,
        `Prenotazioni ${tipoScuola === 'medie' ? 'Medie' : 'IPI'} ${nuovoValore ? 'riattivate' : 'sospese'}`
      );
    } catch (e: any) {
      mostraAlert(t('errore', lang), e?.message || t('aulaStudioErroreGenerico', lang));
    } finally {
      setCambiandoPrenotazioni(null);
    }
  };
  const [aulaId, setAulaId] = useState<string>('');
  const [bozza, setBozza] = useState<AulaStudioConfig>(configPerAula[aulaId] || AULA_STUDIO_CONFIG_DEFAULT);
  const [salvando, setSalvando] = useState(false);

  // Sceglie automaticamente la prima aula disponibile appena l'elenco (dinamico) è pronto.
  useEffect(() => {
    if (aulaId || aule.length === 0) return;
    setAulaId(aule[0].id);
  }, [aulaId, aule]);

  useEffect(() => {
    setBozza(configPerAula[aulaId] || AULA_STUDIO_CONFIG_DEFAULT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aulaId]);

  // ---- Gestione aule: aggiunta, riordino, rinomina IT/AR, tipo scuola, eliminazione ----
  const [modalitaModificaAule, setModalitaModificaAule] = useState(false);
  const [modaleAulaAperta, setModaleAulaAperta] = useState<{ modo: 'nuova' | 'modifica'; aula?: AulaStudioAula } | null>(null);
  const [formAulaNome, setFormAulaNome] = useState('');
  const [formAulaNomeAr, setFormAulaNomeAr] = useState('');
  const [formAulaTipo, setFormAulaTipo] = useState<'medie' | 'ipi'>('medie');

  const apriNuovaAula = () => {
    setFormAulaNome('');
    setFormAulaNomeAr('');
    setFormAulaTipo('medie');
    setModaleAulaAperta({ modo: 'nuova' });
  };

  const apriModificaAula = (a: AulaStudioAula) => {
    setFormAulaNome(a.nome);
    setFormAulaNomeAr(a.nomeAr || '');
    setFormAulaTipo(a.tipoScuola);
    setModaleAulaAperta({ modo: 'modifica', aula: a });
  };

  const salvaAula = async () => {
    if (!formAulaNome.trim()) {
      mostraAlert(t('attenzione', lang), lang === 'ar' ? 'أدخل اسم القاعة' : 'Inserisci il nome dell\'aula.');
      return;
    }
    if (modaleAulaAperta?.modo === 'nuova') {
      const nuovoId = await aggiungiAulaStudioAula(db, {
        nome: formAulaNome.trim(),
        nomeAr: formAulaNomeAr.trim(),
        tipoScuola: formAulaTipo,
        ordine: aule.length,
      });
      await registraAttivita(TIPI_REGISTRO_AULA_STUDIO.GESTIONE_AULE, `Aula Studio "${formAulaNome.trim()}" creata (${formAulaTipo})`);
      setAulaId(nuovoId);
    } else if (modaleAulaAperta?.aula) {
      await modificaAulaStudioAula(db, modaleAulaAperta.aula.id, {
        nome: formAulaNome.trim(),
        nomeAr: formAulaNomeAr.trim(),
        tipoScuola: formAulaTipo,
      });
      await registraAttivita(TIPI_REGISTRO_AULA_STUDIO.GESTIONE_AULE, `Aula Studio "${formAulaNome.trim()}" modificata`);
    }
    setModaleAulaAperta(null);
  };

  const eliminaAula = (a: AulaStudioAula) => {
    const esegui = async () => {
      await eliminaAulaStudioAula(db, a.id);
      await registraAttivita(TIPI_REGISTRO_AULA_STUDIO.GESTIONE_AULE, `Aula Studio "${a.nome}" eliminata`);
      if (aulaId === a.id) setAulaId('');
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(lang === 'ar' ? 'حذف هذه القاعة؟' : 'Eliminare questa aula?')) esegui();
    } else {
      Alert.alert(t('conferma', lang) || 'Conferma', lang === 'ar' ? 'حذف هذه القاعة؟' : 'Eliminare questa aula?', [
        { text: t('annulla', lang) || 'Annulla' },
        { text: t('elimina', lang) || 'Elimina', onPress: esegui },
      ]);
    }
  };

  const aggiornaSemestreMese = (campo: 'semestre1Inizio' | 'semestre2Inizio', mese: string) => {
    setBozza((prev) => {
      const giornoAttuale = (prev[campo] || '01-01').split('-')[1] || '01';
      return { ...prev, [campo]: `${mese}-${giornoAttuale}` };
    });
  };
  const aggiornaSemestreGiorno = (campo: 'semestre1Inizio' | 'semestre2Inizio', giorno: string) => {
    setBozza((prev) => {
      const meseAttuale = (prev[campo] || '01-01').split('-')[0] || '01';
      return { ...prev, [campo]: `${meseAttuale}-${giorno}` };
    });
  };

  const salva = async () => {
    if (bozza.fasce.length === 0) {
      mostraAlert(t('attenzione', lang), t('aulaStudioAlmenoUnaFascia', lang));
      return;
    }
    for (const f of bozza.fasce) {
      if (!/^\d{2}:\d{2}$/.test(f.inizio) || !/^\d{2}:\d{2}$/.test(f.fine)) {
        mostraAlert(t('attenzione', lang), t('aulaStudioFormatoOrarioNonValido', lang));
        return;
      }
    }
    for (const f of bozza.ferieExtra) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.inizio) || !/^\d{4}-\d{2}-\d{2}$/.test(f.fine)) {
        mostraAlert(t('attenzione', lang), t('aulaStudioFormatoDataNonValido', lang));
        return;
      }
    }
    setSalvando(true);
    try {
      await salvaAulaStudioConfig(db, aulaId, bozza);
      mostraAlert(t('successo', lang), t('aulaStudioConfigSalvata', lang));
    } catch (e: any) {
      mostraAlert(t('errore', lang), e?.message || t('aulaStudioErroreGenerico', lang));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.formWrap}>
        <Text style={styles.titolo}>{t('aulaStudioImpostazioniTitolo', lang)}</Text>

        <Text style={styles.sezioneTitolo}>{t('aulaStudioImpostazioniPrenotazioniSezione', lang)}</Text>
        <View style={{ marginBottom: 8 }}>
          {(ambitoRuolo === null || ambitoRuolo === 'medie') && (
            <View style={styles.rigaInterruttore}>
              <Text style={styles.rigaInterruttoreLabel}>{t('aulaStudioImpostazioniPrenotazioniMedie', lang)}</Text>
              <TouchableOpacity
                style={[styles.interruttoreBtn, { backgroundColor: prenotazioniAttive.medie ? colors.success : colors.danger }]}
                onPress={() => cambiaPrenotazioniAttive('medie', !prenotazioniAttive.medie)}
                disabled={cambiandoPrenotazioni === 'medie'}
              >
                <Text style={styles.interruttoreBtnText}>
                  {prenotazioniAttive.medie ? t('aulaStudioPrenotazioniAttivo', lang) : t('aulaStudioPrenotazioniSospeso', lang)}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          {(ambitoRuolo === null || ambitoRuolo === 'ipi') && (
            <View style={styles.rigaInterruttore}>
              <Text style={styles.rigaInterruttoreLabel}>{t('aulaStudioImpostazioniPrenotazioniIpi', lang)}</Text>
              <TouchableOpacity
                style={[styles.interruttoreBtn, { backgroundColor: prenotazioniAttive.ipi ? colors.success : colors.danger }]}
                onPress={() => cambiaPrenotazioniAttive('ipi', !prenotazioniAttive.ipi)}
                disabled={cambiandoPrenotazioni === 'ipi'}
              >
                <Text style={styles.interruttoreBtnText}>
                  {prenotazioniAttive.ipi ? t('aulaStudioPrenotazioniAttivo', lang) : t('aulaStudioPrenotazioniSospeso', lang)}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.rigaGestioneAuleHeader}>
          <Text style={styles.sezioneTitolo}>{lang === 'ar' ? 'القاعات' : 'Aule'}</Text>
          <TouchableOpacity
            style={[styles.editToggleBtn, { backgroundColor: modalitaModificaAule ? colors.success : colors.primary }]}
            onPress={() => setModalitaModificaAule((v) => !v)}
          >
            <Text style={styles.editToggleBtnText}>{modalitaModificaAule ? `✓ ${t('fine', lang) || 'Fine'}` : `✎ ${t('modifica', lang) || 'Modifica'}`}</Text>
          </TouchableOpacity>
        </View>

        {modalitaModificaAule ? (
          <View style={{ marginBottom: 12 }}>
            {aule.map((a, idx) => (
              <View key={a.id} style={styles.rigaAulaGestione}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rigaAulaGestioneNome}>{nomeAulaStudio(a, lang)}</Text>
                  <Text style={styles.rigaAulaGestioneTipo}>{a.tipoScuola === 'medie' ? (lang === 'ar' ? 'الإعدادية' : 'Medie') : lang === 'ar' ? 'المعهد الصناعي' : 'IPI'}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <TouchableOpacity style={styles.bottoneRimuovi} onPress={() => spostaAulaStudioAula(db, aule, a.id, 'su')} disabled={idx === 0}>
                    <Text style={styles.bottoneRimuoviTextNeutro}>▲</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.bottoneRimuovi} onPress={() => spostaAulaStudioAula(db, aule, a.id, 'giu')} disabled={idx === aule.length - 1}>
                    <Text style={styles.bottoneRimuoviTextNeutro}>▼</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.bottoneRimuovi} onPress={() => apriModificaAula(a)}>
                    <Text style={styles.bottoneRimuoviTextNeutro}>{t('modifica', lang) || 'Modifica'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.bottoneRimuovi} onPress={() => eliminaAula(a)}>
                    <Text style={styles.bottoneRimuoviText}>{t('elimina', lang) || 'Elimina'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.bottoneAggiungiRiga} onPress={apriNuovaAula}>
              <Text style={styles.bottoneAggiungiRigaText}>{lang === 'ar' ? '+ إضافة قاعة' : '+ Aggiungi aula'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.rigaAule}>
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
        )}

        {/* Modale: aggiungi/modifica aula (nome IT/AR, tipo scuola) */}
        <Modal visible={!!modaleAulaAperta} transparent animationType="fade" onRequestClose={() => setModaleAulaAperta(null)}>
          <View style={styles.overlayModaleAula}>
            <View style={styles.modaleAulaBox}>
              <Text style={styles.modaleTitoloAula}>
                {modaleAulaAperta?.modo === 'nuova' ? (lang === 'ar' ? 'قاعة جديدة' : 'Nuova aula') : (lang === 'ar' ? 'تعديل القاعة' : 'Modifica aula')}
              </Text>
              <TextInput style={styles.input} placeholder={lang === 'ar' ? 'الاسم (بالإيطالية)' : 'Nome (italiano)'} placeholderTextColor={colors.placeholder} value={formAulaNome} onChangeText={setFormAulaNome} />
              <View style={{ height: 8 }} />
              <TextInput style={[styles.input, { textAlign: 'right' }]} placeholder="الاسم (بالعربية)" placeholderTextColor={colors.placeholder} value={formAulaNomeAr} onChangeText={setFormAulaNomeAr} />
              <View style={{ height: 12 }} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[styles.chipAula, { flex: 1, alignItems: 'center' }, formAulaTipo === 'medie' && styles.chipAulaAttiva]} onPress={() => setFormAulaTipo('medie')}>
                  <Text style={[styles.chipAulaText, formAulaTipo === 'medie' && styles.chipAulaTextAttiva]}>{lang === 'ar' ? 'الإعدادية' : 'Medie'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.chipAula, { flex: 1, alignItems: 'center' }, formAulaTipo === 'ipi' && styles.chipAulaAttiva]} onPress={() => setFormAulaTipo('ipi')}>
                  <Text style={[styles.chipAulaText, formAulaTipo === 'ipi' && styles.chipAulaTextAttiva]}>{lang === 'ar' ? 'المعهد الصناعي' : 'IPI'}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <TouchableOpacity style={{ paddingVertical: 10, paddingHorizontal: 14 }} onPress={() => setModaleAulaAperta(null)}>
                  <Text style={{ color: colors.textMuted, fontWeight: '600' }}>{t('annulla', lang) || 'Annulla'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bottonePrimarioPiccolo} onPress={salvaAula}>
                  <Text style={styles.bottonePrimarioText}>{t('salva', lang) || 'Salva'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Text style={styles.sezioneTitolo}>{t('aulaStudioPostiTotali', lang)}</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={String(bozza.posti)}
          onChangeText={(v) => setBozza((prev) => ({ ...prev, posti: parseInt(v, 10) || 0 }))}
        />

        <Text style={styles.sezioneTitolo}>{t('aulaStudioAnticipoMassimo', lang)}</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={String(bozza.anticipoGiorni)}
          onChangeText={(v) => setBozza((prev) => ({ ...prev, anticipoGiorni: parseInt(v, 10) || 0 }))}
        />

        <Text style={styles.sezioneTitolo}>{t('aulaStudioFasceOrarie', lang)}</Text>
        <AulaStudioFasceEditor
          fasce={bozza.fasce}
          onChange={(fasce) => setBozza((prev) => ({ ...prev, fasce }))}
          colors={colors}
          t={t}
          lang={lang}
        />

        <Text style={styles.sezioneTitolo}>{t('aulaStudioFerieExtra', lang)}</Text>
        <AulaStudioFerieEditor
          ferieExtra={bozza.ferieExtra}
          onChange={(ferieExtra) => setBozza((prev) => ({ ...prev, ferieExtra }))}
          colors={colors}
          t={t}
          lang={lang}
        />

        <Text style={styles.sezioneTitolo}>{t('aulaStudioSemestri', lang)}</Text>
        <Text style={styles.testoInfo}>{t('aulaStudioSemestriSpiegazione', lang)}</Text>
        <View style={styles.rigaFasciaEdit}>
          <View style={{ flex: 1 }}>
            <Text style={styles.etichettaPiccola}>{t('aulaStudioSemestre1', lang)}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <View style={{ flex: 1.3 }}>
                <TendinaSemplice
                  valore={(bozza.semestre1Inizio || '09-01').split('-')[0]}
                  opzioni={MESI_NUMERO}
                  etichette={nomiMesi}
                  onScegli={(v) => aggiornaSemestreMese('semestre1Inizio', v)}
                  colors={colors}
                  lang={lang}
                />
              </View>
              <View style={{ flex: 0.7 }}>
                <TendinaSemplice
                  valore={(bozza.semestre1Inizio || '09-01').split('-')[1]}
                  opzioni={GIORNI_MESE}
                  onScegli={(v) => aggiornaSemestreGiorno('semestre1Inizio', v)}
                  colors={colors}
                  lang={lang}
                />
              </View>
            </View>
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.etichettaPiccola}>{t('aulaStudioSemestre2', lang)}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <View style={{ flex: 1.3 }}>
                <TendinaSemplice
                  valore={(bozza.semestre2Inizio || '02-01').split('-')[0]}
                  opzioni={MESI_NUMERO}
                  etichette={nomiMesi}
                  onScegli={(v) => aggiornaSemestreMese('semestre2Inizio', v)}
                  colors={colors}
                  lang={lang}
                />
              </View>
              <View style={{ flex: 0.7 }}>
                <TendinaSemplice
                  valore={(bozza.semestre2Inizio || '02-01').split('-')[1]}
                  opzioni={GIORNI_MESE}
                  onScegli={(v) => aggiornaSemestreGiorno('semestre2Inizio', v)}
                  colors={colors}
                  lang={lang}
                />
              </View>
            </View>
          </View>
        </View>

        <TouchableOpacity style={[styles.bottonePrimario, salvando && { opacity: 0.6 }]} onPress={salva} disabled={salvando}>
          <Text style={styles.bottonePrimarioText}>{t('salva', lang) || 'Salva'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    formWrap: { maxWidth: 480, width: '100%', alignSelf: 'center' },
    titolo: { fontSize: 22, fontWeight: '700', color: colors.textMain, marginBottom: 16 },
    rigaAule: { flexDirection: 'row', marginBottom: 16 },
    chipAula: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginRight: 8 },
    chipAulaAttiva: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipAulaText: { color: colors.textMain, fontWeight: '600' },
    chipAulaTextAttiva: { color: colors.primaryText },
    sezioneTitolo: { color: colors.textSub, fontWeight: '700', fontSize: 14, marginTop: 20, marginBottom: 8 },
    etichettaPiccola: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
    testoInfo: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.textMain, backgroundColor: colors.surface },
    rigaFasciaEdit: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    bottoneRimuovi: { marginLeft: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    bottoneRimuoviText: { color: colors.danger, fontWeight: '700' },
    bottoneAggiungiRiga: { alignSelf: 'flex-start', marginBottom: 8 },
    bottoneAggiungiRigaText: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
    bottonePrimario: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 24, marginBottom: 40 },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
    rigaInterruttore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
    rigaInterruttoreLabel: { color: colors.textMain, fontWeight: '600', fontSize: 14 },
    interruttoreBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20 },
    interruttoreBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
    rigaGestioneAuleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    editToggleBtn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8 },
    editToggleBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
    rigaAulaGestione: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border },
    rigaAulaGestioneNome: { color: colors.textMain, fontWeight: '600', fontSize: 13 },
    rigaAulaGestioneTipo: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    bottoneRimuoviTextNeutro: { color: colors.textMain, fontWeight: '700', fontSize: 12 },
    overlayModaleAula: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 20 },
    modaleAulaBox: { backgroundColor: colors.surface, borderRadius: 16, padding: 18, width: '100%', maxWidth: 380 },
    modaleTitoloAula: { color: colors.textMain, fontWeight: '700', fontSize: 16, marginBottom: 12 },
    bottonePrimarioPiccolo: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  });
