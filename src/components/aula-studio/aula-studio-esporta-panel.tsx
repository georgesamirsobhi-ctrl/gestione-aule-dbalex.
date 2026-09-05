// ============================================================================
// AULA STUDIO — Pannello di esportazione, montato dentro Impostazioni →
// Esporta (non più come pulsante dentro la schermata Appello). Permette al
// gestore di scegliere aula + giorno e scaricare l'Excel dell'appello di
// quel giorno, con la stessa logica/colonne di sempre (incluso l'insegnante
// di turno confermato, se presente).
// ============================================================================
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Firestore } from 'firebase/firestore';

import AulaStudioCalendarioPopup from './aula-studio-calendario-popup';
import { numArabo, dataArabo } from '../../utils/numeri-arabo';
import {
  useAulaStudioAule,
  useAulaStudioConfig,
  useAulaStudioPrenotazioniGiorno,
  useAulaStudioSanzioni,
  useAulaStudioTurni,
} from './aula-studio-data';
import { AULA_STUDIO_CONFIG_DEFAULT, calcolaSemestreCorrente, nomeAulaStudio, oggiIso } from './aula-studio-utils';

interface Props {
  db: Firestore;
  lang: 'it' | 'ar';
  colors: Record<string, string>;
  t: (key: string, lang: string, ...args: any[]) => any;
  mostraAlert: (titolo: string, messaggio: string) => void;
  scriviECondividiExcel: (nomeFile: string, righe: Record<string, any>[]) => Promise<void>;
}

export default function AulaStudioEsportaPanel({ db, lang, colors, t, mostraAlert, scriviECondividiExcel }: Props) {
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { aule } = useAulaStudioAule(db);
  const [aulaId, setAulaId] = useState<string>('');
  const [dataSelezionata, setDataSelezionata] = useState<string>(oggiIso());
  const [giornoPopupAperto, setGiornoPopupAperto] = useState(false);
  const [esportazioneInCorso, setEsportazioneInCorso] = useState(false);

  const aulaEffettiva = aulaId || aule[0]?.id || '';
  const { configPerAula } = useAulaStudioConfig(db);
  const configAula = configPerAula[aulaEffettiva] || AULA_STUDIO_CONFIG_DEFAULT;
  const { prenotazioni } = useAulaStudioPrenotazioniGiorno(db, aulaEffettiva || null, dataSelezionata || null);
  const { sanzioni } = useAulaStudioSanzioni(db);
  const { turni } = useAulaStudioTurni(db);

  const semestreCorrente = calcolaSemestreCorrente(dataSelezionata, configAula.semestre1Inizio, configAula.semestre2Inizio);

  const palliniPerStudente = useMemo(() => {
    const mappa: Record<string, number> = {};
    sanzioni
      .filter((s) => s.semestre === semestreCorrente)
      .forEach((s) => {
        mappa[s.chiaveStudente] = (mappa[s.chiaveStudente] || 0) + 1;
      });
    return mappa;
  }, [sanzioni, semestreCorrente]);

  const insegnanteDiTurnoPerFascia = useMemo(() => {
    const mappa: Record<string, string> = {};
    turni
      .filter((r) => r.stato === 'confermata' && r.aulaId === aulaEffettiva && r.data === dataSelezionata)
      .forEach((r) => {
        r.fasce.forEach((f) => {
          mappa[f] = mappa[f] ? `${mappa[f]}, ${r.insegnanteNome}` : r.insegnanteNome;
        });
      });
    return mappa;
  }, [turni, aulaEffettiva, dataSelezionata]);

  const esportaGiorno = async () => {
    const righe = prenotazioni.map((p) => ({
      [t('aulaStudioColNome', lang)]: `${p.nome} ${p.cognome}`,
      [t('aulaStudioClasse', lang)]: p.classe,
      [t('aulaStudioNumeroInClasse', lang)]: p.numero,
      [t('aulaStudioFasceOrarie', lang)]: p.fascia,
      [t('aulaStudioColStato', lang)]: p.stato,
      [t('aulaStudioColPresenza', lang)]: p.statoPresenza,
      [t('aulaStudioColPallini', lang)]: palliniPerStudente[p.chiaveStudente] || 0,
      [lang === 'ar' ? 'المعلم المناوب' : 'Insegnante di turno']: insegnanteDiTurnoPerFascia[p.fascia] || '',
    }));
    if (righe.length === 0) {
      mostraAlert('', t('aulaStudioNessunaPrenotazione', lang));
      return;
    }
    setEsportazioneInCorso(true);
    try {
      await scriviECondividiExcel(`aula_studio_${aulaEffettiva}_${dataSelezionata}.xlsx`, righe);
    } finally {
      setEsportazioneInCorso(false);
    }
  };

  return (
    <View>
      <Text style={styles.etichetta}>{lang === 'ar' ? 'القاعة' : 'Aula'}</Text>
      <View style={styles.rigaAule}>
        {aule.map((a) => (
          <TouchableOpacity
            key={a.id}
            style={[styles.chipAula, aulaEffettiva === a.id && styles.chipAulaAttiva]}
            onPress={() => setAulaId(a.id)}
          >
            <Text style={[styles.chipAulaText, aulaEffettiva === a.id && styles.chipAulaTextAttiva]}>{nomeAulaStudio(a, lang)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.etichetta}>{lang === 'ar' ? 'اليوم' : 'Giorno'}</Text>
      <TouchableOpacity style={styles.casellaGiorno} onPress={() => setGiornoPopupAperto(true)}>
        <Text style={styles.casellaGiornoText}>{dataArabo(dataSelezionata, lang)}</Text>
        <Text style={styles.casellaSceltaIcona}>📅</Text>
      </TouchableOpacity>
      <AulaStudioCalendarioPopup
        visible={giornoPopupAperto}
        onClose={() => setGiornoPopupAperto(false)}
        dataSelezionata={dataSelezionata}
        onSeleziona={(d: string) => setDataSelezionata(d)}
        colors={colors}
        lang={lang}
        titolo={t('aulaStudioScegliGiorno', lang)}
      />

      <TouchableOpacity
        style={[styles.bottoneEsporta, (esportazioneInCorso || !aulaEffettiva) && { opacity: 0.6 }]}
        onPress={esportaGiorno}
        disabled={esportazioneInCorso || !aulaEffettiva}
      >
        <Text style={styles.bottoneEsportaText}>📊 {t('aulaStudioEsportaGiorno', lang)}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    etichetta: { color: colors.textSub, fontWeight: '600', fontSize: 12, marginBottom: 6, marginTop: 4 },
    rigaAule: { flexDirection: 'row', marginBottom: 6, flexWrap: 'wrap', gap: 8 },
    chipAula: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    chipAulaAttiva: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipAulaText: { color: colors.textMain, fontWeight: '600' },
    chipAulaTextAttiva: { color: colors.primaryText },
    casellaGiorno: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 16,
      maxWidth: 220,
    },
    casellaGiornoText: { color: colors.textMain, fontSize: 14, fontWeight: '700' },
    casellaSceltaIcona: { color: colors.textMuted, fontSize: 13, marginLeft: 6 },
    bottoneEsporta: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    bottoneEsportaText: { color: colors.primaryText, fontWeight: '700' },
  });
