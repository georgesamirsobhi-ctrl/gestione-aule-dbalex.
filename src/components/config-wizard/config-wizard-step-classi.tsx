// ============================================================================
// WIZARD CONFIGURAZIONE — Passo 1: Classi. Stessa collection Firestore
// "classi" e stessa logica già usata da Impostazioni > Classi (nome + tipo
// Medie/IPI, usato dall'Aula Studio per smistare lo studente): qui è solo
// incorporata nel wizard, non reinventata. I dati sono perciò identici e
// intercambiabili tra le due schermate.
// ============================================================================
import { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { ConfigWizardSharedProps } from './config-wizard-types';

// Stesse chiavi di registro attività già usate da Impostazioni > Classi (TIPI_REGISTRO
// in src/app/index.tsx): duplicate qui come stringhe letterali per evitare un import
// di ritorno verso index.tsx (che già importa questo componente).
const REGISTRO_AGGIUNTA_CLASSE = 'aggiunta_classe';
const REGISTRO_MODIFICA_CLASSE = 'modifica_classe';
const REGISTRO_ELIMINAZIONE_CLASSE = 'eliminazione_classe';

export default function ConfigWizardStepClassi(props: ConfigWizardSharedProps) {
  const { db, lang, colors, t, mostraAlert, registraAttivita, classiLista, onRicaricaDatiGenerali } = props;
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [mostraForm, setMostraForm] = useState(false);
  const [classeInModifica, setClasseInModifica] = useState<{ id: string; nome: string } | null>(null);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'medie' | 'ipi'>('medie');

  const apriNuova = () => {
    setClasseInModifica(null);
    setNome('');
    setTipo('medie');
    setMostraForm(true);
  };

  const apriModifica = (c: { id: string; nome: string; tipo?: string | null }) => {
    setClasseInModifica({ id: c.id, nome: c.nome });
    setNome(c.nome);
    setTipo(c.tipo === 'ipi' ? 'ipi' : 'medie');
    setMostraForm(true);
  };

  const annulla = () => {
    setClasseInModifica(null);
    setNome('');
    setMostraForm(false);
  };

  const salva = async () => {
    if (!nome.trim()) {
      mostraAlert(t('attenzione', lang), t('wizardConfigNomeItObbligatorio', lang));
      return;
    }
    if (classeInModifica) {
      await updateDoc(doc(db, 'classi', classeInModifica.id), { nome: nome.trim(), tipo });
      await registraAttivita(REGISTRO_MODIFICA_CLASSE, `Classe ${classeInModifica.nome} rinominata in ${nome.trim()}`);
    } else {
      await addDoc(collection(db, 'classi'), { nome: nome.trim(), tipo, ordine: classiLista.length });
      await registraAttivita(REGISTRO_AGGIUNTA_CLASSE, `Classe ${nome.trim()} aggiunta`);
    }
    setNome('');
    setClasseInModifica(null);
    setMostraForm(false);
    onRicaricaDatiGenerali();
  };

  const elimina = (c: { id: string; nome: string }) => {
    const esegui = async () => {
      await deleteDoc(doc(db, 'classi', c.id));
      await registraAttivita(REGISTRO_ELIMINAZIONE_CLASSE, `Classe ${c.nome} eliminata`);
      onRicaricaDatiGenerali();
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(t('confermaEliminazioneClasse', lang))) esegui();
    } else {
      Alert.alert(t('conferma', lang) || 'Conferma', t('confermaEliminazioneClasse', lang), [
        { text: t('annulla', lang) },
        { text: t('elimina', lang) || 'Elimina', onPress: esegui },
      ]);
    }
  };

  const classificaNonAssegnate = async (tipoScelto: 'medie' | 'ipi') => {
    const daClassificare = classiLista.filter((c) => c.tipo !== 'medie' && c.tipo !== 'ipi');
    if (daClassificare.length === 0) return;
    for (const c of daClassificare) {
      await updateDoc(doc(db, 'classi', c.id), { tipo: tipoScelto });
    }
    await registraAttivita(
      REGISTRO_MODIFICA_CLASSE,
      `${daClassificare.length} classi classificate come ${tipoScelto === 'ipi' ? 'IPI' : 'Medie'}`
    );
    onRicaricaDatiGenerali();
  };

  const gruppi = [
    { chiave: 'medie', titolo: t('aulaStudioTipoMedie', lang), elenco: classiLista.filter((c) => c.tipo === 'medie') },
    { chiave: 'ipi', titolo: t('aulaStudioTipoIpi', lang), elenco: classiLista.filter((c) => c.tipo === 'ipi') },
    { chiave: 'altro', titolo: t('classiDaClassificare', lang), elenco: classiLista.filter((c) => c.tipo !== 'medie' && c.tipo !== 'ipi') },
  ];

  return (
    <View>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.bottoneAggiungi} onPress={apriNuova}>
          <Text style={styles.bottoneAggiungiText}>{t('aggiungiClasse', lang)}</Text>
        </TouchableOpacity>
      </View>

      {mostraForm && (
        <View style={styles.formRow}>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <TouchableOpacity style={[styles.chipTipo, tipo === 'medie' && styles.chipTipoAttivo]} onPress={() => setTipo('medie')}>
              <Text style={[styles.chipTipoText, tipo === 'medie' && styles.chipTipoTextAttivo]}>{t('aulaStudioTipoMedie', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chipTipo, tipo === 'ipi' && styles.chipTipoAttivo]} onPress={() => setTipo('ipi')}>
              <Text style={[styles.chipTipoText, tipo === 'ipi' && styles.chipTipoTextAttivo]}>{t('aulaStudioTipoIpi', lang)}</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder={t('nomeClasse', lang)}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="characters"
            value={nome}
            onChangeText={setNome}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity style={styles.bottonePrimarioPiccolo} onPress={salva}>
              <Text style={styles.bottonePrimarioText}>{t('salvaClasse', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bottoneAnnullaPiccolo} onPress={annulla}>
              <Text style={styles.bottoneAnnullaText}>{t('annullaModifica', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {classiLista.length === 0 && <Text style={styles.testoInfo}>{t('nessunaClasse', lang)}</Text>}

      {gruppi.map((gruppo) =>
        gruppo.elenco.length === 0 ? null : (
          <View key={gruppo.chiave} style={{ marginBottom: 14 }}>
            <Text style={styles.gruppoTitolo}>{gruppo.titolo}</Text>
            {gruppo.chiave === 'altro' && (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <TouchableOpacity style={styles.bottoneSecondario} onPress={() => classificaNonAssegnate('medie')}>
                  <Text style={styles.bottoneSecondarioText}>{t('classificaComeMedie', lang)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bottoneSecondario} onPress={() => classificaNonAssegnate('ipi')}>
                  <Text style={styles.bottoneSecondarioText}>{t('classificaComeIpi', lang)}</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.griglia}>
              {gruppo.elenco.map((c) => (
                <View key={c.id} style={styles.card}>
                  <Text style={styles.cardNome} numberOfLines={1}>{c.nome}</Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TouchableOpacity style={styles.cardBtn} onPress={() => apriModifica(c)}>
                      <Text style={styles.cardBtnText}>{t('modifica', lang)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cardBtn} onPress={() => elimina(c)}>
                      <Text style={styles.cardBtnTextRimuovi}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )
      )}
    </View>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    headerRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12 },
    bottoneAggiungi: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
    bottoneAggiungiText: { color: colors.primaryText, fontWeight: '700', fontSize: 13 },
    formRow: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 16 },
    chipTipo: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    chipTipoAttivo: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipTipoText: { color: colors.textMain, fontWeight: '600', fontSize: 13 },
    chipTipoTextAttivo: { color: colors.primaryText },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.textMain, backgroundColor: colors.surface },
    bottonePrimarioPiccolo: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700', fontSize: 13 },
    bottoneAnnullaPiccolo: { paddingVertical: 10, paddingHorizontal: 16 },
    bottoneAnnullaText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    testoInfo: { color: colors.textMuted, fontSize: 14, marginBottom: 12 },
    gruppoTitolo: { color: colors.textSub, fontWeight: '700', fontSize: 15, marginBottom: 8 },
    bottoneSecondario: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: colors.surfaceAlt },
    bottoneSecondarioText: { color: colors.textMain, fontWeight: '600', fontSize: 12 },
    griglia: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
    cardNome: { color: colors.textMain, fontWeight: '600', fontSize: 13, maxWidth: 90 },
    cardBtn: { paddingVertical: 4, paddingHorizontal: 6 },
    cardBtnText: { color: colors.primary, fontWeight: '600', fontSize: 12 },
    cardBtnTextRimuovi: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  });
