// ============================================================================
// AULA STUDIO — Impostazioni: fasce orarie, posti, anticipo massimo, ferie
// extra (con calendario popup) e date semestri (con menu mese+giorno), per
// aula (Medie e IPI separatamente). Caselle vincolate in larghezza come nel
// resto dell'app.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AulaStudioCalendarioPopup from './aula-studio-calendario-popup';
import { numArabo, dataArabo } from '../../utils/numeri-arabo';
import { TIPI_REGISTRO_AULA_STUDIO } from './aula-studio-constants';
import {
  aggiungiAulaStudioAula,
  eliminaAulaStudioAula,
  modificaAulaStudioAula,
  salvaAulaStudioConfig,
  spostaAulaStudioAula,
  useAulaStudioAule,
  useAulaStudioConfig,
} from './aula-studio-data';
import { AULA_STUDIO_CONFIG_DEFAULT, AulaStudioConfig, FasciaOraria, IntervalloFerie, NOMI_MESI_BREVI, nomeAulaStudio } from './aula-studio-utils';
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
  const { db, lang, isRTL, colors, t, mostraAlert, registraAttivita } = props;
  const styles = useMemo(() => getStyles(colors), [colors]);
  const nomiMesi = NOMI_MESI_BREVI[lang] || NOMI_MESI_BREVI.it;

  const { configPerAula } = useAulaStudioConfig(db);
  const { aule } = useAulaStudioAule(db);
  const [aulaId, setAulaId] = useState<string>('');
  const [bozza, setBozza] = useState<AulaStudioConfig>(configPerAula[aulaId] || AULA_STUDIO_CONFIG_DEFAULT);
  const [salvando, setSalvando] = useState(false);
  const [popupFerieIndice, setPopupFerieIndice] = useState<{ indice: number; campo: 'inizio' | 'fine' } | null>(null);

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

  const aggiornaFascia = (indice: number, campo: keyof FasciaOraria, valore: string) => {
    setBozza((prev) => ({
      ...prev,
      fasce: prev.fasce.map((f, i) => (i === indice ? { ...f, [campo]: valore } : f)),
    }));
  };
  const aggiungiFascia = () => {
    setBozza((prev) => ({ ...prev, fasce: [...prev.fasce, { inizio: '18:00', fine: '19:00' }] }));
  };
  const rimuoviFascia = (indice: number) => {
    setBozza((prev) => ({ ...prev, fasce: prev.fasce.filter((_, i) => i !== indice) }));
  };

  const aggiornaFerie = (indice: number, campo: keyof IntervalloFerie, valore: string) => {
    setBozza((prev) => ({
      ...prev,
      ferieExtra: prev.ferieExtra.map((f, i) => (i === indice ? { ...f, [campo]: valore } : f)),
    }));
  };
  const aggiungiFerie = () => {
    setBozza((prev) => ({
      ...prev,
      ferieExtra: [...prev.ferieExtra, { inizio: '', fine: '', etichetta: '' }],
    }));
  };
  const rimuoviFerie = (indice: number) => {
    setBozza((prev) => ({ ...prev, ferieExtra: prev.ferieExtra.filter((_, i) => i !== indice) }));
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
        {bozza.fasce.map((f, i) => (
          <View key={i} style={styles.rigaFasciaEdit}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="HH:MM" value={f.inizio} onChangeText={(v) => aggiornaFascia(i, 'inizio', v)} />
            <Text style={styles.trattino}>—</Text>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="HH:MM" value={f.fine} onChangeText={(v) => aggiornaFascia(i, 'fine', v)} />
            <TouchableOpacity style={styles.bottoneRimuovi} onPress={() => rimuoviFascia(i)}>
              <Text style={styles.bottoneRimuoviText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.bottoneAggiungiRiga} onPress={aggiungiFascia}>
          <Text style={styles.bottoneAggiungiRigaText}>{t('aulaStudioAggiungiFascia', lang)}</Text>
        </TouchableOpacity>

        <Text style={styles.sezioneTitolo}>{t('aulaStudioFerieExtra', lang)}</Text>
        {bozza.ferieExtra.map((f, i) => (
          <View key={i} style={styles.rigaFerieEdit}>
            <TouchableOpacity style={[styles.input, styles.casellaData, { flex: 1 }]} onPress={() => setPopupFerieIndice({ indice: i, campo: 'inizio' })}>
              <Text style={[styles.testoCasellaData, !f.inizio && { color: colors.placeholder }]}>{f.inizio ? dataArabo(f.inizio, lang) : (lang === 'ar' ? 'سنة-شهر-يوم' : 'AAAA-MM-GG')}</Text>
              <Text style={styles.casellaSceltaIcona}>📅</Text>
            </TouchableOpacity>
            <Text style={styles.trattino}>—</Text>
            <TouchableOpacity style={[styles.input, styles.casellaData, { flex: 1 }]} onPress={() => setPopupFerieIndice({ indice: i, campo: 'fine' })}>
              <Text style={[styles.testoCasellaData, !f.fine && { color: colors.placeholder }]}>{f.fine ? dataArabo(f.fine, lang) : (lang === 'ar' ? 'سنة-شهر-يوم' : 'AAAA-MM-GG')}</Text>
              <Text style={styles.casellaSceltaIcona}>📅</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bottoneRimuovi} onPress={() => rimuoviFerie(i)}>
              <Text style={styles.bottoneRimuoviText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.bottoneAggiungiRiga} onPress={aggiungiFerie}>
          <Text style={styles.bottoneAggiungiRigaText}>{t('aulaStudioAggiungiFerie', lang)}</Text>
        </TouchableOpacity>

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

      <AulaStudioCalendarioPopup
        visible={!!popupFerieIndice}
        onClose={() => setPopupFerieIndice(null)}
        dataSelezionata={popupFerieIndice ? bozza.ferieExtra[popupFerieIndice.indice]?.[popupFerieIndice.campo] || null : null}
        onSeleziona={(d) => {
          if (popupFerieIndice) aggiornaFerie(popupFerieIndice.indice, popupFerieIndice.campo, d);
        }}
        colors={colors}
        lang={lang}
        titolo={t('aulaStudioFerieExtra', lang)}
      />
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
    casellaData: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    testoCasellaData: { color: colors.textMain, fontSize: 13 },
    casellaSceltaIcona: { color: colors.textMuted, fontSize: 13, marginLeft: 6 },
    rigaFasciaEdit: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    rigaFerieEdit: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    trattino: { color: colors.textMuted, marginHorizontal: 6 },
    bottoneRimuovi: { marginLeft: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    bottoneRimuoviText: { color: colors.danger, fontWeight: '700' },
    bottoneAggiungiRiga: { alignSelf: 'flex-start', marginBottom: 8 },
    bottoneAggiungiRigaText: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
    bottonePrimario: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 24, marginBottom: 40 },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
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
