// ============================================================================
// AULA STUDIO — Editor fasce orarie (orario inizio/fine di ogni fascia),
// componente controllato e riusabile: usato da AulaStudioImpostazioni (una
// fascia per aula) e dal wizard di configurazione iniziale dell'app (stesso
// editor, stessa logica — nessuna duplicazione).
// ============================================================================
import { useMemo } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { FasciaOraria } from './aula-studio-utils';

interface AulaStudioFasceEditorProps {
  fasce: FasciaOraria[];
  onChange: (fasce: FasciaOraria[]) => void;
  colors: Record<string, string>;
  t: (key: string, lang: string, ...args: any[]) => any;
  lang: 'it' | 'ar';
}

export default function AulaStudioFasceEditor({ fasce, onChange, colors, t, lang }: AulaStudioFasceEditorProps) {
  const styles = useMemo(() => getStyles(colors), [colors]);

  const aggiornaFascia = (indice: number, campo: keyof FasciaOraria, valore: string) => {
    onChange(fasce.map((f, i) => (i === indice ? { ...f, [campo]: valore } : f)));
  };
  const aggiungiFascia = () => {
    onChange([...fasce, { inizio: '18:00', fine: '19:00' }]);
  };
  const rimuoviFascia = (indice: number) => {
    onChange(fasce.filter((_, i) => i !== indice));
  };

  return (
    <View>
      {fasce.map((f, i) => (
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
    </View>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.textMain, backgroundColor: colors.surface },
    rigaFasciaEdit: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    trattino: { color: colors.textMuted, marginHorizontal: 6 },
    bottoneRimuovi: { marginLeft: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    bottoneRimuoviText: { color: colors.danger, fontWeight: '700' },
    bottoneAggiungiRiga: { alignSelf: 'flex-start', marginBottom: 8 },
    bottoneAggiungiRigaText: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  });
