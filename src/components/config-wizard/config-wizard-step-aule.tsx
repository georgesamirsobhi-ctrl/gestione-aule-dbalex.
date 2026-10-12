// ============================================================================
// WIZARD CONFIGURAZIONE — Passo 2: Aule. Un tab per ciascuna sezione
// scolastica esistente (Scuola Base, Scuola Media, Scuola Professionale,
// Comuni: stessa collection Firestore "aule" già usata da Impostazioni >
// Aule) più due tab fissi per l'Aula Studio (Medie/IPI: stessa collection
// aulaStudioAule + aulaStudioConfig già usata dal modulo Aula Studio). Nome
// IT e AR sono sempre obbligatori qui (regola più severa solo nel wizard).
// La capienza è sempre presente: per l'Aula Studio è il campo "posti" reale
// (vincolo usato dalle prenotazioni), per le altre sezioni resta solo
// informativa, esattamente come oggi.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
  aggiungiAulaStudioAula,
  eliminaAulaStudioAula,
  modificaAulaStudioAula,
  salvaAulaStudioConfig,
  spostaAulaStudioAula,
  useAulaStudioAule,
  useAulaStudioConfig,
} from '../aula-studio/aula-studio-data';
import { AULA_STUDIO_CONFIG_DEFAULT, nomeAulaStudio } from '../aula-studio/aula-studio-utils';
import { AulaStudioAula } from '../aula-studio/aula-studio-types';
import { ConfigWizardSharedProps, SezioneScolastica } from './config-wizard-types';

// Stesse chiavi di registro attività già usate da Impostazioni > Aule (TIPI_REGISTRO in
// src/app/index.tsx) e da Impostazioni > Aula Studio (TIPI_REGISTRO_AULA_STUDIO), duplicate
// qui come stringhe letterali per evitare un import di ritorno verso index.tsx.
const REGISTRO_AGGIUNTA_AULA = 'aggiunta_aula';
const REGISTRO_MODIFICA_AULA = 'modifica_aula';
const REGISTRO_ELIMINAZIONE_AULA = 'eliminazione_aula';
const REGISTRO_GESTIONE_AULE_STUDIO = 'aula_studio_gestione_aule';

type TabGenerale = { key: string; tipo: 'generale'; sezione: SezioneScolastica };
type TabAulaStudio = { key: string; tipo: 'aulaStudio'; tipoScuola: 'medie' | 'ipi'; titolo: string };
type Tab = TabGenerale | TabAulaStudio;

