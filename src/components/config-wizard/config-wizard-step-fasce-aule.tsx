// ============================================================================
// WIZARD CONFIGURAZIONE — Fasce orarie e regole di prenotazione delle Aule
// (Scuola Base, Scuola Media, Scuola Professionale, Comuni). Un'UNICA
// configurazione condivisa da tutte le aule di tutte le sezioni insieme
// (nessun selettore per sezione/aula, a differenza dello step "Fasce orarie
// Aula Studio"): riusa l'editor già esistente (AulaStudioFasceEditor,
// condiviso con Aula Studio) e lo stesso pattern di lettura/scrittura in
// tempo reale, applicato qui a un unico documento Firestore invece che per
// singola aula. Le regole di prenotazione (per ora: giorni minimi di
// anticipo) vivono in un documento Firestore separato (stesso pattern,
// config-wizard-regole-prenotazione-data.ts) ma si salvano insieme con lo
// stesso bottone, per non moltiplicare i passi del wizard.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AulaStudioFasceEditor from '../aula-studio/aula-studio-fasce-editor';
import { FasciaOraria } from '../aula-studio/aula-studio-utils';
import { salvaFasceOrarieAule, useFasceOrarieAule } from './config-wizard-fasce-aule-data';
import {
  REGOLE_PRENOTAZIONE_AULE_DEFAULT,
  salvaRegolePrenotazioneAule,
  useRegolePrenotazioneAule,
} from './config-wizard-regole-prenotazione-data';
import { ConfigWizardSharedProps } from './config-wizard-types';

export default function ConfigWizardStepFasceAule(props: ConfigWizardSharedProps) {
  const { db, lang, colors, t, mostraAlert } = props;
  const styles = useMemo(() => getStyles(colors), [colors]);

  const { fasce: fasceSalvate, caricamento } = useFasceOrarieAule(db);
  const { regole: regoleSalvate, caricamento: caricamentoRegole } = useRegolePrenotazioneAule(db);

  const [fasce, setFasce] = useState<FasciaOraria[]>(fasceSalvate);
  const [anticipoMinimoGiorni, setAnticipoMinimoGiorni] = useState<string>(String(REGOLE_PRENOTAZIONE_AULE_DEFAULT.anticipoMinimoGiorni));
  const [inizializzato, setInizializzato] = useState(false);
  useEffect(() => {
    if (inizializzato || caricamento || caricamentoRegole) return;
    setFasce(fasceSalvate);
    setAnticipoMinimoGiorni(String(regoleSalvate.anticipoMinimoGiorni));
    setInizializzato(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inizializzato, caricamento, caricamentoRegole, fasceSalvate, regoleSalvate]);

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
    const anticipoParsed = parseInt(anticipoMinimoGiorni, 10);
    if (!Number.isFinite(anticipoParsed) || anticipoParsed < 0) {
      mostraAlert(t('attenzione', lang), t('wizardConfigAnticipoMinimoLabel', lang));
      return;
    }
    setSalvando(true);
    try {
      await Promise.all([
        salvaFasceOrarieAule(db, fasce),
        salvaRegolePrenotazioneAule(db, { anticipoMinimoGiorni: anticipoParsed }),
      ]);
      mostraAlert(t('successo', lang), t('aulaStudioConfigSalvata', lang));
    } catch (e: any) {
      mostraAlert(t('errore', lang), e?.message || t('aulaStudioErroreGenerico', lang));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <View>
      <Text style={styles.spiegazione}>{t('wizardConfigFasceAuleSpiegazione', lang)}</Text>

      <AulaStudioFasceEditor fasce={fasce} onChange={setFasce} colors={colors} t={t} lang={lang} />

      <Text style={[styles.etichetta, { marginTop: 18 }]}>{t('wizardConfigAnticipoMinimoLabel', lang)}</Text>
      <Text style={styles.spiegazione}>{t('wizardConfigAnticipoMinimoSpiegazione', lang)}</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={anticipoMinimoGiorni}
        onChangeText={setAnticipoMinimoGiorni}
      />

      <TouchableOpacity style={[styles.bottonePrimario, salvando && { opacity: 0.6 }]} onPress={salva} disabled={salvando}>
        <Text style={styles.bottonePrimarioText}>{t('salva', lang) || 'Salva'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    spiegazione: { color: colors.textMuted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
    etichetta: { color: colors.textMain, fontWeight: '700', fontSize: 14, marginBottom: 4 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.textMain, backgroundColor: colors.surfaceAlt, maxWidth: 120 },
    bottonePrimario: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
  });
