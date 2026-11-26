// ============================================================================
// AGGIORNAMENTI DELL'APP (solo Android/iOS, non sul web)
//
// 1) Aggiornamenti "over the air" (EAS Update, pacchetto expo-updates):
//    a ogni apertura l'app controlla da sola se c'è una versione nuova del
//    codice e la scarica in background (app.json → updates.checkAutomatically
//    ON_LOAD). Qui in più: controllo anche quando l'app torna in primo piano,
//    e una barra "Aggiorna ora" per applicarla subito senza chiudere l'app.
//    Si pubblica con:  eas update --channel production --message "..." --environment production
//
// 2) Nuovo APK necessario (cambi nativi): il Direttore indica in Impostazioni
//    → Manuali la versione dell'ultimo APK e il link della pagina di download
//    (documento Firestore configurazione/app). Chi ha una versione più vecchia
//    vede una barra con il pulsante per scaricarla.
// ============================================================================
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';

const COLLEZIONE = 'configurazione';
const DOC_APP = 'app';

/** Versione dell'app installata (campo "version" di app.json al momento della build). */
export const VERSIONE_APP: string = Constants.expoConfig?.version || '0.0.0';

/** true se a è una versione più recente di b (formato "1.2.3"). */
export function versionePiuRecente(a: string, b: string): boolean {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

interface DatiVersioneApp {
  versioneApk?: string;
  linkDownloadApk?: string;
}

type Lingua = 'it' | 'ar';

// ---------------------------------------------------------------------------
// Barra in cima alla schermata principale
// ---------------------------------------------------------------------------

export function BarraAggiornamentiApp({ db, lang, colors }: { db: Firestore; lang: Lingua; colors: Record<string, string> }) {
  if (Platform.OS === 'web') return null;
  return <BarraAggiornamentiNative db={db} lang={lang} colors={colors} />;
}

function BarraAggiornamentiNative({ db, lang, colors }: { db: Firestore; lang: Lingua; colors: Record<string, string> }) {
  const { isUpdatePending } = Updates.useUpdates();
  const [apkNuovo, setApkNuovo] = useState<DatiVersioneApp | null>(null);
  const [apkNascosto, setApkNascosto] = useState(false);

  // Oltre al controllo automatico all'apertura: ricontrolla quando l'app torna in primo piano.
  useEffect(() => {
    if (!Updates.isEnabled) return;
    const controlla = async () => {
      try {
        const risultato = await Updates.checkForUpdateAsync();
        if (risultato.isAvailable) await Updates.fetchUpdateAsync();
      } catch (e) {
        // Nessuna rete o modalità sviluppo: si riprova alla prossima occasione.
      }
    };
    const sub = AppState.addEventListener('change', (stato) => {
      if (stato === 'active') controlla();
    });
    return () => sub.remove();
  }, []);

  // C'è un APK più nuovo da scaricare?
  useEffect(() => {
    getDoc(doc(db, COLLEZIONE, DOC_APP))
      .then((snap) => {
        const dati = (snap.exists() ? snap.data() : {}) as DatiVersioneApp;
        if (dati.versioneApk && dati.linkDownloadApk && versionePiuRecente(dati.versioneApk, VERSIONE_APP)) {
          setApkNuovo(dati);
        }
      })
      .catch(() => {});
  }, [db]);

  const styles = getStyles(colors);

  if (isUpdatePending) {
    return (
      <View style={styles.barra}>
        <Text style={styles.testo}>
          {lang === 'ar' ? 'تحديث جديد للتطبيق جاهز.' : "È pronto un aggiornamento dell'app."}
        </Text>
        <TouchableOpacity style={styles.bottone} onPress={() => Updates.reloadAsync().catch(() => {})}>
          <Text style={styles.bottoneTesto}>{lang === 'ar' ? 'تحديث الآن' : 'Aggiorna ora'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (apkNuovo && !apkNascosto) {
    return (
      <View style={styles.barra}>
        <Text style={styles.testo}>
          {lang === 'ar'
            ? `يتوفر إصدار جديد من التطبيق (${apkNuovo.versioneApk}). قم بتنزيله وتثبيته.`
            : `È disponibile una nuova versione dell'app (${apkNuovo.versioneApk}): scaricala e installala.`}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={styles.bottone} onPress={() => Linking.openURL(apkNuovo.linkDownloadApk!).catch(() => {})}>
            <Text style={styles.bottoneTesto}>{lang === 'ar' ? 'تنزيل' : 'Scarica'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottoneSecondario} onPress={() => setApkNascosto(true)}>
            <Text style={styles.bottoneSecondarioTesto}>{lang === 'ar' ? 'لاحقًا' : 'Più tardi'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Editor per il Direttore (Impostazioni → Manuali, sul web)
// ---------------------------------------------------------------------------

export function EditorVersioneApk({
  db,
  lang,
  colors,
  mostraAlert,
}: {
  db: Firestore;
  lang: Lingua;
  colors: Record<string, string>;
  mostraAlert: (titolo: string, messaggio: string) => void;
}) {
  const [versione, setVersione] = useState('');
  const [link, setLink] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    getDoc(doc(db, COLLEZIONE, DOC_APP))
      .then((snap) => {
        const dati = (snap.exists() ? snap.data() : {}) as DatiVersioneApp;
        setVersione(dati.versioneApk || '');
        setLink(dati.linkDownloadApk || '');
      })
      .catch(() => {});
  }, [db]);

  const salva = async () => {
    const v = versione.trim();
    const l = link.trim();
    if (!/^\d+(\.\d+){0,2}$/.test(v)) {
      mostraAlert('', lang === 'ar' ? 'أدخل رقم إصدار صحيح، مثل 1.1.0' : 'Inserisci un numero di versione valido, per esempio 1.1.0.');
      return;
    }
    if (!/^https?:\/\//.test(l)) {
      mostraAlert('', lang === 'ar' ? 'أدخل رابطًا يبدأ بـ https://' : 'Inserisci un link che inizi con https://');
      return;
    }
    setSalvando(true);
    try {
      await setDoc(doc(db, COLLEZIONE, DOC_APP), { versioneApk: v, linkDownloadApk: l, aggiornatoIl: new Date().toISOString() }, { merge: true });
      mostraAlert('', lang === 'ar' ? 'تم الحفظ.' : 'Salvato.');
    } catch (e: any) {
      mostraAlert('', e?.message || 'Errore');
    } finally {
      setSalvando(false);
    }
  };

  const styles = getStyles(colors);
  return (
    <View style={styles.editor}>
      <Text style={styles.editorTitolo}>{lang === 'ar' ? 'إصدار تطبيق أندرويد' : 'Versione app Android'}</Text>
      <Text style={styles.editorSpiegazione}>
        {lang === 'ar'
          ? 'عند نشر ملف APK جديد، اكتب هنا رقم إصداره ورابط صفحة التنزيل: من لديه إصدار أقدم سيرى رسالة للتنزيل.'
          : "Quando pubblichi un nuovo APK, scrivi qui il suo numero di versione e il link della pagina di download: chi ha una versione più vecchia vedrà un avviso per scaricarla."}
      </Text>
      <TextInput
        style={styles.input}
        placeholder={lang === 'ar' ? 'رقم الإصدار (مثال 1.1.0)' : 'Versione (es. 1.1.0)'}
        placeholderTextColor={colors.placeholder}
        value={versione}
        onChangeText={setVersione}
      />
      <TextInput
        style={styles.input}
        placeholder={lang === 'ar' ? 'رابط صفحة التنزيل' : 'Link della pagina di download'}
        placeholderTextColor={colors.placeholder}
        value={link}
        onChangeText={setLink}
        autoCapitalize="none"
      />
      <TouchableOpacity style={[styles.bottone, { alignSelf: 'flex-start' }, salvando && { opacity: 0.6 }]} onPress={salva} disabled={salvando}>
        <Text style={styles.bottoneTesto}>{lang === 'ar' ? 'حفظ' : 'Salva'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors: Record<string, string>) =>
  StyleSheet.create({
    barra: {
      backgroundColor: colors.surfaceAlt,
      borderBottomWidth: 1,
      borderColor: colors.primary,
      paddingVertical: 10,
      paddingHorizontal: 16,
      gap: 8,
    },
    testo: { color: colors.textMain, fontSize: 14, fontWeight: '600' },
    bottone: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'flex-start' },
    bottoneTesto: { color: colors.primaryText, fontWeight: '700' },
    bottoneSecondario: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border },
    bottoneSecondarioTesto: { color: colors.textSub, fontWeight: '600' },
    editor: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderColor: colors.border, gap: 8 },
    editorTitolo: { color: colors.textMain, fontSize: 15, fontWeight: '700' },
    editorSpiegazione: { color: colors.textSub, fontSize: 13 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      color: colors.textMain,
      backgroundColor: colors.surface,
      maxWidth: 420,
    },
  });