export default function ConfigWizardStepAule(props: ConfigWizardSharedProps) {
  const { db, lang, colors, t, mostraAlert, registraAttivita, canGestireAule, canGestireAulaStudio, aule, sezioniLista, onRicaricaDatiGenerali } = props;
  const styles = useMemo(() => getStyles(colors), [colors]);

  const { aule: auleStudio } = useAulaStudioAule(db);
  const { configPerAula } = useAulaStudioConfig(db);

  const tabs: Tab[] = useMemo(() => {
    const generali: Tab[] = canGestireAule
      ? sezioniLista
          .filter((s) => s.speciale !== 'aulaStudio')
          .sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0))
          .map((s) => ({ key: `s:${s.id}`, tipo: 'generale', sezione: s }))
      : [];
    const aulaStudio: Tab[] = canGestireAulaStudio
      ? [
          { key: 'as:medie', tipo: 'aulaStudio', tipoScuola: 'medie', titolo: t('wizardConfigTabAulaStudioMedie', lang) },
          { key: 'as:ipi', tipo: 'aulaStudio', tipoScuola: 'ipi', titolo: t('wizardConfigTabAulaStudioIpi', lang) },
        ]
      : [];
    return [...generali, ...aulaStudio];
  }, [canGestireAule, canGestireAulaStudio, sezioniLista, lang]);

  const [tabAttiva, setTabAttiva] = useState<string>('');
  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabAttiva || !tabs.some((tb) => tb.key === tabAttiva)) setTabAttiva(tabs[0].key);
  }, [tabs, tabAttiva]);

  const tab = tabs.find((tb) => tb.key === tabAttiva) || null;

  // ---- Form condiviso (nome IT/AR obbligatori + capienza/posti) ----
  const [modaleAperto, setModaleAperto] = useState<{ modo: 'nuova' | 'modifica'; id?: string } | null>(null);
  const [formNome, setFormNome] = useState('');
  const [formNomeAr, setFormNomeAr] = useState('');
  const [formCapienza, setFormCapienza] = useState('');

  const apriNuova = () => {
    setFormNome('');
    setFormNomeAr('');
    setFormCapienza('');
    setModaleAperto({ modo: 'nuova' });
  };

  const apriModificaGenerale = (a: (typeof aule)[number]) => {
    setFormNome(a.nome);
    setFormNomeAr(a.nomeAr || '');
    setFormCapienza(String(a.capienza ?? ''));
    setModaleAperto({ modo: 'modifica', id: a.id });
  };

  const apriModificaAulaStudio = (a: AulaStudioAula) => {
    setFormNome(a.nome);
    setFormNomeAr(a.nomeAr || '');
    setFormCapienza(String(configPerAula[a.id]?.posti ?? AULA_STUDIO_CONFIG_DEFAULT.posti));
    setModaleAperto({ modo: 'modifica', id: a.id });
  };

  const chiudiModale = () => setModaleAperto(null);

  const validaForm = (): boolean => {
    if (!formNome.trim()) {
      mostraAlert(t('attenzione', lang), t('wizardConfigNomeItObbligatorio', lang));
      return false;
    }
    if (!formNomeAr.trim()) {
      mostraAlert(t('attenzione', lang), t('wizardConfigNomeArObbligatorio', lang));
      return false;
    }
    if (!formCapienza.trim()) {
      mostraAlert(t('attenzione', lang), tab?.tipo === 'aulaStudio' ? t('wizardConfigPostiObbligatori', lang) : t('wizardConfigCapienzaObbligatoria', lang));
      return false;
    }
    if (tab?.tipo === 'aulaStudio' && (!Number.isFinite(parseInt(formCapienza, 10)) || parseInt(formCapienza, 10) <= 0)) {
      mostraAlert(t('attenzione', lang), t('wizardConfigPostiObbligatori', lang));
      return false;
    }
    return true;
  };

  const salvaGenerale = async (sezione: SezioneScolastica) => {
    if (!validaForm()) return;
    if (modaleAperto?.modo === 'modifica' && modaleAperto.id) {
      await updateDoc(doc(db, 'aule', modaleAperto.id), { nome: formNome.trim(), nomeAr: formNomeAr.trim(), capienza: formCapienza.trim() });
      await registraAttivita(REGISTRO_MODIFICA_AULA, `Aula ${formNome.trim()} modificata (capienza ${formCapienza.trim()})`);
    } else {
      const auleSezione = aule.filter((a) => a.sezione === sezione.nome);
      await addDoc(collection(db, 'aule'), {
        nome: formNome.trim(),
        nomeAr: formNomeAr.trim(),
        capienza: formCapienza.trim(),
        sezione: sezione.nome,
        ordine: auleSezione.length,
      });
      await registraAttivita(REGISTRO_AGGIUNTA_AULA, `Aula ${formNome.trim()} creata (capienza ${formCapienza.trim()}) nella sezione ${sezione.nome}`);
    }
    chiudiModale();
    onRicaricaDatiGenerali();
  };

  const eliminaGenerale = (a: (typeof aule)[number]) => {
    const esegui = async () => {
      await deleteDoc(doc(db, 'aule', a.id));
      await registraAttivita(REGISTRO_ELIMINAZIONE_AULA, `Aula ${a.nome} eliminata`);
      onRicaricaDatiGenerali();
    };
    confermaEliminazione(lang, esegui);
  };

  const spostaGenerale = async (sezione: SezioneScolastica, id: string, direzione: 'su' | 'giu') => {
    const auleSezione = aule.filter((a) => a.sezione === sezione.nome).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0));
    const idx = auleSezione.findIndex((a) => a.id === id);
    const target = direzione === 'su' ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= auleSezione.length) return;
    await Promise.all([
      updateDoc(doc(db, 'aule', auleSezione[idx].id), { ordine: auleSezione[target].ordine }),
      updateDoc(doc(db, 'aule', auleSezione[target].id), { ordine: auleSezione[idx].ordine }),
    ]);
    onRicaricaDatiGenerali();
  };

  const salvaAulaStudio = async (tipoScuola: 'medie' | 'ipi') => {
    if (!validaForm()) return;
    const posti = parseInt(formCapienza, 10);
    if (modaleAperto?.modo === 'modifica' && modaleAperto.id) {
      await modificaAulaStudioAula(db, modaleAperto.id, { nome: formNome.trim(), nomeAr: formNomeAr.trim(), tipoScuola });
      await salvaAulaStudioConfig(db, modaleAperto.id, { ...(configPerAula[modaleAperto.id] || AULA_STUDIO_CONFIG_DEFAULT), posti });
      await registraAttivita(REGISTRO_GESTIONE_AULE_STUDIO, `Aula Studio "${formNome.trim()}" modificata`);
    } else {
      const auleTipo = auleStudio.filter((a) => a.tipoScuola === tipoScuola);
      const nuovoId = await aggiungiAulaStudioAula(db, { nome: formNome.trim(), nomeAr: formNomeAr.trim(), tipoScuola, ordine: auleTipo.length });
      await salvaAulaStudioConfig(db, nuovoId, { ...AULA_STUDIO_CONFIG_DEFAULT, posti });
      await registraAttivita(REGISTRO_GESTIONE_AULE_STUDIO, `Aula Studio "${formNome.trim()}" creata (${tipoScuola})`);
    }
    chiudiModale();
  };

  const eliminaAulaStudio = (a: AulaStudioAula) => {
    const esegui = async () => {
      await eliminaAulaStudioAula(db, a.id);
      await registraAttivita(REGISTRO_GESTIONE_AULE_STUDIO, `Aula Studio "${a.nome}" eliminata`);
    };
    confermaEliminazione(lang, esegui);
  };

  if (tabs.length === 0) return null;

  return (
    <View>
      <View style={styles.rigaTab}>
        {tabs.map((tb) => (
          <TouchableOpacity key={tb.key} style={[styles.tab, tabAttiva === tb.key && styles.tabAttiva]} onPress={() => setTabAttiva(tb.key)}>
            <Text style={[styles.tabText, tabAttiva === tb.key && styles.tabTextAttiva]}>
              {tb.tipo === 'generale' ? (lang === 'ar' && tb.sezione.nomeAr ? tb.sezione.nomeAr : tb.sezione.nome) : tb.titolo}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab?.tipo === 'generale' && (
        <View>
          <TouchableOpacity style={styles.bottoneAggiungi} onPress={apriNuova}>
            <Text style={styles.bottoneAggiungiText}>{t('aggiungiAula', lang)}</Text>
          </TouchableOpacity>
          {aule
            .filter((a) => a.sezione === tab.sezione.nome)
            .sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0))
            .map((a, idx, arr) => (
              <View key={a.id} style={styles.riga}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rigaNome}>{lang === 'ar' && a.nomeAr ? a.nomeAr : a.nome}</Text>
                  <Text style={styles.rigaDettaglio}>{t('capienza', lang)}: {a.capienza}</Text>
                </View>
                <View style={styles.rigaAzioni}>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => spostaGenerale(tab.sezione, a.id, 'su')} disabled={idx === 0}>
                    <Text style={styles.iconBtnText}>▲</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => spostaGenerale(tab.sezione, a.id, 'giu')} disabled={idx === arr.length - 1}>
                    <Text style={styles.iconBtnText}>▼</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => apriModificaGenerale(a)}>
                    <Text style={styles.iconBtnText}>{t('modifica', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => eliminaGenerale(a)}>
                    <Text style={styles.iconBtnTextRimuovi}>{t('elimina', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
        </View>
      )}

      {tab?.tipo === 'aulaStudio' && (
        <View>
          <TouchableOpacity style={styles.bottoneAggiungi} onPress={apriNuova}>
            <Text style={styles.bottoneAggiungiText}>{t('aggiungiAula', lang)}</Text>
          </TouchableOpacity>
          {auleStudio
            .filter((a) => a.tipoScuola === tab.tipoScuola)
            .map((a, idx, arr) => (
              <View key={a.id} style={styles.riga}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rigaNome}>{nomeAulaStudio(a, lang)}</Text>
                  <Text style={styles.rigaDettaglio}>{t('aulaStudioPostiTotali', lang)}: {configPerAula[a.id]?.posti ?? AULA_STUDIO_CONFIG_DEFAULT.posti}</Text>
                </View>
                <View style={styles.rigaAzioni}>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => spostaAulaStudioAula(db, arr, a.id, 'su')} disabled={idx === 0}>
                    <Text style={styles.iconBtnText}>▲</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => spostaAulaStudioAula(db, arr, a.id, 'giu')} disabled={idx === arr.length - 1}>
                    <Text style={styles.iconBtnText}>▼</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => apriModificaAulaStudio(a)}>
                    <Text style={styles.iconBtnText}>{t('modifica', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => eliminaAulaStudio(a)}>
                    <Text style={styles.iconBtnTextRimuovi}>{t('elimina', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
        </View>
      )}

      {modaleAperto && tab && (
        <View style={styles.formRow}>
          <Text style={styles.formTitolo}>
            {modaleAperto.modo === 'nuova' ? t('aggiungiAula', lang) : t('modifica', lang)}
          </Text>
          <TextInput style={styles.input} placeholder={t('nomeAula', lang)} placeholderTextColor={colors.placeholder} value={formNome} onChangeText={setFormNome} />
          <View style={{ height: 8 }} />
          <TextInput
            style={[styles.input, { textAlign: 'right' }]}
            placeholder={t('wizardConfigNomeArPlaceholder', lang)}
            placeholderTextColor={colors.placeholder}
            value={formNomeAr}
            onChangeText={setFormNomeAr}
          />
          <View style={{ height: 8 }} />
          <TextInput
            style={styles.input}
            placeholder={tab.tipo === 'aulaStudio' ? t('aulaStudioPostiTotali', lang) : t('capienza', lang)}
            placeholderTextColor={colors.placeholder}
            keyboardType="numeric"
            value={formCapienza}
            onChangeText={setFormCapienza}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity
              style={styles.bottonePrimarioPiccolo}
              onPress={() => (tab.tipo === 'generale' ? salvaGenerale(tab.sezione) : salvaAulaStudio(tab.tipoScuola))}
            >
              <Text style={styles.bottonePrimarioText}>{t('salva', lang) || 'Salva'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bottoneAnnullaPiccolo} onPress={chiudiModale}>
              <Text style={styles.bottoneAnnullaText}>{t('annulla', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

function confermaEliminazione(lang: 'it' | 'ar', esegui: () => void) {
  const messaggio = lang === 'ar' ? 'حذف هذه القاعة؟' : 'Eliminare questa aula?';
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(messaggio)) esegui();
  } else {
    Alert.alert(lang === 'ar' ? 'تأكيد' : 'Conferma', messaggio, [
      { text: lang === 'ar' ? 'إلغاء' : 'Annulla' },
      { text: lang === 'ar' ? 'حذف' : 'Elimina', onPress: esegui },
    ]);
  }
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    rigaTab: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
    tab: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    tabAttiva: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { color: colors.textMain, fontWeight: '600', fontSize: 13 },
    tabTextAttiva: { color: colors.primaryText },
    bottoneAggiungi: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 12 },
    bottoneAggiungiText: { color: colors.primaryText, fontWeight: '700', fontSize: 13 },
    riga: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 8 },
    rigaNome: { color: colors.textMain, fontWeight: '700', fontSize: 14 },
    rigaDettaglio: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    rigaAzioni: { flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap' },
    iconBtn: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, backgroundColor: colors.surfaceAlt },
    iconBtnText: { color: colors.textMain, fontWeight: '700', fontSize: 12 },
    iconBtnTextRimuovi: { color: colors.danger, fontWeight: '700', fontSize: 12 },
    formRow: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginTop: 8 },
    formTitolo: { color: colors.textMain, fontWeight: '700', fontSize: 15, marginBottom: 10 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.textMain, backgroundColor: colors.surfaceAlt },
    bottonePrimarioPiccolo: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700', fontSize: 13 },
    bottoneAnnullaPiccolo: { paddingVertical: 10, paddingHorizontal: 16 },
    bottoneAnnullaText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  });
