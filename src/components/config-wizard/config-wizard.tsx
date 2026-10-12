// ============================================================================
// WIZARD DI CONFIGURAZIONE INIZIALE — container con i 4 passi in sequenza
// (Classi → Aule → Fasce orarie Aula Studio → Ferie). Nessuno stato di
// avanzamento viene salvato: ogni passo legge/scrive direttamente le
// collection Firestore già esistenti, quindi riaprendo il wizard in un
// secondo momento ogni passo mostra sempre lo stato reale attuale,
// modificabile e completabile — mai vuoto se i dati esistono già. Ogni passo
// è visibile solo a chi ha il permesso specifico per quell'area (Classi,
// Aule, Aula Studio); i Ruoli e Permessi non fanno parte del wizard e restano
// gestibili solo dalle Impostazioni avanzate.
// ============================================================================
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import ConfigWizardStepClassi from './config-wizard-step-classi';
import ConfigWizardStepAule from './config-wizard-step-aule';
import ConfigWizardStepFasceAule from './config-wizard-step-fasce-aule';
import ConfigWizardStepFasce from './config-wizard-step-fasce';
import ConfigWizardStepFerie from './config-wizard-step-ferie';
import { ConfigWizardSharedProps } from './config-wizard-types';

interface ConfigWizardProps extends ConfigWizardSharedProps {
  onChiudi: () => void;
}

export default function ConfigWizard(props: ConfigWizardProps) {
  const { lang, isRTL, colors, t, canGestireClassi, canGestireAule, canGestireAulaStudio, onChiudi, ...stepProps } = props;
  const styles = useMemo(() => getStyles(colors), [colors]);

  const passi = useMemo(
    () =>
      [
        { key: 'classi', titolo: t('wizardConfigPassoClassiTitolo', lang), visibile: canGestireClassi, Componente: ConfigWizardStepClassi },
        { key: 'aule', titolo: t('wizardConfigPassoAuleTitolo', lang), visibile: canGestireAule || canGestireAulaStudio, Componente: ConfigWizardStepAule },
        { key: 'fasceAule', titolo: t('wizardConfigPassoFasceAuleTitolo', lang), visibile: canGestireAule, Componente: ConfigWizardStepFasceAule },
        { key: 'fasce', titolo: t('wizardConfigPassoFasceTitolo', lang), visibile: canGestireAulaStudio, Componente: ConfigWizardStepFasce },
        { key: 'ferie', titolo: t('wizardConfigPassoFerieTitolo', lang), visibile: canGestireAulaStudio, Componente: ConfigWizardStepFerie },
      ].filter((p) => p.visibile),
    [lang, canGestireClassi, canGestireAule, canGestireAulaStudio]
  );

  const [indice, setIndice] = useState(0);
  const passoCorrente = passi[Math.min(indice, passi.length - 1)];

  if (passi.length === 0 || !passoCorrente) {
    return (
      <View style={styles.container}>
        <Text style={styles.testoInfo}>{t('wizardConfigSottotitolo', lang)}</Text>
      </View>
    );
  }

  const isPrimo = indice === 0;
  const isUltimo = indice === passi.length - 1;
  const StepComponente = passoCorrente.Componente;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.formWrap}>
        <Text style={styles.titolo}>{t('wizardConfigVoceMenu', lang)}</Text>
        <Text style={styles.sottotitolo}>{t('wizardConfigSottotitolo', lang)}</Text>

        <View style={styles.indicatorRow}>
          {passi.map((p, i) => (
            <View key={p.key} style={[styles.pallino, i === indice && styles.pallinoAttivo, i < indice && styles.pallinoCompletato]} />
          ))}
        </View>
        <Text style={styles.passoLabel}>
          {t('wizardConfigPasso', lang, indice + 1, passi.length)} — {passoCorrente.titolo}
        </Text>

        <View style={styles.stepBody}>
          <StepComponente
            {...stepProps}
            lang={lang}
            isRTL={isRTL}
            colors={colors}
            t={t}
            canGestireClassi={canGestireClassi}
            canGestireAule={canGestireAule}
            canGestireAulaStudio={canGestireAulaStudio}
          />
        </View>

        <View style={styles.navRow}>
          <TouchableOpacity
            style={[styles.bottoneSecondario, isPrimo && styles.bottoneDisabilitato]}
            onPress={() => setIndice((i) => Math.max(0, i - 1))}
            disabled={isPrimo}
          >
            <Text style={styles.bottoneSecondarioText}>{t('wizardConfigIndietro', lang)}</Text>
          </TouchableOpacity>
          {isUltimo ? (
            <TouchableOpacity style={styles.bottonePrimario} onPress={onChiudi}>
              <Text style={styles.bottonePrimarioText}>{t('wizardConfigFine', lang)}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.bottonePrimario} onPress={() => setIndice((i) => Math.min(passi.length - 1, i + 1))}>
              <Text style={styles.bottonePrimarioText}>{t('wizardConfigAvanti', lang)}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    formWrap: { maxWidth: 560, width: '100%', alignSelf: 'center' },
    titolo: { fontSize: 22, fontWeight: '700', color: colors.textMain, marginBottom: 6 },
    sottotitolo: { color: colors.textMuted, fontSize: 13, marginBottom: 18, lineHeight: 18 },
    indicatorRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
    pallino: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt },
    pallinoAttivo: { backgroundColor: colors.primary },
    pallinoCompletato: { backgroundColor: colors.success },
    passoLabel: { color: colors.textSub, fontWeight: '700', fontSize: 15, marginBottom: 16 },
    stepBody: { marginBottom: 24 },
    navRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 40 },
    bottoneSecondario: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, backgroundColor: colors.surface },
    bottoneSecondarioText: { color: colors.textMain, fontWeight: '700', fontSize: 14 },
    bottoneDisabilitato: { opacity: 0.4 },
    bottonePrimario: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700', fontSize: 14 },
    testoInfo: { color: colors.textMuted, fontSize: 14, padding: 16 },
  });
