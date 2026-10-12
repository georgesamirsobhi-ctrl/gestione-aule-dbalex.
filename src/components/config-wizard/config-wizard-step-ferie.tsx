// ============================================================================
// WIZARD CONFIGURAZIONE — Passo 4: Ferie. Riusa interamente l'editor ferie
// già esistente (AulaStudioFerieEditor, condiviso con Impostazioni > Aula
// Studio) e la stessa collection aulaStudioConfig: nessuna logica
// reinventata. A differenza di Impostazioni (dove le ferie si impostano per
// singola aula), qui un solo inserimento viene applicato a TUTTE le aule
// Aula Studio esistenti (Medie e IPI), per evitare di ripetere lo stesso
// intervento più volte — comportamento confermato con l'utente.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import AulaStudioFerieEditor from '../aula-studio/aula-studio-ferie-editor';
import { salvaAulaStudioConfig, useAulaStudioAule, useAulaStudioConfig } from '../aula-studio/aula-studio-data';
import { AULA_STUDIO_CONFIG_DEFAULT, IntervalloFerie } from '../aula-studio/aula-studio-utils';
import { ConfigWizardSharedProps } from './config-wizard-types';

export default function ConfigWizardStepFerie(props: ConfigWizardSharedProps) {
  const { db, lang, colors, t, mostraAlert } = props;
  const styles = useMemo(() => getStyles(colors), [colors]);

  const { aule } = useAulaStudioAule(db);
  const { configPerAula, caricamentoConfig } = useAulaStudioConfig(db);

  // Precompilato con le ferie della prima aula esistente (se già configurate) — mai vuoto se
  // i dati esistono già; se le aule hanno oggi ferie diverse tra loro, salvando qui si
  // uniformano tutte a questo unico elenco (comportamento illustrato da wizardConfigFerieSpiegazione).
  const [ferieExtra, setFerieExtra] = useState<IntervalloFerie[]>([]);
  const [inizializzato, setInizializzato] = useState(false);
  useEffect(() => {
    if (inizializzato || caricamentoConfig || aule.length === 0) return;
    setFerieExtra(configPerAula[aule[0].id]?.ferieExtra || AULA_STUDIO_CONFIG_DEFAULT.ferieExtra);
    setInizializzato(true);
  }, [inizializzato, caricamentoConfig, aule, configPerAula]);

  const [salvando, setSalvando] = useState(false);

  const salva = async () => {
    for (const f of ferieExtra) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.inizio) || !/^\d{4}-\d{2}-\d{2}$/.test(f.fine)) {
        mostraAlert(t('attenzione', lang), t('aulaStudioFormatoDataNonValido', lang));
        return;
      }
    }
    setSalvando(true);
    try {
      await Promise.all(
        aule.map((a) => salvaAulaStudioConfig(db, a.id, { ...(configPerAula[a.id] || AULA_STUDIO_CONFIG_DEFAULT), ferieExtra }))
      );
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
      <Text style={styles.spiegazione}>{t('wizardConfigFerieSpiegazione', lang)}</Text>

      <AulaStudioFerieEditor ferieExtra={ferieExtra} onChange={setFerieExtra} colors={colors} t={t} lang={lang} />

      <TouchableOpacity style={[styles.bottonePrimario, salvando && { opacity: 0.6 }]} onPress={salva} disabled={salvando}>
        <Text style={styles.bottonePrimarioText}>{t('salva', lang) || 'Salva'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    testoInfo: { color: colors.textMuted, fontSize: 14 },
    spiegazione: { color: colors.textMuted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
    bottonePrimario: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
  });
