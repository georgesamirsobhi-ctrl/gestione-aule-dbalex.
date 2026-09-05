// ============================================================================
// AULA STUDIO — Calendario popup condiviso: una casella che apre un calendario
// mensile (stesso stile dei dayButton dell'app) per scegliere un giorno.
// Se "giorniAttivi" è fornito, solo quei giorni sono cliccabili (caso studente,
// solo i 2 giorni prenotabili); altrimenti tutti i giorni del mese sono
// cliccabili (caso gestore/impostazioni, che devono poter scegliere qualsiasi
// data).
// ============================================================================
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { formattaMeseAnno, giorniNelMese, oggiIso, spostaMese } from './aula-studio-utils';
import { numArabo } from '../../utils/numeri-arabo';

interface CalendarioPopupProps {
  visible: boolean;
  onClose: () => void;
  dataSelezionata: string | null; // 'YYYY-MM-DD'
  onSeleziona: (dataIso: string) => void;
  /** Se fornito, solo questi giorni ('YYYY-MM-DD') sono cliccabili. Se omesso, tutti i giorni sono cliccabili. */
  giorniAttivi?: string[];
  colors: Record<string, string>;
  lang: 'it' | 'ar';
  titolo: string;
}

export default function AulaStudioCalendarioPopup(props: CalendarioPopupProps) {
  const { visible, onClose, dataSelezionata, onSeleziona, giorniAttivi, colors, lang, titolo } = props;
  const styles = getStyles(colors);

  const [meseVisualizzato, setMeseVisualizzato] = useState<string>((dataSelezionata || oggiIso()).substring(0, 7));

  useEffect(() => {
    if (visible) {
      setMeseVisualizzato((dataSelezionata || oggiIso()).substring(0, 7));
    }
  }, [visible, dataSelezionata]);

  const nGiorni = giorniNelMese(meseVisualizzato);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.box} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.titolo} numberOfLines={1}>{titolo}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.chiudi}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.navMese}>
            <TouchableOpacity style={styles.freccia} onPress={() => setMeseVisualizzato((m) => spostaMese(m, -1))}>
              <Text style={styles.frecciaText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.testoMese}>{numArabo(formattaMeseAnno(meseVisualizzato, lang), lang)}</Text>
            <TouchableOpacity style={styles.freccia} onPress={() => setMeseVisualizzato((m) => spostaMese(m, 1))}>
              <Text style={styles.frecciaText}>›</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.dayGrid}>
            {Array.from({ length: nGiorni }, (_, i) => i + 1).map((giorno) => {
              const giornoStr = `${meseVisualizzato}-${String(giorno).padStart(2, '0')}`;
              const attivo = giorniAttivi ? giorniAttivi.includes(giornoStr) : true;
              const selezionato = dataSelezionata === giornoStr;
              return (
                <TouchableOpacity
                  key={giornoStr}
                  disabled={!attivo}
                  style={[
                    styles.dayButton,
                    attivo ? styles.dayButtonFree : styles.dayButtonPast,
                    selezionato && styles.dayButtonSelezionato,
                  ]}
                  onPress={() => {
                    onSeleziona(giornoStr);
                    onClose();
                  }}
                >
                  <Text style={[styles.dayButtonText, !attivo && styles.dayButtonTextPast]}>{numArabo(giorno, lang)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
    box: {
      backgroundColor: colors.bg,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      maxWidth: 360,
      width: '100%',
      alignSelf: 'center',
    },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    titolo: { color: colors.textMain, fontSize: 15, fontWeight: '700', flex: 1, paddingRight: 8 },
    chiudi: { color: colors.textMain, fontSize: 18 },
    navMese: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    freccia: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    frecciaText: { fontSize: 18, color: colors.textMain },
    testoMese: { color: colors.textMain, fontWeight: '700', fontSize: 14 },
    dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
    dayButton: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
    dayButtonFree: { backgroundColor: colors.success },
    dayButtonPast: { backgroundColor: colors.surface, opacity: 0.35 },
    dayButtonSelezionato: { borderWidth: 2, borderColor: colors.primary },
    dayButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
    dayButtonTextPast: { color: colors.textMuted },
  });
