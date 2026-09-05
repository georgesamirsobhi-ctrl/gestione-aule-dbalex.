// ============================================================================
// AULA STUDIO — Wizard di registrazione al primo accesso (solo studenti):
// Passo 1 tipo scuola (IPI/Medie), Passo 2 classe (filtrata), Passo 3 numero
// di registro + conferma nome/cognome. Va fatto una sola volta: il risultato
// viene salvato sul profilo (users/{uid}) e riusato per tutte le prenotazioni
// future senza richiederlo mai più.
// ============================================================================
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { salvaProfiloAulaStudio } from './aula-studio-data';
import { AulaStudioSharedProps } from './aula-studio-types';

/** Divide "Nome Cognome" nel modo più ragionevole: ultima parola = cognome, il resto = nome. Solo un punto di partenza modificabile dallo studente. */
function separaNomeCognome(nomeCompleto: string): { nome: string; cognome: string } {
  const parti = (nomeCompleto || '').trim().split(/\s+/).filter(Boolean);
  if (parti.length <= 1) return { nome: parti[0] || '', cognome: '' };
  return { nome: parti.slice(0, -1).join(' '), cognome: parti[parti.length - 1] };
}

export default function AulaStudioRegistrazioneWizard(props: AulaStudioSharedProps) {
  const { db, user, userName, lang, colors, t, mostraAlert, classiLista, onProfiloAulaStudioSalvato } = props;
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [tipoScuola, setTipoScuola] = useState<'medie' | 'ipi' | null>(null);
  const [classeScelta, setClasseScelta] = useState<string>('');
  const [dropdownClasseAperto, setDropdownClasseAperto] = useState(false);
  const [numeroRegistro, setNumeroRegistro] = useState('');
  const iniziali = useMemo(() => separaNomeCognome(userName), [userName]);
  const [nomeStudente, setNomeStudente] = useState(iniziali.nome);
  const [cognomeStudente, setCognomeStudente] = useState(iniziali.cognome);
  const [salvando, setSalvando] = useState(false);

  const classiFiltrate = useMemo(
    () => classiLista.filter((c) => c.tipo === tipoScuola),
    [classiLista, tipoScuola]
  );

  const vaiPasso2 = (tipo: 'medie' | 'ipi') => {
    setTipoScuola(tipo);
    setClasseScelta('');
    setPasso(2);
  };

  const vaiPasso3 = () => {
    if (!classeScelta.trim()) {
      mostraAlert(t('attenzione', lang), t('aulaStudioScegliereClasse', lang));
      return;
    }
    setPasso(3);
  };

  const confermaRegistrazione = async () => {
    if (!numeroRegistro.trim() || !nomeStudente.trim() || !cognomeStudente.trim() || !tipoScuola) {
      mostraAlert(t('attenzione', lang), t('aulaStudioCompilaDatiStudente', lang));
      return;
    }
    if (!user?.uid) return;
    setSalvando(true);
    try {
      await salvaProfiloAulaStudio(db, user.uid, {
        tipoScuola,
        classe: classeScelta.trim(),
        numeroRegistro: numeroRegistro.trim(),
        nomeStudente: nomeStudente.trim(),
        cognomeStudente: cognomeStudente.trim(),
      });
      onProfiloAulaStudioSalvato();
    } catch (e: any) {
      mostraAlert(t('errore', lang), e?.message || t('aulaStudioErroreGenerico', lang));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.titolo}>{t('aulaStudioRegistrazioneTitolo', lang)}</Text>
      <Text style={styles.sottotitolo}>{t('aulaStudioRegistrazioneSottotitolo', lang)}</Text>

      <View style={styles.passiRiga}>
        {[1, 2, 3].map((n) => (
          <View key={n} style={styles.passoWrap}>
            <View style={[styles.passoCerchio, passo >= n && styles.passoCerchioAttivo]}>
              <Text style={[styles.passoCerchioText, passo >= n && styles.passoCerchioTextAttivo]}>{n}</Text>
            </View>
            {n < 3 && <View style={[styles.passoLinea, passo > n && styles.passoLineaAttiva]} />}
          </View>
        ))}
      </View>

      {passo === 1 && (
        <View>
          <Text style={styles.etichetta}>{t('aulaStudioSceglieTipoScuola', lang)}</Text>
          <View style={styles.rigaScelte}>
            <TouchableOpacity style={styles.cartaScelta} onPress={() => vaiPasso2('medie')}>
              <Text style={styles.cartaSceltaText}>{t('aulaStudioTipoMedie', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cartaScelta} onPress={() => vaiPasso2('ipi')}>
              <Text style={styles.cartaSceltaText}>{t('aulaStudioTipoIpi', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {passo === 2 && (
        <View>
          <TouchableOpacity style={styles.linkIndietro} onPress={() => setPasso(1)}>
            <Text style={styles.linkIndietroText}>‹ {t('torna', lang)}</Text>
          </TouchableOpacity>
          <Text style={styles.etichetta}>{t('aulaStudioClasse', lang)}</Text>
          <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setDropdownClasseAperto(true)}>
            <Text style={styles.dropdownTriggerText}>{classeScelta || t('aulaStudioSceglieClasse', lang)}</Text>
            <Text style={styles.dropdownArrow}>▼</Text>
          </TouchableOpacity>

          <Modal visible={dropdownClasseAperto} animationType="fade" transparent onRequestClose={() => setDropdownClasseAperto(false)}>
            <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setDropdownClasseAperto(false)}>
              <View style={styles.dropdownOptionsList}>
                {classiFiltrate.length === 0 ? (
                  <Text style={styles.testoInfo}>{t('aulaStudioNessunaClasseDisponibile', lang)}</Text>
                ) : (
                  classiFiltrate.map((c) => {
                    const attivo = classeScelta === c.nome;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]}
                        onPress={() => {
                          setClasseScelta(c.nome);
                          setDropdownClasseAperto(false);
                        }}
                      >
                        <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{c.nome}</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </TouchableOpacity>
          </Modal>

          <TouchableOpacity style={styles.bottonePrimario} onPress={vaiPasso3}>
            <Text style={styles.bottonePrimarioText}>{t('avanti', lang)}</Text>
          </TouchableOpacity>
        </View>
      )}

      {passo === 3 && (
        <View>
          <TouchableOpacity style={styles.linkIndietro} onPress={() => setPasso(2)}>
            <Text style={styles.linkIndietroText}>‹ {t('torna', lang)}</Text>
          </TouchableOpacity>

          <Text style={styles.etichetta}>{t('aulaStudioNumeroInClasse', lang)}</Text>
          <TextInput
            style={styles.input}
            value={numeroRegistro}
            onChangeText={setNumeroRegistro}
            placeholder="12"
            placeholderTextColor={colors.placeholder}
            keyboardType="number-pad"
          />

          <Text style={styles.etichetta}>{t('nomeCognome', lang)}</Text>
          <View style={styles.rigaDue}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={nomeStudente}
              onChangeText={setNomeStudente}
              placeholder={t('nome', lang) || 'Nome'}
              placeholderTextColor={colors.placeholder}
            />
            <TextInput
              style={[styles.input, { flex: 1, marginLeft: 8 }]}
              value={cognomeStudente}
              onChangeText={setCognomeStudente}
              placeholder={t('cognome', lang) || 'Cognome'}
              placeholderTextColor={colors.placeholder}
            />
          </View>

          <View style={styles.riepilogoBox}>
            <Text style={styles.riepilogoRiga}>
              {tipoScuola === 'medie' ? t('aulaStudioTipoMedie', lang) : t('aulaStudioTipoIpi', lang)} · {classeScelta}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.bottonePrimario, salvando && { opacity: 0.6 }]}
            onPress={confermaRegistrazione}
            disabled={salvando}
          >
            {salvando ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.bottonePrimarioText}>{t('aulaStudioConfermaRegistrazione', lang)}</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    titolo: { fontSize: 22, fontWeight: '700', color: colors.textMain, marginBottom: 4 },
    sottotitolo: { color: colors.textMuted, fontSize: 13, marginBottom: 20 },
    passiRiga: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
    passoWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    passoCerchio: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    passoCerchioAttivo: { backgroundColor: colors.primary, borderColor: colors.primary },
    passoCerchioText: { color: colors.textMuted, fontWeight: '700', fontSize: 12 },
    passoCerchioTextAttivo: { color: colors.primaryText },
    passoLinea: { flex: 1, height: 2, backgroundColor: colors.border, marginHorizontal: 4 },
    passoLineaAttiva: { backgroundColor: colors.primary },
    etichetta: { color: colors.textSub, fontWeight: '600', marginBottom: 8, marginTop: 14, fontSize: 13 },
    testoInfo: { color: colors.textMuted, fontSize: 13, padding: 8 },
    rigaScelte: { flexDirection: 'row', gap: 12, marginTop: 4 },
    cartaScelta: {
      flex: 1,
      paddingVertical: 26,
      borderRadius: 14,
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
    },
    cartaSceltaText: { color: colors.textMain, fontWeight: '700', fontSize: 16 },
    linkIndietro: { marginBottom: 6 },
    linkIndietroText: { color: colors.primary, fontWeight: '600' },
    dropdownTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 16,
    },
    dropdownTriggerText: { color: colors.textMain, fontSize: 14, fontWeight: '600' },
    dropdownArrow: { color: colors.textMuted, fontSize: 12 },
    overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
    dropdownOptionsList: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 8,
      maxWidth: 340,
      width: '90%',
      maxHeight: '70%',
      alignSelf: 'center',
    },
    dropdownOption: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8 },
    dropdownOptionActive: { backgroundColor: colors.primary },
    dropdownOptionText: { color: colors.textMain, fontSize: 15 },
    dropdownOptionTextActive: { color: colors.primaryText, fontWeight: '700' },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.textMain,
      backgroundColor: colors.surface,
    },
    rigaDue: { flexDirection: 'row' },
    riepilogoBox: { backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 12, marginTop: 16 },
    riepilogoRiga: { color: colors.textSub, fontWeight: '600' },
    bottonePrimario: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
    bottonePrimarioText: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
  });
