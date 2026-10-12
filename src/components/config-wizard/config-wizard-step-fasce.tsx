// ============================================================================
// WIZARD CONFIGURAZIONE — Passo 3: Fasce orarie Aula Studio. Riusa
// interamente l'editor fasce già esistente (AulaStudioFasceEditor, condiviso
// con Impostazioni > Aula Studio) e la stessa collection aulaStudioConfig:
// nessuna logica reinventata. Una fascia per ciascuna aula Aula Studio
// esistente (create nel passo "Aule"), scelta con un selettore a chip come
// nella pagina Impostazioni già esistente.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import AulaStudioFasceEditor from '../aula-studio/aula-studio-fasce-editor';
import { salvaAulaStudioConfig, useAulaStudioAule, useAulaStudioConfig } from '../aula-studio/aula-studio-data';
import { AULA_STUDIO_CONFIG_DEFAULT, FasciaOraria, nomeAulaStudio } from '../aula-studio/aula-studio-utils';
import { ConfigWizardSharedProps } from './config-wizard-types';

export default function ConfigWizardStepFasce(props: ConfigWizardSharedProps) {
  const { db, lang, colors, t, mostraAlert } = props;
  const styles = useMemo(() => getStyles(colors), [colors]);

  const { aule } = useAulaStudioAule(db);
  const { configPerAula, caricamentoConfig } = useAulaStudioConfig(db);

  const [aulaId, setAulaId] = useState('');
  useEffect(() => {
    if (aule.length === 0) return;
    if (!aulaId || !aule.some((a) => a.id === aulaId)) setAulaId(aule[0].id);
  }, [aule, aulaId]);

  const [fasce, setFasce] = useState<FasciaOraria[]>(AULA_STUDIO_CONFIG_DEFAULT.fasce);
  useEffect(() => {
    // Aspetta che la config sia arrivata da Firestore: l'elenco aule (useAulaStudioAule) può
    // risolversi prima della config (useAulaStudioConfig, qui sotto anche come dipendenza) —
    // senza questa attesa si vedrebbero le fasce di default anche quando per l'aula esistono
    // già fasce salvate (caso tipico alla primissima apertura del wizard, cache Firestore fredda).
    if (caricamentoConfig) return;
    setFasce(configPerAula[aulaId]?.fasce || AULA_STUDIO_CONFIG_DEFAULT.fasce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aulaId, caricamentoConfig]);

  const [salvando, setSalvando] = useState(false);

  const salva = async () => {
    if (fasce.length === 0) {
      mostraAlert(t('attenzione', lang), t('aulaStudioAlmenoUnaFascia', lang));
      return;
    }
    for (const f of fasce) {
      if (!/^\d{2}:\d{2}$/.test(f.inizio) || !/^\d{2}:\d{2}$/.test(f.fine)) {
        mostraAlert(t('attenzione', lang), t('aulaStudioFormatoOrarioNonValido', lang));
        return;
      }
    }
    setSalvando(true);
    try {
      await salvaAulaStudioConfig(db, aulaId, { ...(configPerAula[aulaId] || AULA_STUDIO_CONFIG_DEFAULT), fasce });
      mostraAlert(t('successo', lang), t('aulaStudioConfigSalvata', lang));
    } catch (e: any) {
      mostraAlert(t('errore', lang), e?.message || t('aulaStudioErroreGenerico', lang));
    } finally {
      setSalvando(false);
    }
  };

  if (aule.length === 0) {
    return <Text style={styles.testoInfo}>{t('wizardConfigCreaAulaStudioPrima', lang)}</Text>;
  }

  return (
    <View>
      <View style={styles.rigaAule}>
        {aule.map((a) => (
          <TouchableOpacity key={a.id} style={[styles.chipAula, aulaId === a.id && styles.chipAulaAttiva]} onPress={() => setAulaId(a.id)}>
            <Text style={[styles.chipAulaText, aulaId === a.id && styles.chipAulaTextAttiva]}>{nomeAulaStudio(a, lang)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <AulaStudioFasceEditor fasce={fasce} onChange={setFasce} colors={colors} t={t} lang={lang} />

      <TouchableOpacity style={[styles.bottonePrimario, salvando && { opacity: 0.6 }]} onPress={salva} disabled={salvando}>
        <Text style={styles.bottonePrimarioText}>{t('salva', lang) || 'Salva'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    testoInfo: { color: colors.textMuted, fontSize: 14 },
    rigaAule: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    chipAula: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    chipAulaAttiva: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipAulaText: { color: colors.textMain, fontWeight: '600' },
    chipAulaTextAttiva: { color: colors.primaryText },
    bottonePrimario: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
  });
