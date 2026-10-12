// ============================================================================
// AULA STUDIO — Editor ferie extra (intervalli di date aggiuntivi, oltre a
// venerdì/domenica fissi già gestiti da isGiornoVacanza), con calendario
// popup per la scelta delle date. Componente controllato e riusabile: usato
// da AulaStudioImpostazioni (ferie per singola aula) e dal wizard di
// configurazione iniziale dell'app (stesso editor, stessa logica).
// ============================================================================
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import AulaStudioCalendarioPopup from './aula-studio-calendario-popup';
import { dataArabo } from '../../utils/numeri-arabo';
import { IntervalloFerie } from './aula-studio-utils';

interface AulaStudioFerieEditorProps {
  ferieExtra: IntervalloFerie[];
  onChange: (ferieExtra: IntervalloFerie[]) => void;
  colors: Record<string, string>;
  t: (key: string, lang: string, ...args: any[]) => any;
  lang: 'it' | 'ar';
}

export default function AulaStudioFerieEditor({ ferieExtra, onChange, colors, t, lang }: AulaStudioFerieEditorProps) {
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [popupIndice, setPopupIndice] = useState<{ indice: number; campo: 'inizio' | 'fine' } | null>(null);

  const aggiornaFerie = (indice: number, campo: keyof IntervalloFerie, valore: string) => {
    onChange(ferieExtra.map((f, i) => (i === indice ? { ...f, [campo]: valore } : f)));
  };
  const aggiungiFerie = () => {
    onChange([...ferieExtra, { inizio: '', fine: '', etichetta: '' }]);
  };
  const rimuoviFerie = (indice: number) => {
    onChange(ferieExtra.filter((_, i) => i !== indice));
  };

  return (
    <View>
      {ferieExtra.map((f, i) => (
        <View key={i} style={styles.rigaFerieEdit}>
          <TouchableOpacity style={[styles.input, styles.casellaData, { flex: 1 }]} onPress={() => setPopupIndice({ indice: i, campo: 'inizio' })}>
            <Text style={[styles.testoCasellaData, !f.inizio && { color: colors.placeholder }]}>{f.inizio ? dataArabo(f.inizio, lang) : (lang === 'ar' ? 'سنة-شهر-يوم' : 'AAAA-MM-GG')}</Text>
            <Text style={styles.casellaSceltaIcona}>📅</Text>
          </TouchableOpacity>
          <Text style={styles.trattino}>—</Text>
          <TouchableOpacity style={[styles.input, styles.casellaData, { flex: 1 }]} onPress={() => setPopupIndice({ indice: i, campo: 'fine' })}>
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

      <AulaStudioCalendarioPopup
        visible={!!popupIndice}
        onClose={() => setPopupIndice(null)}
        dataSelezionata={popupIndice ? ferieExtra[popupIndice.indice]?.[popupIndice.campo] || null : null}
        onSeleziona={(d) => {
          if (popupIndice) aggiornaFerie(popupIndice.indice, popupIndice.campo, d);
        }}
        colors={colors}
        lang={lang}
        titolo={t('aulaStudioFerieExtra', lang)}
      />
    </View>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.textMain, backgroundColor: colors.surface },
    casellaData: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    testoCasellaData: { color: colors.textMain, fontSize: 13 },
    casellaSceltaIcona: { color: colors.textMuted, fontSize: 13, marginLeft: 6 },
    rigaFerieEdit: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    trattino: { color: colors.textMuted, marginHorizontal: 6 },
    bottoneRimuovi: { marginLeft: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    bottoneRimuoviText: { color: colors.danger, fontWeight: '700' },
    bottoneAggiungiRiga: { alignSelf: 'flex-start', marginBottom: 8 },
    bottoneAggiungiRigaText: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  });
