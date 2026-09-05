import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system/legacy';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, getMetadata, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as XLSX from 'xlsx';
import { auth, db, firebaseConfig, storage } from '../config/firebaseConfig';
import AulaStudioEsportaPanel from '@/components/aula-studio/aula-studio-esporta-panel';
import AulaStudioImpostazioni from '@/components/aula-studio/aula-studio-impostazioni';
import AulaStudioResponsabileView from '@/components/aula-studio/aula-studio-responsabile-view';
import AulaStudioStudentView from '@/components/aula-studio/aula-studio-student-view';
import AulaStudioTurniView from '@/components/aula-studio/aula-studio-turni-view';
import { puoGestireAulaStudio } from '@/components/aula-studio/aula-studio-constants';
import { salvaProfiloAulaStudio } from '@/components/aula-studio/aula-studio-data';
import { numArabo, dataArabo } from '@/utils/numeri-arabo';

/** Divide "Nome Cognome" nel modo più ragionevole: ultima parola = cognome, il resto = nome. */
function separaNomeCognomeAulaStudio(nomeCompleto) {
  const parti = (nomeCompleto || '').trim().split(/\s+/).filter(Boolean);
  if (parti.length <= 1) return { nome: parti[0] || '', cognome: '' };
  return { nome: parti.slice(0, -1).join(' '), cognome: parti[parti.length - 1] };
}

// MODIFICATO: endpoint della funzione serverless (Vercel) che cancella
// DEFINITIVAMENTE un utente (Firebase Authentication + Firestore).
// Dopo il deploy su Vercel, se il dominio del progetto è diverso da quello
// di default, aggiorna qui l'URL.
const DELETE_USER_API_URL = 'https://gestione-aule-dbalex.vercel.app/api/delete-user';

// ---- SFONDI E LOGHI ----
const SFONDO_LOGIN = require('../../assets/sfondo-login.jpg');
const SFONDO_LOGIN_MOBILE = require('../../assets/sfondo-login-mobile.png');
const LOGO_WATERMARK = require('../../assets/logo-watermark.png');

// Link fisso: punta sempre all'ultima release pubblicata su GitHub,
// a patto che il nome del file APK resti identico ad ogni aggiornamento.
const APK_DOWNLOAD_URL = 'https://github.com/georgesamirsobhi-ctrl/gestione-aule-dbalex./releases/latest/download/application-46bc2bf2-a990-48d0-8dcb-51b876c7336a.apk';

// Guida interattiva IT/AR per studenti, insegnanti e utenti: pagina statica
// pubblicata sullo stesso sito (cartella /public del progetto), autonoma da
// Claude — chiunque abbia il link la apre senza bisogno di alcun account.
const GUIDA_UTENTI_URL = 'https://gestione-aule-dbalex.vercel.app/guida.html';

// Manuale amministrativo (IT/AR): percorso su Firebase Storage dove il
// gestore può caricare/sostituire il file da Impostazioni → Manuali. Se non
// è mai stato caricato nulla (storage vuoto), si scarica invece la copia
// predefinita pubblicata insieme al sito (MANUALE_FALLBACK_URL).
const MANUALE_STORAGE_PATH = {
  it: 'manuali/manuale-amministrativo-it.docx',
  ar: 'manuali/manuale-amministrativo-ar.docx',
};
const MANUALE_FALLBACK_URL = {
  it: 'https://gestione-aule-dbalex.vercel.app/manuali/manuale-amministrativo-it.docx',
  ar: 'https://gestione-aule-dbalex.vercel.app/manuali/manuale-amministrativo-ar.docx',
};

// ---- COSTANTI ESISTENTI ----
const SEZIONI_INIZIALI = ['Scuola Base', 'Scuola Media', 'Scuola Professionale', 'Comuni'];
const FASCE_ORARIE = [
  '08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00',
  '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00',
  '18:00-19:00', '19:00-20:00', '20:00-21:00', '21:00-22:00'
];

const CATEGORIE_NOTIFICHE = {
  NUOVA_PRENOTAZIONE: 'nuova_prenotazione',
  ESITO_PRENOTAZIONE: 'esito_prenotazione',
  NUOVA_SEGNALAZIONE: 'nuova_segnalazione',
  INIZIO_LAVORO: 'inizio_lavoro',
  FINE_LAVORO: 'fine_lavoro',
  RICHIESTA_TURNO_AULA_STUDIO: 'richiesta_turno_aula_studio',
  ESITO_TURNO_AULA_STUDIO: 'esito_turno_aula_studio'
};

const ETICHETTE_CATEGORIE = {
  it: {
    [CATEGORIE_NOTIFICHE.NUOVA_PRENOTAZIONE]: 'Nuova richiesta prenotazione',
    [CATEGORIE_NOTIFICHE.ESITO_PRENOTAZIONE]: 'Esito prenotazione (approvata/rifiutata)',
    [CATEGORIE_NOTIFICHE.NUOVA_SEGNALAZIONE]: 'Nuova segnalazione guasto',
    [CATEGORIE_NOTIFICHE.INIZIO_LAVORO]: 'Inizio lavoro (presa in carico)',
    [CATEGORIE_NOTIFICHE.FINE_LAVORO]: 'Fine lavoro (segnalazione risolta)',
    [CATEGORIE_NOTIFICHE.RICHIESTA_TURNO_AULA_STUDIO]: 'Nuova richiesta di turno Aula Studio',
    [CATEGORIE_NOTIFICHE.ESITO_TURNO_AULA_STUDIO]: 'Esito richiesta di turno Aula Studio'
  },
  ar: {
    [CATEGORIE_NOTIFICHE.NUOVA_PRENOTAZIONE]: 'طلب حجز جديد',
    [CATEGORIE_NOTIFICHE.ESITO_PRENOTAZIONE]: 'نتيجة الحجز (موافقة/رفض)',
    [CATEGORIE_NOTIFICHE.NUOVA_SEGNALAZIONE]: 'بلاغ عطل جديد',
    [CATEGORIE_NOTIFICHE.INIZIO_LAVORO]: 'بدء العمل (استلام البلاغ)',
    [CATEGORIE_NOTIFICHE.FINE_LAVORO]: 'انتهاء العمل (تم حل البلاغ)',
    [CATEGORIE_NOTIFICHE.RICHIESTA_TURNO_AULA_STUDIO]: 'طلب مناوبة جديد في قاعة الدراسة',
    [CATEGORIE_NOTIFICHE.ESITO_TURNO_AULA_STUDIO]: 'نتيجة طلب المناوبة في قاعة الدراسة'
  }
};

const MESI_MASSIMI_PRENOTAZIONE = 2;
const MESI_MASSIMI_RIPETIZIONE = 12;

const ANDROID_STATUSBAR_HEIGHT = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;
const FONT_FAMILY = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  android: 'sans-serif',
  default: 'System'
});

/** Elenco classi predefinite (modificabili in futuro da Segreteria/Direttore) */
const CLASSI_DISPONIBILI = [
  '1A','1B','1C','1D','1E',
  '2A','2B','2C','2D','2E',
  '3A','3B','3C','3D','3E',
  '4A','4B','4C','4D','4E',
  '5A','5B','5C','5D','5E'
];

/** Genera automaticamente gli anni scolastici da quest'anno a +5 anni */
const generaAnniScolastici = () => {
  const annoCorrente = new Date().getFullYear();
  const anni: string[] = [];
  for (let i = 0; i <= 5; i++) {
    const anno = annoCorrente + i;
    anni.push(`${anno}-${anno + 1}`);
  }
  return anni;
};

/** Anno scolastico corrente calcolato automaticamente (si aggiorna da solo ogni anno) */
const annoScolasticoAttuale = () => {
  const annoCorrente = new Date().getFullYear();
  return `${annoCorrente}-${annoCorrente + 1}`;
};

/** Calcola l'età a partire dalla data di nascita (formato YYYY-MM-DD) */
const calcolaEta = (dataNascita) => {
  if (!dataNascita) return null;
  const oggi = new Date();
  const nascita = new Date(dataNascita);
  let eta = oggi.getFullYear() - nascita.getFullYear();
  const mese = oggi.getMonth() - nascita.getMonth();
  if (mese < 0 || (mese === 0 && oggi.getDate() < nascita.getDate())) {
    eta--;
  }
  return eta;
};

const RUOLI_TIPO_SEGRETERIA = ['segreteria', 'segreteriaSBase', 'presideIpi', 'vicePresideIpi', 'presideAbm', 'oratorio'];
// 'studente' e 'insegnante' sono ora ruoli veri e propri, selezionabili come tutti gli altri.
const RUOLI_TUTTI = ['utente', 'TEVT', 'studente', 'insegnante', 'gestore', 'economo', ...RUOLI_TIPO_SEGRETERIA, 'manutentore'];

// Funzioni di permesso esistenti
const puoGestireUtenti = (ruolo) => ruolo === 'gestore' || RUOLI_TIPO_SEGRETERIA.includes(ruolo);
const puoGestireDominiEmail = (ruolo) => ruolo === 'gestore' || RUOLI_TIPO_SEGRETERIA.includes(ruolo);
const puoApprovarePrenotazioni = (ruolo) => ruolo === 'gestore' || RUOLI_TIPO_SEGRETERIA.includes(ruolo);
const puoGestireAule = (ruolo) => ruolo === 'gestore' || RUOLI_TIPO_SEGRETERIA.includes(ruolo) || ruolo === 'economo';
const puoPrenotareAule = (ruolo) => !!ruolo;
const puoSegnalareGuasto = (ruolo) => !!ruolo;
const puoGestireManutenzione = (ruolo) => ruolo === 'gestore' || ruolo === 'economo' || ruolo === 'manutentore';
const puoEsportareUtentiPrenotazioni = (ruolo) => ruolo === 'gestore' || RUOLI_TIPO_SEGRETERIA.includes(ruolo);
const puoEsportarePrenotazioniSegnalazioni = (ruolo) => ruolo === 'gestore' || ruolo === 'economo';
const puoResettareDati = (ruolo) => ruolo === 'gestore';
const puoVedereRegistroAttivita = (ruolo) => ruolo === 'gestore' || ruolo === 'economo';

// NUOVE FUNZIONI PER PROFILI E CLASSI
const puoVedereProfili = (ruolo) => 
  ruolo === 'gestore' || 
  RUOLI_TIPO_SEGRETERIA.includes(ruolo) ||
  ruolo === 'presideAbm' ||
  ruolo === 'oratorio';

const puoModificareProfili = (ruolo) =>
  ruolo === 'gestore' ||
  ruolo === 'segreteria' ||
  ruolo === 'segreteriaSBase' ||
  ruolo === 'presideIpi' ||
  ruolo === 'vicePresideIpi';

const puoGestireClassi = (ruolo) =>
  ruolo === 'gestore' || ruolo === 'segreteria' || ruolo === 'segreteriaSBase';

const puoCreareRuoliPersonalizzati = (ruolo) => 
  ruolo === 'gestore' || RUOLI_TIPO_SEGRETERIA.includes(ruolo);

const puoAssegnarePermessiRuoliPersonalizzati = (ruolo) =>
  ruolo === 'gestore';

// Carica/sostituisce i due manuali amministrativi (IT/AR) mostrati come
// download nella schermata di accesso — riservato al gestore, come il reset dati.
const puoGestireManuali = (ruolo) => ruolo === 'gestore';

// Vede i due manuali amministrativi (IT/AR) come scelte di download nel
// pulsante "Manuali": gestore + staff di segreteria/direzione, che sono già
// gli stessi ruoli che gestiscono utenti e prenotazioni. Tutti gli altri
// ruoli (studenti, insegnanti, TEVT, utente generico) vedono nello stesso
// pulsante solo la guida interattiva, non i manuali amministrativi.
const puoVedereManualiAmministrativi = (ruolo) => ruolo === 'gestore' || RUOLI_TIPO_SEGRETERIA.includes(ruolo);

// Configurazione righe della tabella permessi (Impostazioni Avanzate).
// Ogni riga rappresenta un singolo permesso, raggruppato per categoria.
const RIGHE_TABELLA_PERMESSI = [
  { categoriaKey: 'sezStruttura', permessoKey: 'puoGestireAule', label: 'Gestire sezioni e aule', labelAr: 'إدارة الأقسام والقاعات', defaultFn: puoGestireAule },
  { categoriaKey: 'sezPrenotazioni', permessoKey: 'puoApprovarePrenotazioni', label: 'Approvare/rifiutare prenotazioni', labelAr: 'الموافقة على الحجوزات أو رفضها', defaultFn: puoApprovarePrenotazioni },
  { categoriaKey: 'sezManutenzione', permessoKey: 'puoGestireManutenzione', label: 'Gestire segnalazioni (stati, diario)', labelAr: 'إدارة البلاغات (الحالات، السجل اليومي)', defaultFn: puoGestireManutenzione },
  { categoriaKey: 'sezUtentiDomini', permessoKey: 'puoGestireUtenti', label: 'Gestire utenti (aggiungere, modificare ruoli, eliminare)', labelAr: 'إدارة المستخدمين (إضافة، تعديل الأدوار، حذف)', defaultFn: puoGestireUtenti },
  { categoriaKey: 'sezUtentiDomini', permessoKey: 'puoGestireDominiEmail', label: 'Gestire domini email consentiti', labelAr: 'إدارة نطاقات البريد الإلكتروني المسموح بها', defaultFn: puoGestireDominiEmail },
  { categoriaKey: 'sezBlocchi', permessoKey: 'puoGestireBlocchi', label: 'Bloccare/sbloccare utenti', labelAr: 'حظر/إلغاء حظر المستخدمين', defaultFn: puoGestireUtenti },
  { categoriaKey: 'sezReset', permessoKey: 'puoResettareDati', label: 'Eseguire reset dei dati (prenotazioni, manutenzione)', labelAr: 'إعادة تعيين البيانات (الحجوزات، الصيانة)', defaultFn: puoResettareDati },
  { categoriaKey: 'sezEsportazione', permessoKey: 'puoEsportareUtentiPrenotazioni', label: 'Esportare utenti e prenotazioni', labelAr: 'تصدير المستخدمين والحجوزات', defaultFn: puoEsportareUtentiPrenotazioni },
  { categoriaKey: 'sezEsportazione', permessoKey: 'puoEsportarePrenotazioniSegnalazioni', label: 'Esportare prenotazioni e segnalazioni di manutenzione', labelAr: 'تصدير الحجوزات وبلاغات الصيانة', defaultFn: puoEsportarePrenotazioniSegnalazioni },
  { categoriaKey: 'registroAttivita', permessoKey: 'puoVedereRegistroAttivita', label: 'Vedere ed esportare il registro attività', labelAr: 'عرض وتصدير سجل النشاط', defaultFn: puoVedereRegistroAttivita },
  { categoriaKey: 'profili', permessoKey: 'puoVedereProfili', label: 'Visualizzare la sezione Profili', labelAr: 'عرض قسم الملفات الشخصية', defaultFn: puoVedereProfili },
  { categoriaKey: 'profili', permessoKey: 'puoModificareProfili', label: 'Modificare i profili altrui', labelAr: 'تعديل ملفات المستخدمين الآخرين', defaultFn: puoModificareProfili },
  { categoriaKey: 'classi', permessoKey: 'puoGestireClassi', label: 'Gestire le classi (in Impostazioni)', labelAr: 'إدارة الفصول (في الإعدادات)', defaultFn: puoGestireClassi },
  { categoriaKey: 'sezRuoliPersonalizzati', permessoKey: 'puoCreareRuoliPersonalizzati', label: 'Creare ruoli personalizzati (in Aggiungi Utente)', labelAr: 'إنشاء أدوار مخصّصة (في إضافة مستخدم)', defaultFn: puoCreareRuoliPersonalizzati },
  { categoriaKey: 'sezRuoliPersonalizzati', permessoKey: 'puoAssegnarePermessiRuoliPersonalizzati', label: 'Assegnare permessi a ruoli personalizzati', labelAr: 'تعيين صلاحيات للأدوار المخصّصة', defaultFn: puoAssegnarePermessiRuoliPersonalizzati },
  { categoriaKey: 'sezAulaStudio', permessoKey: 'puoGestireAulaStudio', label: 'Gestire Aula Studio (appello, pallini, sanzioni, impostazioni)', labelAr: 'إدارة قاعة الدراسة (الحضور، النقاط، العقوبات، الإعدادات)', defaultFn: puoGestireAulaStudio },
  { categoriaKey: 'sezManuali', permessoKey: 'puoGestireManuali', label: 'Caricare i manuali amministrativi (IT/AR) mostrati nella schermata di accesso', labelAr: 'رفع الأدلة الإدارية (إيطالي/عربي) الظاهرة في شاشة الدخول', defaultFn: puoGestireManuali },
  { categoriaKey: 'sezManuali', permessoKey: 'puoVedereManualiAmministrativi', label: 'Vedere i manuali amministrativi (IT/AR) tra le scelte del pulsante "Manuali"', labelAr: 'رؤية الأدلة الإدارية (إيطالي/عربي) ضمن خيارات زر "الأدلة"', defaultFn: puoVedereManualiAmministrativi }
];

const NOMI_MESI = {
  it: {
    '01': 'Gennaio', '02': 'Febbraio', '03': 'Marzo', '04': 'Aprile',
    '05': 'Maggio', '06': 'Giugno', '07': 'Luglio', '08': 'Agosto',
    '09': 'Settembre', '10': 'Ottobre', '11': 'Novembre', '12': 'Dicembre'
  },
  ar: {
    '01': 'يناير', '02': 'فبراير', '03': 'مارس', '04': 'أبريل',
    '05': 'مايو', '06': 'يونيو', '07': 'يوليو', '08': 'أغسطس',
    '09': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر'
  }
};

const formattaMeseAnno = (ym, currentLang) => {
  if (!ym) return '';
  const [anno, mese] = ym.split('-');
  const mesi = NOMI_MESI[currentLang] || NOMI_MESI['it'];
  return `${mesi[mese] || mese} ${numArabo(anno, currentLang)}`;
};

const formattaDataOra = (iso, currentLang) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const gg = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const aaaa = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const testo = `${gg}/${mm}/${aaaa} ${hh}:${min}`;
  return numArabo(testo, currentLang);
};

const etichettaRuolo = (ruolo, currentLang) => {
  if (ruolo === 'studente') return currentLang === 'ar' ? 'طالب' : 'STUDENTE';
  if (ruolo === 'insegnante') return currentLang === 'ar' ? 'معلم' : 'INSEGNANTE';
  if (ruolo === 'gestore') return currentLang === 'ar' ? 'المدير' : 'DIRETTORE';
  if (ruolo === 'manutentore') return currentLang === 'ar' ? 'الصيانة / تقنية المعلومات' : 'MANUTENTORE / IT';
  if (ruolo === 'economo') return currentLang === 'ar' ? 'أمين الصندوق' : 'ECONOMO';
  if (ruolo === 'segreteria') return currentLang === 'ar' ? 'السكرتارية IPI' : 'SEGRETERIA IPI';
  if (ruolo === 'segreteriaSBase') return currentLang === 'ar' ? 'سكرتارية المدرسة الأساسية' : 'SEGRETERIA S. BASE';
  if (ruolo === 'presideIpi') return currentLang === 'ar' ? 'مدير المعهد IPI' : 'PRESIDE IPI';
  if (ruolo === 'vicePresideIpi') return currentLang === 'ar' ? 'نائب مدير المعهد IPI' : 'VICE PRESIDE IPI';
  if (ruolo === 'presideAbm') return currentLang === 'ar' ? 'مدير المدرسة الأساسية' : 'PRESIDE S. BASE';
  if (ruolo === 'oratorio') return currentLang === 'ar' ? 'الأوراتوريو' : 'ORATORIO';
  if (ruolo === 'TEVT') return currentLang === 'ar' ? 'TEVT' : 'TEVT';
  return currentLang === 'ar' ? 'مستخدم' : 'UTENTE';
};

const SEZIONI_TRADUZIONI_AR = {
  'Scuola Base': 'التعليم الأساسي',
  'Scuola Media': 'المدرسة الاعدادية',
  'Scuola Professionale': 'المعهد الصناعى',
  'Comuni': 'مناطق مشتركة'
};
const etichettaSezione = (nome, currentLang) => {
  if (!nome) return nome;
  if (currentLang === 'ar' && SEZIONI_TRADUZIONI_AR[nome]) return SEZIONI_TRADUZIONI_AR[nome];
  return nome;
};

const etichettaTipoGuasto = (tipo, currentLang) =>
  tipo === 'elettrico' ? t('elettrico', currentLang)
  : tipo === 'informatico' ? t('informatico', currentLang)
  : tipo === 'strutturale' ? t('strutturale', currentLang)
  : t('altroTipoGuasto', currentLang);

const GIORNI_SETTIMANA = {
  it: ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
};

const nomeGiornoSettimana = (dataStr, currentLang) => {
  if (!dataStr) return '';
  const d = new Date(dataStr + 'T00:00:00');
  const giorni = GIORNI_SETTIMANA[currentLang] || GIORNI_SETTIMANA['it'];
  return giorni[d.getDay()];
};

const generaDateRipetizione = (dataInizioObj, dataFineStr) => {
  const risultato: string[] = [];
  if (!dataFineStr) return risultato;
  let corrente = new Date(dataInizioObj);
  const fine = new Date(dataFineStr + 'T00:00:00');
  let sicurezza = 0;
  while (corrente <= fine && sicurezza < 104) {
    risultato.push(corrente.toISOString().split('T')[0]);
    corrente = new Date(corrente);
    corrente.setDate(corrente.getDate() + 7);
    sicurezza++;
  }
  return risultato;
};

const t = (key, lang, ...args) => {
  const dict = {
    it: {
      appName: 'Gestione Aule DBALEX',
      nomeCognome: 'Nome e Cognome',
      email: 'Email',
      password: 'Password',
      registrati: 'Registrati',
      accedi: 'Accedi',
      haiAccountAccedi: 'Hai un account? Accedi',
      nonHaiAccesso: "Non hai accesso a questa applicazione",
      esci: 'Esci',
      ruolo: 'Ruolo',
      verifEmailTitle: 'Verifica la tua email',
      verifEmailText: (emailUser) => `Abbiamo inviato un'email di conferma a\n${emailUser}.\nApri il link ricevuto per attivare l'account, poi torna qui.`,
      hoVerificato: 'Ho verificato, continua',
      nonRicevutoEmail: "Non hai ricevuto l'email? Invia di nuovo",
      navHome: 'Home',
      navCalendario: 'Calendario',
      navGestione: 'Gestione Prenotazioni',
      navUtenti: 'Utenti',
      navImpostazioni: 'Impostazioni',
      aggiungiSezione: '+ Aggiungi Sezione',
      nomeNuovaSezione: 'Nome nuova sezione',
      nomeNuovaSezioneAr: 'Nome sezione in arabo (opzionale)',
      nomeSezioneAr: 'Nome sezione in arabo (opzionale)',
      modificaSezioneTitolo: 'Modifica Sezione',
      nomeSezioneLabel: 'Nome Sezione:',
      elimina: '✕',
      modifica: 'Modifica',
      fine: 'Fine',
      prenota: 'Prenota',
      aggiungiAula: '+ Aggiungi Aula',
      capienza: 'Capienza',
      calendarioPubblico: 'Calendario Pubblico',
      prenotazioniPassate: (count) => `Prenotazioni passate (${count})`,
      tua: (stato) => `TUA (${stato})`,
      occupata: 'OCCUPATA',
      nessunaPrenotazione: 'Nessuna prenotazione in questa categoria.',
      inAttesa: 'In attesa',
      approvata: 'Approvata',
      rifiutata: 'Rifiutata',
      tutte: 'Tutte',
      approva: 'Approva',
      rifiuta: 'Rifiuta',
      utente: 'Utente',
      data: 'Data',
      ore: 'Ore',
      motivo: 'Motivo',
      classe: 'Classe',
      partecipanti: 'Partecipanti',
      stato: 'Stato',
      filtraPerUtente: 'Filtra per utente',
      filtraPerAula: 'Filtra per aula',
      filtraPerData: 'Filtra per data (AAAA-MM-GG)',
      aula: 'Aula',
      orario: 'Orario',
      azioni: 'Azioni',
      utentiEDomini: 'Utenti e Domini',
      listaAggiuntaUtenti: 'Lista e Aggiunta Utenti',
      permessiDomini: 'Permessi Domini',
      nome: 'Nome',
      cercaUtente: 'Cerca Utente (nome o email)',
      aggiungiUtente: '+ Aggiungi Utente',
      notaUtenteManuale: "Nota: L'aggiunta manuale inserisce l'utente nel database per la gestione dei ruoli. L'utente deve comunque registrarsi e creare una password.",
      inserisciNomeEmailPassword: 'Inserisci nome, email e password',
      passwordTroppoCorta: 'La password deve avere almeno 6 caratteri',
      accountCreatoConSuccesso: 'Account creato con successo',
      erroreCreazioneAccount: 'Errore nella creazione dell\'account',
      notaUtenteManualeBypass: "Il Gestore può creare account con qualsiasi email, anche fuori dai domini consentiti. All'utente arriverà un'email con un link per impostare la password; non è richiesta un'ulteriore verifica email.",
      eliminaUtenteAzione: 'Elimina',
      confermaEliminaUtenteMessaggio: (nome) => `Vuoi eliminare definitivamente ${nome}? Verrà rimosso sia dall'app sia dall'accesso Firebase: l'operazione non è reversibile.`,
      utenteRimossoDallaLista: "Utente eliminato definitivamente, sia dall'app che dall'accesso Firebase.",
      notaEliminaUtenteLista: "Eliminando un utente da qui lo elimini definitivamente: sia dalla lista (Firestore) sia dal suo accesso Firebase Authentication.",
      toccaRigaUtente: 'Tocca un utente per cambiare ruolo o eliminarlo',
      colonnaStatoEmail: 'Stato',
      scaricaAppAndroidTitolo: 'Preferisci l\'app? Scaricala per Android',
      scaricaAppAndroidPulsante: '📱 Scarica app Android (.apk)',
      manualiPulsanteLogin: 'Manuali',
      manualiSceltaTitolo: 'Manuali e guide',
      manualiGuidaInterattiva: 'Guida interattiva (Studenti, Insegnanti, Utenti)',
      manualiScaricaAmminIt: 'Manuale Amministrativo (Italiano)',
      manualiScaricaAmminAr: 'Manuale Amministrativo (Arabo)',
      menuManuali: 'Manuali',
      manualiImpostazioniSottotitolo: 'Carica qui i file mostrati nel pulsante "Manuali" della schermata di accesso. Chi non carica nulla, il pulsante mostra comunque la versione predefinita.',
      manualiTitoloIt: 'Manuale Amministrativo — Italiano',
      manualiTitoloAr: 'Manuale Amministrativo — Arabo',
      manualiCaricaNuovo: 'Carica nuovo file (.docx)',
      manualiSostituisci: 'Sostituisci file',
      manualiUltimoAggiornamento: (data) => `Ultimo aggiornamento: ${data}`,
      manualiNessunFileCaricato: 'Nessun file caricato: viene usata la versione predefinita.',
      manualiCaricamentoInCorso: 'Caricamento in corso…',
      manualiCaricatoConSuccesso: 'File caricato con successo.',
      manualiErroreCaricamento: 'Errore durante il caricamento. Riprova.',
      manualiFormatoNonValido: 'Seleziona un file Word (.doc o .docx).',
      manualiVerificaCaricamento: 'Controllo del file caricato…',
      emailVerificata: '✓ Attivo',
      emailNonVerificataBadge: '✕ Email non verificata',
      invitoInAttesa: '⏳ Invito in attesa',
      generaPassword: 'Genera',
      inviaInvito: 'Invia invito',
      rinviaInvito: 'Rinvia invito',
      invitoRinviato: "Email di invito inviata di nuovo",
      cambiaRuolo: 'Cambia Ruolo',
      aggiungiDominio: '+ Aggiungi Dominio',
      nessunDominio: 'Nessun dominio impostato: la registrazione è aperta a qualsiasi email.',
      classi: 'Classi',
      gestioneClassi: 'Gestione Classi',
      aggiungiClasse: '+ Aggiungi Classe',
      salvaClasse: 'Salva',
      annullaModifica: 'Annulla',
      nessunaClasse: 'Nessuna classe impostata.',
      confermaEliminazioneClasse: 'Eliminare questa classe? Non sarà più selezionabile per nuovi profili.',
      generaAnnoScolastico: 'Genera anno scolastico',
      rimuovi: '✕',
      dataMaxMesi: (mesi) => `Data (max ${mesi} mesi da oggi):`,
      fasceOrarie: 'Fasce Orarie (selezione multipla):',
      motivoUso: "Motivo dell'uso:",
      motivoObbligatorio: 'Motivo (obbligatorio)',
      insegnanteRiferimento: 'Insegnante di riferimento (facoltativo):',
      insegnanteRiferimentoPlaceholder: 'Nome insegnante (facoltativo)',
      nomeClasse: 'Nome della classe:',
      classeObbligatoriaCFP: 'Classe (obbligatorio per Scuola Professionale)',
      nomiPartecipanti: 'Nomi dei partecipanti:',
      aggiungiPartecipante: '+ Aggiungi partecipante',
      confermaPrenotazione: 'Conferma prenotazione',
      modificaAula: 'Modifica Aula',
      nuovaAula: 'Nuova Aula',
      salvaModifiche: 'Salva Modifiche',
      creaAula: 'Crea Aula',
      nomeAula: 'Nome Aula',
      nomeAulaAr: 'Nome aula in arabo (opzionale)',
      nomeAulaArPlaceholder: 'Nome aula in arabo (opzionale)',
      accessoRiservato: 'Accesso riservato ai gestori',
      annulla: 'Annulla',
      cancella: 'Cancella',
      conferma: 'Conferma',
      attenzione: 'Attenzione',
      compilaTuttiICampi: 'Compila tutti i campi.',
      erroreDiAccesso: 'Errore di Accesso',
      credenzialiNonValide: "Credenziali non valide. Assicurati che l'utente esista e che la password sia corretta (attenzione agli spazi).",
      emailGiaRegistrata: 'Email già registrata',
      errore: 'Errore',
      emailInviataDiNuovo: "Email di verifica inviata di nuovo. Controlla anche lo spam.",
      emailNonVerificataAncora: "L'email non risulta ancora verificata. Apri il link ricevuto e riprova.",
      cancellata: 'Cancellata.',
      sicuroDiCancellare: 'Sicuro di cancellare?',
      haiGiaUnaRichiesta: "Hai già una richiesta/prenotazione per questa data e fascia oraria in un'altra aula.",
      richiestaInviata: 'Richiesta Inviata!',
      ripetiSettimanalmente: 'Ripeti ogni settimana',
      finoAl: 'Fino al:',
      ripetizioneRiepilogo: (n, giorno) => `Verranno create ${n} richieste, ogni ${giorno}.`,
      dataFineRipetizioneObbligatoria: 'Seleziona fino a quando ripetere la prenotazione.',
      avvisoAutorizzazioneSpeciale: "Superi il limite normale delle prenotazioni singole: questa richiesta necessita di un'autorizzazione speciale da parte del gestore. La richiesta seguirà comunque il normale iter di approvazione.",
      prenotazioniSpeciali: 'Prenotazioni Speciali',
      etichettaSpeciale: 'SPECIALE',
      speciali: 'Speciali',
      legendaNessunaAttesa: 'Nessuna in attesa',
      legendaInAttesa: 'Prenotazioni in attesa',
      torna: 'Indietro',
      dataFineDeveEssereSuccessiva: "La data di fine deve essere successiva alla data d'inizio.",
      richiesteRipetuteInviate: (n) => `${n} richieste inviate!`,
      alcuneDateSaltate: (n) => ` (${n} date saltate perché l'aula era già occupata da un altro utente)`,
      bloccaAula: 'Blocca',
      bloccaAulaTitolo: (nome) => `Blocca ${nome}`,
      bloccaAulaSpiegazione: "Rende l'aula non prenotabile in tutte le fasce orarie per l'intero periodo scelto (es. per lavori, uso riservato, chiusura stagionale). Non è limitato ai mesi previsti per le prenotazioni normali.",
      dataInizioBlocco: 'Data inizio blocco:',
      dataFineBlocco: 'Data fine blocco:',
      motivoBloccoPlaceholder: 'es. Lavori di manutenzione, uso riservato...',
      confermaBlocco: 'Conferma Blocco',
      compilaDateBlocco: "Seleziona la data d'inizio e la data di fine del blocco.",
      dataFineBloccoSuccessiva: "La data di fine deve essere successiva o uguale alla data d'inizio.",
      motivoBloccoObbligatorio: 'Inserisci il motivo del blocco.',
      bloccoCreato: (n) => `Aula bloccata per ${n} giorni.`,
      troppiGiorniBlocco: 'Periodo troppo lungo: massimo 2 anni.',
      bloccatoDalGestore: 'Bloccato dal Direttore',
      inserisciNomeCapienza: "Inserisci nome e capienza dell'aula.",
      eliminareAulaConferma: "Eliminare questa aula? Le eventuali prenotazioni collegate resteranno storicizzate.",
      nonPuoiEliminareTuoAccount: 'Non puoi eliminare il tuo stesso account.',
      eliminareUtenteConferma: 'Eliminare questo utente?',
      eliminareSezioneConferma: "Eliminare questa sezione? Le aule ed eventuali prenotazioni collegate resteranno storicizzate.",
      emailGiaRegistrataDettaglio: 'Questo indirizzo email existe già in Firebase Authentication.',
      nessunUtenteAutenticato: 'Nessun utente autenticato al momento.',
      compilaMotivoFascia: 'Compila il motivo e seleziona almeno una fascia oraria.',
      classeObbligatoriaMessaggio: 'Il nome della classe è obbligatorio per la Scuola Professionale.',
      domandaStudenteIPI: 'Sei uno studente IPI?',
      sonoStudenteIPI: 'Sono uno studente (IPI)',
      nonSonoStudenteIPI: 'Non sono uno studente (IPI)',
      studenteIPIObbligatorioMessaggio: 'Indica se sei uno studente IPI prima di procedere.',
      inserisciNomeEmail: 'Inserisci nome ed email.',
      passwordDimenticata: 'Password dimenticata?',
      inserisciEmailPrimaReset: 'Scrivi la tua email nel campo sopra, poi tocca di nuovo questo link.',
      emailResetInviata: 'Ti abbiamo inviato un\'email per reimpostare la password. Controlla la posta in arrivo (anche lo spam).',
      emailNonRegistrataReset: 'Non esiste nessun account con questa email.',
      areaResetGestore: '( RESET )',
      areaBloccaGestore: 'Blocca',
      bloccaSceltaModalita: 'Blocca o sblocca utenti registrati in:',
      bloccaUtentiAzione: 'Blocca utenti del periodo',
      sbloccaUtentiAzione: 'Sblocca utenti del periodo',
      confermaBloccoUtentiTitolo: 'Conferma blocco',
      confermaBloccoUtentiMessaggio: 'Vuoi bloccare tutti gli utenti registrati nel periodo selezionato? Non potranno più accedere né usare l\'app finché non li sblocchi.',
      confermaSbloccoUtentiTitolo: 'Conferma sblocco',
      confermaSbloccoUtentiMessaggio: 'Vuoi sbloccare tutti gli utenti registrati nel periodo selezionato?',
      bloccoUtentiCompletato: (n) => n > 0 ? `${n} utenti bloccati.` : 'Nessun utente da bloccare in questo periodo.',
      sbloccoUtentiCompletato: (n) => n > 0 ? `${n} utenti sbloccati.` : 'Nessun utente da sbloccare in questo periodo.',
      accountBloccatoMessaggio: 'Il tuo account è stato bloccato. Contatta un gestore per maggiori informazioni.',
      utenteBloccatoBadge: 'Bloccato',
      cercaUtenteBlocco: 'Cerca per nome o email...',
      nessunUtenteTrovatoBlocco: 'Nessun utente trovato.',
      bloccaSingolo: 'Blocca',
      sbloccaSingolo: 'Sblocca',
      confermaBloccoSingoloTitolo: 'Conferma blocco',
      confermaBloccoSingoloMessaggio: (nome) => `Vuoi bloccare ${nome}? Non potrà più accedere né usare l'app finché non lo sblocchi.`,
      confermaSbloccoSingoloTitolo: 'Conferma sblocco',
      confermaSbloccoSingoloMessaggio: (nome) => `Vuoi sbloccare ${nome}?`,
      bloccoSingoloCompletato: (nome) => `${nome} bloccato.`,
      sbloccoSingoloCompletato: (nome) => `${nome} sbloccato.`,
      elencoUtentiPeriodo: 'Utenti registrati nel periodo selezionato',
      nessunUtentePeriodo: 'Nessun utente registrato in questo periodo.',
      colonnaRegistrazione: 'Registrazione',
      colonnaRuolo: 'Ruolo',
      colonnaAzione: 'Azione',
      toccaPerDettagli: 'Tocca una riga per vedere email, data e azione',
      nonPuoiRimuovereUltimoGestore: 'Non puoi togliere il ruolo di Direttore: è l\'ultimo rimasto. Assegna il ruolo di Direttore a un altro utente prima di cambiare questo.',
      selezionaModalitaReset: 'Seleziona modalità di reset:',
      resetSceltaTipo: 'Cosa vuoi resettare?',
      resetTipoPrenotazioni: 'Prenotazioni',
      resetTipoManutenzione: 'Segnalazioni Manutenzione',
      resetTipoUtenti: 'Utenti',
      impostazioniMenuSottotitolo: 'Tocca una voce per aprirla',
      eseguiResetManutenzione: 'Esegui Reset Segnalazioni Manutenzione',
      mensile: 'Mensile',
      annuale: 'Annuale',
      selezionaMese: 'Seleziona mese:',
      selezionaAnno: 'Inserisci o seleziona anno (es. 2026):',
      eseguiReset: 'Esegui Reset Prenotazioni',
      confermaResetTitolo: 'Conferma Reset',
      confermaResetMessaggio: 'Sei sicuro di voler eliminare tutte le prenotazioni per il periodo selezionato? Questa operazione non può essere annullata.',
      resetCompletato: 'Reset completato con successo.',
      eliminaBlocco: 'Elimina blocco',
      eliminareGruppoConferma: (n) => `Eliminare tutte le ${n} prenotazioni di questo blocco ripetuto? L'operazione non può essere annullata.`,
      navManutenzione: 'Manutenzione',
      confermaEliminaArchivioManutenzione: (n) => `Eliminare le ${n} segnalazioni archiviate nel periodo selezionato? L'operazione non può essere annullata.`,
      archivioManutenzioneEliminato: (n) => n > 0 ? `${n} segnalazioni eliminate dall'archivio.` : 'Nessuna segnalazione da eliminare in questo periodo.',
      nuovaSegnalazione: '+ Nuova Segnalazione',
      segnalaGuasto: 'Segnala un guasto',
      selezionaAula: 'Seleziona aula',
      selezionaAulaManutenzione: "Seleziona prima l'aula.",
      tipoGuasto: 'Tipo di guasto',
      elettrico: 'Elettrico',
      informatico: 'Informatico',
      strutturale: 'Strutturale',
      altroTipoGuasto: 'Altro',
      selezionaTipoGuasto: 'Seleziona il tipo di guasto.',
      descrizioneGuastoLabel: 'Descrizione del problema:',
      descrizioneGuastoPlaceholder: 'Descrivi il problema in dettaglio (obbligatorio)',
      descrizioneObbligatoriaMessaggio: 'La descrizione del guasto è obbligatoria.',
      inviaSegnalazione: 'Invia Segnalazione',
      segnalazioneInviata: 'Segnalazione inviata!',
      segnalatoDa: 'Segnalato da',
      daRisolvere: 'Da risolvere',
      risolto: 'Risolto',
      segnaComeRisolto: 'Segna come Risolto',
      segnaComeDaRisolvere: 'Segna come Da risolvere',
      nessunaSegnalazione: 'Nessuna segnalazione in questa categoria.',
      ruoloManutentore: 'MANUTENTORE / IT',
      scegliRuolo: 'Scegli il ruolo',
      inLavorazione: 'Presa in carico',
      segnaComeInLavorazione: 'Presa in carico',
      riportaADaRisolvere: 'Riporta a Da risolvere',
      dettaglioSegnalazione: 'Dettaglio segnalazione',
      colAula: 'Aula',
      colSegnalatoDa: 'Segnalato da',
      colTipoGuasto: 'Tipo guasto',
      colStato: 'Stato',
      colData: 'Data',
      storicoTempistiche: 'Storico tempistiche',
      segnalatoIl: 'Segnalato il',
      presoInCaricoIl: 'Preso in carico il',
      risoltoIl: 'Risolto il',
      nonAncora: 'Non ancora',
      diarioLavoro: 'Diario di Lavoro',
      diarioVuoto: 'Nessun aggiornamento inserito.',
      diarioPlaceholder: "Scrivi un aggiornamento sull'intervento...",
      aggiungiAggiornamento: 'Aggiungi',
      esportaExcel: 'Esporta Excel',
      esportazioneNonDisponibile: 'Esportazione Excel non disponibile su questo dispositivo.',
      notifiche: 'Notifiche',
      centroNotifiche: 'Centro Notifiche',
      nessunaNotifica: 'Nessuna notifica per ora.',
      segnaTutteLette: 'Segna tutte come lette',
      notificaApprovataTitolo: (aula) => `Prenotazione approvata: ${aula}`,
      notificaRifiutataTitolo: (aula) => `Prenotazione rifiutata: ${aula}`,
      notificaApprovataCorpo: (aula, data, ore) => `La tua richiesta per "${aula}" del ${data} (${ore}) è stata approvata.`,
      notificaRifiutataCorpo: (aula, data, ore) => `La tua richiesta per "${aula}" del ${data} (${ore}) è stata rifiutata.`,
      notifichePrenotazioniAttive: 'Notifiche prenotazioni',
      notifichePrenotazioniSpiegazione: 'Se disattivate, le notifiche sulle prenotazioni resteranno comunque visibili nel Centro Notifiche in-app, ma non riceverai più il banner/suono sul telefono.',
      notificheSegnalazioniAttive: 'Notifiche segnalazioni',
      notificheSegnalazioniSpiegazione: 'Se disattivate, le notifiche sulle segnalazioni di manutenzione resteranno comunque visibili nel Centro Notifiche in-app, ma non riceverai più il banner/suono sul telefono.',
      notificaNuovaSegnalazioneTitolo: (aula) => `Nuova segnalazione: ${aula}`,
      notificaNuovaSegnalazioneCorpo: (utente, aula, guasto) => `${utente} ha segnalato un guasto ("${guasto}") in "${aula}".`,
      notificaSegnalazioneInLavorazioneTitolo: (aula) => `Segnalazione presa in carico: ${aula}`,
      notificaSegnalazioneInLavorazioneCorpo: (aula) => `La tua segnalazione per "${aula}" è stata presa in carico.`,
      notificaSegnalazioneRisoltaTitolo: (aula) => `Segnalazione risolta: ${aula}`,
      notificaSegnalazioneRisoltaCorpo: (aula) => `La tua segnalazione per "${aula}" è stata risolta.`,
      sbloccoImpronta: 'Sblocco con impronta',
      sbloccoImprontaSpiegazione: 'Quando riapri l\'app dovrai sbloccarla con l\'impronta digitale (o il riconoscimento del volto) invece di reinserire la password.',
      sbloccoImprontaNonDisponibile: 'Il tuo dispositivo non ha un\'impronta digitale (o volto) configurata nelle impostazioni del telefono. Configurala prima di attivare questa opzione.',
      sbloccoImprontaPrompt: 'Sblocca Gestione Aule DBALEX',
      sbloccoImprontaSchermataTesto: 'App bloccata. Usa l\'impronta digitale per continuare.',
      sbloccoImprontaSchermataPulsante: 'Sblocca con impronta',
      preferenze: 'Preferenze',
      aspetto: 'Aspetto',
      modalitaScuraAttiva: 'Modalità scura',
      modalitaChiaraAttiva: 'Modalità chiara',
      lingua: 'Lingua',
      sezioneNotifiche: 'Notifiche',
      gruppoNotifichePrenotazione: 'Prenotazione',
      gruppoNotificheManutenzione: 'Manutenzione',
      gruppoNotificheAulaStudio: 'Aula Studio',
      sezioneGestioneUtenti: 'Gestione Utenti',
      notificaNuovaRichiestaTitolo: (aula) => `Nuova richiesta prenotazione: ${aula}`,
      notificaNuovaRichiestaCorpo: (utente, aula, data) => `${utente} ha richiesto "${aula}" per il ${data}.`,
      areaEsportaGestore: 'Esporta',
      esportaExcelDettagliato: 'Esporta Excel Dettagliato',
      esportazioneInCorso: 'Generazione del file in corso...',
      esportazioneCompletata: (n) => `Esportazione completata: ${n} record inclusi.`,
      nessunDatoDaEsportare: 'Nessun dato da esportare per il periodo selezionato.',
      erroreEsportazione: "Si è verificato un errore durante l'esportazione.",
      colFasceOrarie: 'Fasce Orarie',
      colRichiestoDa: 'Richiesto da',
      colSpeciale: 'Speciale',
      colRipetizione: 'Ripetizione settimanale',
      colDescrizioneGuasto: 'Descrizione',
      colDataSegnalazione: 'Data/ora segnalazione',
      colDataPresaInCarico: 'Data/ora presa in carico',
      colDataRisoluzione: 'Data/ora risoluzione',
      registroAttivita: 'Registro Attività',
      esportaRegistro: 'Esporta Registro Attività',
      colTipoAzione: 'Tipo azione',
      colDettaglio: 'Dettaglio',
      nessunaAttivita: 'Nessuna attività registrata per i filtri selezionati.',
      // NUOVE TRADUZIONI PER PROFILI
      profili: 'Profili',
      notaClicRigaProfilo: 'Tocca la riga di un utente per visualizzare o modificare il suo profilo.',
      modificaProfilo: 'Modifica Profilo',
      profiloPersonale: 'Il mio profilo',
      cambiaRuoloDaGestioneUtenti: 'Il ruolo si modifica dalla sezione Gestione Utenti.',
      studente: 'Studente',
      insegnante: 'Insegnante',
      annoScolastico: 'Anno scolastico',
      dataNascita: 'Data di nascita',
      eta: 'Età',
      dataRegistrazione: 'Data registrazione',
      completaProfilo: 'Completa il tuo profilo',
      scegliTipo: 'Scegli il tipo di utente',
      dataScadenza: 'Data di scadenza',
      profiloScaduto: 'Il tuo profilo è scaduto il',
      profiloTemporaneo: 'Profilo temporaneo',
      finoA: 'Fino al',
      nessunProfilo: 'Nessun profilo disponibile',
      filtraNomeEmail: 'Filtra per nome o email',
      filtraRuolo: 'Filtra per ruolo',
      filtraClasse: 'Filtra per classe',
      filtraAnno: 'Filtra per anno scolastico',
      reimpostaFiltri: 'Reimposta filtri',
      profiloCompletato: 'Profilo completato con successo!',
      profiloAggiornato: 'Profilo aggiornato con successo.',
      // NUOVE TRADUZIONI PER IMPOSTAZIONI AVANZATE
      impostazioniAvanzate: 'Impostazioni Avanzate',
      impostazioniAvanzateDescrizione: 'Personalizza i permessi di ogni utente, sovrascrivendo quelli del suo ruolo base.',
      nessunAltroUtente: 'Nessun altro utente presente.',
      modificaBreve: '✎ Modifica',
      impostaBreve: '✎ Imposta',
      sezStruttura: 'Struttura',
      sezPrenotazioni: 'Prenotazioni',
      sezManutenzione: 'Manutenzione',
      sezUtentiDomini: 'Utenti e Domini',
      sezBlocchi: 'Blocchi',
      sezReset: 'Reset',
      sezEsportazione: 'Esportazione',
      sezRuoliPersonalizzati: 'Ruoli Personalizzati',
      sezAulaStudio: 'Aula Studio',
      sezManuali: 'Manuali',

      // ---- AULA STUDIO ----
      navAulaStudio: 'Aula Studio',
      successo: 'Successo',
      cognome: 'Cognome',
      oggi: 'Oggi',
      salva: 'Salva',
      resetLabel: 'Reset',
      tipoLabel: 'Tipo',
      dettaglioLabel: 'Dettaglio',
      permessoLabel: 'Permesso',
      attivoLabel: 'Attivo',
      chiudiLabel: 'Chiudi',
      aulaStudioTitoloSezione: 'Aula Studio',
      aulaStudioSchedaPrenota: 'Prenota',
      aulaStudioSchedaMiePrenotazioni: 'Le mie prenotazioni',
      aulaStudioScegliAula: "Scegli l'aula",
      aulaStudioScegliGiorno: 'Scegli il giorno',
      aulaStudioNessunGiornoDisponibile: 'Nessun giorno disponibile per la prenotazione al momento.',
      aulaStudioClasse: 'Classe',
      aulaStudioNumeroInClasse: 'Numero in classe',
      aulaStudioFasceOrarie: 'Fasce orarie',
      aulaStudioListaAttesa: (n) => `Lista d'attesa (${n})`,
      aulaStudioPostiLiberi: (n) => `${n} post${n === 1 ? 'o libero' : 'i liberi'}`,
      aulaStudioFasciaGiaIniziata: 'Fascia già iniziata',
      aulaStudioPrenota: 'Prenota',
      aulaStudioNessunaPrenotazione: 'Nessuna prenotazione.',
      aulaStudioStatoConfermata: 'Confermata',
      aulaStudioStatoInAttesa: "In lista d'attesa",
      aulaStudioCompilaDatiStudente: 'Compila nome, cognome, classe e numero.',
      aulaStudioSelezionaAlmenoUnaFascia: 'Seleziona almeno una fascia oraria.',
      aulaStudioBloccoAttivoMessaggio: (data) => `Prenotazione non consentita: blocco attivo fino al ${data}.`,
      aulaStudioConflittoAltraAula: (fascia) => `Hai già una prenotazione per la fascia ${fascia} in un'altra aula.`,
      aulaStudioPrenotazioneConfermata: 'Prenotazione confermata.',
      aulaStudioPrenotazioneInAttesa: "Sei stato/a inserito/a in lista d'attesa: riceverai un avviso se si libera un posto.",
      aulaStudioPrenotazioneParzialeAttesa: 'Alcune fasce sono state confermate, altre inserite in lista di attesa.',
      aulaStudioErroreGenerico: 'Si è verificato un errore. Riprova.',
      aulaStudioPalliniMessaggio: (n) => `Attenzione: ${n} pallin${n === 1 ? 'o rosso' : 'i rossi'} in questo semestre.`,
      aulaStudioNotificaPromossoTitolo: 'Prenotazione confermata',
      aulaStudioNotificaPromossoCorpo: (aula, data, fascia) => `La tua prenotazione per ${aula} il ${data} (${fascia}) è stata confermata: si è liberato un posto.`,
      aulaStudioTitoloAppello: 'Aula Studio — Appello',
      aulaStudioEsportaGiorno: 'Esporta il giorno (Excel)',
      aulaStudioStudenti: 'studenti',
      aulaStudioAggiungiManualmente: '+ Aggiungi studente',
      aulaStudioAggiuntaManuale: 'Aggiunto manualmente',
      aulaStudioColNome: 'Nome e Cognome',
      aulaStudioColStato: 'Stato',
      aulaStudioColPresenza: 'Presenza',
      aulaStudioColPallini: 'Pallini nel semestre',
      aulaStudioMotivoObbligatorio: 'Il motivo è obbligatorio.',
      aulaStudioMotivoBloccoAutomatico: (n) => `Blocco deciso dal responsabile dopo il ${n}° pallino rosso nel semestre.`,
      aulaStudioNuovoPallino: 'Nuovo pallino rosso',
      aulaStudioMotivoPlaceholder: 'Motivo (es. non rispetta il silenzio)',
      aulaStudioAggiungiPallino: 'Aggiungi pallino',
      aulaStudioTerzoPallinoTitolo: '3° pallino rosso nel semestre',
      aulaStudioGiorniLavorativi: 'Giorni lavorativi di blocco:',
      aulaStudioAzioneBlocca: 'Blocca per N giorni lavorativi',
      aulaStudioAzioneRifiuta: 'Rifiuta la prenotazione',
      aulaStudioAzioneAltraPossibilita: "Dai un'altra possibilità",
      aulaStudioPresenzaPresente: 'Presente',
      aulaStudioPresenzaAssente: 'Assente',
      aulaStudioPresenzaInRitardo: 'In Ritardo',
      aulaStudioPresenzaUscitoAnticipo: 'Uscito Anticipo',
      aulaStudioSceglieStato: 'Scegli stato',
      aulaStudioNFasceSelezionate: (n) => `${n} fasce selezionate`,
      fatto: 'Fatto',
      aulaStudioPallino1: '1° pallino',
      aulaStudioPallino2: '2° pallino',
      aulaStudioPallino3: '3° pallino (blocco)',
      aulaStudioImpostazioniTitolo: 'Impostazioni Aula Studio',
      aulaStudioPostiTotali: 'Posti totali per fascia',
      aulaStudioAnticipoMassimo: 'Anticipo massimo di prenotazione (giorni)',
      aulaStudioAggiungiFascia: '+ Aggiungi fascia oraria',
      aulaStudioFerieExtra: 'Ferie extra',
      aulaStudioAggiungiFerie: '+ Aggiungi periodo di ferie',
      aulaStudioSemestri: 'Semestri (per il reset dei pallini rossi)',
      aulaStudioSemestriSpiegazione: 'Formato MM-DD. I pallini rossi si azzerano automaticamente a ogni nuovo semestre.',
      aulaStudioSemestre1: '1° semestre (inizio)',
      aulaStudioSemestre2: '2° semestre (inizio)',
      aulaStudioAlmenoUnaFascia: 'Configura almeno una fascia oraria.',
      aulaStudioFormatoOrarioNonValido: 'Formato orario non valido, usa HH:MM.',
      aulaStudioFormatoDataNonValido: 'Formato data non valido, usa YYYY-MM-DD.',
      aulaStudioConfigSalvata: 'Configurazione salvata.',
      aulaStudioTipoMedie: 'Medie',
      aulaStudioTipoIpi: 'IPI',
      aulaStudioRegistrazioneTitolo: 'Registrazione Aula Studio',
      aulaStudioRegistrazioneSottotitolo: 'Va fatta una sola volta: i tuoi dati verranno usati per tutte le prenotazioni future.',
      aulaStudioSceglieTipoScuola: 'Scegli il tipo di scuola',
      aulaStudioSceglieClasse: 'Scegli la classe',
      aulaStudioScegliereClasse: 'Devi scegliere una classe.',
      aulaStudioNessunaClasseDisponibile: 'Nessuna classe disponibile per questo tipo di scuola. Contatta la segreteria.',
      aulaStudioConfermaRegistrazione: 'Conferma registrazione',
      aulaStudioGiornoAttivo: 'Giorno prenotabile',
      aulaStudioColNumero: 'Numero',
      aulaStudioColGiorno: 'Giorno',
      aulaStudioColAzioni: 'Azioni',
      aulaStudioSoloStudenti: 'Aula Studio è disponibile solo per gli studenti.',
      classiDaClassificare: 'Da classificare',
      classificaComeMedie: 'Segna tutte come Medie',
      classificaComeIpi: 'Segna tutte come IPI',
      confermaClassificaClassiBulk: (n, tipo) => `Classificare tutte le ${n} classi "Da classificare" come ${tipo}? Questa azione non può essere annullata singolarmente.`,
      avanti: 'Avanti'
    },
    ar: {
      appName: 'إدارة قاعات DBALEX',
      nomeCognome: 'الاسم الكامل',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      registrati: 'تسجيل حساب جديد',
      accedi: 'تسجيل الدخول',
      haiAccountAccedi: 'لديك حساب؟ تسجيل الدخول',
      nonHaiAccesso: 'ليس لديك صلاحية الوصول إلى هذا التطبيق',
      esci: 'خروج',
      ruolo: 'الدور',
      verifEmailTitle: 'تحقق من بريدك الإلكتروني',
      verifEmailText: (emailUser) => `لقد أرسلنا رسالة تأكيد إلى\n${emailUser}.\nافتح الرابط المستلم لتفعيل الحساب، ثم عد إلى هنا.`,
      hoVerificato: 'لقد تحقق، متابعة',
      nonRicevutoEmail: 'لم تستلم البريد؟ إرسال مرة أخرى',
      navHome: 'الرئيسية',
      navCalendario: 'التقويم',
      navGestione: 'إدارة الحجوزات',
      navUtenti: 'المستخدمين',
      navImpostazioni: 'الإعدادات',
      aggiungiSezione: '+ إضافة قسم',
      nomeNuovaSezione: 'اسم القسم الجديد',
      nomeNuovaSezioneAr: 'اسم القسم بالعربية (اختياري)',
      nomeSezioneAr: 'اسم القسم بالعربية (اختياري)',
      modificaSezioneTitolo: 'تعديل القسم',
      nomeSezioneLabel: 'اسم القسم:',
      elimina: '✕',
      modifica: 'تعديل',
      fine: 'تم',
      prenota: 'حجز',
      aggiungiAula: '+ إضافة قاعة',
      capienza: 'السعة',
      calendarioPubblico: 'التقويم العام',
      prenotazioniPassate: (count) => `الحجوزات السابقة (${count})`,
      tua: (stato) => `خاصتك (${stato})`,
      occupata: 'محجوزة',
      nessunaPrenotazione: 'لا توجد حجوزات في هذه الفئة.',
      inAttesa: 'قيد الانتظار',
      approvata: 'تم الموافقة',
      rifiutata: 'مرفوضة',
      tutte: 'الكل',
      approva: 'موافقة',
      rifiuta: 'رفض',
      utente: 'المستخدم',
      data: 'التاريخ',
      ore: 'الساعات',
      motivo: 'السبب',
      classe: 'الصف',
      partecipanti: 'المشاركون',
      stato: 'الحالة',
      filtraPerUtente: 'تصفية حسب المستخدم',
      filtraPerAula: 'تصفية حسب القاعة',
      filtraPerData: 'تصفية حسب التاريخ (YYYY-MM-DD)',
      aula: 'القاعة',
      orario: 'الوقت',
      azioni: 'الإجراءات',
      utentiEDomini: 'المستخدمون والنطاقات',
      listaAggiuntaUtenti: 'قائمة وإضافة المستخدمين',
      permessiDomini: 'صلاحيات النطاقات',
      nome: 'الاسم',
      cercaUtente: 'بحث عن مستخدم (بالاسم أو البريد)',
      aggiungiUtente: '+ إضافة مستخدم',
      notaUtenteManuale: "ملاحظة: الإضافة اليدوية تدخل المستخدم في قاعدة البيانات لإدارة الأدوار. يجب على المستخدم التسجيل وإنشاء كلمة مرور.",
      inserisciNomeEmailPassword: 'أدخل الاسم والبريد الإلكتروني وكلمة المرور',
      passwordTroppoCorta: 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل',
      accountCreatoConSuccesso: 'تم إنشاء الحساب بنجاح',
      erroreCreazioneAccount: 'خطأ في إنشاء الحساب',
      notaUtenteManualeBypass: 'يمكن للمدير إنشاء حسابات بأي بريد إلكتروني، حتى خارج النطاقات المسموح بها. سيصل للمستخدم رابط لتعيين كلمة المرور، دون الحاجة لتحقق إضافي من البريد.',
      eliminaUtenteAzione: 'حذف',
      confermaEliminaUtenteMessaggio: (nome) => `هل تريد حذف ${nome} نهائياً؟ سيتم حذفه من التطبيق ومن حساب الدخول على Firebase: هذا الإجراء لا يمكن التراجع عنه.`,
      utenteRimossoDallaLista: 'تم حذف المستخدم نهائياً، من التطبيق ومن حساب الدخول على Firebase.',
      notaEliminaUtenteLista: 'حذف مستخدم من هنا يحذفه نهائياً: من القائمة (Firestore) ومن حساب الدخول على Firebase Authentication.',
      toccaRigaUtente: 'اضغط على مستخدم لتغيير دوره أو حذفه',
      colonnaStatoEmail: 'الحالة',
      scaricaAppAndroidTitolo: 'تفضل التطبيق؟ حمّله لنظام أندرويد',
      scaricaAppAndroidPulsante: '📱 تحميل تطبيق أندرويد (.apk)',
      manualiPulsanteLogin: 'الأدلة',
      manualiSceltaTitolo: 'الأدلة والدلائل الإرشادية',
      manualiGuidaInterattiva: 'الدليل التفاعلي (الطلاب، المعلمون، المستخدمون)',
      manualiScaricaAmminIt: 'الدليل الإداري (إيطالي)',
      manualiScaricaAmminAr: 'الدليل الإداري (عربي)',
      menuManuali: 'الأدلة',
      manualiImpostazioniSottotitolo: 'ارفع هنا الملفات التي تظهر في زر "الأدلة" بشاشة الدخول. إذا لم يرفع أحد شيئًا، يظهر الزر النسخة الافتراضية تلقائيًا.',
      manualiTitoloIt: 'الدليل الإداري — إيطالي',
      manualiTitoloAr: 'الدليل الإداري — عربي',
      manualiCaricaNuovo: 'رفع ملف جديد (.docx)',
      manualiSostituisci: 'استبدال الملف',
      manualiUltimoAggiornamento: (data) => `آخر تحديث: ${data}`,
      manualiNessunFileCaricato: 'لم يُرفع أي ملف: تُستخدم النسخة الافتراضية.',
      manualiCaricamentoInCorso: 'جارٍ الرفع…',
      manualiCaricatoConSuccesso: 'تم رفع الملف بنجاح.',
      manualiErroreCaricamento: 'حدث خطأ أثناء الرفع. حاول مرة أخرى.',
      manualiFormatoNonValido: 'اختر ملف Word (.doc أو .docx).',
      manualiVerificaCaricamento: 'التحقق من الملف المرفوع…',
      emailVerificata: '✓ نشط',
      emailNonVerificataBadge: '✕ لم يتم التحقق من البريد',
      invitoInAttesa: '⏳ دعوة قيد الانتظار',
      generaPassword: 'توليد',
      inviaInvito: 'إرسال الدعوة',
      rinviaInvito: 'إعادة إرسال الدعوة',
      invitoRinviato: 'تم إرسال بريد الدعوة مرة أخرى',
      cambiaRuolo: 'تغيير الدور',
      aggiungiDominio: '+ إضافة نطاق',
      nessunDominio: 'لا توجد نطاقات محددة: التسجيل متاح لأي بريد إلكتروني.',
      classi: 'الفصول',
      gestioneClassi: 'إدارة الفصول',
      aggiungiClasse: '+ إضافة فصل',
      salvaClasse: 'حفظ',
      annullaModifica: 'إلغاء',
      nessunaClasse: 'لا توجد فصول محددة.',
      confermaEliminazioneClasse: 'هل تريد حذف هذا الفصل؟ لن يعد قابلاً للاختيار للملفات الجديدة.',
      generaAnnoScolastico: 'إنشاء السنة الدراسية',
      rimuovi: '✕',
      dataMaxMesi: (mesi) => `التاريخ (الحد الأقصى ${mesi} أشهر من اليوم):`,
      fasceOrarie: 'الفترات الزمنية (تحديد متعدد):',
      motivoUso: 'سبب الاستخدام:',
      motivoObbligatorio: 'السبب (إلزامي)',
      insegnanteRiferimento: 'المعلم المرجعي (اختياري):',
      insegnanteRiferimentoPlaceholder: 'اسم المعلم (اختياري)',
      nomeClasse: 'اسم الصف:',
      classeObbligatoriaCFP: 'الصف (إلزامي لمدرسة المهن)',
      nomiPartecipanti: 'أسماء المشاركين:',
      aggiungiPartecipante: '+ إضافة مشارك',
      confermaPrenotazione: 'تأكيد الحجز',
      modificaAula: 'تعديل القاعة',
      nuovaAula: 'قاعة جديدة',
      salvaModifiche: 'حفظ التعديلات',
      creaAula: 'إنشاء قاعة',
      nomeAula: 'اسم القاعة',
      nomeAulaAr: 'اسم القاعة بالعربية (اختياري)',
      nomeAulaArPlaceholder: 'اسم القاعة بالعربية (اختياري)',
      accessoRiservato: 'الوصول مقتصر على المديرين',
      annulla: 'إلغاء',
      cancella: 'حذف',
      conferma: 'تأكيد',
      attenzione: 'تنبيه',
      compilaTuttiICampi: 'الرجاء ملء جميع الحقول.',
      erroreDiAccesso: 'خطأ في تسجيل الدخول',
      credenzialiNonValide: 'بيانات الاعتماد غير صالحة. تأكد من وجود المستخدم وأن كلمة المرور صحيحة.',
      emailGiaRegistrata: 'البريد الإلكتروني مسجل مسبقاً',
      errore: 'خطأ',
      emailInviataDiNuovo: 'تم إرسال بريد التحقق مرة أخرى. تحقق من البريد العشوائي.',
      emailNonVerificataAncora: 'لم يتم التحقق من البريد الإلكتروني بعد. افتح الرابط المستلم وحاول مرة أخرى.',
      cancellata: 'تم الحذف.',
      sicuroDiCancellare: 'هل أنت متأكد من الحذف؟',
      haiGiaUnaRichiesta: 'لديك بالفعل طلب/حجز لهذا التاريخ والفترة الزمنية في قاعة أخرى.',
      richiestaInviata: 'تم إرسال الطلب!',
      ripetiSettimanalmente: 'تكرار أسبوعي',
      finoAl: 'حتى تاريخ:',
      ripetizioneRiepilogo: (n, giorno) => `سيتم إنشاء ${n} طلبات، كل يوم ${giorno}.`,
      dataFineRipetizioneObbligatoria: 'اختر تاريخ انتهاء التكرار.',
      avvisoAutorizzazioneSpeciale: 'لقد تجاوزت الحد الطبيعي للحجوزات الفردية: يحتاج هذا الطلب إلى إذن خاص من المدير. سيتبع الطلب مع ذلك نفس مسار الموافقة المعتاد.',
      prenotazioniSpeciali: 'حجوزات خاصة',
      etichettaSpeciale: 'خاص',
      speciali: 'خاصة',
      legendaNessunaAttesa: 'لا توجد طلبات معلقة',
      legendaInAttesa: 'طلبات معلقة',
      torna: 'رجوع',
      dataFineDeveEssereSuccessiva: 'يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.',
      richiesteRipetuteInviate: (n) => `تم إرسال ${n} طلبات!`,
      alcuneDateSaltate: (n) => ` (تم تخطي ${n} تواريخ لأن القاعة كانت محجوزة من مستخدم آخر)`,
      bloccaAula: 'حظر',
      bloccaAulaTitolo: (nome) => `حظر ${nome}`,
      bloccaAulaSpiegazione: 'يجعل القاعة غير قابلة للحجز في جميع الفترات الزمنية طوال المدة المحددة (مثلاً بسبب أعمال صيانة أو استخدام محجوز). غير مقيد بالأشهر المسموح بها للحجوزات العادية.',
      dataInizioBlocco: 'تاريخ بدء الحظر:',
      dataFineBlocco: 'تاريخ انتهاء الحظر:',
      motivoBloccoPlaceholder: 'مثال: أعمال صيانة، استخدام محجوز...',
      confermaBlocco: 'تأكيد الحظر',
      compilaDateBlocco: 'اختر تاريخ بدء وتاريخ انتهاء الحظر.',
      dataFineBloccoSuccessiva: 'يجب أن يكون تاريخ الانتهاء بعد أو يساوي تاريخ البدء.',
      motivoBloccoObbligatorio: 'أدخل سبب الحظر.',
      bloccoCreato: (n) => `تم حظر القاعة لمدة ${n} يوماً.`,
      troppiGiorniBlocco: 'المدة طويلة جداً: الحد الأقصى سنتان.',
      bloccatoDalGestore: 'محظور من قبل المدير',
      inserisciNomeCapienza: 'أدخل اسم وسعة القاعة.',
      eliminareAulaConferma: 'حذف هذه القاعة؟ ستظل أي حجوزات مرتبطة محفوظة في السجل.',
      nonPuoiEliminareTuoAccount: 'لا يمكنك حذف حسابك الخاص.',
      eliminareUtenteConferma: 'هل تريد حذف هذا المستخدم؟',
      eliminareSezioneConferma: 'حذف هذا القسم؟ ستظل القاعات والحجوزات المرتبطة محفوظة في السجل.',
      emailGiaRegistrataDettaglio: 'هذا البريد الإلكتروني مسجل بالفعل في Firebase Authentication.',
      nessunUtenteAutenticato: 'لا يوجد مستخدم مسجل الدخول حالياً.',
      compilaMotivoFascia: 'يرجى كتابة السبب واختيار فترة زمنية واحدة على الأقل.',
      classeObbligatoriaMessaggio: 'اسم الصف إلزامي لقاعات مدرسة المهن.',
      domandaStudenteIPI: 'هل أنت طالب في IPI؟',
      sonoStudenteIPI: 'أنا طالب (IPI)',
      nonSonoStudenteIPI: 'لست طالبًا (IPI)',
      studenteIPIObbligatorioMessaggio: 'يرجى تحديد ما إذا كنت طالبًا في IPI قبل المتابعة.',
      inserisciNomeEmail: 'أدخل الاسم والبريد الإلكتروني.',
      passwordDimenticata: 'نسيت كلمة المرور؟',
      inserisciEmailPrimaReset: 'اكتب بريدك الإلكتروني في الحقل أعلاه، ثم اضغط على هذا الرابط مرة أخرى.',
      emailResetInviata: 'تم إرسال بريد إلكتروني لإعادة تعيين كلمة المرور. تحقق من صندوق الوارد (وأيضاً البريد العشوائي).',
      emailNonRegistrataReset: 'لا يوجد حساب مسجل بهذا البريد الإلكتروني.',
      areaResetGestore: '( إعادة ضبط )',
      areaBloccaGestore: 'حظر',
      bloccaSceltaModalita: 'حظر أو إلغاء حظر المستخدمين المسجلين في:',
      bloccaUtentiAzione: 'حظر مستخدمي هذه الفترة',
      sbloccaUtentiAzione: 'إلغاء حظر مستخدمي هذه الفترة',
      confermaBloccoUtentiTitolo: 'تأكيد الحظر',
      confermaBloccoUtentiMessaggio: 'هل تريد حظر جميع المستخدمين المسجلين في الفترة المحددة؟ لن يتمكنوا من الدخول أو استخدام التطبيق حتى تلغي حظرهم.',
      confermaSbloccoUtentiTitolo: 'تأكيد إلغاء الحظر',
      confermaSbloccoUtentiMessaggio: 'هل تريد إلغاء حظر جميع المستخدمين المسجلين في الفترة المحددة؟',
      bloccoUtentiCompletato: (n) => n > 0 ? `تم حظر ${n} مستخدم.` : 'لا يوجد مستخدمون لحظرهم في هذه الفترة.',
      sbloccoUtentiCompletato: (n) => n > 0 ? `تم إلغاء حظر ${n} مستخدم.` : 'لا يوجد مستخدمون لإلغاء حظرهم في هذه الفترة.',
      accountBloccatoMessaggio: 'تم حظر حسابك. تواصل مع أحد المديرين لمزيد من المعلومات.',
      utenteBloccatoBadge: 'محظور',
      cercaUtenteBlocco: 'ابحث بالاسم أو البريد الإلكتروني...',
      nessunUtenteTrovatoBlocco: 'لم يتم العثور على أي مستخدم.',
      bloccaSingolo: 'حظر',
      sbloccaSingolo: 'إلغاء الحظر',
      confermaBloccoSingoloTitolo: 'تأكيد الحظر',
      confermaBloccoSingoloMessaggio: (nome) => `هل تريد حظر ${nome}؟ لن يتمكن من الدخول أو استخدام التطبيق حتى تلغي حظره.`,
      confermaSbloccoSingoloTitolo: 'تأكيد إلغاء الحظر',
      confermaSbloccoSingoloMessaggio: (nome) => `هل تريد إلغاء حظر ${nome}؟`,
      bloccoSingoloCompletato: (nome) => `تم حظر ${nome}.`,
      sbloccoSingoloCompletato: (nome) => `تم إلغاء حظر ${nome}.`,
      elencoUtentiPeriodo: 'المستخدمون المسجلون في الفترة المحددة',
      nessunUtentePeriodo: 'لا يوجد مستخدمون مسجلون في هذه الفترة.',
      colonnaRegistrazione: 'تاريخ التسجيل',
      colonnaRuolo: 'الدور',
      colonnaAzione: 'إجراء',
      toccaPerDettagli: 'المس أي صف لعرض البريد الإلكتروني والتاريخ والإجراء',
      nonPuoiRimuovereUltimoGestore: 'لا يمكنك إزالة صلاحية المدير: إنه المدير الوحيد المتبقي. عيّن مديرًا آخر أولاً قبل تغيير هذا الحساب.',
      selezionaModalitaReset: 'اختر وضع إعادة الضبط:',
      resetSceltaTipo: 'ماذا تريد إعادة ضبطه؟',
      resetTipoPrenotazioni: 'الحجوزات',
      resetTipoManutenzione: 'بلاغات الصيانة',
      resetTipoUtenti: 'المستخدمون',
      impostazioniMenuSottotitolo: 'اضغط على عنصر لفتحه',
      eseguiResetManutenzione: 'تنفيذ إعادة ضبط بلاغات الصيانة',
      mensile: 'شهري',
      annuale: 'سنوي',
      selezionaMese: 'اختر الشهر:',
      selezionaAnno: 'أدخل أو اختر السنة (مثال 2026):',
      eseguiReset: 'تنفيذ إعادة ضبط الحجوزات',
      confermaResetTitolo: 'تأكيد إعادة الضبط',
      confermaResetMessaggio: 'هل أنت متأكد من رغبتك في حذف جميع الحجوزات للفترة المحددة؟ لا يمكن التراجع عن هذا الإجراء.',
      resetCompletato: 'تمت إعادة الضبط بنجاح.',
      eliminaBlocco: 'حذف المجموعة',
      eliminareGruppoConferma: (n) => `حذف جميع الحجوزات الـ ${n} الخاصة بهذه المجموعة المتكررة؟ لا يمكن التراجع عن هذا الإجراء.`,
      navManutenzione: 'الصيانة',
      confermaEliminaArchivioManutenzione: (n) => `هل تريد حذف ${n} بلاغات مؤرشفة في الفترة المحددة؟ لا يمكن التراجع عن هذا الإجراء.`,
      archivioManutenzioneEliminato: (n) => n > 0 ? `تم حذف ${n} بلاغات من الأرشيف.` : 'لا توجد بلاغات للحذف في هذه الفترة.',
      nuovaSegnalazione: '+ بلاغ جديد',
      segnalaGuasto: 'الإبلاغ عن عطل',
      selezionaAula: 'اختر القاعة',
      selezionaAulaManutenzione: 'الرجاء اختيار القاعة أولاً.',
      tipoGuasto: 'نوع العطل',
      elettrico: 'كهربائي',
      informatico: 'معلوماتي',
      strutturale: 'إنشائي',
      altroTipoGuasto: 'أخرى',
      selezionaTipoGuasto: 'الرجاء اختيار نوع العطل.',
      descrizioneGuastoLabel: 'وصف المشكلة:',
      descrizioneGuastoPlaceholder: 'صف المشكلة بالتفصيل (إلزامي)',
      descrizioneObbligatoriaMessaggio: 'وصف العطل إلزامي.',
      inviaSegnalazione: 'إرسال البلاغ',
      segnalazioneInviata: 'تم إرسال البلاغ!',
      segnalatoDa: 'تم الإبلاغ من قبل',
      daRisolvere: 'قيد الحل',
      risolto: 'تم الحل',
      segnaComeRisolto: 'وضع علامة كـ تم الحل',
      segnaComeDaRisolvere: 'وضع علامة كـ قيد الحل',
      nessunaSegnalazione: 'لا توجد بلاغات في هذه الفئة.',
      ruoloManutentore: 'الصيانة / تقنية المعلومات',
      scegliRuolo: 'اختر الدور',
      inLavorazione: 'قيد المعالجة',
      segnaComeInLavorazione: 'بدء المعالجة',
      riportaADaRisolvere: 'إعادة إلى قيد الحل',
      dettaglioSegnalazione: 'تفاصيل البلاغ',
      colAula: 'القاعة',
      colSegnalatoDa: 'المُبلّغ',
      colTipoGuasto: 'نوع العطل',
      colStato: 'الحالة',
      colData: 'التاريخ',
      storicoTempistiche: 'السجل الزمني',
      segnalatoIl: 'تم الإبلاغ في',
      presoInCaricoIl: 'بدأت المعالجة في',
      risoltoIl: 'تم الحل في',
      nonAncora: 'ليس بعد',
      diarioLavoro: 'سجل العمل',
      diarioVuoto: 'لا توجد تحديثات مسجلة.',
      diarioPlaceholder: 'اكتب تحديثًا عن التدخل...',
      aggiungiAggiornamento: 'إضافة',
      esportaExcel: 'تصدير Excel',
      esportazioneNonDisponibile: 'التصدير إلى Excel غير متاح على هذا الجهاز.',
      notifiche: 'الإشعارات',
      centroNotifiche: 'مركز الإشعارات',
      nessunaNotifica: 'لا توجد إشعارات حاليًا.',
      segnaTutteLette: 'وضع علامة مقروء على الكل',
      notificaApprovataTitolo: (aula) => `تم قبول الحجز: ${aula}`,
      notificaRifiutataTitolo: (aula) => `تم رفض الحجز: ${aula}`,
      notificaApprovataCorpo: (aula, data, ore) => `تم قبول طلبك لحجز "${aula}" بتاريخ ${data} (${ore}).`,
      notificaRifiutataCorpo: (aula, data, ore) => `تم رفض طلبك لحجز "${aula}" بتاريخ ${data} (${ore}).`,
      notifichePrenotazioniAttive: 'إشعارات الحجوزات',
      notifichePrenotazioniSpiegazione: 'عند التعطيل، ستبقى إشعارات الحجوزات مرئية في مركز الإشعارات داخل التطبيق، لكن لن تصلك الإشعارات المنبثقة أو الصوت على الهاتف.',
      notificheSegnalazioniAttive: 'إشعارات البلاغات',
      notificheSegnalazioniSpiegazione: 'عند التعطيل، ستبقى إشعارات بلاغات الصيانة مرئية في مركز الإشعارات داخل التطبيق، لكن لن تصلك الإشعارات المنبثقة أو الصوت على الهاتف.',
      notificaNuovaSegnalazioneTitolo: (aula) => `بلاغ جديد: ${aula}`,
      notificaNuovaSegnalazioneCorpo: (utente, aula, guasto) => `${utente} أبلغ عن عطل ("${guasto}") في "${aula}".`,
      notificaSegnalazioneInLavorazioneTitolo: (aula) => `تم استلام البلاغ: ${aula}`,
      notificaSegnalazioneInLavorazioneCorpo: (aula) => `تم استلام بلاغك الخاص بـ "${aula}" وجارٍ العمل عليه.`,
      notificaSegnalazioneRisoltaTitolo: (aula) => `تم حل البلاغ: ${aula}`,
      notificaSegnalazioneRisoltaCorpo: (aula) => `تم حل بلاغك الخاص بـ "${aula}".`,
      sbloccoImpronta: 'فتح ببصمة الإصبع',
      sbloccoImprontaSpiegazione: 'عند إعادة فتح التطبيق ستحتاج لفتحه ببصمة الإصبع (أو التعرف على الوجه) بدلاً من إعادة إدخال كلمة المرور.',
      sbloccoImprontaNonDisponibile: 'جهازك لا يحتوي على بصمة إصبع (أو وجه) مُعدّة في إعدادات الهاتف. قم بإعدادها أولاً قبل تفعيل هذا الخيار.',
      sbloccoImprontaPrompt: 'فتح تطبيق إدارة القاعات DBALEX',
      sbloccoImprontaSchermataTesto: 'التطبيق مقفل. استخدم بصمة الإصبع للمتابعة.',
      sbloccoImprontaSchermataPulsante: 'فتح ببصمة الإصبع',
      preferenze: 'التفضيلات',
      aspetto: 'المظهر',
      modalitaScuraAttiva: 'الوضع الداكن',
      modalitaChiaraAttiva: 'الوضع الفاتح',
      lingua: 'اللغة',
      sezioneNotifiche: 'الإشعارات',
      gruppoNotifichePrenotazione: 'الحجز',
      gruppoNotificheManutenzione: 'الصيانة',
      gruppoNotificheAulaStudio: 'قاعة الدراسة',
      sezioneGestioneUtenti: 'إدارة المستخدمين',
      notificaNuovaRichiestaTitolo: (aula) => `طلب حجز جديد: ${aula}`,
      notificaNuovaRichiestaCorpo: (utente, aula, data) => `${utente} طلب حجز "${aula}" بتاريخ ${data}.`,
      areaEsportaGestore: 'تصدير',
      esportaExcelDettagliato: 'تصدير ملف Excel مفصّل',
      esportazioneInCorso: 'جارٍ إنشاء الملف...',
      esportazioneCompletata: (n) => `اكتمل التصدير: تم تضمين ${n} سجل.`,
      nessunDatoDaEsportare: 'لا توجد بيانات للتصدير في الفترة المحددة.',
      erroreEsportazione: 'حدث خطأ أثناء التصدير.',
      colFasceOrarie: 'الفترات الزمنية',
      colRichiestoDa: 'طلب من',
      colSpeciale: 'خاص',
      colRipetizione: 'تكرار أسبوعي',
      colDescrizioneGuasto: 'الوصف',
      colDataSegnalazione: 'تاريخ/وقت الإبلاغ',
      colDataPresaInCarico: 'تاريخ/وقت بدء المعالجة',
      colDataRisoluzione: 'تاريخ/وقت الحل',
      registroAttivita: 'سجل النشاطات',
      esportaRegistro: 'تصدير سجل النشاطات',
      colTipoAzione: 'نوع الإجراء',
      colDettaglio: 'تفاصيل',
      nessunaAttivita: 'لا توجد أنشطة مسجلة للفلاتر المحددة.',
      // NUOVE TRADUZIONI AR
      profili: 'الملفات الشخصية',
      notaClicRigaProfilo: 'اضغط على صف المستخدم لعرض أو تعديل ملفه الشخصي.',
      modificaProfilo: 'تعديل الملف الشخصي',
      profiloPersonale: 'ملفي الشخصي',
      cambiaRuoloDaGestioneUtenti: 'يتم تغيير الدور من قسم إدارة المستخدمين.',
      studente: 'طالب',
      insegnante: 'معلم',
      annoScolastico: 'السنة الدراسية',
      dataNascita: 'تاريخ الميلاد',
      eta: 'العمر',
      dataRegistrazione: 'تاريخ التسجيل',
      completaProfilo: 'أكمل ملفك الشخصي',
      scegliTipo: 'اختر نوع المستخدم',
      dataScadenza: 'تاريخ الانتهاء',
      profiloScaduto: 'انتهت صلاحية ملفك الشخصي في',
      profiloTemporaneo: 'ملف مؤقت',
      finoA: 'حتى',
      nessunProfilo: 'لا توجد ملفات شخصية',
      filtraNomeEmail: 'بحث بالاسم أو البريد',
      filtraRuolo: 'تصفية حسب الدور',
      filtraClasse: 'تصفية حسب الصف',
      filtraAnno: 'تصفية حسب السنة الدراسية',
      reimpostaFiltri: 'إعادة تعيين الفلاتر',
      profiloCompletato: 'تم إكمال الملف الشخصي بنجاح!',
      profiloAggiornato: 'تم تحديث الملف الشخصي بنجاح.',
      // NUOVE TRADUZIONI AR PER IMPOSTAZIONI AVANZATE
      impostazioniAvanzate: 'الإعدادات المتقدمة',
      impostazioniAvanzateDescrizione: 'خصّص صلاحيات كل مستخدم، مع تجاوز صلاحيات دوره الأساسي.',
      nessunAltroUtente: 'لا يوجد مستخدمون آخرون.',
      modificaBreve: '✎ تعديل',
      impostaBreve: '✎ تعيين',
      sezStruttura: 'البنية',
      sezPrenotazioni: 'الحجوزات',
      sezManutenzione: 'الصيانة',
      sezUtentiDomini: 'المستخدمون والنطاقات',
      sezBlocchi: 'الحظر',
      sezReset: 'إعادة التعيين',
      sezEsportazione: 'التصدير',
      sezRuoliPersonalizzati: 'الأدوار المخصصة',
      sezAulaStudio: 'قاعة الدراسة',
      sezManuali: 'الأدلة',

      // ---- AULA STUDIO (عربي) ----
      navAulaStudio: 'قاعة الدراسة',
      successo: 'تم بنجاح',
      cognome: 'اسم العائلة',
      oggi: 'اليوم',
      salva: 'حفظ',
      resetLabel: 'إعادة تعيين',
      tipoLabel: 'النوع',
      dettaglioLabel: 'التفاصيل',
      permessoLabel: 'الصلاحية',
      attivoLabel: 'مفعّل',
      chiudiLabel: 'إغلاق',
      aulaStudioTitoloSezione: 'قاعة الدراسة',
      aulaStudioSchedaPrenota: 'حجز',
      aulaStudioSchedaMiePrenotazioni: 'حجوزاتي',
      aulaStudioScegliAula: 'اختر القاعة',
      aulaStudioScegliGiorno: 'اختر اليوم',
      aulaStudioNessunGiornoDisponibile: 'لا يوجد يوم متاح للحجز حاليًا.',
      aulaStudioClasse: 'الفصل',
      aulaStudioNumeroInClasse: 'الرقم في الفصل',
      aulaStudioFasceOrarie: 'الفترات الزمنية',
      aulaStudioListaAttesa: (n) => `قائمة الانتظار (${n})`,
      aulaStudioPostiLiberi: (n) => `${n} مقعد متاح`,
      aulaStudioFasciaGiaIniziata: 'الفترة بدأت بالفعل',
      aulaStudioPrenota: 'احجز',
      aulaStudioNessunaPrenotazione: 'لا توجد حجوزات.',
      aulaStudioStatoConfermata: 'مؤكد',
      aulaStudioStatoInAttesa: 'في قائمة الانتظار',
      aulaStudioCompilaDatiStudente: 'يرجى إدخال الاسم واللقب والفصل والرقم.',
      aulaStudioSelezionaAlmenoUnaFascia: 'اختر فترة زمنية واحدة على الأقل.',
      aulaStudioBloccoAttivoMessaggio: (data) => `الحجز غير مسموح: حظر ساري حتى ${data}.`,
      aulaStudioConflittoAltraAula: (fascia) => `لديك حجز بالفعل لهذه الفترة ${fascia} في قاعة أخرى.`,
      aulaStudioPrenotazioneConfermata: 'تم تأكيد الحجز.',
      aulaStudioPrenotazioneInAttesa: 'تمت إضافتك إلى قائمة الانتظار: سيصلك إشعار إذا توفر مقعد.',
      aulaStudioPrenotazioneParzialeAttesa: 'تم تأكيد بعض الفترات، والبعض الآخر في قائمة الانتظار.',
      aulaStudioErroreGenerico: 'حدث خطأ ما. حاول مرة أخرى.',
      aulaStudioPalliniMessaggio: (n) => `تنبيه: ${n} نقطة حمراء في هذا الفصل الدراسي.`,
      aulaStudioNotificaPromossoTitolo: 'تم تأكيد الحجز',
      aulaStudioNotificaPromossoCorpo: (aula, data, fascia) => `تم تأكيد حجزك في ${aula} يوم ${data} (${fascia}): توفر مقعد.`,
      aulaStudioTitoloAppello: 'قاعة الدراسة — الحضور',
      aulaStudioEsportaGiorno: 'تصدير اليوم (Excel)',
      aulaStudioStudenti: 'طلاب',
      aulaStudioAggiungiManualmente: '+ إضافة طالب يدويًا',
      aulaStudioAggiuntaManuale: 'أُضيف يدويًا',
      aulaStudioColNome: 'الاسم الكامل',
      aulaStudioColStato: 'الحالة',
      aulaStudioColPresenza: 'الحضور',
      aulaStudioColPallini: 'النقاط الحمراء في الفصل الدراسي',
      aulaStudioMotivoObbligatorio: 'السبب مطلوب.',
      aulaStudioMotivoBloccoAutomatico: (n) => `حظر قرره المسؤول بعد النقطة الحمراء رقم ${n} في الفصل الدراسي.`,
      aulaStudioNuovoPallino: 'نقطة حمراء جديدة',
      aulaStudioMotivoPlaceholder: 'السبب (مثال: لا يحترم الهدوء)',
      aulaStudioAggiungiPallino: 'إضافة نقطة',
      aulaStudioTerzoPallinoTitolo: 'النقطة الحمراء الثالثة في الفصل الدراسي',
      aulaStudioGiorniLavorativi: 'أيام العمل للحظر:',
      aulaStudioAzioneBlocca: 'حظر لعدد أيام عمل',
      aulaStudioAzioneRifiuta: 'رفض الحجز',
      aulaStudioAzioneAltraPossibilita: 'منح فرصة أخرى',
      aulaStudioPresenzaPresente: 'حاضر',
      aulaStudioPresenzaAssente: 'غائب',
      aulaStudioPresenzaInRitardo: 'متأخر',
      aulaStudioPresenzaUscitoAnticipo: 'خرج مبكرًا',
      aulaStudioSceglieStato: 'اختر الحالة',
      aulaStudioNFasceSelezionate: (n) => `${n} فترات محددة`,
      fatto: 'تم',
      aulaStudioPallino1: 'النقطة الأولى',
      aulaStudioPallino2: 'النقطة الثانية',
      aulaStudioPallino3: 'النقطة الثالثة (حظر)',
      aulaStudioImpostazioniTitolo: 'إعدادات قاعة الدراسة',
      aulaStudioPostiTotali: 'إجمالي المقاعد لكل فترة',
      aulaStudioAnticipoMassimo: 'أقصى مدة للحجز المسبق (أيام)',
      aulaStudioAggiungiFascia: '+ إضافة فترة زمنية',
      aulaStudioFerieExtra: 'عطلات إضافية',
      aulaStudioAggiungiFerie: '+ إضافة فترة عطلة',
      aulaStudioSemestri: 'الفصول الدراسية (لإعادة ضبط النقاط الحمراء)',
      aulaStudioSemestriSpiegazione: 'الصيغة MM-DD. يتم صفر النقاط الحمراء تلقائيًا مع بداية كل فصل دراسي.',
      aulaStudioSemestre1: 'بداية الفصل الدراسي الأول',
      aulaStudioSemestre2: 'بداية الفصل الدراسي الثاني',
      aulaStudioAlmenoUnaFascia: 'أضف فترة زمنية واحدة على الأقل.',
      aulaStudioFormatoOrarioNonValido: 'صيغة الوقت غير صحيحة، استخدم HH:MM.',
      aulaStudioFormatoDataNonValido: 'صيغة التاريخ غير صحيحة، استخدم YYYY-MM-DD.',
      aulaStudioConfigSalvata: 'تم حفظ الإعدادات.',
      aulaStudioTipoMedie: 'متوسطة',
      aulaStudioTipoIpi: 'IPI',
      aulaStudioRegistrazioneTitolo: 'تسجيل قاعة الدراسة',
      aulaStudioRegistrazioneSottotitolo: 'مرة واحدة فقط: ستُستخدم بياناتك في كل الحجوزات القادمة.',
      aulaStudioSceglieTipoScuola: 'اختر نوع المدرسة',
      aulaStudioSceglieClasse: 'اختر الفصل',
      aulaStudioScegliereClasse: 'يجب اختيار فصل.',
      aulaStudioNessunaClasseDisponibile: 'لا يوجد فصل متاح لهذا النوع من المدرسة. تواصل مع الإدارة.',
      aulaStudioConfermaRegistrazione: 'تأكيد التسجيل',
      aulaStudioGiornoAttivo: 'يوم متاح للحجز',
      aulaStudioColNumero: 'الرقم',
      aulaStudioColGiorno: 'اليوم',
      aulaStudioColAzioni: 'إجراءات',
      aulaStudioSoloStudenti: 'قاعة الدراسة متاحة فقط للطلاب.',
      classiDaClassificare: 'غير مصنّف',
      classificaComeMedie: 'تصنيف الكل كمتوسطة',
      classificaComeIpi: 'تصنيف الكل كـ IPI',
      confermaClassificaClassiBulk: (n, tipo) => `هل تريد تصنيف كل الفصول غير المصنّفة (${n}) كـ ${tipo}؟ لا يمكن التراجع عن هذا الإجراء دفعة واحدة.`,
      avanti: 'التالي'
    }
  };
  const val = dict[lang]?.[key] || dict['it'][key] || key;
  return typeof val === 'function' ? val(...args) : val;
};

const AppLogo = ({ style }) => (
  <Image
    source={require('../../assets/logo.png')}
    style={[style]}
    resizeMode="contain"
  />
);

const mostraAlert = (titolo, messaggio) => {
  if (Platform.OS === 'web') alert(`${titolo ? titolo + '\n' : ''}${messaggio}`);
  else Alert.alert(titolo, messaggio);
};

// ---- Notifiche push (Expo) ----
// Definisce come le notifiche vengono mostrate quando l'app è in primo piano.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Richiede il permesso, registra il canale Android e restituisce il token push del dispositivo (null su web o se negato). */
const registraPushTokenDispositivo = async () => {
  try {
    if (Platform.OS === 'web') return null;
    if (!Device.isDevice) return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#C9A227'
      });
    }

    const { status: statoEsistente } = await Notifications.getPermissionsAsync();
    let statoFinale = statoEsistente;
    if (statoEsistente !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      statoFinale = status;
    }
    if (statoFinale !== 'granted') return null;

    const projectId = Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenResponse.data;
  } catch (e) {
    console.warn('Impossibile registrare il token per le notifiche push:', e);
    return null;
  }
};

/** Invia una notifica push tramite il servizio Expo a un token già registrato. */
const inviaNotificaPush = async (pushToken, titolo, corpo, extra) => {
  if (!pushToken) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: pushToken,
        title: titolo,
        body: corpo,
        sound: 'default',
        data: extra || {}
      })
    });
  } catch (e) {
    console.warn('Invio notifica push non riuscito:', e);
  }
};

const getThemeColors = (isDark) => ({
  bg: isDark ? '#151E2E' : '#EDEBE4',
  surface: isDark ? '#1E2838' : '#F9F8F4',
  surfaceAlt: isDark ? '#242F42' : '#F2F0EA',
  border: isDark ? '#3C4A63' : '#DFDCD2',
  textMain: isDark ? '#F5F7FA' : '#2B2A24',
  textMuted: isDark ? '#98A6BA' : '#7A776E',
  textSub: isDark ? '#CDD7E3' : '#423F38',
  primary: '#C9A227',
  primaryText: '#111827',
  danger: isDark ? '#F87171' : '#C4453D',
  success: isDark ? '#34D399' : '#3F8F63',
  warning: isDark ? '#FBBF24' : '#C98A2E',
  warningText: '#2B2A24',
  moveBtn: isDark ? '#3F4D67' : '#D6D3C8',
  altRow: isDark ? '#1A2434' : '#EFEDE6',
  overlay: isDark ? 'rgba(15,21,33,0.75)' : 'rgba(40,40,36,0.40)',
  placeholder: isDark ? '#8FA0B6' : '#8C8980',
  shadow: isDark ? '#000000' : '#2B2A24',
  watermarkOpacity: isDark ? 0.14 : 0.10
});


const getCategorieVisibili = (ruolo, lang) => {
  const visibili: any[] = [];
  visibili.push({
    key: CATEGORIE_NOTIFICHE.ESITO_PRENOTAZIONE,
    label: ETICHETTE_CATEGORIE[lang]?.[CATEGORIE_NOTIFICHE.ESITO_PRENOTAZIONE] || 'Esito prenotazione'
  });
  if (puoApprovarePrenotazioni(ruolo)) {
    visibili.push({
      key: CATEGORIE_NOTIFICHE.NUOVA_PRENOTAZIONE,
      label: ETICHETTE_CATEGORIE[lang]?.[CATEGORIE_NOTIFICHE.NUOVA_PRENOTAZIONE] || 'Nuova richiesta prenotazione'
    });
  }
  if (puoGestireManutenzione(ruolo) || RUOLI_TIPO_SEGRETERIA.includes(ruolo)) {
    visibili.push({
      key: CATEGORIE_NOTIFICHE.NUOVA_SEGNALAZIONE,
      label: ETICHETTE_CATEGORIE[lang]?.[CATEGORIE_NOTIFICHE.NUOVA_SEGNALAZIONE] || 'Nuova segnalazione guasto'
    });
    visibili.push({
      key: CATEGORIE_NOTIFICHE.INIZIO_LAVORO,
      label: ETICHETTE_CATEGORIE[lang]?.[CATEGORIE_NOTIFICHE.INIZIO_LAVORO] || 'Inizio lavoro (presa in carico)'
    });
    visibili.push({
      key: CATEGORIE_NOTIFICHE.FINE_LAVORO,
      label: ETICHETTE_CATEGORIE[lang]?.[CATEGORIE_NOTIFICHE.FINE_LAVORO] || 'Fine lavoro (segnalazione risolta)'
    });
  }
  if (puoGestireAulaStudio(ruolo)) {
    visibili.push({
      key: CATEGORIE_NOTIFICHE.RICHIESTA_TURNO_AULA_STUDIO,
      label: ETICHETTE_CATEGORIE[lang]?.[CATEGORIE_NOTIFICHE.RICHIESTA_TURNO_AULA_STUDIO] || 'Nuova richiesta di turno Aula Studio'
    });
  }
  if (ruolo === 'insegnante') {
    visibili.push({
      key: CATEGORIE_NOTIFICHE.ESITO_TURNO_AULA_STUDIO,
      label: ETICHETTE_CATEGORIE[lang]?.[CATEGORIE_NOTIFICHE.ESITO_TURNO_AULA_STUDIO] || 'Esito richiesta di turno Aula Studio'
    });
  }
  return visibili;
};


const TIPI_REGISTRO = {
  CREAZIONE_UTENTE: 'creazione_utente',
  MODIFICA_RUOLO_UTENTE: 'modifica_ruolo_utente',
  ELIMINAZIONE_UTENTE: 'eliminazione_utente',
  AGGIUNTA_AULA: 'aggiunta_aula',
  MODIFICA_AULA: 'modifica_aula',
  ELIMINAZIONE_AULA: 'eliminazione_aula',
  CREAZIONE_PRENOTAZIONE: 'creazione_prenotazione',
  APPROVAZIONE_PRENOTAZIONE: 'approvazione_prenotazione',
  RIFIUTO_PRENOTAZIONE: 'rifiuto_prenotazione',
  AGGIUNTA_DOMINIO: 'aggiunta_dominio',
  RIMOZIONE_DOMINIO: 'rimozione_dominio',
  AGGIUNTA_CLASSE: 'aggiunta_classe',
  MODIFICA_CLASSE: 'modifica_classe',
  ELIMINAZIONE_CLASSE: 'eliminazione_classe',
  CREAZIONE_SEGNALAZIONE: 'creazione_segnalazione',
  PRESA_IN_CARICO_SEGNALAZIONE: 'presa_in_carico_segnalazione',
  RISOLUZIONE_SEGNALAZIONE: 'risoluzione_segnalazione',
  CARICAMENTO_MANUALE: 'caricamento_manuale'
};

export default function App() {
  const [lang, setLang] = useState('it');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [utentePermessiTarget, setUtentePermessiTarget] = useState<any>(null);
  const [permessiModifica, setPermessiModifica] = useState<Record<string, any>>({});
  const isRTL = lang === 'ar';

  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const watermarkSize = Math.min(560, Math.max(220, winWidth * 0.68));
  const watermarkOffset = -(watermarkSize * (160 / 560));
  // Offset verticale ridotto rispetto a quello orizzontale: alza il logo così se ne vede di più
  const watermarkOffsetY = -(watermarkSize * (80 / 560));

  // ---- STATI AUTENTICAZIONE ----
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mostraPassword, setMostraPassword] = useState(false);
  const [showDownloadChoice, setShowDownloadChoice] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [showManualiChoice, setShowManualiChoice] = useState(false);
  const [manualeInCaricamento, setManualeInCaricamento] = useState(null); // 'it' | 'ar' | null, mostra un piccolo indicatore mentre si cerca l'URL su Storage

  // ---- STATI IMPOSTAZIONI → MANUALI (caricamento manuale IT/AR da parte del gestore) ----
  // manualiMeta[lingua]: undefined = non ancora controllato, false = nessun file caricato, oggetto = metadati Storage (contiene "updated")
  const [manualiMeta, setManualiMeta] = useState<Record<string, any>>({});
  const [manualiStato, setManualiStato] = useState<Record<string, string>>({}); // 'uploading' | 'success' | 'error' per lingua
  const [nome, setNome] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);

  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState('utente');
  const [userName, setUserName] = useState('');
  const [notifichePrefs, setNotifichePrefs] = useState<Record<string, any>>({});
  const [initializing, setInitializing] = useState(true);

  // ---- BIOMETRICO ----
  const [biometricoAttivo, setBiometricoAttivo] = useState(false);
  const [biometricoDisponibile, setBiometricoDisponibile] = useState(false);
  const [appBloccata, setAppBloccata] = useState(false);

  // ---- ALTRI STATI ----
  const [filtroMeseGestioneDropdownAperto, setFiltroMeseGestioneDropdownAperto] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState('');
  const [emailNonVerificata, setEmailNonVerificata] = useState(false);

  // ---- NOTIFICHE ----
  const [notificheLista, setNotificheLista] = useState<any[]>([]);
  const [modalNotifiche, setModalNotifiche] = useState(false);

  // ---- STATI PRINCIPALI (AULE, PRENOTAZIONI, ECC.) ----
  const [sezioneSelezionata, setSezioneSelezionata] = useState<any>(null);
  const [vistaAttiva, setVistaAttiva] = useState('home');
  // Id di una richiesta di turno Aula Studio da aprire automaticamente (deep-link da una notifica).
  const [richiestaTurnoDaAprireId, setRichiestaTurnoDaAprireId] = useState<string | null>(null);

  const [aule, setAule] = useState<any[]>([]);
  const [prenotazioni, setPrenotazioni] = useState<any[]>([]);
  const [dominiLista, setDominiLista] = useState<any[]>([]);
  const [classiLista, setClassiLista] = useState<any[]>([]);
  const [utentiLista, setUtentiLista] = useState<any[]>([]);
  const [sezioniLista, setSezioniLista] = useState<any[]>([]);

  // ---- STATI PER MODALITÀ MODIFICA E GESTIONE ----
  const [nuovaSezioneNome, setNuovaSezioneNome] = useState('');
  const [nuovaSezioneNomeAr, setNuovaSezioneNomeAr] = useState('');
  const [modalNuovaSezione, setModalNuovaSezione] = useState(false);
  const [modalitaModificaClassi, setModalitaModificaClassi] = useState(false);
  const [mostraFormAggiungiClasse, setMostraFormAggiungiClasse] = useState(false);

  const [sezioneInModifica, setSezioneInModifica] = useState<any>(null);
  const [nomeSezioneInModifica, setNomeSezioneInModifica] = useState('');
  const [nomeSezioneInModificaAr, setNomeSezioneInModificaAr] = useState('');
  const [modalModificaSezione, setModalModificaSezione] = useState(false);

  // ---- FILTRI ----
  const [filtroUtente, setFiltroUtente] = useState('');
  const [filtroAula, setFiltroAula] = useState('');
  const [filtroData, setFiltroData] = useState('');
  const [cercaUtenteQuery, setCercaUtenteQuery] = useState('');

  // ---- RESET ----
  const [resetTipoSelezionato, setResetTipoSelezionato] = useState('prenotazioni');
  const [esportazioneInCorso, setEsportazioneInCorso] = useState(false);
  const [resetModalita, setResetModalita] = useState('mensile');
  const [resetMeseSelezionato, setResetMeseSelezionato] = useState(new Date().toISOString().slice(0, 7));
  const [resetAnnoSelezionato, setResetAnnoSelezionato] = useState(String(new Date().getFullYear()));
  const [resetMeseDropdownAperto, setResetMeseDropdownAperto] = useState(false);

  // ---- BLOCCA UTENTI ----
  const [bloccaModalita, setBloccaModalita] = useState('mensile');
  const [bloccaMeseSelezionato, setBloccaMeseSelezionato] = useState(new Date().toISOString().slice(0, 7));
  const [bloccaAnnoSelezionato, setBloccaAnnoSelezionato] = useState(String(new Date().getFullYear()));
  const [bloccaMeseDropdownAperto, setBloccaMeseDropdownAperto] = useState(false);
  const [bloccaCercaQuery, setBloccaCercaQuery] = useState('');

  // ---- ARCHIVIO MANUTENZIONE ----
  const [archivioManutenzioneModalita, setArchivioManutenzioneModalita] = useState('mensile');
  const [archivioManutenzioneMeseSelezionato, setArchivioManutenzioneMeseSelezionato] = useState(new Date().toISOString().slice(0, 7));
  const [archivioManutenzioneAnnoSelezionato, setArchivioManutenzioneAnnoSelezionato] = useState(String(new Date().getFullYear()));
  const [archivioManutenzioneMeseDropdownAperto, setArchivioManutenzioneMeseDropdownAperto] = useState(false);

  // ---- CALENDARIO ----
  const [calendarioMeseSelezionato, setCalendarioMeseSelezionato] = useState<any>(null);
  const [giornoCalendarioSelezionato, setGiornoCalendarioSelezionato] = useState<any>(null);

  // ---- GESTIONE PRENOTAZIONI ----
  const [gestioneMeseSelezionato, setGestioneMeseSelezionato] = useState<any>(null);
  const [giornoGestioneSelezionato, setGiornoGestioneSelezionato] = useState<any>(null);
  const [gestioneVistaSpeciali, setGestioneVistaSpeciali] = useState(false);
  const [prenotazioneDettaglio, setPrenotazioneDettaglio] = useState<any>(null);

  // ---- MANUTENZIONE ----
  const [manutenzioneLista, setManutenzioneLista] = useState<any[]>([]);
  const [modalNuovaSegnalazione, setModalNuovaSegnalazione] = useState(false);
  const [aulaManutenzioneSelezionata, setAulaManutenzioneSelezionata] = useState<any>(null);
  const [aulaManutenzioneDropdownAperto, setAulaManutenzioneDropdownAperto] = useState(false);
  const [tipoGuastoSelezionato, setTipoGuastoSelezionato] = useState<any>(null);
  const [descrizioneGuasto, setDescrizioneGuasto] = useState('');
  const [filtroStatoManutenzione, setFiltroStatoManutenzione] = useState('Tutte');
  const [filtroStatoManutenzioneDropdownAperto, setFiltroStatoManutenzioneDropdownAperto] = useState(false);
  const [segnalazioneDettaglio, setSegnalazioneDettaglio] = useState<any>(null);
  const [nuovaVoceDiario, setNuovaVoceDiario] = useState('');

  // ---- UTENTI (RUOLO, DETTAGLIO) ----
  const [utenteRuoloModalTarget, setUtenteRuoloModalTarget] = useState<any>(null);
  const [utenteDettaglioTarget, setUtenteDettaglioTarget] = useState<any>(null);
  const [filtroMeseCalendarioDropdownAperto, setFiltroMeseCalendarioDropdownAperto] = useState(false);

  // ---- PRENOTAZIONE MODALE ----
  const [aulaInPrenotazione, setAulaInPrenotazione] = useState<any>(null);
  const [dataPrenotazioneObj, setDataPrenotazioneObj] = useState(new Date());
  const [dataPrenotazione, setDataPrenotazione] = useState(new Date().toISOString().split('T')[0]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [ripeti, setRipeti] = useState(false);
  const [dataFineRipetizione, setDataFineRipetizione] = useState('');
  const [dataFineRipetizioneObj, setDataFineRipetizioneObj] = useState(new Date());
  const [showDatePickerFine, setShowDatePickerFine] = useState(false);
  const [fasceSelezionate, setFasceSelezionate] = useState<any[]>([]);
  const [motivo, setMotivo] = useState('');
  const [classe, setClasse] = useState('');
  const [insegnanteRiferimento, setInsegnanteRiferimento] = useState('');
  const [studenteIPI, setStudenteIPI] = useState<any>(null);
  const [partecipanti, setPartecipanti] = useState(['']);

  // ---- AULA MODALE ----
  const [modalNuovaAula, setModalNuovaAula] = useState(false);
  const [aulaInModifica, setAulaInModifica] = useState<any>(null);
  const [nomeNuovaAula, setNomeNuovaAula] = useState('');
  const [nomeNuovaAulaAr, setNomeNuovaAulaAr] = useState('');
  const [capienzaNuovaAula, setCapienzaNuovaAula] = useState('');

  // ---- BLOCCO AULA ----
  const [modalBloccoAula, setModalBloccoAula] = useState(false);
  const [aulaDaBloccare, setAulaDaBloccare] = useState<any>(null);
  const [dataInizioBlocco, setDataInizioBlocco] = useState('');
  const [dataInizioBloccoObj, setDataInizioBloccoObj] = useState(new Date());
  const [showDatePickerBloccoInizio, setShowDatePickerBloccoInizio] = useState(false);
  const [dataFineBlocco, setDataFineBlocco] = useState('');
  const [dataFineBloccoObj, setDataFineBloccoObj] = useState(new Date());
  const [showDatePickerBloccoFine, setShowDatePickerBloccoFine] = useState(false);
  const [motivoBlocco, setMotivoBlocco] = useState('');

  // ---- IMPOSTAZIONI ----
  const [impostazioniVista, setImpostazioniVista] = useState('menu');
  const [esportaTipoSelezionato, setEsportaTipoSelezionato] = useState('prenotazioni');
  const [righeEspanseBloccoUtenti, setRigheEspanseBloccoUtenti] = useState<Record<string, any>>({}); // solo Android: id utente -> true se la riga della tabella "Blocca" è aperta
  const [righeEspansePermessiAvanzati, setRigheEspansePermessiAvanzati] = useState<Record<string, any>>({}); // solo Android: id utente -> true se la riga della tabella "Impostazioni Avanzate" è aperta

  // ---- AGGIUNGI UTENTE ----
  const [modalAggiungiUtente, setModalAggiungiUtente] = useState(false);
  const [nuovoUtenteNome, setNuovoUtenteNome] = useState('');
  const [nuovoUtenteEmail, setNuovoUtenteEmail] = useState('');
  const [nuovoUtentePassword, setNuovoUtentePassword] = useState('');
  const [nuovoUtenteRuolo, setNuovoUtenteRuolo] = useState('utente');
  const [modalScegliRuoloNuovoUtente, setModalScegliRuoloNuovoUtente] = useState(false);
  const [nuovoRuoloPersonalizzatoAttivo, setNuovoRuoloPersonalizzatoAttivo] = useState(false);
  const [nuovoDominio, setNuovoDominio] = useState('');
  const [nuovaClasseNome, setNuovaClasseNome] = useState('');
  const [classeInModifica, setClasseInModifica] = useState<any>(null);
  const [nuovaClasseTipo, setNuovaClasseTipo] = useState('medie');

  // ---- NUOVI STATI PER PROFILI E SCADENZA ----
  const [profiloDaCompletare, setProfiloDaCompletare] = useState(false); // true se l'utente deve completare il profilo
  const [necessitaDatiAulaStudio, setNecessitaDatiAulaStudio] = useState(false); // true se uno studente già registrato deve ancora completare tipo scuola/classe/numero registro
  const [modalProfiloPersonale, setModalProfiloPersonale] = useState(false); // modale profilo personale
  const [utenteProfiloModifica, setUtenteProfiloModifica] = useState<any>(null); // utente selezionato per modifica profilo (da sezione Profili)
  const [profiloModificaDati, setProfiloModificaDati] = useState<Record<string, any>>({}); // dati del form di modifica profilo (nome, anno, classe, dataNascita, dataScadenza); il Ruolo si legge da utenteProfiloModifica.role
  const [modalScegliClasseProfilo, setModalScegliClasseProfilo] = useState(false);
  const [modalScegliRuoloProfilo, setModalScegliRuoloProfilo] = useState(false);
  const [filtroRuoloProfiliDropdownAperto, setFiltroRuoloProfiliDropdownAperto] = useState(false);
  const [showDatePickerProfiloNascita, setShowDatePickerProfiloNascita] = useState(false); // solo Android: calendario data di nascita nella modifica profilo
  const [showDatePickerProfiloScadenza, setShowDatePickerProfiloScadenza] = useState(false); // solo Android: calendario data di scadenza nella modifica profilo
  const [filtriProfili, setFiltriProfili] = useState({
    ricerca: '',
    ruolo: 'tutti',
    classe: 'tutte',
    annoScolastico: 'tutti'
  });

  // ---- STATI PER SCHERMATA COMPLETA PROFILO ----
  const [tipoUtenteScelto, setTipoUtenteScelto] = useState<any>(null); // 'studente' | 'insegnante'
  const [annoScolasticoScelto, setAnnoScolasticoScelto] = useState('');
  const [classeScelta, setClasseScelta] = useState('');
  const [modalScegliClasseRegistrazione, setModalScegliClasseRegistrazione] = useState(false);
  const [dataNascitaScelta, setDataNascitaScelta] = useState('');
  const [dataNascitaObj, setDataNascitaObj] = useState(new Date());
  const [showDatePickerNascita, setShowDatePickerNascita] = useState(false);
  // MODIFICATO: dati Aula Studio chiesti allo studente nello stesso step di completamento profilo
  // (o, per chi è già registrato, nel mini-form una tantum al prossimo accesso).
  const [aulaStudioTipoScuolaScelto, setAulaStudioTipoScuolaScelto] = useState<any>(null); // 'medie' | 'ipi'
  const [aulaStudioNumeroRegistroScelto, setAulaStudioNumeroRegistroScelto] = useState('');
  const [salvandoDatiAulaStudio, setSalvandoDatiAulaStudio] = useState(false);

  // ---- STATI PER AGGIUNTA UTENTE CON PROFILO TEMPORANEO ----
  const [isTemporaneo, setIsTemporaneo] = useState(false);
  const [dataScadenzaUtente, setDataScadenzaUtente] = useState('');
  const [showDatePickerScadenza, setShowDatePickerScadenza] = useState(false);

  // ---- REGISTRO ATTIVITÀ ----
  const [registroAttivita, setRegistroAttivita] = useState<any[]>([]);
  const [registroDettaglio, setRegistroDettaglio] = useState<any>(null); // solo Android: riga registro attività selezionata
  const [filtroTipoRegistro, setFiltroTipoRegistro] = useState('Tutte');
  const [filtroModalitaRegistro, setFiltroModalitaRegistro] = useState('mensile');
  const [filtroMeseRegistro, setFiltroMeseRegistro] = useState(new Date().toISOString().slice(0, 7));
  const [filtroAnnoRegistro, setFiltroAnnoRegistro] = useState(String(new Date().getFullYear()));
  const [filtroTipoRegistroDropdownAperto, setFiltroTipoRegistroDropdownAperto] = useState(false);
  const [filtroMeseRegistroDropdownAperto, setFiltroMeseRegistroDropdownAperto] = useState(false);

  // ---- DERIVATI ----
  const colors = getThemeColors(isDarkMode);
  const styles = getDynamicStyles(colors, isRTL);

  // Funzioni helper per risolvere nomi sezioni/aule in arabo
  const risolviNomeSezione = (nome, currentLangArg) => {
    if (currentLangArg === 'ar') {
      const sez = sezioniLista.find((s) => s.nome === nome);
      if (sez && sez.nomeAr && sez.nomeAr.trim()) return sez.nomeAr.trim();
    }
    return etichettaSezione(nome, currentLangArg);
  };

  const risolviNomeAula = (nome, currentLangArg) => {
    if (currentLangArg === 'ar') {
      const aulaTrovata = aule.find((a) => a.nome === nome);
      if (aulaTrovata && aulaTrovata.nomeAr && aulaTrovata.nomeAr.trim()) return aulaTrovata.nomeAr.trim();
    }
    return nome;
  };

  // Stile per input date su web
  const webDateInputStyle: any = {
    backgroundColor: colors.surface,
    color: colors.textMain,
    padding: 12,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    marginBottom: 12,
    fontSize: 15,
    width: '100%',
    boxSizing: 'border-box'
  };

  // Verifica dominio consentito per la registrazione
  const verifyDomain = async (userEmail) => {
    try {
      const snap = await getDocs(collection(db, 'allowed_domains'));
      if (!snap.empty) {
        const allowedDomains = snap.docs.map(d => d.data().domain.toLowerCase());
        const userDomain = userEmail.split('@')[1]?.toLowerCase();
        if (allowedDomains.length > 0 && !allowedDomains.includes(userDomain)) return false;
      }
      return true;
    } catch (e) {
      return true;
    }
  };

  // ---- REGISTRO ATTIVITÀ ----
  const registraAttivita = async (tipo, dettaglio) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'registro_attivita'), {
        userId: user.uid,
        userEmail: user.email,
        userName: userName,
        tipo: tipo,
        dettaglio: dettaglio,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.warn('Errore registrazione attività:', e);
    }
  };

  // Carica il registro attività (usato nelle impostazioni)
  const caricaRegistroAttivita = async () => {
    try {
      const snap = await getDocs(collection(db, 'registro_attivita'));
      const lista = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      lista.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
      setRegistroAttivita(lista);
    } catch (e) {
      console.warn('Errore caricamento registro attività:', e);
    }
  };

  // ---- GESTIONE AUTH (LOGIN / REGISTRAZIONE) ----
  const handleAuth = async () => {
    if (!email || !password || (isRegistering && !nome)) {
      mostraAlert(t('attenzione', lang), t('compilaTuttiICampi', lang));
      return;
    }
    setLoading(true);
    setBlockedMessage('');

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    // Controllo dominio solo in registrazione
    if (isRegistering) {
      const isAllowed = await verifyDomain(cleanEmail);
      if (!isAllowed) {
        setLoading(false);
        setBlockedMessage(t('nonHaiAccesso', lang));
        return;
      }
    }

    try {
      let firebaseUser;
      let bypassVerificaEmail = false;

      if (isRegistering) {
        // ---- REGISTRAZIONE NUOVO UTENTE ----
        const res = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPassword);
        firebaseUser = res.user;
        await sendEmailVerification(firebaseUser);

        // Creazione documento utente con i NUOVI CAMPI
        await setDoc(doc(db, 'users', firebaseUser.uid), {
          nome: nome.trim(),
          email: cleanEmail,
          role: 'utente',
          emailVerified: false,
          createdAt: new Date().toISOString(),
          notifichePrefs: {
            [CATEGORIE_NOTIFICHE.NUOVA_PRENOTAZIONE]: true,
            [CATEGORIE_NOTIFICHE.ESITO_PRENOTAZIONE]: true,
            [CATEGORIE_NOTIFICHE.NUOVA_SEGNALAZIONE]: true,
            [CATEGORIE_NOTIFICHE.INIZIO_LAVORO]: true,
            [CATEGORIE_NOTIFICHE.FINE_LAVORO]: true
          },
          // NUOVI CAMPI PROFILO
          annoScolastico: null,
          dataNascita: null,
          classe: null,
          profiloCompleto: false,
          rolePersonalizzato: null,
          dataScadenza: null
        });

        setUserName(nome.trim());
        setUserRole('utente');

      } else {
        // ---- LOGIN ----
        const res = await signInWithEmailAndPassword(auth, cleanEmail, cleanPassword);
        firebaseUser = res.user;
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));

        if (userDoc.exists()) {
          const datiUtente = userDoc.data();

          // 1. Controllo bloccato
          if (datiUtente.bloccato === true) {
            await signOut(auth);
            setLoading(false);
            setBlockedMessage(t('accountBloccatoMessaggio', lang));
            return;
          }

          // 2. Controllo scadenza profilo temporaneo
          if (datiUtente.dataScadenza && new Date(datiUtente.dataScadenza) < new Date()) {
            await updateDoc(doc(db, 'users', firebaseUser.uid), { bloccato: true });
            await signOut(auth);
            setLoading(false);
            setBlockedMessage(`${t('profiloScaduto', lang)} ${formattaDataOra(datiUtente.dataScadenza, lang)}.`);
            return;
          }

          // 3. Impostazione ruolo e nome
          setUserRole(datiUtente.role || 'utente');
          setUserName(datiUtente.nome || cleanEmail);

          // 4. Migrazione preferenze notifiche (se non esistono)
          let prefs = datiUtente.notifichePrefs || {};
          if (!datiUtente.notifichePrefs) {
            const oldPrenotazioni = datiUtente.notifichePrenotazioni !== undefined ? datiUtente.notifichePrenotazioni : true;
            const oldSegnalazioni = datiUtente.notificheSegnalazioni !== undefined ? datiUtente.notificheSegnalazioni : true;
            prefs = {
              [CATEGORIE_NOTIFICHE.NUOVA_PRENOTAZIONE]: oldPrenotazioni,
              [CATEGORIE_NOTIFICHE.ESITO_PRENOTAZIONE]: oldPrenotazioni,
              [CATEGORIE_NOTIFICHE.NUOVA_SEGNALAZIONE]: oldSegnalazioni,
              [CATEGORIE_NOTIFICHE.INIZIO_LAVORO]: oldSegnalazioni,
              [CATEGORIE_NOTIFICHE.FINE_LAVORO]: oldSegnalazioni
            };
            try {
              await updateDoc(doc(db, 'users', firebaseUser.uid), { notifichePrefs: prefs });
            } catch (e) {}
          }
          setNotifichePrefs(prefs);

          // 5. Verifica email bypass per utenti creati da gestore
          bypassVerificaEmail = datiUtente.creatoDaGestore === true;
          if (bypassVerificaEmail && datiUtente.primoAccessoEffettuato === false) {
            try { await updateDoc(doc(db, 'users', firebaseUser.uid), { primoAccessoEffettuato: true }); } catch (e) {}
          }

          // 6. Controllo se profilo completo
          if (!datiUtente.profiloCompleto) {
            setProfiloDaCompletare(true);
          } else {
            setProfiloDaCompletare(false);
          }
          // MODIFICATO: studenti già registrati prima dell'introduzione di
          // Aula Studio non hanno ancora tipo scuola/classe/numero di
          // registro: li completano una tantum al prossimo accesso.
          setNecessitaDatiAulaStudio(datiUtente.role === 'studente' && !datiUtente.aulaStudioProfiloCompletato);
          // MODIFICATO: le classi (con il campo "tipo" Medie/IPI) servono già
          // durante la schermata di completamento profilo, che va in scena
          // PRIMA di caricaDatiGenerali(): le carichiamo qui a parte.
          try {
            const snapClassiPrecoce = await getDocs(collection(db, 'classi'));
            setClassiLista(snapClassiPrecoce.docs.map(d => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)));
          } catch (e) {}
        }
      }

      setUser(firebaseUser);

      // Verifica email
      if (!firebaseUser.emailVerified && !bypassVerificaEmail) {
        setEmailNonVerificata(true);
      } else {
        setEmailNonVerificata(false);
        if (!bypassVerificaEmail) {
          try { await updateDoc(doc(db, 'users', firebaseUser.uid), { emailVerified: true }); } catch (e) {}
        }
        // Se non deve completare profilo, carica i dati
        if (!profiloDaCompletare) {
          caricaDatiGenerali();
        }
      }

    } catch (err) {
      console.error("DEBUG - ERRORE DETTAGLIATO FIREBASE:", err.code, err.message);
      if (err.code === 'auth/invalid-credential') {
        mostraAlert(t('erroreDiAccesso', lang), t('credenzialiNonValide', lang));
      } else if (err.code === 'auth/email-already-in-use') {
        mostraAlert(t('emailGiaRegistrata', lang), t('emailGiaRegistrataDettaglio', lang));
      } else {
        mostraAlert(t('errore', lang), err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // ---- REINVIA EMAIL VERIFICA ----
  const reinviaEmailVerifica = async () => {
    if (!auth.currentUser) {
      mostraAlert(t('errore', lang), t('nessunUtenteAutenticato', lang));
      return;
    }
    try {
      await sendEmailVerification(auth.currentUser);
      mostraAlert('', t('emailInviataDiNuovo', lang));
    } catch (e) {
      mostraAlert(t('errore', lang), e.code + ': ' + e.message);
    }
  };

  // ---- APRE IL MANUALE AMMINISTRATIVO (IT/AR) DALLA SCHERMATA DI ACCESSO ----
  // Prova prima il file caricato dal gestore su Storage (Impostazioni → Manuali);
  // se non è mai stato caricato nulla (storage/object-not-found), usa la copia
  // predefinita pubblicata insieme al sito, così il pulsante funziona comunque.
  const apriManuale = async (linguaManuale) => {
    setManualeInCaricamento(linguaManuale);
    try {
      const url = await getDownloadURL(storageRef(storage, MANUALE_STORAGE_PATH[linguaManuale]));
      await Linking.openURL(url);
    } catch (e) {
      await Linking.openURL(MANUALE_FALLBACK_URL[linguaManuale]);
    } finally {
      setManualeInCaricamento(null);
      setShowManualiChoice(false);
    }
  };

  // ---- IMPOSTAZIONI → MANUALI: carica/sostituisce il manuale IT o AR su Storage ----
  const caricaManuale = (linguaManuale) => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.doc,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword';
    input.onchange = async (ev: any) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      if (!/\.docx?$/i.test(file.name)) {
        mostraAlert(t('errore', lang), t('manualiFormatoNonValido', lang));
        return;
      }
      setManualiStato((s) => ({ ...s, [linguaManuale]: 'uploading' }));
      try {
        await uploadBytes(
          storageRef(storage, MANUALE_STORAGE_PATH[linguaManuale]),
          file,
          { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
        );
        const meta = await getMetadata(storageRef(storage, MANUALE_STORAGE_PATH[linguaManuale]));
        setManualiMeta((m) => ({ ...m, [linguaManuale]: meta }));
        setManualiStato((s) => ({ ...s, [linguaManuale]: 'success' }));
        registraAttivita(TIPI_REGISTRO.CARICAMENTO_MANUALE, `Manuale amministrativo (${linguaManuale.toUpperCase()}) aggiornato: ${file.name}`);
      } catch (e) {
        console.warn('Errore caricamento manuale:', e);
        setManualiStato((s) => ({ ...s, [linguaManuale]: 'error' }));
      }
    };
    input.click();
  };

  // ---- CONTROLLA SE EMAIL È STATA VERIFICATA ----
  const controllaEmailVerificata = async () => {
    try {
      if (auth.currentUser) {
        await auth.currentUser.reload();
        if (auth.currentUser.emailVerified) {
          setEmailNonVerificata(false);
          await updateDoc(doc(db, 'users', auth.currentUser.uid), { emailVerified: true });
          caricaDatiGenerali();
        } else {
          mostraAlert(t('attenzione', lang), t('emailNonVerificataAncora', lang));
        }
      }
    } catch (e) {
      mostraAlert(t('errore', lang), e.message);
    }
  };

  // ---- RESET PASSWORD ----
  const handlePasswordReset = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      mostraAlert(t('attenzione', lang), t('inserisciEmailPrimaReset', lang));
      return;
    }
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      mostraAlert('', t('emailResetInviata', lang));
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        mostraAlert(t('errore', lang), t('emailNonRegistrataReset', lang));
      } else {
        mostraAlert(t('errore', lang), e.message);
      }
    }
  };

  // ---- LOGOUT ----
  const handleLogout = async () => {
    setUser(null);
    setUserRole('utente');
    setEmailNonVerificata(false);
    setSezioneSelezionata(null);
    setVistaAttiva('home');
    setEmail('');
    setPassword('');
    setNome('');
    setAppBloccata(false);
    setProfiloDaCompletare(false);
    try {
      await signOut(auth);
    } catch (e) {
      console.error('Errore logout:', e);
    }
  };

  // ---- COMPLETAMENTO PROFILO (dopo verifica email) ----
  const completaProfilo = async () => {
    if (!tipoUtenteScelto) {
      mostraAlert(t('attenzione', lang), t('scegliTipo', lang));
      return;
    }
    if (!dataNascitaScelta) {
      mostraAlert(t('attenzione', lang), t('dataNascita', lang) + ' obbligatoria.');
      return;
    }
    if (tipoUtenteScelto === 'studente') {
      if (!annoScolasticoScelto) {
        mostraAlert(t('attenzione', lang), t('annoScolastico', lang) + ' obbligatorio.');
        return;
      }
      if (!classeScelta) {
        mostraAlert(t('attenzione', lang), t('classe', lang) + ' obbligatoria.');
        return;
      }
      // MODIFICATO: allo stesso passo chiediamo anche i dati per Aula Studio,
      // così lo studente non deve più fare una registrazione separata dopo.
      if (!aulaStudioTipoScuolaScelto) {
        mostraAlert(t('attenzione', lang), t('aulaStudioSceglieTipoScuola', lang));
        return;
      }
      if (!aulaStudioNumeroRegistroScelto.trim()) {
        mostraAlert(t('attenzione', lang), t('aulaStudioNumeroInClasse', lang) + ' obbligatorio.');
        return;
      }
    }
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        // Il Ruolo è l'unica fonte di verità: assegniamo direttamente 'studente' o 'insegnante'.
        // Non ci sono controindicazioni di sicurezza: questi ruoli non hanno permessi speciali.
        role: tipoUtenteScelto,
        annoScolastico: tipoUtenteScelto === 'studente' ? annoScolasticoScelto : null,
        dataNascita: dataNascitaScelta,
        classe: tipoUtenteScelto === 'studente' ? classeScelta : null,
        profiloCompleto: true
      });
      if (tipoUtenteScelto === 'studente') {
        const { nome: nomeSep, cognome: cognomeSep } = separaNomeCognomeAulaStudio(userName);
        await salvaProfiloAulaStudio(db, user.uid, {
          tipoScuola: aulaStudioTipoScuolaScelto,
          classe: classeScelta,
          numeroRegistro: aulaStudioNumeroRegistroScelto.trim(),
          nomeStudente: nomeSep,
          cognomeStudente: cognomeSep,
        });
        setNecessitaDatiAulaStudio(false);
      }
      setUserRole(tipoUtenteScelto);
      setProfiloDaCompletare(false);
      caricaDatiGenerali();
      mostraAlert('', t('profiloCompletato', lang) || 'Profilo completato con successo!');
    } catch (e) {
      mostraAlert(t('errore', lang), e.message);
    }
  };

  // ---- COMPLETAMENTO DATI AULA STUDIO (per studenti già registrati prima di questa funzione) ----
  const completaDatiAulaStudioEsistente = async () => {
    if (!aulaStudioTipoScuolaScelto) {
      mostraAlert(t('attenzione', lang), t('aulaStudioSceglieTipoScuola', lang));
      return;
    }
    if (!classeScelta) {
      mostraAlert(t('attenzione', lang), t('aulaStudioScegliereClasse', lang));
      return;
    }
    if (!aulaStudioNumeroRegistroScelto.trim()) {
      mostraAlert(t('attenzione', lang), t('aulaStudioNumeroInClasse', lang) + ' obbligatorio.');
      return;
    }
    setSalvandoDatiAulaStudio(true);
    try {
      const { nome: nomeSep, cognome: cognomeSep } = separaNomeCognomeAulaStudio(userName);
      await salvaProfiloAulaStudio(db, user.uid, {
        tipoScuola: aulaStudioTipoScuolaScelto,
        classe: classeScelta,
        numeroRegistro: aulaStudioNumeroRegistroScelto.trim(),
        nomeStudente: nomeSep,
        cognomeStudente: cognomeSep,
      });
      setNecessitaDatiAulaStudio(false);
      caricaDatiGenerali();
    } catch (e) {
      mostraAlert(t('errore', lang), e.message);
    } finally {
      setSalvandoDatiAulaStudio(false);
    }
  };

  // ---- CARICA DATI GENERALI (aule, prenotazioni, utenti, sezioni, manutenzione, notifiche) ----
  const caricaDatiGenerali = async () => {
    try {
      let snapAule = await getDocs(collection(db, 'aule'));
      if (snapAule.empty) {
        const auleIniziali = [
          { nome: 'Aula Magna', nomeAr: 'القاعة الكبرى', capienza: '120', sezione: 'Scuola Base', ordine: 0 },
          { nome: 'Laboratorio 1', nomeAr: 'المختبر ١', capienza: '25', sezione: 'Scuola Base', ordine: 1 },
          { nome: 'Aula 1A', nomeAr: 'فصل ١أ', capienza: '30', sezione: 'Scuola Media', ordine: 0 },
          { nome: 'Aula 2B', nomeAr: 'فصل ٢ب', capienza: '28', sezione: 'Scuola Media', ordine: 1 },
          { nome: 'Officina Meccanica', nomeAr: 'ورشة الميكانيكا', capienza: '20', sezione: 'Scuola Professionale', ordine: 0 },
          { nome: 'Lab Elettrico', nomeAr: 'مختبر الكهرباء', capienza: '18', sezione: 'Scuola Professionale', ordine: 1 },
          { nome: 'Sala Consiliare', nomeAr: 'قاعة المجلس', capienza: '50', sezione: 'Comuni', ordine: 0 },
          { nome: 'Sala Polifunzionale', nomeAr: 'القاعة متعددة الأغراض', capienza: '80', sezione: 'Comuni', ordine: 1 }
        ];
        for (const a of auleIniziali) { await addDoc(collection(db, 'aule'), a); }
        snapAule = await getDocs(collection(db, 'aule'));
      }
      setAule(snapAule.docs.map(d => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)));

      const snapPrenotazioni = await getDocs(collection(db, 'prenotazioni'));
      setPrenotazioni(snapPrenotazioni.docs.map(d => ({ id: d.id, ...d.data() })));

      const snapDomini = await getDocs(collection(db, 'allowed_domains'));
      setDominiLista(snapDomini.docs.map(d => ({ id: d.id, ...d.data() })));

      let snapClassi = await getDocs(collection(db, 'classi'));
      if (snapClassi.empty) {
        for (let i = 0; i < CLASSI_DISPONIBILI.length; i++) {
          await addDoc(collection(db, 'classi'), { nome: CLASSI_DISPONIBILI[i], ordine: i });
        }
        snapClassi = await getDocs(collection(db, 'classi'));
      }
      setClassiLista(snapClassi.docs.map(d => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)));

      const snapUtenti = await getDocs(collection(db, 'users'));
      setUtentiLista(snapUtenti.docs.map(d => ({ id: d.id, ...d.data() })));

      let snapSezioni = await getDocs(collection(db, 'sezioni'));
      if (snapSezioni.empty) {
        for (let i = 0; i < SEZIONI_INIZIALI.length; i++) {
          await addDoc(collection(db, 'sezioni'), { nome: SEZIONI_INIZIALI[i], ordine: i });
        }
        snapSezioni = await getDocs(collection(db, 'sezioni'));
      }
      let sezioniArr = snapSezioni.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      if (!sezioniArr.some((s: any) => s.speciale === 'aulaStudio')) {
        const ordineMax = sezioniArr.reduce((max: number, s: any) => Math.max(max, s.ordine ?? 0), -1);
        await addDoc(collection(db, 'sezioni'), { nome: 'Aula Studio', nomeAr: 'قاعة الدراسة', ordine: ordineMax + 1, speciale: 'aulaStudio' });
        const snapSezioni2 = await getDocs(collection(db, 'sezioni'));
        sezioniArr = snapSezioni2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      }
      setSezioniLista(sezioniArr.sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)));

      const snapManutenzione = await getDocs(collection(db, 'manutenzione'));
      setManutenzioneLista(snapManutenzione.docs.map(d => ({ id: d.id, ...d.data() })));

      if (user) {
        const snapNotifiche = await getDocs(collection(db, 'notifiche'));
        const mieNotifiche = snapNotifiche.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(n => n.utenteId === user.uid)
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setNotificheLista(mieNotifiche);
      }
    } catch (e) {
      console.log('Errore caricamento dati:', e);
    }
  };

  useEffect(() => {
    let primoControllo = true;
    const nonSottoscritto = onAuthStateChanged(auth, async (firebaseUser) => {
      if (primoControllo) {
        primoControllo = false;
        if (firebaseUser) {
          try {
            await signOut(auth);
          } catch (e) {
            console.warn('Errore durante la disconnessione della sessione salvata:', e);
          }
          return;
        }
      }
      if (!firebaseUser) {
        setUser(null);
        setInitializing(false);
        return;
      }
      try {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const datiUtente = userDoc.data();
          if (datiUtente.bloccato === true) {
            await signOut(auth);
            setUser(null);
            setInitializing(false);
            return;
          }
          // Controllo scadenza profilo temporaneo
          if (datiUtente.dataScadenza && new Date(datiUtente.dataScadenza) < new Date()) {
            await updateDoc(doc(db, 'users', firebaseUser.uid), { bloccato: true });
            await signOut(auth);
            setUser(null);
            setInitializing(false);
            return;
          }
          setUserRole(datiUtente.role || 'utente');
          setUserName(datiUtente.nome || firebaseUser.email);

          // Migrazione preferenze notifiche
          let prefs = datiUtente.notifichePrefs || {};
          if (!datiUtente.notifichePrefs) {
            const oldPrenotazioni = datiUtente.notifichePrenotazioni !== undefined ? datiUtente.notifichePrenotazioni : true;
            const oldSegnalazioni = datiUtente.notificheSegnalazioni !== undefined ? datiUtente.notificheSegnalazioni : true;
            prefs = {
              [CATEGORIE_NOTIFICHE.NUOVA_PRENOTAZIONE]: oldPrenotazioni,
              [CATEGORIE_NOTIFICHE.ESITO_PRENOTAZIONE]: oldPrenotazioni,
              [CATEGORIE_NOTIFICHE.NUOVA_SEGNALAZIONE]: oldSegnalazioni,
              [CATEGORIE_NOTIFICHE.INIZIO_LAVORO]: oldSegnalazioni,
              [CATEGORIE_NOTIFICHE.FINE_LAVORO]: oldSegnalazioni
            };
            try {
              await updateDoc(doc(db, 'users', firebaseUser.uid), { notifichePrefs: prefs });
            } catch (e) {}
          }
          setNotifichePrefs(prefs);

          const bypassVerificaEmail = datiUtente.creatoDaGestore === true;
          setEmailNonVerificata(!firebaseUser.emailVerified && !bypassVerificaEmail);

          // Controllo profilo completo
          if (!datiUtente.profiloCompleto) {
            setProfiloDaCompletare(true);
          } else {
            setProfiloDaCompletare(false);
          }
          setNecessitaDatiAulaStudio(datiUtente.role === 'studente' && !datiUtente.aulaStudioProfiloCompletato);
          try {
            const snapClassiPrecoce = await getDocs(collection(db, 'classi'));
            setClassiLista(snapClassiPrecoce.docs.map(d => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)));
          } catch (e) {}
        }
        setUser(firebaseUser);
      } catch (e) {
        console.error('Errore ripristino sessione salvata:', e);
        setUser(null);
      } finally {
        setInitializing(false);
      }
    });
    return nonSottoscritto;
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    (async () => {
      try {
        const supportato = await LocalAuthentication.hasHardwareAsync();
        const registrato = supportato && (await LocalAuthentication.isEnrolledAsync());
        setBiometricoDisponibile(!!registrato);
        const salvato = await AsyncStorage.getItem('biometricoAttivo');
        setBiometricoAttivo(salvato === 'true' && !!registrato);
      } catch (e) {
        console.warn('Impossibile verificare sensore impronta:', e);
      }
    })();
  }, []);

  useEffect(() => {
    if (!initializing && user && !emailNonVerificata && biometricoAttivo && !profiloDaCompletare) {
      setAppBloccata(true);
    }
  }, [initializing, user, emailNonVerificata, biometricoAttivo, profiloDaCompletare]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let statoPrecedente = AppState.currentState;
    const sub = AppState.addEventListener('change', (nuovoStato) => {
      if (statoPrecedente.match(/inactive|background/) && nuovoStato === 'active') {
        if (user && !emailNonVerificata && biometricoAttivo && !profiloDaCompletare) {
          setAppBloccata(true);
        }
      }
      statoPrecedente = nuovoStato;
    });
    return () => sub.remove();
  }, [user, emailNonVerificata, biometricoAttivo, profiloDaCompletare]);

  const sbloccaConImpronta = async () => {
    try {
      const esito = await LocalAuthentication.authenticateAsync({
        promptMessage: t('sbloccoImprontaPrompt', lang),
        cancelLabel: t('annulla', lang),
        disableDeviceFallback: false
      });
      if (esito.success) setAppBloccata(false);
    } catch (e) {
      console.warn('Errore autenticazione biometrica:', e);
    }
  };

  const toggleBiometrico = async () => {
    if (!biometricoAttivo) {
      if (!biometricoDisponibile) {
        mostraAlert(t('attenzione', lang), t('sbloccoImprontaNonDisponibile', lang));
        return;
      }
      try {
        const esito = await LocalAuthentication.authenticateAsync({
          promptMessage: t('sbloccoImprontaPrompt', lang),
          cancelLabel: t('annulla', lang)
        });
        if (!esito.success) return;
      } catch (e) {
        return;
      }
      setBiometricoAttivo(true);
      await AsyncStorage.setItem('biometricoAttivo', 'true');
    } else {
      setBiometricoAttivo(false);
      await AsyncStorage.setItem('biometricoAttivo', 'false');
    }
  };

  useEffect(() => {
    if (user && !emailNonVerificata && !profiloDaCompletare) {
      caricaDatiGenerali();
    }
  }, [user, vistaAttiva, emailNonVerificata, profiloDaCompletare]);

  useEffect(() => {
    if (!user || emailNonVerificata || profiloDaCompletare) return;
    (async () => {
      const token = await registraPushTokenDispositivo();
      if (token) {
        try { await updateDoc(doc(db, 'users', user.uid), { pushToken: token }); } catch (e) {}
      }
    })();
  }, [user, emailNonVerificata, profiloDaCompletare]);

  // Su web, dopo il login/completamento profilo (o cambio vista) la pagina
  // può restare scrollata in basso (es. per il focus lasciato su un input
  // della schermata precedente): la riportiamo sempre in cima.
  useEffect(() => {
    if (Platform.OS === 'web' && user && !emailNonVerificata && !profiloDaCompletare) {
      if (typeof window !== 'undefined' && window.scrollTo) {
        window.scrollTo(0, 0);
      }
    }
  }, [user, emailNonVerificata, profiloDaCompletare, vistaAttiva]);


  const creaNotificaInApp = async (destinatarioUid, titolo, corpo, extra) => {
    if (!destinatarioUid) return;
    await addDoc(collection(db, 'notifiche'), {
      utenteId: destinatarioUid,
      titolo,
      corpo,
      letta: false,
      createdAt: new Date().toISOString(),
      ...(extra || {})
    });
  };

  const inviaNotificaConPreferenza = async (destinatarioUid, categoria, titolo, corpo, extra) => {
    if (!destinatarioUid) return;
    const utente = utentiLista.find(u => u.id === destinatarioUid);
    if (!utente) return;
    const prefs = utente.notifichePrefs || {};
    if (prefs[categoria] === false) return;

    await creaNotificaInApp(destinatarioUid, titolo, corpo, extra);
    if (utente.pushToken) {
      await inviaNotificaPush(utente.pushToken, titolo, corpo, extra);
    }
  };

  const toggleNotifica = async (categoria) => {
    const nuovoValore = !notifichePrefs[categoria];
    setNotifichePrefs(prev => ({ ...prev, [categoria]: nuovoValore }));
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        [`notifichePrefs.${categoria}`]: nuovoValore
      });
    } catch (e) {
      console.error('Errore aggiornamento preferenza notifica:', e);
      setNotifichePrefs(prev => ({ ...prev, [categoria]: !nuovoValore }));
    }
  };

  const segnaNotificaComeLetta = async (id) => {
    try {
      await updateDoc(doc(db, 'notifiche', id), { letta: true });
      setNotificheLista((prev) => prev.map((n) => (n.id === id ? { ...n, letta: true } : n)));
    } catch (e) {
      console.error('Errore aggiornamento notifica:', e);
    }
  };

  const segnaTutteLeNotificheComeLette = async () => {
    const nonLette = notificheLista.filter(n => !n.letta);
    for (const n of nonLette) {
      try { await updateDoc(doc(db, 'notifiche', n.id), { letta: true }); } catch (e) {}
    }
    setNotificheLista((prev) => prev.map(n => ({ ...n, letta: true })));
  };

  const eliminaNotifica = async (id) => {
    const eseguiCancellazione = async () => {
      try {
        await deleteDoc(doc(db, 'notifiche', id));
        setNotificheLista((prev) => prev.filter((n) => n.id !== id));
      } catch (e) {
        console.error('Errore eliminazione notifica:', e);
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('sicuroDiCancellare', lang))) await eseguiCancellazione();
    } else {
      Alert.alert(t('conferma', lang), t('sicuroDiCancellare', lang), [{ text: t('annulla', lang) }, { text: t('cancella', lang), onPress: eseguiCancellazione }]);
    }
  };

  const notificheNonLette = notificheLista.filter(n => !n.letta).length;

  const onChangeDate = (event, selectedDate) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setDataPrenotazioneObj(selectedDate);
      setDataPrenotazione(selectedDate.toISOString().split('T')[0]);
    }
  };

  const onChangeDateWeb = (e) => {
    const valore = e.target.value;
    if (!valore) return;
    setDataPrenotazione(valore);
    setDataPrenotazioneObj(new Date(valore + 'T00:00:00'));
  };

  const onChangeDateFine = (event, selectedDate) => {
    setShowDatePickerFine(Platform.OS === 'ios');
    if (selectedDate) {
      setDataFineRipetizioneObj(selectedDate);
      setDataFineRipetizione(selectedDate.toISOString().split('T')[0]);
    }
  };

  const onChangeDateFineWeb = (e) => {
    const valore = e.target.value;
    if (!valore) return;
    setDataFineRipetizione(valore);
    setDataFineRipetizioneObj(new Date(valore + 'T00:00:00'));
  };

  const toggleFascia = (fascia) => {
    if (fasceSelezionate.includes(fascia)) {
      setFasceSelezionate(fasceSelezionate.filter(f => f !== fascia));
    } else {
      setFasceSelezionate([...fasceSelezionate, fascia]);
    }
  };

  const aggiungiCampoPartecipante = () => setPartecipanti([...partecipanti, '']);
  const rimuoviCampoPartecipante = (idx) => {
    if (partecipanti.length === 1) return;
    setPartecipanti(partecipanti.filter((_, i) => i !== idx));
  };
  const modificaPartecipante = (idx, valore) => {
    const copia = [...partecipanti];
    copia[idx] = valore;
    setPartecipanti(copia);
  };

  const chiudiModalePrenotazione = () => {
    setAulaInPrenotazione(null);
    setFasceSelezionate([]);
    setMotivo('');
    setClasse('');
    setInsegnanteRiferimento('');
    setStudenteIPI(null);
    setPartecipanti(['']);
    setDataPrenotazione(new Date().toISOString().split('T')[0]);
    setDataPrenotazioneObj(new Date());
    setShowDatePicker(false);
    setRipeti(false);
    setDataFineRipetizione('');
    setDataFineRipetizioneObj(new Date());
    setShowDatePickerFine(false);
  };

  const haConflittoUtente = (data, fasce) => {
    return prenotazioni.some((p) =>
      p.utenteEmail === user.email &&
      p.data === data &&
      p.stato !== 'Rifiutata' &&
      p.fasce.some(f => fasce.includes(f))
    );
  };

  const inviaPrenotazione = async () => {
    if (!motivo.trim() || fasceSelezionate.length === 0) {
      mostraAlert(t('attenzione', lang), t('compilaMotivoFascia', lang));
      return;
    }
    if (sezioneSelezionata === 'Scuola Professionale' && !studenteIPI) {
      mostraAlert(t('attenzione', lang), t('studenteIPIObbligatorioMessaggio', lang));
      return;
    }
    if (sezioneSelezionata === 'Scuola Professionale' && studenteIPI === 'si' && !classe.trim()) {
      mostraAlert(t('attenzione', lang), t('classeObbligatoriaMessaggio', lang));
      return;
    }
    if (ripeti && !dataFineRipetizione) {
      mostraAlert(t('attenzione', lang), t('dataFineRipetizioneObbligatoria', lang));
      return;
    }
    if (ripeti && dataFineRipetizione <= dataPrenotazione) {
      mostraAlert(t('attenzione', lang), t('dataFineDeveEssereSuccessiva', lang));
      return;
    }

    const dateDaPrenotare = ripeti
      ? generaDateRipetizione(dataPrenotazioneObj, dataFineRipetizione)
      : [dataPrenotazione];

    const gruppoRipetizione = ripeti ? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
    const richiedeAutorizzazioneSpeciale = ripeti && dataFineRipetizione > limiteNormaleStr;

    let conflittoPersonale = false;
    let saltate = 0;

    try {
      for (const dataSingola of dateDaPrenotare) {
        const occupataDaAltri = prenotazioni.some((p) =>
          p.aulaId === aulaInPrenotazione.id &&
          p.data === dataSingola &&
          p.stato !== 'Rifiutata' &&
          p.fasce.some(f => fasceSelezionate.includes(f))
        );
        if (occupataDaAltri) {
          saltate++;
          continue;
        }

        if (haConflittoUtente(dataSingola, fasceSelezionate)) conflittoPersonale = true;

        await addDoc(collection(db, 'prenotazioni'), {
          aulaId: aulaInPrenotazione.id,
          aulaNome: aulaInPrenotazione.nome,
          sezione: sezioneSelezionata,
          data: dataSingola,
          fasce: fasceSelezionate,
          motivo: motivo.trim(),
          studenteIPI: sezioneSelezionata === 'Scuola Professionale' ? studenteIPI : null,
          classe: sezioneSelezionata === 'Scuola Professionale' && studenteIPI === 'si' ? classe.trim() : '',
          insegnanteRiferimento: insegnanteRiferimento.trim(),
          partecipanti: partecipanti.map(p => p.trim()).filter(p => p !== ''),
          utenteNome: userName,
          utenteEmail: user.email,
          stato: 'In attesa',
          ...(gruppoRipetizione ? { gruppoRipetizione } : {}),
          ...(richiedeAutorizzazioneSpeciale ? { richiedeAutorizzazioneSpeciale: true } : {})
        });

        await registraAttivita(
          TIPI_REGISTRO.CREAZIONE_PRENOTAZIONE,
          `Prenotazione per ${aulaInPrenotazione.nome} il ${dataSingola} fasce ${fasceSelezionate.join(', ')} da ${userName}`
        );
      }

      // Notifica agli approvatori
      const approvatori = utentiLista.filter(u => 
        puoApprovarePrenotazioni(u.role) && u.id !== user.uid
      );
      if (approvatori.length > 0) {
        const titoloIt = t('notificaNuovaRichiestaTitolo', 'it', aulaInPrenotazione.nome);
        const corpoIt = t('notificaNuovaRichiestaCorpo', 'it', userName, aulaInPrenotazione.nome, dataPrenotazione);
        const titoloAr = t('notificaNuovaRichiestaTitolo', 'ar', aulaInPrenotazione.nome);
        const corpoAr = t('notificaNuovaRichiestaCorpo', 'ar', userName, aulaInPrenotazione.nome, dataPrenotazione);
        const titolo = `${titoloIt} / ${titoloAr}`;
        const corpo = `${corpoIt}\n${corpoAr}`;
        const extra = { tipo: 'nuova_richiesta', aulaNome: aulaInPrenotazione.nome, data: dataPrenotazione };

        for (const approvatore of approvatori) {
          await inviaNotificaConPreferenza(
            approvatore.id,
            CATEGORIE_NOTIFICHE.NUOVA_PRENOTAZIONE,
            titolo,
            corpo,
            extra
          );
        }
      }

      chiudiModalePrenotazione();
      caricaDatiGenerali();

      if (ripeti) {
        const inviate = dateDaPrenotare.length - saltate;
        let msg = t('richiesteRipetuteInviate', lang, inviate);
        if (saltate > 0) msg += t('alcuneDateSaltate', lang, saltate);
        mostraAlert('', msg);
      } else if (conflittoPersonale) {
        mostraAlert(t('attenzione', lang), t('haiGiaUnaRichiesta', lang));
      } else {
        mostraAlert('', t('richiestaInviata', lang));
      }
    } catch (e) {
      console.error('Errore:', e);
    }
  };

  const cambiaStatoPrenotazione = async (id, nuovoStato, utenteEmail, aulaNome, data, fasce) => {
    await updateDoc(doc(db, 'prenotazioni', id), { stato: nuovoStato });
    const dettagliOrario = fasce && fasce.length > 0 ? fasce.join(', ') : '';
    const approvata = nuovoStato === 'Approvata';

    const tipoAzione = approvata ? TIPI_REGISTRO.APPROVAZIONE_PRENOTAZIONE : TIPI_REGISTRO.RIFIUTO_PRENOTAZIONE;
    await registraAttivita(
      tipoAzione,
      `Prenotazione per ${aulaNome} del ${data} (fasce ${dettagliOrario}) ${approvata ? 'approvata' : 'rifiutata'}`
    );

    const titoloIt = approvata ? t('notificaApprovataTitolo', 'it', aulaNome) : t('notificaRifiutataTitolo', 'it', aulaNome);
    const corpoIt = approvata ? t('notificaApprovataCorpo', 'it', aulaNome, data, dettagliOrario) : t('notificaRifiutataCorpo', 'it', aulaNome, data, dettagliOrario);
    const titoloAr = approvata ? t('notificaApprovataTitolo', 'ar', aulaNome) : t('notificaRifiutataTitolo', 'ar', aulaNome);
    const corpoAr = approvata ? t('notificaApprovataCorpo', 'ar', aulaNome, data, dettagliOrario) : t('notificaRifiutataCorpo', 'ar', aulaNome, data, dettagliOrario);
    const titolo = `${titoloIt} / ${titoloAr}`;
    const corpo = `${corpoIt}\n${corpoAr}`;

    const destinatario = utentiLista.find((u) => u.email === utenteEmail);
    if (destinatario) {
      await inviaNotificaConPreferenza(
        destinatario.id,
        CATEGORIE_NOTIFICHE.ESITO_PRENOTAZIONE,
        titolo,
        corpo,
        { tipo: approvata ? 'approvazione' : 'rifiuto', prenotazioneId: id, aulaNome, data, fasce: fasce || [] }
      );
    }
    caricaDatiGenerali();
  };

  const eliminaPrenotazione = async (id) => {
    const eseguiCancellazione = async () => {
      try {
        await deleteDoc(doc(db, 'prenotazioni', id));
        await caricaDatiGenerali();
        mostraAlert('', t('cancellata', lang));
      } catch (e) {
        console.error('Errore:', e);
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('sicuroDiCancellare', lang))) await eseguiCancellazione();
    } else {
      Alert.alert(t('conferma', lang), t('sicuroDiCancellare', lang), [{ text: t('annulla', lang) }, { text: t('cancella', lang), onPress: eseguiCancellazione }]);
    }
  };

  const eliminaGruppoPrenotazioni = async (gruppoRipetizione) => {
    const daEliminare = prenotazioni.filter((p) => p.gruppoRipetizione === gruppoRipetizione);
    if (daEliminare.length === 0) return;
    const eseguiCancellazione = async () => {
      try {
        for (const p of daEliminare) {
          await deleteDoc(doc(db, 'prenotazioni', p.id));
        }
        await caricaDatiGenerali();
        mostraAlert('', t('cancellata', lang));
      } catch (e) {
        console.error('Errore:', e);
      }
    };
    const messaggioConferma = t('eliminareGruppoConferma', lang, daEliminare.length);
    if (Platform.OS === 'web') {
      if (window.confirm(messaggioConferma)) await eseguiCancellazione();
    } else {
      Alert.alert(t('conferma', lang), messaggioConferma, [{ text: t('annulla', lang) }, { text: t('cancella', lang), onPress: eseguiCancellazione }]);
    }
  };

  const apriNuovaAula = () => {
    setAulaInModifica(null);
    setNomeNuovaAula('');
    setNomeNuovaAulaAr('');
    setCapienzaNuovaAula('');
    setModalNuovaAula(true);
  };

  const apriModificaAula = (aula) => {
    setAulaInModifica(aula);
    setNomeNuovaAula(aula.nome);
    setNomeNuovaAulaAr(aula.nomeAr || '');
    setCapienzaNuovaAula(String(aula.capienza));
    setModalNuovaAula(true);
  };

  const salvaAula = async () => {
    if (!nomeNuovaAula.trim() || !capienzaNuovaAula.trim()) {
      mostraAlert(t('attenzione', lang), t('inserisciNomeCapienza', lang));
      return;
    }
    try {
      if (aulaInModifica) {
        await updateDoc(doc(db, 'aule', aulaInModifica.id), {
          nome: nomeNuovaAula.trim(),
          nomeAr: nomeNuovaAulaAr.trim(),
          capienza: capienzaNuovaAula.trim()
        });
        await registraAttivita(
          TIPI_REGISTRO.MODIFICA_AULA,
          `Aula ${nomeNuovaAula.trim()} modificata (capienza ${capienzaNuovaAula.trim()})`
        );
      } else {
        const auleSezione = aule.filter((a) => a.sezione === sezioneSelezionata);
        await addDoc(collection(db, 'aule'), {
          nome: nomeNuovaAula.trim(),
          nomeAr: nomeNuovaAulaAr.trim(),
          capienza: capienzaNuovaAula.trim(),
          sezione: sezioneSelezionata,
          ordine: auleSezione.length
        });
        await registraAttivita(
          TIPI_REGISTRO.AGGIUNTA_AULA,
          `Aula ${nomeNuovaAula.trim()} creata (capienza ${capienzaNuovaAula.trim()}) nella sezione ${risolviNomeSezione(sezioneSelezionata, lang)}`
        );
      }
      setModalNuovaAula(false);
      setAulaInModifica(null);
      caricaDatiGenerali();
    } catch (e) {
      console.error('Errore:', e);
    }
  };

  const eliminaAula = async (id) => {
    const esegui = async () => {
      const aula = aule.find(a => a.id === id);
      await deleteDoc(doc(db, 'aule', id));
      if (aula) {
        await registraAttivita(
          TIPI_REGISTRO.ELIMINAZIONE_AULA,
          `Aula ${aula.nome} eliminata`
        );
      }
      caricaDatiGenerali();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('eliminareAulaConferma', lang))) await esegui();
    } else {
      Alert.alert(t('conferma', lang), t('eliminareAulaConferma', lang), [{ text: t('annulla', lang) }, { text: t('elimina', lang), onPress: esegui }]);
    }
  };

  const spostaAula = async (aulaId, direzione) => {
    const auleSezione = aule.filter((a) => a.sezione === sezioneSelezionata).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0));
    const index = auleSezione.findIndex((a) => a.id === aulaId);
    const targetIndex = direzione === 'su' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= auleSezione.length) return;

    const nuovaSottoLista = [...auleSezione];
    const temp = nuovaSottoLista[index];
    nuovaSottoLista[index] = nuovaSottoLista[targetIndex];
    nuovaSottoLista[targetIndex] = temp;

    const auleAggiornate = aule.map((a) => {
      const foundInSub = nuovaSottoLista.find((sub) => sub.id === a.id);
      if (foundInSub) {
        return { ...a, ordine: nuovaSottoLista.indexOf(foundInSub) };
      }
      return a;
    }).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0));

    setAule(auleAggiornate);

    try {
      for (let i = 0; i < nuovaSottoLista.length; i++) {
        await updateDoc(doc(db, 'aule', nuovaSottoLista[i].id), { ordine: i });
      }
    } catch (e) {
      console.error('Errore aggiornamento ordine aule:', e);
    }
  };

  const apriBloccaAula = (aula) => {
    setAulaDaBloccare(aula);
    setDataInizioBlocco('');
    setDataInizioBloccoObj(new Date());
    setDataFineBlocco('');
    setDataFineBloccoObj(new Date());
    setMotivoBlocco('');
    setModalBloccoAula(true);
  };

  const chiudiBloccaAula = () => {
    setModalBloccoAula(false);
    setAulaDaBloccare(null);
    setDataInizioBlocco('');
    setDataFineBlocco('');
    setMotivoBlocco('');
    setShowDatePickerBloccoInizio(false);
    setShowDatePickerBloccoFine(false);
  };

  const onChangeDateBloccoInizio = (event, selectedDate) => {
    setShowDatePickerBloccoInizio(Platform.OS === 'ios');
    if (selectedDate) {
      setDataInizioBloccoObj(selectedDate);
      setDataInizioBlocco(selectedDate.toISOString().split('T')[0]);
    }
  };
  const onChangeDateBloccoInizioWeb = (e) => {
    const valore = e.target.value;
    if (!valore) return;
    setDataInizioBlocco(valore);
    setDataInizioBloccoObj(new Date(valore + 'T00:00:00'));
  };
  const onChangeDateBloccoFine = (event, selectedDate) => {
    setShowDatePickerBloccoFine(Platform.OS === 'ios');
    if (selectedDate) {
      setDataFineBloccoObj(selectedDate);
      setDataFineBlocco(selectedDate.toISOString().split('T')[0]);
    }
  };
  const onChangeDateBloccoFineWeb = (e) => {
    const valore = e.target.value;
    if (!valore) return;
    setDataFineBlocco(valore);
    setDataFineBloccoObj(new Date(valore + 'T00:00:00'));
  };

  const confermaBloccoAula = async () => {
    if (!dataInizioBlocco || !dataFineBlocco) {
      mostraAlert(t('attenzione', lang), t('compilaDateBlocco', lang));
      return;
    }
    if (dataFineBlocco < dataInizioBlocco) {
      mostraAlert(t('attenzione', lang), t('dataFineBloccoSuccessiva', lang));
      return;
    }
    if (!motivoBlocco.trim()) {
      mostraAlert(t('attenzione', lang), t('motivoBloccoObbligatorio', lang));
      return;
    }

    const giorni: string[] = [];
    let corrente = new Date(dataInizioBloccoObj);
    const fine = new Date(dataFineBlocco + 'T00:00:00');
    let sicurezza = 0;
    while (corrente <= fine && sicurezza < 731) {
      giorni.push(corrente.toISOString().split('T')[0]);
      corrente = new Date(corrente);
      corrente.setDate(corrente.getDate() + 1);
      sicurezza++;
    }
    if (sicurezza >= 731) {
      mostraAlert(t('attenzione', lang), t('troppiGiorniBlocco', lang));
      return;
    }

    const gruppoBlocco = `blocco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      for (const dataGiorno of giorni) {
        await addDoc(collection(db, 'prenotazioni'), {
          aulaId: aulaDaBloccare.id,
          aulaNome: aulaDaBloccare.nome,
          sezione: aulaDaBloccare.sezione,
          data: dataGiorno,
          fasce: FASCE_ORARIE,
          motivo: motivoBlocco.trim(),
          classe: '',
          partecipanti: [],
          utenteNome: t('bloccatoDalGestore', lang),
          utenteEmail: user.email,
          stato: 'Approvata',
          bloccoGestore: true,
          gruppoRipetizione: gruppoBlocco
        });
      }
      chiudiBloccaAula();
      caricaDatiGenerali();
      mostraAlert('', t('bloccoCreato', lang, giorni.length));
    } catch (e) {
      console.error('Errore blocco aula:', e);
    }
  };

  const aggiungiSezione = async () => {
    if (!nuovaSezioneNome.trim()) return;
    await addDoc(collection(db, 'sezioni'), {
      nome: nuovaSezioneNome.trim(),
      nomeAr: nuovaSezioneNomeAr.trim(),
      ordine: sezioniLista.length
    });
    setNuovaSezioneNome('');
    setNuovaSezioneNomeAr('');
    setModalNuovaSezione(false);
    caricaDatiGenerali();
  };

  const chiudiModaleNuovaSezione = () => {
    setModalNuovaSezione(false);
    setNuovaSezioneNome('');
    setNuovaSezioneNomeAr('');
  };

  const apriModificaSezione = (sez) => {
    setSezioneInModifica(sez);
    setNomeSezioneInModifica(sez.nome);
    setNomeSezioneInModificaAr(sez.nomeAr || '');
    setModalModificaSezione(true);
  };

  const salvaSezioneModificata = async () => {
    if (!nomeSezioneInModifica.trim() || !sezioneInModifica) return;
    try {
      await updateDoc(doc(db, 'sezioni', sezioneInModifica.id), {
        nome: nomeSezioneInModifica.trim(),
        nomeAr: nomeSezioneInModificaAr.trim()
      });
      setModalModificaSezione(false);
      setSezioneInModifica(null);
      caricaDatiGenerali();
    } catch (e) {
      console.error('Errore modifica sezione:', e);
    }
  };

  const eliminaSezione = async (id) => {
    const esegui = async () => {
      await deleteDoc(doc(db, 'sezioni', id));
      caricaDatiGenerali();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('eliminareSezioneConferma', lang))) await esegui();
    } else {
      Alert.alert(t('conferma', lang), t('eliminareSezioneConferma', lang), [{ text: t('annulla', lang) }, { text: t('elimina', lang), onPress: esegui }]);
    }
  };

  const spostaSezione = async (index, direzione) => {
    const targetIndex = direzione === 'su' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sezioniLista.length) return;

    const nuovaLista = [...sezioniLista];
    const temp = nuovaLista[index];
    nuovaLista[index] = nuovaLista[targetIndex];
    nuovaLista[targetIndex] = temp;

    setSezioniLista(nuovaLista);

    try {
      for (let i = 0; i < nuovaLista.length; i++) {
        await updateDoc(doc(db, 'sezioni', nuovaLista[i].id), { ordine: i });
      }
    } catch (e) {
      console.error('Errore aggiornamento ordine sezioni:', e);
    }
  };

  const impostaRuoloUtente = async (uid, nuovoRuolo) => {
    const utenteTarget = utentiLista.find((u) => u.id === uid);
    if (utenteTarget && utenteTarget.role === 'gestore' && nuovoRuolo !== 'gestore') {
      const altriGestori = utentiLista.filter((u) => u.role === 'gestore' && u.id !== uid);
      if (altriGestori.length === 0) {
        mostraAlert(t('attenzione', lang), t('nonPuoiRimuovereUltimoGestore', lang));
        setUtenteRuoloModalTarget(null);
        return;
      }
    }
    // Il Ruolo è l'unica fonte di verità: se diventa 'studente', la sezione profilo
    // (anno scolastico/classe) si attiva automaticamente in base a questo campo.
    const aggiornamentoRuolo = { role: nuovoRuolo };
    await updateDoc(doc(db, 'users', uid), aggiornamentoRuolo);
    const vecchioRuolo = utenteTarget?.role || 'utente';
    await registraAttivita(
      TIPI_REGISTRO.MODIFICA_RUOLO_UTENTE,
      `Ruolo di ${utenteTarget?.nome || utenteTarget?.email} cambiato da ${etichettaRuolo(vecchioRuolo, lang)} a ${etichettaRuolo(nuovoRuolo, lang)}`
    );
    setUtenteRuoloModalTarget(null);
    // Se il ruolo modificato è quello dell'utente aperto nella Modale Modifica Profilo,
    // aggiorna anche quello stato così il campo Ruolo riflette subito il nuovo valore.
    setUtenteProfiloModifica(prev => (prev && prev.id === uid ? { ...prev, role: nuovoRuolo } : prev));
    caricaDatiGenerali();
  };

  const generaPasswordCasuale = () => {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 12; i++) {
      pwd += charset[Math.floor(Math.random() * charset.length)];
    }
    setNuovoUtentePassword(pwd);
  };

  const aggiungiUtenteManuale = async () => {
    if (!nuovoUtenteNome.trim() || !nuovoUtenteEmail.trim() || !nuovoUtentePassword.trim()) {
      mostraAlert(t('attenzione', lang), t('inserisciNomeEmailPassword', lang));
      return;
    }
    if (nuovoUtentePassword.trim().length < 6) {
      mostraAlert(t('attenzione', lang), t('passwordTroppoCorta', lang));
      return;
    }

    const nomeAppSecondaria = `secondaria-${Date.now()}`;
    const appSecondaria = initializeApp(firebaseConfig, nomeAppSecondaria);
    const authSecondaria = getAuth(appSecondaria);
    const emailPulita = nuovoUtenteEmail.trim().toLowerCase();

    // Gestione ruolo personalizzato: se il ruolo scelto non è tra quelli standard, lo salviamo come personalizzato
    const ruoloFinale = RUOLI_TUTTI.includes(nuovoUtenteRuolo) ? nuovoUtenteRuolo : 'utente';
    const ruoloPersonalizzato = RUOLI_TUTTI.includes(nuovoUtenteRuolo) ? null : nuovoUtenteRuolo;

    try {
      const res = await createUserWithEmailAndPassword(authSecondaria, emailPulita, nuovoUtentePassword.trim());
      await setDoc(doc(db, 'users', res.user.uid), {
        nome: nuovoUtenteNome.trim(),
        email: emailPulita,
        role: ruoloFinale,
        emailVerified: true,
        creatoDaGestore: true,
        primoAccessoEffettuato: false,
        createdAt: new Date().toISOString(),
        notifichePrefs: {
          [CATEGORIE_NOTIFICHE.NUOVA_PRENOTAZIONE]: true,
          [CATEGORIE_NOTIFICHE.ESITO_PRENOTAZIONE]: true,
          [CATEGORIE_NOTIFICHE.NUOVA_SEGNALAZIONE]: true,
          [CATEGORIE_NOTIFICHE.INIZIO_LAVORO]: true,
          [CATEGORIE_NOTIFICHE.FINE_LAVORO]: true
        },
        // NUOVI CAMPI PROFILO
        annoScolastico: null,
        dataNascita: null,
        classe: null,
        profiloCompleto: false,
        rolePersonalizzato: ruoloPersonalizzato,
        dataScadenza: isTemporaneo ? dataScadenzaUtente : null
      });
      try {
        await sendPasswordResetEmail(authSecondaria, emailPulita);
      } catch (mailErr) {
        console.warn('Utente creato ma invio email di invito fallito:', mailErr);
      }
      await registraAttivita(
        TIPI_REGISTRO.CREAZIONE_UTENTE,
        `Utente ${nuovoUtenteNome.trim()} creato con ruolo ${etichettaRuolo(ruoloFinale, lang)}${ruoloPersonalizzato ? ' (' + ruoloPersonalizzato + ')' : ''}${isTemporaneo ? ' (temporaneo fino al ' + dataScadenzaUtente + ')' : ''}`
      );
      setNuovoUtenteNome('');
      setNuovoUtenteEmail('');
      setNuovoUtentePassword('');
      setNuovoUtenteRuolo('utente');
      setNuovoRuoloPersonalizzatoAttivo(false);
      setIsTemporaneo(false);
      setDataScadenzaUtente('');
      setModalAggiungiUtente(false);
      caricaDatiGenerali();
      mostraAlert('', t('accountCreatoConSuccesso', lang));
    } catch (e) {
      console.error('Errore creazione account da Gestore:', e);
      mostraAlert(t('attenzione', lang), e.code === 'auth/email-already-in-use' ? t('emailGiaRegistrata', lang) : t('erroreCreazioneAccount', lang));
    } finally {
      try { await signOut(authSecondaria); } catch (err) {}
      try { await deleteApp(appSecondaria); } catch (err) {}
    }
  };

  const rinviaInvitoUtente = async (targetEmail) => {
    try {
      await sendPasswordResetEmail(auth, targetEmail);
      mostraAlert('', t('invitoRinviato', lang));
    } catch (e) {
      mostraAlert(t('errore', lang), e.message);
    }
  };

  const eliminaUtenteDallaLista = (u) => {
    const esegui = async () => {
      try {
        // MODIFICATO: prima si cancellava solo la scheda Firestore, lasciando
        // attivo l'accesso su Firebase Authentication. Ora si chiama la
        // funzione serverless (Vercel) che, con l'Admin SDK, cancella
        // DAVVERO anche l'account di accesso.
        const idToken = await auth.currentUser.getIdToken();
        const risposta = await fetch(DELETE_USER_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ targetUid: u.id }),
        });
        const risultato = await risposta.json().catch(() => ({}));
        if (!risposta.ok) {
          throw new Error(risultato.error || 'Eliminazione non riuscita');
        }
        await registraAttivita(
          TIPI_REGISTRO.ELIMINAZIONE_UTENTE,
          `Utente ${u.nome} eliminato definitivamente (account + lista)`
        );
        caricaDatiGenerali();
        mostraAlert('', t('utenteRimossoDallaLista', lang));
      } catch (e) {
        mostraAlert(t('errore', lang), e.message);
      }
    };
    const messaggio = t('confermaEliminaUtenteMessaggio', lang, u.nome);
    if (Platform.OS === 'web') {
      if (window.confirm(messaggio)) esegui();
    } else {
      Alert.alert(t('conferma', lang), messaggio, [{ text: t('annulla', lang) }, { text: t('eliminaUtenteAzione', lang), onPress: esegui }]);
    }
  };

  const aggiungiDominio = async () => {
    if (!nuovoDominio.trim()) return;
    await addDoc(collection(db, 'allowed_domains'), { domain: nuovoDominio.trim().toLowerCase().replace('@', '') });
    await registraAttivita(
      TIPI_REGISTRO.AGGIUNTA_DOMINIO,
      `Dominio ${nuovoDominio.trim().toLowerCase()} aggiunto`
    );
    setNuovoDominio('');
    caricaDatiGenerali();
  };

  const rimuoviDominio = async (id) => {
    const dominio = dominiLista.find(d => d.id === id);
    await deleteDoc(doc(db, 'allowed_domains', id));
    if (dominio) {
      await registraAttivita(
        TIPI_REGISTRO.RIMOZIONE_DOMINIO,
        `Dominio ${dominio.domain} rimosso`
      );
    }
    caricaDatiGenerali();
  };

  const aggiungiClasse = async () => {
    if (!nuovaClasseNome.trim()) return;
    if (classeInModifica) {
      await updateDoc(doc(db, 'classi', classeInModifica.id), { nome: nuovaClasseNome.trim(), tipo: nuovaClasseTipo });
      await registraAttivita(TIPI_REGISTRO.MODIFICA_CLASSE, `Classe ${classeInModifica.nome} rinominata in ${nuovaClasseNome.trim()}`);
      setClasseInModifica(null);
    } else {
      await addDoc(collection(db, 'classi'), { nome: nuovaClasseNome.trim(), tipo: nuovaClasseTipo, ordine: classiLista.length });
      await registraAttivita(TIPI_REGISTRO.AGGIUNTA_CLASSE, `Classe ${nuovaClasseNome.trim()} aggiunta`);
    }
    setNuovaClasseNome('');
    setNuovaClasseTipo('medie');
    setMostraFormAggiungiClasse(false);
    caricaDatiGenerali();
  };

  const avviaModificaClasse = (classeItem) => {
    setClasseInModifica(classeItem);
    setNuovaClasseNome(classeItem.nome);
    setNuovaClasseTipo(classeItem.tipo === 'ipi' ? 'ipi' : 'medie');
    setMostraFormAggiungiClasse(true);
  };

  const annullaModificaClasse = () => {
    setClasseInModifica(null);
    setNuovaClasseNome('');
    setNuovaClasseTipo('medie');
    setMostraFormAggiungiClasse(false);
  };

  const eliminaClasse = async (id) => {
    const classeItem = classiLista.find(c => c.id === id);
    const esegui = async () => {
      await deleteDoc(doc(db, 'classi', id));
      if (classeItem) {
        await registraAttivita(TIPI_REGISTRO.ELIMINAZIONE_CLASSE, `Classe ${classeItem.nome} eliminata`);
      }
      caricaDatiGenerali();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('confermaEliminazioneClasse', lang))) esegui();
    } else {
      Alert.alert(t('conferma', lang), t('confermaEliminazioneClasse', lang), [{ text: t('annulla', lang) }, { text: t('eliminaUtenteAzione', lang), onPress: esegui }]);
    }
  };

  // Classifica in blocco tutte le classi ancora "Da classificare" col tipo scelto (Medie/IPI)
  const classificaClassiNonAssegnate = async (tipoScelto) => {
    const classiDaClassificare = classiLista.filter((c) => c.tipo !== 'medie' && c.tipo !== 'ipi');
    if (classiDaClassificare.length === 0) return;
    const esegui = async () => {
      for (const c of classiDaClassificare) {
        await updateDoc(doc(db, 'classi', c.id), { tipo: tipoScelto });
      }
      await registraAttivita(TIPI_REGISTRO.MODIFICA_CLASSE, `${classiDaClassificare.length} classi classificate come ${tipoScelto === 'ipi' ? 'IPI' : 'Medie'}`);
      caricaDatiGenerali();
    };
    const messaggioConferma = t('confermaClassificaClassiBulk', lang, classiDaClassificare.length, tipoScelto === 'ipi' ? 'IPI' : 'Medie');
    if (Platform.OS === 'web') {
      if (window.confirm(messaggioConferma)) esegui();
    } else {
      Alert.alert(t('conferma', lang), messaggioConferma, [{ text: t('annulla', lang) }, { text: t('conferma', lang), onPress: esegui }]);
    }
  };

   const eseguiResetPrenotazioni = async () => {
    const effettuaReset = async () => {
      try {
        let prenotazioniDaEliminare: any[] = [];
        if (resetModalita === 'mensile') {
          prenotazioniDaEliminare = prenotazioni.filter((p) => p.data && p.data.startsWith(resetMeseSelezionato));
        } else {
          prenotazioniDaEliminare = prenotazioni.filter((p) => p.data && p.data.startsWith(resetAnnoSelezionato));
        }
        for (const p of prenotazioniDaEliminare) {
          await deleteDoc(doc(db, 'prenotazioni', p.id));
        }
        await caricaDatiGenerali();
        mostraAlert('', t('resetCompletato', lang));
      } catch (e) {
        console.error('Errore durante il reset:', e);
        mostraAlert(t('errore', lang), e.message);
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('confermaResetMessaggio', lang))) {
        await effettuaReset();
      }
    } else {
      Alert.alert(t('confermaResetTitolo', lang), t('confermaResetMessaggio', lang), [
        { text: t('annulla', lang), style: 'cancel' },
        { text: t('conferma', lang), style: 'destructive', onPress: effettuaReset }
      ]);
    }
  };

  const eseguiBloccoUtenti = async (vuoleBloccare) => {
    const effettua = async () => {
      try {
        const utentiTarget = utentiLista.filter((u) => {
          if (!u.createdAt) return false;
          if (u.email === user.email) return false;
          return bloccaModalita === 'mensile'
            ? u.createdAt.startsWith(bloccaMeseSelezionato)
            : u.createdAt.startsWith(bloccaAnnoSelezionato);
        });
        for (const u of utentiTarget) {
          await updateDoc(doc(db, 'users', u.id), { bloccato: vuoleBloccare });
        }
        await caricaDatiGenerali();
        mostraAlert('', vuoleBloccare ? t('bloccoUtentiCompletato', lang, utentiTarget.length) : t('sbloccoUtentiCompletato', lang, utentiTarget.length));
      } catch (e) {
        console.error('Errore durante il blocco/sblocco utenti:', e);
        mostraAlert(t('errore', lang), e.message);
      }
    };
    const titolo = vuoleBloccare ? t('confermaBloccoUtentiTitolo', lang) : t('confermaSbloccoUtentiTitolo', lang);
    const messaggio = vuoleBloccare ? t('confermaBloccoUtentiMessaggio', lang) : t('confermaSbloccoUtentiMessaggio', lang);
    if (Platform.OS === 'web') {
      if (window.confirm(messaggio)) await effettua();
    } else {
      Alert.alert(titolo, messaggio, [
        { text: t('annulla', lang), style: 'cancel' },
        { text: t('conferma', lang), style: 'destructive', onPress: effettua }
      ]);
    }
  };

  const eseguiBloccoSingolo = async (utenteTarget, vuoleBloccare) => {
    if (utenteTarget.email === user.email) return;
    const effettua = async () => {
      try {
        await updateDoc(doc(db, 'users', utenteTarget.id), { bloccato: vuoleBloccare });
        await caricaDatiGenerali();
        mostraAlert('', vuoleBloccare
          ? t('bloccoSingoloCompletato', lang, utenteTarget.nome || utenteTarget.email)
          : t('sbloccoSingoloCompletato', lang, utenteTarget.nome || utenteTarget.email));
      } catch (e) {
        console.error('Errore durante il blocco/sblocco del singolo utente:', e);
        mostraAlert(t('errore', lang), e.message);
      }
    };
    const titolo = vuoleBloccare ? t('confermaBloccoSingoloTitolo', lang) : t('confermaSbloccoSingoloTitolo', lang);
    const messaggio = vuoleBloccare
      ? t('confermaBloccoSingoloMessaggio', lang, utenteTarget.nome || utenteTarget.email)
      : t('confermaSbloccoSingoloMessaggio', lang, utenteTarget.nome || utenteTarget.email);
    if (Platform.OS === 'web') {
      if (window.confirm(messaggio)) await effettua();
    } else {
      Alert.alert(titolo, messaggio, [
        { text: t('annulla', lang), style: 'cancel' },
        { text: t('conferma', lang), style: 'destructive', onPress: effettua }
      ]);
    }
  };

  const inviaSegnalazioneManutenzione = async () => {
    if (!aulaManutenzioneSelezionata) {
      mostraAlert(t('attenzione', lang), t('selezionaAulaManutenzione', lang));
      return;
    }
    if (!tipoGuastoSelezionato) {
      mostraAlert(t('attenzione', lang), t('selezionaTipoGuasto', lang));
      return;
    }
    if (!descrizioneGuasto.trim()) {
      mostraAlert(t('attenzione', lang), t('descrizioneObbligatoriaMessaggio', lang));
      return;
    }
    try {
      const oraSegnalazione = new Date().toISOString();
      await addDoc(collection(db, 'manutenzione'), {
        aulaNome: aulaManutenzioneSelezionata.nome,
        sezione: aulaManutenzioneSelezionata.sezione,
        tipoGuasto: tipoGuastoSelezionato,
        descrizione: descrizioneGuasto.trim(),
        utenteNome: userName,
        utenteEmail: user.email,
        stato: 'Da risolvere',
        data: oraSegnalazione.split('T')[0],
        tsSegnalazione: oraSegnalazione,
        tsPresaInCarico: null,
        tsRisoluzione: null,
        diario: []
      });

      await registraAttivita(
        TIPI_REGISTRO.CREAZIONE_SEGNALAZIONE,
        `Segnalazione per ${aulaManutenzioneSelezionata.nome} di tipo ${etichettaTipoGuasto(tipoGuastoSelezionato, lang)}`
      );

      const destinatariSegnalazione = utentiLista.filter(u => 
        (puoGestireManutenzione(u.role) || RUOLI_TIPO_SEGRETERIA.includes(u.role)) &&
        u.id !== user.uid
      );
      if (destinatariSegnalazione.length > 0) {
        const titoloIt = t('notificaNuovaSegnalazioneTitolo', 'it', aulaManutenzioneSelezionata.nome);
        const corpoIt = t('notificaNuovaSegnalazioneCorpo', 'it', userName, aulaManutenzioneSelezionata.nome, tipoGuastoSelezionato);
        const titoloAr = t('notificaNuovaSegnalazioneTitolo', 'ar', aulaManutenzioneSelezionata.nome);
        const corpoAr = t('notificaNuovaSegnalazioneCorpo', 'ar', userName, aulaManutenzioneSelezionata.nome, tipoGuastoSelezionato);
        const titolo = `${titoloIt} / ${titoloAr}`;
        const corpo = `${corpoIt}\n${corpoAr}`;
        const extra = { tipo: 'nuova_segnalazione', aulaNome: aulaManutenzioneSelezionata.nome };

        for (const dest of destinatariSegnalazione) {
          await inviaNotificaConPreferenza(
            dest.id,
            CATEGORIE_NOTIFICHE.NUOVA_SEGNALAZIONE,
            titolo,
            corpo,
            extra
          );
        }
      }

      setModalNuovaSegnalazione(false);
      setAulaManutenzioneSelezionata(null);
      setTipoGuastoSelezionato(null);
      setDescrizioneGuasto('');
      caricaDatiGenerali();
      mostraAlert('', t('segnalazioneInviata', lang));
    } catch (e) {
      console.error('Errore:', e);
    }
  };

  const cambiaStatoManutenzione = async (id, nuovoStato, segnalazioneCorrente) => {
    const aggiornamento: any = { stato: nuovoStato };
    const ora = new Date().toISOString();
    if (nuovoStato === 'In lavorazione' && !segnalazioneCorrente?.tsPresaInCarico) {
      aggiornamento.tsPresaInCarico = ora;
    }
    if (nuovoStato === 'Risolto') {
      aggiornamento.tsRisoluzione = ora;
    }
    await updateDoc(doc(db, 'manutenzione', id), aggiornamento);
    setSegnalazioneDettaglio((prev) => (prev && prev.id === id) ? { ...prev, ...aggiornamento } : prev);

    let tipoAzione;
    let dettaglioAzione;
    if (nuovoStato === 'In lavorazione') {
      tipoAzione = TIPI_REGISTRO.PRESA_IN_CARICO_SEGNALAZIONE;
      dettaglioAzione = `Segnalazione per ${segnalazioneCorrente.aulaNome} presa in carico da ${userName}`;
    } else if (nuovoStato === 'Risolto') {
      tipoAzione = TIPI_REGISTRO.RISOLUZIONE_SEGNALAZIONE;
      dettaglioAzione = `Segnalazione per ${segnalazioneCorrente.aulaNome} risolta`;
    } else {
      tipoAzione = 'cambio_stato_segnalazione';
      dettaglioAzione = `Segnalazione per ${segnalazioneCorrente.aulaNome} riportata a "Da risolvere"`;
    }
    await registraAttivita(tipoAzione, dettaglioAzione);

    if (nuovoStato === 'In lavorazione' || nuovoStato === 'Risolto') {
      const categoria = nuovoStato === 'In lavorazione' 
        ? CATEGORIE_NOTIFICHE.INIZIO_LAVORO 
        : CATEGORIE_NOTIFICHE.FINE_LAVORO;
      
      const titoloIt = t(nuovoStato === 'In lavorazione' 
        ? 'notificaSegnalazioneInLavorazioneTitolo' 
        : 'notificaSegnalazioneRisoltaTitolo', 'it', segnalazioneCorrente.aulaNome);
      const corpoIt = t(nuovoStato === 'In lavorazione' 
        ? 'notificaSegnalazioneInLavorazioneCorpo' 
        : 'notificaSegnalazioneRisoltaCorpo', 'it', segnalazioneCorrente.aulaNome);
      const titoloAr = t(nuovoStato === 'In lavorazione' 
        ? 'notificaSegnalazioneInLavorazioneTitolo' 
        : 'notificaSegnalazioneRisoltaTitolo', 'ar', segnalazioneCorrente.aulaNome);
      const corpoAr = t(nuovoStato === 'In lavorazione' 
        ? 'notificaSegnalazioneInLavorazioneCorpo' 
        : 'notificaSegnalazioneRisoltaCorpo', 'ar', segnalazioneCorrente.aulaNome);
      const titolo = `${titoloIt} / ${titoloAr}`;
      const corpo = `${corpoIt}\n${corpoAr}`;
      const extra = { 
        tipo: nuovoStato === 'In lavorazione' ? 'segnalazione_in_lavorazione' : 'segnalazione_risolta',
        segnalazioneId: id,
        aulaNome: segnalazioneCorrente.aulaNome
      };

      const destinatariLavoro = utentiLista.filter(u => 
        (puoGestireManutenzione(u.role) || RUOLI_TIPO_SEGRETERIA.includes(u.role)) &&
        u.id !== user.uid &&
        u.email !== segnalazioneCorrente.utenteEmail
      );

      for (const dest of destinatariLavoro) {
        await inviaNotificaConPreferenza(
          dest.id,
          categoria,
          titolo,
          corpo,
          extra
        );
      }
    }

    caricaDatiGenerali();
  };

  const eliminaManutenzione = async (id) => {
    const esegui = async () => {
      await deleteDoc(doc(db, 'manutenzione', id));
      setSegnalazioneDettaglio((prev) => (prev && prev.id === id) ? null : prev);
      caricaDatiGenerali();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('sicuroDiCancellare', lang))) await esegui();
    } else {
      Alert.alert(t('conferma', lang), t('sicuroDiCancellare', lang), [{ text: t('annulla', lang) }, { text: t('cancella', lang), onPress: esegui }]);
    }
  };

  const aggiungiVoceDiario = async (id) => {
    if (!nuovaVoceDiario.trim()) return;
    const voce = { testo: nuovaVoceDiario.trim(), autore: userName, timestamp: new Date().toISOString() };
    try {
      await updateDoc(doc(db, 'manutenzione', id), { diario: arrayUnion(voce) });
      setNuovaVoceDiario('');
      setSegnalazioneDettaglio((prev) => (prev && prev.id === id) ? { ...prev, diario: [...(prev.diario || []), voce] } : prev);
      caricaDatiGenerali();
    } catch (e) {
      console.error('Errore diario:', e);
    }
  };

  const eliminaArchivioManutenzione = async () => {
    const chiave = archivioManutenzioneModalita === 'mensile' ? archivioManutenzioneMeseSelezionato : archivioManutenzioneAnnoSelezionato;
    const daEliminare = manutenzioneLista.filter((s) => {
      if (s.stato !== 'Risolto') return false;
      const riferimento = s.tsRisoluzione || s.data || '';
      return riferimento.startsWith(chiave);
    });

    const effettuaEliminazione = async () => {
      try {
        for (const s of daEliminare) {
          await deleteDoc(doc(db, 'manutenzione', s.id));
        }
        setSegnalazioneDettaglio((prev) => (prev && daEliminare.some((s) => s.id === prev.id)) ? null : prev);
        await caricaDatiGenerali();
        mostraAlert('', t('archivioManutenzioneEliminato', lang, daEliminare.length));
      } catch (e) {
        console.error('Errore eliminazione archivio manutenzione:', e);
        mostraAlert(t('errore', lang), e.message);
      }
    };

    if (daEliminare.length === 0) {
      mostraAlert('', t('archivioManutenzioneEliminato', lang, 0));
      return;
    }
    const messaggioConferma = t('confermaEliminaArchivioManutenzione', lang, daEliminare.length);
    if (Platform.OS === 'web') {
      if (window.confirm(messaggioConferma)) await effettuaEliminazione();
    } else {
      Alert.alert(t('confermaResetTitolo', lang), messaggioConferma, [
        { text: t('annulla', lang), style: 'cancel' },
        { text: t('conferma', lang), style: 'destructive', onPress: effettuaEliminazione }
      ]);
    }
  };

  const scriviECondividiExcel = async (nomeFile, righe) => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(righe);
    XLSX.utils.book_append_sheet(wb, ws, 'Dati');

    if (Platform.OS === 'web') {
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = nomeFile;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return;
    }

    const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    const uri = FileSystem.cacheDirectory + nomeFile;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
    const disponibile = await Sharing.isAvailableAsync();
    if (disponibile) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: nomeFile
      });
    } else {
      mostraAlert('', t('esportazioneNonDisponibile', lang));
    }
  };

  const esportaPrenotazioniExcel = async () => {
    const chiave = resetModalita === 'mensile' ? resetMeseSelezionato : resetAnnoSelezionato;
    const daEsportare = prenotazioni.filter((p) => p.data && p.data.startsWith(chiave));

    if (daEsportare.length === 0) {
      mostraAlert('', t('nessunDatoDaEsportare', lang));
      return;
    }

    setEsportazioneInCorso(true);
    try {
      const righe = daEsportare
        .slice()
        .sort((a, b) => (a.data || '').localeCompare(b.data || ''))
        .map((p) => {
          const etichettaStato = p.stato === 'In attesa' ? t('inAttesa', lang)
            : p.stato === 'Approvata' ? t('approvata', lang)
            : p.stato === 'Rifiutata' ? t('rifiutata', lang)
            : (p.stato || '');
          return {
            [t('aula', lang)]: p.aulaNome || '',
            Sezione: risolviNomeSezione(p.sezione, lang) || '',
            [t('data', lang)]: p.data || '',
            [t('colFasceOrarie', lang)]: (p.fasce || []).join(', '),
            [t('motivo', lang)]: p.motivo || '',
            [t('classe', lang)]: p.classe || '',
            [t('insegnanteRiferimento', lang)]: p.insegnanteRiferimento || '',
            [t('partecipanti', lang)]: (p.partecipanti || []).join(', '),
            [t('colRichiestoDa', lang)]: p.utenteNome || '',
            [t('email', lang)]: p.utenteEmail || '',
            [t('stato', lang)]: etichettaStato,
            [t('colSpeciale', lang)]: p.richiedeAutorizzazioneSpeciale ? 'SI' : 'NO',
            [t('colRipetizione', lang)]: p.gruppoRipetizione ? 'SI' : 'NO'
          };
        });

      const nomeFile = `prenotazioni_${chiave.replace(/[^0-9A-Za-z_-]/g, '')}.xlsx`;
      await scriviECondividiExcel(nomeFile, righe);
      mostraAlert('', t('esportazioneCompletata', lang, daEsportare.length));
    } catch (e) {
      console.error('Errore esportazione prenotazioni:', e);
      mostraAlert(t('errore', lang), t('erroreEsportazione', lang));
    } finally {
      setEsportazioneInCorso(false);
    }
  };

  const esportaManutenzioneExcel = async () => {
    const chiave = archivioManutenzioneModalita === 'mensile' ? archivioManutenzioneMeseSelezionato : archivioManutenzioneAnnoSelezionato;
    const daEsportare = manutenzioneLista.filter((s) => {
      const riferimento = s.tsRisoluzione || s.data || '';
      return riferimento.startsWith(chiave);
    });

    if (daEsportare.length === 0) {
      mostraAlert('', t('nessunDatoDaEsportare', lang));
      return;
    }

    setEsportazioneInCorso(true);
    try {
      const righe = daEsportare
        .slice()
        .sort((a, b) => (a.data || '').localeCompare(b.data || ''))
        .map((s) => {
          const diarioTesto = (s.diario || [])
            .map((v) => `${v.autore} (${formattaDataOra(v.timestamp, lang)}): ${v.testo}`)
            .join(' | ');
          return {
            [t('aula', lang)]: s.aulaNome || '',
            Sezione: risolviNomeSezione(s.sezione, lang) || '',
            [t('colTipoGuasto', lang)]: etichettaTipoGuasto(s.tipoGuasto, lang),
            [t('colDescrizioneGuasto', lang)]: s.descrizione || '',
            [t('colSegnalatoDa', lang)]: s.utenteNome || '',
            [t('email', lang)]: s.utenteEmail || '',
            [t('stato', lang)]: s.stato || '',
            [t('colDataSegnalazione', lang)]: formattaDataOra(s.tsSegnalazione, lang) || s.data || '',
            [t('colDataPresaInCarico', lang)]: s.tsPresaInCarico ? formattaDataOra(s.tsPresaInCarico, lang) : t('nonAncora', lang),
            [t('colDataRisoluzione', lang)]: s.tsRisoluzione ? formattaDataOra(s.tsRisoluzione, lang) : t('nonAncora', lang),
            [t('diarioLavoro', lang)]: diarioTesto
          };
        });

      const nomeFile = `manutenzione_${chiave.replace(/[^0-9A-Za-z_-]/g, '')}.xlsx`;
      await scriviECondividiExcel(nomeFile, righe);
      mostraAlert('', t('esportazioneCompletata', lang, daEsportare.length));
    } catch (e) {
      console.error('Errore esportazione manutenzione:', e);
      mostraAlert(t('errore', lang), t('erroreEsportazione', lang));
    } finally {
      setEsportazioneInCorso(false);
    }
  };

  const esportaUtentiExcel = async () => {
    if (utentiLista.length === 0) {
      mostraAlert('', t('nessunDatoDaEsportare', lang));
      return;
    }

    setEsportazioneInCorso(true);
    try {
      const righe = utentiLista
        .slice()
        .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
        .map((u) => ({
          [t('nome', lang)]: u.nome || '',
          [t('email', lang)]: u.email || '',
          [t('ruolo', lang)]: etichettaRuolo(u.role, lang),
          [t('classe', lang)]: u.classe || '—',
          [t('eta', lang)]: u.dataNascita ? calcolaEta(u.dataNascita) : '—',
          [t('stato', lang)]: u.primoAccessoEffettuato === false ? t('invitoInAttesa', lang) : t('emailVerificata', lang)
        }));

      const nomeFile = `utenti_${new Date().toISOString().slice(0, 10)}.xlsx`;
      await scriviECondividiExcel(nomeFile, righe);
      mostraAlert('', t('esportazioneCompletata', lang, righe.length));
    } catch (e) {
      console.error('Errore esportazione utenti:', e);
      mostraAlert(t('errore', lang), t('erroreEsportazione', lang));
    } finally {
      setEsportazioneInCorso(false);
    }
  };
  const salvaModificaProfilo = async () => {
    if (!utenteProfiloModifica) return;
    try {
      // Anno scolastico e classe si applicano solo se il Ruolo dell'utente è "Studente":
      // il Ruolo è l'unica fonte di verità, non è più modificabile da questo modale.
      const eStudente = utenteProfiloModifica.role === 'studente';
      const aggiornamenti = {
        nome: profiloModificaDati.nome || utenteProfiloModifica.nome,
        annoScolastico: eStudente ? profiloModificaDati.annoScolastico : null,
        classe: eStudente ? profiloModificaDati.classe : null,
        dataNascita: profiloModificaDati.dataNascita || null,
        dataScadenza: profiloModificaDati.dataScadenza || null
      };
      await updateDoc(doc(db, 'users', utenteProfiloModifica.id), aggiornamenti);
      setUtenteProfiloModifica(null);
      caricaDatiGenerali();
      mostraAlert('', t('profiloAggiornato', lang) || 'Profilo aggiornato con successo.');
    } catch (e) {
      console.error('Errore salvataggio profilo:', e);
      mostraAlert(t('errore', lang), e.message);
    }
  };
  const togglePermesso = (key) => {
    setPermessiModifica(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const salvaPermessiUtente = async () => {
    if (!utentePermessiTarget) {
      mostraAlert(t('attenzione', lang), 'Nessun utente selezionato.');
      return;
    }
    
    try {
      // Valori di default in base al ruolo
      const defaults = {
        puoGestireAule: puoGestireAule(utentePermessiTarget.role),
        puoApprovarePrenotazioni: puoApprovarePrenotazioni(utentePermessiTarget.role),
        puoGestireManutenzione: puoGestireManutenzione(utentePermessiTarget.role),
        puoGestireUtenti: puoGestireUtenti(utentePermessiTarget.role),
        puoGestireDominiEmail: puoGestireDominiEmail(utentePermessiTarget.role),
        puoGestireBlocchi: puoGestireUtenti(utentePermessiTarget.role),
        puoResettareDati: puoResettareDati(utentePermessiTarget.role),
        puoEsportareUtentiPrenotazioni: puoEsportareUtentiPrenotazioni(utentePermessiTarget.role),
        puoEsportarePrenotazioniSegnalazioni: puoEsportarePrenotazioniSegnalazioni(utentePermessiTarget.role),
        puoVedereRegistroAttivita: puoVedereRegistroAttivita(utentePermessiTarget.role),
        // NUOVI PERMESSI
        puoVedereProfili: puoVedereProfili(utentePermessiTarget.role),
        puoModificareProfili: puoModificareProfili(utentePermessiTarget.role),
        puoGestireClassi: puoGestireClassi(utentePermessiTarget.role),
        puoCreareRuoliPersonalizzati: puoCreareRuoliPersonalizzati(utentePermessiTarget.role),
        puoAssegnarePermessiRuoliPersonalizzati: puoAssegnarePermessiRuoliPersonalizzati(utentePermessiTarget.role)
      };

      const overrides = {};
      Object.keys(permessiModifica).forEach(key => {
        if (permessiModifica[key] !== defaults[key]) {
          overrides[key] = permessiModifica[key];
        }
      });

      if (Object.keys(overrides).length === 0) {
        await updateDoc(doc(db, 'users', utentePermessiTarget.id), {
          permessiSovrascritti: null
        });
      } else {
        await updateDoc(doc(db, 'users', utentePermessiTarget.id), {
          permessiSovrascritti: overrides
        });
      }

      await registraAttivita(
        'modifica_permessi_utente',
        `Permessi di ${utentePermessiTarget.nome} aggiornati`
      );

      setUtentePermessiTarget(null);
      caricaDatiGenerali();
      mostraAlert('', lang === 'ar' ? 'تم تحديث الصلاحيات بنجاح.' : 'Permessi aggiornati con successo.');
    } catch (e) {
      console.error('Errore salvataggio permessi:', e);
      mostraAlert(t('errore', lang), e.message);
    }
  };
// ================================================================
// PARTE 4 – RENDERING PRINCIPALE (UI COMPLETA)
// ================================================================

  // ==============================================================
  // CALCOLI PER LA UI
  // ==============================================================

  const maxCalendarDate = new Date();
  maxCalendarDate.setMonth(maxCalendarDate.getMonth() + MESI_MASSIMI_PRENOTAZIONE);
  const maxCalendarDateRipetizione = new Date();
  maxCalendarDateRipetizione.setMonth(maxCalendarDateRipetizione.getMonth() + MESI_MASSIMI_RIPETIZIONE);
  const limiteNormaleStr = maxCalendarDate.toISOString().split('T')[0];

  const isGestore = userRole === 'gestore';
  const isManutentore = userRole === 'manutentore';

  // PERMESSI CON SOVRASCRITTURE
  const haPermesso = (utente, permessoKey, defaultValueFn) => {
    if (!utente) return false;
    if (utente.permessiSovrascritti && utente.permessiSovrascritti[permessoKey] !== undefined) {
      return utente.permessiSovrascritti[permessoKey];
    }
    return defaultValueFn(utente.role);
  };

  const currentUserData = utentiLista.find(u => u.id === user?.uid) || { 
    role: userRole, 
    permessiSovrascritti: {} 
  };

  const canGestireUtenti = haPermesso(currentUserData, 'puoGestireUtenti', puoGestireUtenti);
  const canGestireDominiEmail = haPermesso(currentUserData, 'puoGestireDominiEmail', puoGestireDominiEmail);
  const canApprovarePrenotazioni = haPermesso(currentUserData, 'puoApprovarePrenotazioni', puoApprovarePrenotazioni);
  const canGestireAule = haPermesso(currentUserData, 'puoGestireAule', puoGestireAule);
  const canGestireManutenzione = haPermesso(currentUserData, 'puoGestireManutenzione', puoGestireManutenzione);
  const canEsportareUtentiPrenotazioni = haPermesso(currentUserData, 'puoEsportareUtentiPrenotazioni', puoEsportareUtentiPrenotazioni);
  const canEsportarePrenotazioniSegnalazioni = haPermesso(currentUserData, 'puoEsportarePrenotazioniSegnalazioni', puoEsportarePrenotazioniSegnalazioni);
  const canResettareDati = haPermesso(currentUserData, 'puoResettareDati', puoResettareDati);
  const canVedereRegistroAttivita = haPermesso(currentUserData, 'puoVedereRegistroAttivita', puoVedereRegistroAttivita);
  const canVedereProfili = haPermesso(currentUserData, 'puoVedereProfili', puoVedereProfili);
  const canModificareProfili = haPermesso(currentUserData, 'puoModificareProfili', puoModificareProfili);
  const canGestireClassi = haPermesso(currentUserData, 'puoGestireClassi', puoGestireClassi);
  const canCreareRuoliPersonalizzati = haPermesso(currentUserData, 'puoCreareRuoliPersonalizzati', puoCreareRuoliPersonalizzati);
  const canAssegnarePermessiRuoliPersonalizzati = haPermesso(currentUserData, 'puoAssegnarePermessiRuoliPersonalizzati', puoAssegnarePermessiRuoliPersonalizzati);
  const canGestireAulaStudio = haPermesso(currentUserData, 'puoGestireAulaStudio', puoGestireAulaStudio);
  const canGestireManuali = haPermesso(currentUserData, 'puoGestireManuali', puoGestireManuali) && Platform.OS === 'web';
  const canVedereManualiAmministrativi = haPermesso(currentUserData, 'puoVedereManualiAmministrativi', puoVedereManualiAmministrativi);
  // Controlla, alla prima apertura della schermata Impostazioni → Manuali, se esiste già
  // un file caricato per ciascuna lingua (per mostrare data ultimo aggiornamento o "nessun file").
  useEffect(() => {
    if (impostazioniVista !== 'manuali' || !canGestireManuali) return;
    ['it', 'ar'].forEach((linguaManuale) => {
      if (manualiMeta[linguaManuale] !== undefined) return;
      getMetadata(storageRef(storage, MANUALE_STORAGE_PATH[linguaManuale]))
        .then((meta) => setManualiMeta((m) => ({ ...m, [linguaManuale]: meta })))
        .catch(() => setManualiMeta((m) => ({ ...m, [linguaManuale]: false })));
    });
  }, [impostazioniVista, canGestireManuali]);
  // Se l'utente entra in Impostazioni → Esporta ma può esportare solo l'Aula Studio (es. segreteria
  // senza gli altri permessi di export), sposta automaticamente la scheda selezionata su "Aula Studio".
  useEffect(() => {
    if (impostazioniVista !== 'esporta') return;
    const puoEsportarePrenotazioniOUtenti = canEsportareUtentiPrenotazioni || canEsportarePrenotazioniSegnalazioni;
    if (esportaTipoSelezionato !== 'aulaStudio' && !puoEsportarePrenotazioniOUtenti && canGestireAulaStudio) {
      setEsportaTipoSelezionato('aulaStudio');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impostazioniVista, canEsportareUtentiPrenotazioni, canEsportarePrenotazioniSegnalazioni, canGestireAulaStudio]);
  // Profilo Aula Studio dello studente loggato (tipo scuola, classe, numero di registro, nome/cognome),
  // compilato una sola volta dal wizard di primo accesso e riusato per tutte le prenotazioni.
  const profiloAulaStudio = currentUserData?.aulaStudioProfiloCompletato
    ? {
        tipoScuola: currentUserData.aulaStudioTipoScuola,
        classe: currentUserData.aulaStudioClasse,
        numeroRegistro: currentUserData.aulaStudioNumeroRegistro,
        nomeStudente: currentUserData.aulaStudioNomeStudente,
        cognomeStudente: currentUserData.aulaStudioCognomeStudente,
      }
    : null;

  // Utenti che possono gestire l'Aula Studio (rispettando eventuali override permessi), usato per
  // notificare le nuove richieste di turno degli insegnanti.
  const gestoriAulaStudio = useMemo(
    () =>
      utentiLista
        .filter((u) => haPermesso(u, 'puoGestireAulaStudio', puoGestireAulaStudio))
        .map((u) => ({ uid: u.id, nome: u.nome, role: u.role })),
    [utentiLista]
  );

  // Insegnanti, usati dal responsabile Aula Studio per assegnare direttamente un turno.
  const insegnantiAulaStudio = useMemo(
    () =>
      utentiLista
        .filter((u) => u.role === 'insegnante')
        .map((u) => ({ uid: u.id, nome: u.nome, email: u.email || null })),
    [utentiLista]
  );

  // Filtri profili per la sezione "Profili" (spostato qui: gli Hook non possono essere
  // chiamati condizionalmente né dentro funzioni annidate nel JSX)
  const utentiProfiliFiltrati = useMemo(() => {
    if (!canVedereProfili) return [];
    return utentiLista.filter(u => {
      const matchRicerca = u.nome?.toLowerCase().includes(filtriProfili.ricerca.toLowerCase()) ||
                           u.email?.toLowerCase().includes(filtriProfili.ricerca.toLowerCase());
      const matchRuolo = filtriProfili.ruolo === 'tutti' || u.role === filtriProfili.ruolo;
      const matchClasse = filtriProfili.classe === 'tutte' || u.classe === filtriProfili.classe;
      const matchAnno = filtriProfili.annoScolastico === 'tutti' || u.annoScolastico === filtriProfili.annoScolastico;
      return matchRicerca && matchRuolo && matchClasse && matchAnno;
    });
  }, [utentiLista, filtriProfili, canVedereProfili]);

  const oggiStr = new Date().toISOString().split('T')[0];

  const AccessoNegato = () => (
    <View style={styles.bodyContent}>
      <Text style={styles.blockedText}>{t('accessoRiservato', lang)}</Text>
    </View>
  );

  // ==============================================================
  // RENDER CONDIZIONALE (INIZIALIZZAZIONE, BLOCO, LOGIN, VERIFICA, PROFILO)
  // ==============================================================

  // 1. Inizializzazione
  if (initializing) {
    return (
      <SafeAreaView style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  // 2. Blocco impronta
  if (user && !emailNonVerificata && appBloccata && !profiloDaCompletare) {
    return (
      <SafeAreaView style={[styles.container, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }]}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <AppLogo style={{ width: 150, height: 52, alignSelf: 'center', marginBottom: 20 }} />
        <Text style={[styles.verifyText, { marginBottom: 24 }]}>{t('sbloccoImprontaSchermataTesto', lang)}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={sbloccaConImpronta}>
          <Text style={styles.buttonText}>👆 {t('sbloccoImprontaSchermataPulsante', lang)}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // 3. Schermata di login
  if (!user) {
    return (
      <SafeAreaView style={[styles.container, isRTL && { direction: 'rtl' }]}>
        <StatusBar barStyle={Platform.OS === 'android' ? (isDarkMode ? 'light-content' : 'dark-content') : 'light-content'} />
        <ImageBackground
          source={Platform.OS === 'web' ? SFONDO_LOGIN : undefined}
          resizeMode="cover"
          style={styles.authBackground}
        >
          {Platform.OS === 'web' && <View style={styles.authOverlay} />}
          {Platform.OS === 'android' && (
            <View style={styles.authWatermarkWrap} pointerEvents="none">
              <Image source={SFONDO_LOGIN_MOBILE} style={styles.authWatermarkFixed} resizeMode="contain" />
            </View>
          )}
          <KeyboardAvoidingView
            style={styles.authBox}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
          >
            <ScrollView
              contentContainerStyle={styles.authCenter}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {Platform.OS !== 'android' && (
                <AppLogo style={Platform.OS === 'web' ? { width: 300, height: 104, alignSelf: 'center' } : { width: '82%', maxWidth: 300, aspectRatio: 300 / 104, alignSelf: 'center' }} />
              )}
              <Text style={[styles.appName, Platform.OS === 'android' && { marginTop: 4 }]}>{t('appName', lang)}</Text>
              {Platform.OS === 'web' && (
                <TouchableOpacity
                  style={styles.androidDownloadBanner}
                  onPress={() => setShowDownloadChoice(true)}
                >
                  <Text style={styles.androidDownloadBannerTitle}>{t('scaricaAppAndroidTitolo', lang)}</Text>
                  <Text style={styles.androidDownloadBannerButton}>{t('scaricaAppAndroidPulsante', lang)}</Text>
                </TouchableOpacity>
              )}
              {Platform.OS === 'web' && (
                <Modal
                  visible={showDownloadChoice}
                  transparent
                  animationType="fade"
                  onRequestClose={() => { setShowDownloadChoice(false); setShowQrCode(false); }}
                >
                  <View style={qrStyles.overlay}>
                    <View style={qrStyles.box}>
                      {!showQrCode ? (
                        <>
                          <Text style={qrStyles.title}>{lang === 'ar' ? 'تحميل على:' : 'Scarica su:'}</Text>
                          <TouchableOpacity
                            style={qrStyles.choiceBtn}
                            onPress={() => {
                              Linking.openURL(APK_DOWNLOAD_URL);
                              setShowDownloadChoice(false);
                            }}
                          >
                            <Text style={qrStyles.choiceBtnText}>💻 PC / Windows</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={qrStyles.choiceBtn}
                            onPress={() => setShowQrCode(true)}
                          >
                            <Text style={qrStyles.choiceBtnText}>📱 Android (QR code)</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={qrStyles.closeBtn}
                            onPress={() => setShowDownloadChoice(false)}
                          >
                            <Text style={qrStyles.closeBtnText}>{t('annulla', lang)}</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <>
                          <Text style={qrStyles.title}>{lang === 'ar' ? 'امسح الرمز بهاتف الأندرويد' : 'Scansiona con il telefono Android'}</Text>
                          <Image
                            source={{ uri: `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(APK_DOWNLOAD_URL)}` }}
                            style={qrStyles.qrImage}
                          />
                          <Text style={qrStyles.hint}>{lang === 'ar' ? 'رمز QR صالح دائمًا، حتى بعد تحديثات التطبيق.' : "Il QR è sempre valido, anche dopo gli aggiornamenti dell'app."}</Text>
                          <TouchableOpacity
                            style={qrStyles.closeBtn}
                            onPress={() => { setShowDownloadChoice(false); setShowQrCode(false); }}
                          >
                            <Text style={qrStyles.closeBtnText}>{t('chiudiLabel', lang)}</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                </Modal>
              )}
              {blockedMessage ? <Text style={styles.blockedText}>{blockedMessage}</Text> : null}
              {isRegistering && <TextInput style={styles.input} placeholder={t('nomeCognome', lang)} placeholderTextColor={colors.placeholder} value={nome} onChangeText={setNome} />}
              <TextInput style={styles.input} placeholder={t('email', lang)} placeholderTextColor={colors.placeholder} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
              <View style={styles.passwordFieldRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder={t('password', lang)}
                  placeholderTextColor={colors.placeholder}
                  secureTextEntry={!mostraPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity
                  style={styles.passwordToggleBtn}
                  onPress={() => setMostraPassword(!mostraPassword)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.passwordToggleIcon}>{mostraPassword ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>
              {!isRegistering && (
                <TouchableOpacity onPress={handlePasswordReset} style={{ alignSelf: isRTL ? 'flex-start' : 'flex-end', marginBottom: 14, marginTop: -6 }}>
                  <Text style={styles.forgotPasswordText}>{t('passwordDimenticata', lang)}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.primaryButton} onPress={handleAuth} disabled={loading}>
                {loading ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.buttonText}>{isRegistering ? t('registrati', lang) : t('accedi', lang)}</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setIsRegistering(!isRegistering)}>
                <Text style={[styles.switchAuthText, Platform.OS !== 'android' && { color: 'rgba(255,255,255,0.85)' }]}>{isRegistering ? t('haiAccountAccedi', lang) : t('registrati', lang)}</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </ImageBackground>
      </SafeAreaView>
    );
  }

  // 4. Verifica email
  if (user && emailNonVerificata) {
    return (
      <SafeAreaView style={[styles.container, isRTL && { direction: 'rtl' }]}>
        <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
        <View style={styles.authBox}>
          <View style={styles.authTopBar}>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setIsDarkMode(!isDarkMode)}>
              <Text style={styles.langTextHeader}>{isDarkMode ? '☀️' : '🌙'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setLang(lang === 'it' ? 'ar' : 'it')}>
              <Text style={styles.langTextHeader}>{lang === 'it' ? 'العربية' : 'Italiano'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.authCenter}>
            <AppLogo style={Platform.OS === 'web' ? { width: 260, height: 90, alignSelf: 'center' } : { width: '75%', maxWidth: 260, aspectRatio: 260 / 90, alignSelf: 'center' }} />
            <Text style={styles.appName}>{t('appName', lang)}</Text>
            <Text style={styles.verifyTitle}>{t('verifEmailTitle', lang)}</Text>
            <Text style={styles.verifyText}>
              {t('verifEmailText', lang, user.email)}
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={controllaEmailVerificata}>
              <Text style={styles.buttonText}>{t('hoVerificato', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={reinviaEmailVerifica}>
              <Text style={styles.switchAuthText}>{t('nonRicevutoEmail', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout}>
              <Text style={styles.switchAuthText}>{t('esci', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // 5. Schermata "Completa profilo" (dopo verifica email, prima dell'app)
  if (user && !emailNonVerificata && (profiloDaCompletare || necessitaDatiAulaStudio)) {
    // MODIFICATO: due varianti della stessa schermata.
    // - profiloDaCompletare (nuovo account): tipo utente + (se studente) anno/classe/dati Aula Studio + data nascita.
    // - solo necessitaDatiAulaStudio (studente già registrato prima di questa funzione): SOLO i 3 campi Aula Studio, una tantum.
    const soloDatiAulaStudio = !profiloDaCompletare && necessitaDatiAulaStudio;
    const classiFiltratePerTipoScuola = classiLista.filter((c) => c.tipo === aulaStudioTipoScuolaScelto);
    return (
      <SafeAreaView style={[styles.container, isRTL && { direction: 'rtl' }]}>
        <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
        <View style={styles.authBox}>
          <View style={styles.authTopBar}>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setIsDarkMode(!isDarkMode)}>
              <Text style={styles.langTextHeader}>{isDarkMode ? '☀️' : '🌙'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setLang(lang === 'it' ? 'ar' : 'it')}>
              <Text style={styles.langTextHeader}>{lang === 'it' ? 'العربية' : 'Italiano'}</Text>
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 80}
          >
          <ScrollView
            contentContainerStyle={[
              styles.authCenter,
              {
                paddingTop: 20,
                paddingBottom: Platform.OS === 'android' ? 40 + insets.bottom : 90,
                justifyContent: 'flex-start',
              },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <AppLogo style={Platform.OS === 'web' ? { width: 200, height: 70, alignSelf: 'center' } : { width: '65%', maxWidth: 200, aspectRatio: 200 / 70, alignSelf: 'center' }} />
            <Text style={[styles.appName, { marginBottom: 8 }]}>{soloDatiAulaStudio ? t('aulaStudioRegistrazioneTitolo', lang) : t('completaProfilo', lang)}</Text>
            <Text style={[styles.infoText, { marginBottom: 16 }]}>{soloDatiAulaStudio ? t('aulaStudioRegistrazioneSottotitolo', lang) : t('scegliTipo', lang)}</Text>

            {!soloDatiAulaStudio && (
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <TouchableOpacity
                  style={[styles.fasciaChip, tipoUtenteScelto === 'studente' && styles.fasciaSelected]}
                  onPress={() => { setTipoUtenteScelto('studente'); setAnnoScolasticoScelto(annoScolasticoAttuale()); setClasseScelta(''); setAulaStudioTipoScuolaScelto(null); }}
                >
                  <Text style={[styles.fasciaText, tipoUtenteScelto === 'studente' && styles.fasciaTextSelected]}>{t('studente', lang)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.fasciaChip, tipoUtenteScelto === 'insegnante' && styles.fasciaSelected]}
                  onPress={() => { setTipoUtenteScelto('insegnante'); setAnnoScolasticoScelto(''); setClasseScelta(''); setAulaStudioTipoScuolaScelto(null); }}
                >
                  <Text style={[styles.fasciaText, tipoUtenteScelto === 'insegnante' && styles.fasciaTextSelected]}>{t('insegnante', lang)}</Text>
                </TouchableOpacity>
              </View>
            )}

            {!soloDatiAulaStudio && tipoUtenteScelto === 'studente' && (
              <>
                <Text style={[styles.label, { marginTop: 4 }]}>{t('annoScolastico', lang)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <View style={[styles.datePickerButton, { flex: 1, marginBottom: 0 }]}>
                    <Text style={styles.datePickerButtonText}>{annoScolasticoScelto || annoScolasticoAttuale()}</Text>
                  </View>
                  <TouchableOpacity style={styles.smallEditBtn} onPress={() => setAnnoScolasticoScelto(annoScolasticoAttuale())}>
                    <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('generaAnnoScolastico', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {(soloDatiAulaStudio || tipoUtenteScelto === 'studente') && (
              <>
                {/* MODIFICATO: dati Aula Studio (tipo scuola, classe filtrata, numero di registro) — chiesti qui, una sola volta, non più dentro la sezione Aula Studio. */}
                <Text style={styles.label}>{t('aulaStudioSceglieTipoScuola', lang)}</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  <TouchableOpacity
                    style={[styles.fasciaChip, { flex: 1 }, aulaStudioTipoScuolaScelto === 'medie' && styles.fasciaSelected]}
                    onPress={() => { setAulaStudioTipoScuolaScelto('medie'); setClasseScelta(''); }}
                  >
                    <Text style={[styles.fasciaText, aulaStudioTipoScuolaScelto === 'medie' && styles.fasciaTextSelected]}>{t('aulaStudioTipoMedie', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.fasciaChip, { flex: 1 }, aulaStudioTipoScuolaScelto === 'ipi' && styles.fasciaSelected]}
                    onPress={() => { setAulaStudioTipoScuolaScelto('ipi'); setClasseScelta(''); }}
                  >
                    <Text style={[styles.fasciaText, aulaStudioTipoScuolaScelto === 'ipi' && styles.fasciaTextSelected]}>{t('aulaStudioTipoIpi', lang)}</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>{t('classe', lang)}</Text>
                <TouchableOpacity
                  style={[styles.datePickerButton, { marginBottom: 12 }, !aulaStudioTipoScuolaScelto && { opacity: 0.5 }]}
                  disabled={!aulaStudioTipoScuolaScelto}
                  onPress={() => setModalScegliClasseRegistrazione(true)}
                >
                  <Text style={styles.datePickerButtonText}>{classeScelta || t('aulaStudioSceglieClasse', lang)}</Text>
                </TouchableOpacity>

                <Text style={styles.label}>{t('aulaStudioNumeroInClasse', lang)}</Text>
                <TextInput
                  style={[styles.input, { marginBottom: 12 }]}
                  value={aulaStudioNumeroRegistroScelto}
                  onChangeText={setAulaStudioNumeroRegistroScelto}
                  placeholder="12"
                  placeholderTextColor={colors.placeholder}
                  keyboardType="number-pad"
                />
              </>
            )}

            {!soloDatiAulaStudio && (
              <>
                <Text style={styles.label}>{t('dataNascita', lang)}</Text>
                {Platform.OS === 'web' ? (
                  <input
                    type="date"
                    value={dataNascitaScelta}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => { setDataNascitaScelta(e.target.value); }}
                    style={webDateInputStyle}
                  />
                ) : (
                  <>
                    <TouchableOpacity style={styles.datePickerButton} onPress={() => setShowDatePickerNascita(true)}>
                      <Text style={styles.datePickerButtonText}>{dataNascitaScelta ? dataNascitaScelta : 'Seleziona data'}</Text>
                    </TouchableOpacity>
                    {showDatePickerNascita && (
                      <DateTimePicker
                        value={dataNascitaObj}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'inline' : 'default'}
                        maximumDate={new Date()}
                        onChange={onChangeDateNascita}
                      />
                    )}
                  </>
                )}
                {!!dataNascitaScelta && (
                  <Text style={[styles.infoTextSmall, { marginTop: 4 }]}>
                    {t('eta', lang)}: {calcolaEta(dataNascitaScelta)} {lang === 'ar' ? 'سنة' : 'anni'}
                  </Text>
                )}
              </>
            )}

            <TouchableOpacity
              style={[styles.primaryButton, { marginTop: 20 }, salvandoDatiAulaStudio && { opacity: 0.6 }]}
              onPress={soloDatiAulaStudio ? completaDatiAulaStudioEsistente : completaProfilo}
              disabled={salvandoDatiAulaStudio}
            >
              {salvandoDatiAulaStudio ? (
                <ActivityIndicator color={colors.primaryText || '#fff'} />
              ) : (
                <Text style={styles.buttonText}>{t('conferma', lang)}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout} style={{ marginTop: 12 }}>
              <Text style={styles.switchAuthText}>{t('esci', lang)}</Text>
            </TouchableOpacity>
          </ScrollView>
          </KeyboardAvoidingView>
        </View>

        {/* Modale Scegli Classe (registrazione / completamento profilo / dati Aula Studio) */}
        <Modal visible={modalScegliClasseRegistrazione} animationType="fade" transparent onRequestClose={() => setModalScegliClasseRegistrazione(false)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalScegliClasseRegistrazione(false)}>
            <View style={[styles.dropdownOptionsList, { maxHeight: '75%' }]}>
              <Text style={[styles.label, { textAlign: 'center', marginBottom: 8 }]}>{t('classe', lang)}</Text>
              <ScrollView>
                {((soloDatiAulaStudio || tipoUtenteScelto === 'studente')
                  ? classiFiltratePerTipoScuola.map((c) => c.nome)
                  : (classiLista.length > 0 ? classiLista.map(c => c.nome) : CLASSI_DISPONIBILI)
                ).length === 0 ? (
                  <Text style={[styles.infoText, { textAlign: 'center', padding: 8 }]}>{t('aulaStudioNessunaClasseDisponibile', lang)}</Text>
                ) : (
                  ((soloDatiAulaStudio || tipoUtenteScelto === 'studente')
                    ? classiFiltratePerTipoScuola.map((c) => c.nome)
                    : (classiLista.length > 0 ? classiLista.map(c => c.nome) : CLASSI_DISPONIBILI)
                  ).map((cls) => {
                    const attivo = classeScelta === cls;
                    return (
                      <TouchableOpacity key={cls} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setClasseScelta(cls); setModalScegliClasseRegistrazione(false); }}>
                        <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{cls}</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    );
  }

  // ==============================================================
  // RENDER PRINCIPALE DELL'APP (DOPO IL PROFILO COMPLETO)
  // ==============================================================

  return (
    <SafeAreaView style={[styles.container, isRTL && { direction: 'rtl' }]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />

      {/* ==========================================================
          HEADER (con nome cliccabile per profilo personale)
          ========================================================== */}
      <View style={styles.header}>
        <View style={[styles.headerSideGroup, { justifyContent: isRTL ? 'flex-end' : 'flex-start' }]}>
          <TouchableOpacity onPress={() => setModalProfiloPersonale(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <View style={{ alignItems: isRTL ? 'flex-end' : 'flex-start' }}>
              <Text
                style={[styles.headerTitleCentered, { textAlign: isRTL ? 'right' : 'left' }]}
                numberOfLines={1}
                ellipsizeMode="tail"
                maxFontSizeMultiplier={1.2}
              >{userName}</Text>
              <Text
                style={[styles.headerSubtitleCentered, { textAlign: isRTL ? 'right' : 'left' }]}
                numberOfLines={Platform.OS === 'web' ? 1 : 2}
                adjustsFontSizeToFit={Platform.OS !== 'web'}
                minimumFontScale={Platform.OS !== 'web' ? 0.75 : undefined}
                maxFontSizeMultiplier={1.2}
              >
                {t('ruolo', lang)}: <Text style={styles.roleGold}>
                  {etichettaRuolo(userRole, lang)}
                  {currentUserData.rolePersonalizzato ? ` (${currentUserData.rolePersonalizzato})` : ''}
                </Text>
              </Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.headerCenterGroup}>
          <AppLogo style={{ width: Platform.OS === 'web' ? 210 : 130, height: Platform.OS === 'web' ? 73 : 46 }} />
          <Text style={styles.appNameSmall}>{t('appName', lang)}</Text>
        </View>
        <View style={[styles.headerSideGroup, { justifyContent: isRTL ? 'flex-start' : 'flex-end' }]}>
          <View style={[styles.headerIconsRow, isRTL ? styles.headerIconsRowRTL : styles.headerIconsRowLTR]}>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setShowManualiChoice(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.langTextHeader}>📖</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setLang(lang === 'it' ? 'ar' : 'it')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.langTextHeader}>{lang === 'it' ? 'ع' : 'It'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setModalNotifiche(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.langTextHeader}>🔔</Text>
              {notificheNonLette > 0 && (
                <View style={styles.notificaBadge}>
                  <Text style={styles.notificaBadgeText}>{notificheNonLette > 9 ? `${numArabo(9, lang)}+` : numArabo(notificheNonLette, lang)}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.logoutText}>{t('esci', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ==========================================================
          MODALE MANUALI (guida interattiva per tutti; download IT/AR
          dei manuali amministrativi solo per gestore/segreteria/direzione)
          ========================================================== */}
      <Modal
        visible={showManualiChoice}
        transparent
        animationType="fade"
        onRequestClose={() => setShowManualiChoice(false)}
      >
        <View style={qrStyles.overlay}>
          <View style={qrStyles.box}>
            <Text style={qrStyles.title}>{t('manualiSceltaTitolo', lang)}</Text>
            <TouchableOpacity
              style={qrStyles.choiceBtn}
              onPress={() => { Linking.openURL(GUIDA_UTENTI_URL); setShowManualiChoice(false); }}
            >
              <Text style={qrStyles.choiceBtnText}>🧭 {t('manualiGuidaInterattiva', lang)}</Text>
            </TouchableOpacity>
            {canVedereManualiAmministrativi && (
              <>
                <TouchableOpacity
                  style={qrStyles.choiceBtn}
                  onPress={() => apriManuale('it')}
                  disabled={!!manualeInCaricamento}
                >
                  {manualeInCaricamento === 'it'
                    ? <ActivityIndicator color={colors.primary} />
                    : <Text style={qrStyles.choiceBtnText}>📄 {t('manualiScaricaAmminIt', lang)}</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={qrStyles.choiceBtn}
                  onPress={() => apriManuale('ar')}
                  disabled={!!manualeInCaricamento}
                >
                  {manualeInCaricamento === 'ar'
                    ? <ActivityIndicator color={colors.primary} />
                    : <Text style={qrStyles.choiceBtnText}>📄 {t('manualiScaricaAmminAr', lang)}</Text>}
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={qrStyles.closeBtn}
              onPress={() => setShowManualiChoice(false)}
            >
              <Text style={qrStyles.closeBtnText}>{t('annulla', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ==========================================================
          MODALE NOTIFICHE
          ========================================================== */}
      <Modal visible={modalNotifiche} transparent animationType="fade" onRequestClose={() => setModalNotifiche(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{t('centroNotifiche', lang)}</Text>
              <TouchableOpacity onPress={() => setModalNotifiche(false)}>
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBodyScrollable}>
              {notificheLista.length === 0 && (
                <Text style={styles.diarioVuoto}>{t('nessunaNotifica', lang)}</Text>
              )}
              {notificheLista.map((n) => (
                <TouchableOpacity
                  key={n.id}
                  style={[styles.diarioVoce, n.letta ? styles.diarioVoceLetta : styles.diarioVoceNonLetta]}
                  onPress={() => {
                    if (!n.letta) segnaNotificaComeLetta(n.id);
                    if (n.richiestaTurnoId) {
                      setModalNotifiche(false);
                      setVistaAttiva('aulaStudio');
                      setRichiestaTurnoDaAprireId(n.richiestaTurnoId);
                    }
                  }}
                >
                  <View style={styles.diarioVoceHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                      {!n.letta && <View style={styles.diarioPallino} />}
                      <Text style={[styles.diarioAutore, n.letta && styles.diarioAutoreLetta]}>{n.titolo}</Text>
                    </View>
                    <Text style={styles.diarioTimestamp}>{formattaDataOra(n.createdAt, lang)}</Text>
                  </View>
                  <Text style={styles.diarioTesto}>{n.corpo}</Text>
                  <TouchableOpacity
                    onPress={() => eliminaNotifica(n.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ alignSelf: isRTL ? 'flex-start' : 'flex-end', marginTop: 6 }}
                  >
                    <Text style={[styles.switchAuthText, { color: colors.danger }]}>{t('cancella', lang)}</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {notificheNonLette > 0 && (
              <View style={styles.modalFooterFixed}>
                <TouchableOpacity style={styles.addButton} onPress={segnaTutteLeNotificheComeLette}>
                  <Text style={styles.addButtonText}>{t('segnaTutteLette', lang)}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ==========================================================
          NAVIGAZIONE SUPERIORE (solo web, per non android)
          ========================================================== */}
      {Platform.OS !== 'android' && (
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => { setVistaAttiva('home'); setSezioneSelezionata(null); }}>
            <Text style={[styles.navItem, vistaAttiva === 'home' && styles.navActive]}>{t('navHome', lang)}</Text>
          </TouchableOpacity>
          {!canApprovarePrenotazioni && (
            <TouchableOpacity onPress={() => setVistaAttiva('calendario')}>
              <Text style={[styles.navItem, vistaAttiva === 'calendario' && styles.navActive]}>{t('navCalendario', lang)}</Text>
            </TouchableOpacity>
          )}
          {canApprovarePrenotazioni && (
            <TouchableOpacity onPress={() => setVistaAttiva('gestione')}>
              <Text style={[styles.navItem, vistaAttiva === 'gestione' && styles.navActive]}>{t('navGestione', lang)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setVistaAttiva('manutenzione')}>
            <Text style={[styles.navItem, vistaAttiva === 'manutenzione' && styles.navActive]}>{t('navManutenzione', lang)}</Text>
          </TouchableOpacity>
          {/* "Aula Studio" è stata spostata come voce nella Home: vedi styles.cardGrid in VISTA HOME. */}
          <TouchableOpacity onPress={() => setVistaAttiva('impostazioni')}>
            <Text style={[styles.navItem, vistaAttiva === 'impostazioni' && styles.navActive]}>{t('navImpostazioni', lang)}</Text>
          </TouchableOpacity>
        </View>
      )}

   
   {/* ==========================================================
          CONTENUTO PRINCIPALE (con watermark)
          ========================================================== */}
      <View style={{ flex: 1 }}>
        <Image
          source={LOGO_WATERMARK}
          style={[styles.contentWatermark, { width: watermarkSize, height: watermarkSize, right: watermarkOffset, bottom: watermarkOffsetY, pointerEvents: 'none' }] as any}
          resizeMode="contain"
        />

        {/* ------ VISTA HOME (sezioni) ------ */}
        {vistaAttiva === 'home' && !sezioneSelezionata && (
          <ScrollView contentContainerStyle={styles.bodyContent}>
            <View style={styles.cardGrid}>
              {sezioniLista.map((sez) => {
                const isAulaStudio = sez.speciale === 'aulaStudio';
                return (
                  <View key={sez.id} style={styles.cleanCardRow}>
                    <TouchableOpacity
                      style={styles.cleanCard}
                      onPress={() => {
                        if (isAulaStudio) {
                          setVistaAttiva('aulaStudio');
                        } else {
                          setSezioneSelezionata(sez.nome);
                          setVistaAttiva('aule');
                        }
                      }}
                    >
                      <Text style={styles.cleanCardText}>{risolviNomeSezione(sez.nome, lang)}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
            {/* La gestione di sezioni/aule (aggiungi, rinomina, riordina, elimina) si trova ora in
                Impostazioni → Aule: qui la Home resta di sola navigazione. */}
          </ScrollView>
        )}

        {/* ------ VISTA AULE ------ */}
        {vistaAttiva === 'aule' && sezioneSelezionata && (
          <ScrollView contentContainerStyle={styles.bodyContent}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionHeaderTitle}>{risolviNomeSezione(sezioneSelezionata, lang)}</Text>
            </View>
            {aule.filter((a) => a.sezione === sezioneSelezionata).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)).map((aula) => (
              <View key={aula.id} style={styles.aulaCard}>
                <View>
                  <Text style={styles.aulaTitle}>{risolviNomeAula(aula.nome, lang)}</Text>
                  <Text style={styles.aulaDesc}>{t('capienza', lang)}: {numArabo(aula.capienza, lang)}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <TouchableOpacity style={styles.primaryButtonSmall} onPress={() => setAulaInPrenotazione(aula)}>
                    <Text style={styles.buttonTextSmall}>{t('prenota', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {/* ------ VISTA CALENDARIO ------ */}
        {vistaAttiva === 'calendario' && (() => {
          const prenotazioniValide = prenotazioni.filter((p) => p.stato !== 'Rifiutata');
          const meseCorrenteStr = oggiStr.substring(0, 7);
          const mesiDisponibili: string[] = [];
          for (let i = 0; i <= MESI_MASSIMI_PRENOTAZIONE; i++) {
            const d = new Date();
            d.setDate(1);
            d.setMonth(d.getMonth() + i);
            mesiDisponibili.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
          }
          const selezioneAttiva = calendarioMeseSelezionato !== null ? calendarioMeseSelezionato : meseCorrenteStr;
          const [annoSel, meseSel] = selezioneAttiva.split('-').map(Number);
          const giorniNelMese = new Date(annoSel, meseSel, 0).getDate();
          const prenotazioniGiorno = (giornoStr) => prenotazioniValide.filter((p) => p.data === giornoStr);
          const prenotazioniDelGiornoSelezionato = giornoCalendarioSelezionato ? prenotazioniGiorno(giornoCalendarioSelezionato) : [];

          return (
            <ScrollView contentContainerStyle={styles.bodyContent}>
              <Text style={[styles.sectionHeaderTitle, { marginBottom: 24 }]}>{t('calendarioPubblico', lang)}</Text>

              <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setFiltroMeseCalendarioDropdownAperto(true)}>
                <Text style={styles.dropdownTriggerText}>{formattaMeseAnno(selezioneAttiva, lang)}</Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>

              <Modal visible={filtroMeseCalendarioDropdownAperto} animationType="fade" transparent onRequestClose={() => setFiltroMeseCalendarioDropdownAperto(false)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFiltroMeseCalendarioDropdownAperto(false)}>
                  <View style={styles.dropdownOptionsList}>
                    {mesiDisponibili.map((ym) => {
                      const attivo = selezioneAttiva === ym;
                      return (
                        <TouchableOpacity key={ym} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setCalendarioMeseSelezionato(ym); setFiltroMeseCalendarioDropdownAperto(false); }}>
                          <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{formattaMeseAnno(ym, lang)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </TouchableOpacity>
              </Modal>

              <View style={{ flexDirection: 'row', gap: 16, marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={[styles.dayLegendDot, { backgroundColor: colors.success }]} />
                  <Text style={styles.infoTextSmall}>{lang === 'ar' ? 'متاح' : 'Libero'}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={[styles.dayLegendDot, { backgroundColor: colors.danger }]} />
                  <Text style={styles.infoTextSmall}>{lang === 'ar' ? 'محجوز' : 'Occupato'}</Text>
                </View>
              </View>

              <View style={styles.dayGrid}>
                {Array.from({ length: giorniNelMese }, (_, i) => i + 1).map((giorno) => {
                  const giornoStr = `${selezioneAttiva}-${String(giorno).padStart(2, '0')}`;
                  const passato = giornoStr < oggiStr;
                  const occupato = prenotazioniGiorno(giornoStr).length > 0;
                  return (
                    <TouchableOpacity
                      key={giornoStr}
                      style={[
                        styles.dayButton,
                        passato ? styles.dayButtonPast : (occupato ? styles.dayButtonBusy : styles.dayButtonFree)
                      ]}
                      onPress={() => setGiornoCalendarioSelezionato(giornoStr)}
                    >
                      <Text style={[styles.dayButtonText, passato && styles.dayButtonTextPast]}>{numArabo(giorno, lang)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Modal visible={giornoCalendarioSelezionato !== null} animationType="slide" transparent onRequestClose={() => setGiornoCalendarioSelezionato(null)}>
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContentFixed}>
                    <View style={styles.modalHeaderFixed}>
                      <Text style={styles.modalTitle}>{dataArabo(giornoCalendarioSelezionato, lang)}</Text>
                      <TouchableOpacity onPress={() => setGiornoCalendarioSelezionato(null)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
                    </View>
                    <ScrollView style={styles.modalBodyScrollable}>
                      {prenotazioniDelGiornoSelezionato.length === 0 && (
                        <Text style={styles.infoText}>{t('nessunaPrenotazione', lang)}</Text>
                      )}
                      {prenotazioniDelGiornoSelezionato.map((p) => {
                        const isMia = p.utenteEmail === user?.email;
                        return (
                          <View key={p.id} style={styles.calRow}>
                            <Text style={styles.calRowText} numberOfLines={2} ellipsizeMode="tail">
                              <Text style={styles.calRowAula}>{risolviNomeAula(p.aulaNome, lang)}</Text>
                              {'  '}({risolviNomeSezione(p.sezione, lang)}) · {numArabo(p.fasce.join(', '), lang)} —{' '}
                              <Text style={isMia ? styles.calRowMia : styles.calRowOccupata}>
                                {isMia ? t('tua', lang, p.stato === 'In attesa' ? t('inAttesa', lang) : p.stato === 'Approvata' ? t('approvata', lang) : p.stato === 'Rifiutata' ? t('rifiutata', lang) : p.stato) : t('occupata', lang)}
                              </Text>
                            </Text>
                            {isMia && (
                              <TouchableOpacity style={styles.calDeleteBtn} onPress={() => { eliminaPrenotazione(p.id); setGiornoCalendarioSelezionato(null); }}>
                                <Text style={[styles.calDeleteBtnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>✕</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}
                    </ScrollView>
                  </View>
                </View>
              </Modal>
            </ScrollView>
          );
        })()}

        {/* ------ VISTA AULA STUDIO ------ */}
        {vistaAttiva === 'aulaStudio' && (
          canGestireAulaStudio ? (
            <AulaStudioResponsabileView
              db={db}
              user={user}
              userName={userName}
              userRole={userRole}
              lang={lang as any}
              isRTL={isRTL}
              colors={colors as any}
              t={t}
              mostraAlert={mostraAlert}
              canGestireAulaStudio={canGestireAulaStudio}
              registraAttivita={registraAttivita}
              inviaNotificaConPreferenza={inviaNotificaConPreferenza}
              scriviECondividiExcel={scriviECondividiExcel}
              classiLista={classiLista}
              profiloAulaStudio={profiloAulaStudio}
              onProfiloAulaStudioSalvato={caricaDatiGenerali}
              gestoriAulaStudio={gestoriAulaStudio}
              richiestaTurnoDaAprireId={richiestaTurnoDaAprireId}
              onRichiestaTurnoAperta={() => setRichiestaTurnoDaAprireId(null)}
              insegnantiAulaStudio={insegnantiAulaStudio}
            />
          ) : userRole === 'studente' ? (
            <AulaStudioStudentView
              db={db}
              user={user}
              userName={userName}
              userRole={userRole}
              lang={lang as any}
              isRTL={isRTL}
              colors={colors as any}
              t={t}
              mostraAlert={mostraAlert}
              canGestireAulaStudio={canGestireAulaStudio}
              registraAttivita={registraAttivita}
              inviaNotificaConPreferenza={inviaNotificaConPreferenza}
              scriviECondividiExcel={scriviECondividiExcel}
              classiLista={classiLista}
              profiloAulaStudio={profiloAulaStudio}
              onProfiloAulaStudioSalvato={caricaDatiGenerali}
              gestoriAulaStudio={gestoriAulaStudio}
            />
          ) : userRole === 'insegnante' ? (
            <AulaStudioTurniView
              db={db}
              user={user}
              userName={userName}
              userRole={userRole}
              lang={lang as any}
              isRTL={isRTL}
              colors={colors as any}
              t={t}
              mostraAlert={mostraAlert}
              canGestireAulaStudio={canGestireAulaStudio}
              registraAttivita={registraAttivita}
              inviaNotificaConPreferenza={inviaNotificaConPreferenza}
              scriviECondividiExcel={scriviECondividiExcel}
              classiLista={classiLista}
              profiloAulaStudio={profiloAulaStudio}
              onProfiloAulaStudioSalvato={caricaDatiGenerali}
              gestoriAulaStudio={gestoriAulaStudio}
              richiestaTurnoDaAprireId={richiestaTurnoDaAprireId}
              onRichiestaTurnoAperta={() => setRichiestaTurnoDaAprireId(null)}
            />
          ) : (
            <ScrollView contentContainerStyle={styles.bodyContent}>
              <Text style={styles.infoText}>{t('aulaStudioSoloStudenti', lang)}</Text>
            </ScrollView>
          )
        )}

        {/* ------ VISTA MANUTENZIONE ------ */}
        {vistaAttiva === 'manutenzione' && (() => {
          const auleOrdinate = [...aule].sort((a, b) => (a.sezione || '').localeCompare(b.sezione || '') || (a.nome || '').localeCompare(b.nome || ''));
          const meseCorrenteYYYYMM = new Date().toISOString().slice(0, 7);
          const segnalazioniPropriaVisibilita = manutenzioneLista.filter((s) =>
            canGestireManutenzione || s.utenteEmail === user.email
          );
          const segnalazioniVisibili = segnalazioniPropriaVisibilita.filter((s) => {
            if (s.stato !== 'Risolto') return true;
            const meseRisoluzione = (s.tsRisoluzione || s.data || '').slice(0, 7);
            return meseRisoluzione >= meseCorrenteYYYYMM;
          });
          const segnalazioniFiltrate = segnalazioniVisibili
            .filter((s) => filtroStatoManutenzione === 'Tutte' ? true : s.stato === filtroStatoManutenzione)
            .sort((a, b) => (b.tsSegnalazione || b.data || '').localeCompare(a.tsSegnalazione || a.data || ''));

          const etichettaStatoManutenzione = t(
            filtroStatoManutenzione === 'Da risolvere' ? 'daRisolvere'
              : filtroStatoManutenzione === 'In lavorazione' ? 'inLavorazione'
              : filtroStatoManutenzione === 'Risolto' ? 'risolto' : 'tutte',
            lang
          );
          const coloreStato = (stato) => stato === 'Risolto' ? colors.success : stato === 'In lavorazione' ? colors.primary : colors.danger;
          const etichettaStatoBreve = (stato) => stato === 'Risolto' ? t('risolto', lang) : stato === 'In lavorazione' ? t('inLavorazione', lang) : t('daRisolvere', lang);
          const s = segnalazioneDettaglio;
          const puoVedereDiario = s && canGestireManutenzione && !!s.tsPresaInCarico;
          const puoScrivereDiario = s && (isManutentore || userRole === 'economo') && !!s.tsPresaInCarico;

          return (
            <ScrollView contentContainerStyle={styles.bodyContent}>
              <View style={Platform.OS === 'web' ? styles.manutenzioneWebOuter : null}>
              <View>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionHeaderTitle}>{t('navManutenzione', lang)}</Text>
                <TouchableOpacity style={styles.addButton} onPress={() => setModalNuovaSegnalazione(true)}>
                  <Text style={styles.addButtonText}>{t('nuovaSegnalazione', lang)}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setFiltroStatoManutenzioneDropdownAperto(true)}>
                <Text style={styles.dropdownTriggerText}>{t('stato', lang)}: {etichettaStatoManutenzione}</Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>

              <Modal visible={filtroStatoManutenzioneDropdownAperto} animationType="fade" transparent onRequestClose={() => setFiltroStatoManutenzioneDropdownAperto(false)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFiltroStatoManutenzioneDropdownAperto(false)}>
                  <View style={styles.dropdownOptionsList}>
                    {[['Da risolvere', 'daRisolvere'], ['In lavorazione', 'inLavorazione'], ['Risolto', 'risolto'], ['Tutte', 'tutte']].map(([valore, chiave]) => {
                      const attivo = filtroStatoManutenzione === valore;
                      return (
                        <TouchableOpacity key={valore} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setFiltroStatoManutenzione(valore); setFiltroStatoManutenzioneDropdownAperto(false); }}>
                          <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{t(chiave, lang)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </TouchableOpacity>
              </Modal>

              {segnalazioniFiltrate.length === 0 && (
                <Text style={styles.infoText}>{t('nessunaSegnalazione', lang)}</Text>
              )}

              {segnalazioniFiltrate.length > 0 && (
                Platform.OS === 'android' ? (
                  <View style={[styles.tableCard, { width: '100%' }]}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHeaderCell, { flex: 1.4 }]}>{t('colAula', lang)}</Text>
                      <Text style={[styles.tableHeaderCell, styles.tableColStato]}>{t('colStato', lang)}</Text>
                    </View>
                    {segnalazioniFiltrate.map((riga, idx) => {
                      const RigaTabella = canGestireManutenzione ? TouchableOpacity : View;
                      const propsRiga = canGestireManutenzione
                        ? { onPress: () => { setNuovaVoceDiario(''); setSegnalazioneDettaglio(riga); } }
                        : {};
                      return (
                        <RigaTabella key={riga.id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]} {...propsRiga}>
                          <Text style={[styles.tableCell, { flex: 1.4 }]} numberOfLines={1}>{risolviNomeAula(riga.aulaNome, lang)}{riga.sezione ? ` (${risolviNomeSezione(riga.sezione, lang)})` : ''}</Text>
                          <View style={styles.tableColStato}>
                            <View style={[styles.statoBadge, { backgroundColor: coloreStato(riga.stato) }]}>
                              <Text style={styles.statoBadgeText}>{etichettaStatoBreve(riga.stato)}</Text>
                            </View>
                          </View>
                        </RigaTabella>
                      );
                    })}
                  </View>
                ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.tableScrollWrap}>
                  <View style={[styles.tableCard, styles.tableCardScrollable, { minWidth: 520 }]}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHeaderCell, styles.tableColAula]}>{t('colAula', lang)}</Text>
                      <Text style={[styles.tableHeaderCell, styles.tableColUtente]}>{t('colSegnalatoDa', lang)}</Text>
                      <Text style={[styles.tableHeaderCell, styles.tableColTipo]}>{t('colTipoGuasto', lang)}</Text>
                      <Text style={[styles.tableHeaderCell, styles.tableColStato]}>{t('colStato', lang)}</Text>
                      <Text style={[styles.tableHeaderCell, styles.tableColData]}>{t('colData', lang)}</Text>
                    </View>
                    {segnalazioniFiltrate.map((riga, idx) => {
                      const RigaTabella = canGestireManutenzione ? TouchableOpacity : View;
                      const propsRiga = canGestireManutenzione
                        ? { onPress: () => { setNuovaVoceDiario(''); setSegnalazioneDettaglio(riga); } }
                        : {};
                      return (
                        <RigaTabella key={riga.id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]} {...propsRiga}>
                          <Text style={[styles.tableCell, styles.tableColAula]} numberOfLines={1}>{risolviNomeAula(riga.aulaNome, lang)}{riga.sezione ? ` (${risolviNomeSezione(riga.sezione, lang)})` : ''}</Text>
                          <Text style={[styles.tableCell, styles.tableColUtente]} numberOfLines={1}>{riga.utenteNome}</Text>
                          <Text style={[styles.tableCell, styles.tableColTipo]} numberOfLines={1}>{etichettaTipoGuasto(riga.tipoGuasto, lang)}</Text>
                          <View style={styles.tableColStato}>
                            <View style={[styles.statoBadge, { backgroundColor: coloreStato(riga.stato) }]}>
                              <Text style={styles.statoBadgeText}>{etichettaStatoBreve(riga.stato)}</Text>
                            </View>
                          </View>
                          <Text style={[styles.tableCell, styles.tableColData]}>{dataArabo(riga.data, lang)}</Text>
                        </RigaTabella>
                      );
                    })}
                  </View>
                </ScrollView>
                )
              )}
              </View>
              </View>

              {/* Modale nuova segnalazione */}
              <Modal visible={modalNuovaSegnalazione} animationType="slide" transparent onRequestClose={() => setModalNuovaSegnalazione(false)}>
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContentFixed}>
                    <View style={styles.modalHeaderFixed}>
                      <Text style={styles.modalTitle}>{t('segnalaGuasto', lang)}</Text>
                      <TouchableOpacity onPress={() => setModalNuovaSegnalazione(false)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
                    </View>
                    <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
                      <Text style={styles.label}>{t('selezionaAula', lang)}</Text>
                      <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setAulaManutenzioneDropdownAperto(true)}>
                        <Text style={styles.dropdownTriggerText}>{aulaManutenzioneSelezionata ? `${risolviNomeAula(aulaManutenzioneSelezionata.nome, lang)} (${risolviNomeSezione(aulaManutenzioneSelezionata.sezione, lang)})` : t('selezionaAula', lang)}</Text>
                        <Text style={styles.dropdownArrow}>▼</Text>
                      </TouchableOpacity>

                      <Modal visible={aulaManutenzioneDropdownAperto} animationType="fade" transparent onRequestClose={() => setAulaManutenzioneDropdownAperto(false)}>
                        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAulaManutenzioneDropdownAperto(false)}>
                          <View style={styles.dropdownOptionsList}>
                            <ScrollView style={{ maxHeight: 400 }}>
                              {auleOrdinate.map((a) => {
                                const attivo = aulaManutenzioneSelezionata?.id === a.id;
                                return (
                                  <TouchableOpacity key={a.id} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setAulaManutenzioneSelezionata(a); setAulaManutenzioneDropdownAperto(false); }}>
                                    <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{risolviNomeAula(a.nome, lang)} ({risolviNomeSezione(a.sezione, lang)})</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </ScrollView>
                          </View>
                        </TouchableOpacity>
                      </Modal>

                      <Text style={styles.label}>{t('tipoGuasto', lang)}</Text>
                      <View style={styles.fasceGrid}>
                        {['elettrico', 'informatico', 'strutturale', 'altro'].map((tipo) => {
                          const selezionato = tipoGuastoSelezionato === tipo;
                          return (
                            <TouchableOpacity key={tipo} style={[styles.fasciaChip, selezionato && styles.fasciaSelected]} onPress={() => setTipoGuastoSelezionato(tipo)}>
                              <Text style={[styles.fasciaText, selezionato && styles.fasciaTextSelected]}>{etichettaTipoGuasto(tipo, lang)}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <Text style={styles.label}>{t('descrizioneGuastoLabel', lang)}</Text>
                      <TextInput
                        style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
                        placeholder={t('descrizioneGuastoPlaceholder', lang)}
                        placeholderTextColor={colors.placeholder}
                        value={descrizioneGuasto}
                        onChangeText={setDescrizioneGuasto}
                        multiline
                      />
                    </ScrollView>
                    <View style={styles.modalFooterFixed}>
                      <TouchableOpacity style={styles.primaryButton} onPress={inviaSegnalazioneManutenzione}>
                        <Text style={styles.buttonText}>{t('inviaSegnalazione', lang)}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </Modal>

              {/* Dettaglio segnalazione */}
              <Modal visible={!!segnalazioneDettaglio} animationType="slide" transparent onRequestClose={() => setSegnalazioneDettaglio(null)}>
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContentFixed}>
                    {s && (
                      <>
                        <View style={styles.modalHeaderFixed}>
                          <Text style={styles.modalTitle} numberOfLines={1}>{risolviNomeAula(s.aulaNome, lang)}{s.sezione ? ` (${risolviNomeSezione(s.sezione, lang)})` : ''}</Text>
                          <TouchableOpacity onPress={() => setSegnalazioneDettaglio(null)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
                          <View style={[styles.statoBadge, { backgroundColor: coloreStato(s.stato), marginBottom: 14 }]}>
                            <Text style={styles.statoBadgeText}>{etichettaStatoBreve(s.stato)} · {etichettaTipoGuasto(s.tipoGuasto, lang)}</Text>
                          </View>

                          <Text style={styles.label}>{t('descrizioneGuastoLabel', lang)}</Text>
                          <Text style={styles.gestioneListMeta}>{s.descrizione}</Text>
                          <Text style={[styles.gestioneListMeta, { marginTop: 8 }]}>{t('segnalatoDa', lang)}: {s.utenteNome}</Text>

                          <Text style={[styles.label, { marginTop: 16 }]}>{t('storicoTempistiche', lang)}</Text>
                          <View style={styles.storicoBlocco}>
                            <View style={styles.storicoRiga}>
                              <Text style={styles.storicoLabel}>{t('segnalatoIl', lang)}</Text>
                              <Text style={styles.storicoValore}>{formattaDataOra(s.tsSegnalazione, lang) || dataArabo(s.data, lang)}</Text>
                            </View>
                            <View style={styles.storicoRiga}>
                              <Text style={styles.storicoLabel}>{t('presoInCaricoIl', lang)}</Text>
                              <Text style={styles.storicoValore}>{s.tsPresaInCarico ? formattaDataOra(s.tsPresaInCarico, lang) : t('nonAncora', lang)}</Text>
                            </View>
                            <View style={styles.storicoRiga}>
                              <Text style={styles.storicoLabel}>{t('risoltoIl', lang)}</Text>
                              <Text style={styles.storicoValore}>{s.tsRisoluzione ? formattaDataOra(s.tsRisoluzione, lang) : t('nonAncora', lang)}</Text>
                            </View>
                          </View>

                          {canGestireManutenzione && (
                            <View style={styles.actionRow}>
                              {s.stato === 'Da risolvere' && (
                                <TouchableOpacity style={styles.btnApprove} onPress={() => cambiaStatoManutenzione(s.id, 'In lavorazione', s)}>
                                  <Text style={styles.btnText}>{t('segnaComeInLavorazione', lang)}</Text>
                                </TouchableOpacity>
                              )}
                              {s.stato === 'In lavorazione' && (
                                <>
                                  <TouchableOpacity style={styles.btnApprove} onPress={() => cambiaStatoManutenzione(s.id, 'Risolto', s)}>
                                    <Text style={styles.btnText}>{t('segnaComeRisolto', lang)}</Text>
                                  </TouchableOpacity>
                                  {isGestore && (
                                    <TouchableOpacity style={styles.btnReject} onPress={() => cambiaStatoManutenzione(s.id, 'Da risolvere', s)}>
                                      <Text style={styles.btnText}>{t('riportaADaRisolvere', lang)}</Text>
                                    </TouchableOpacity>
                                  )}
                                </>
                              )}
                              {s.stato === 'Risolto' && isGestore && (
                                <TouchableOpacity style={styles.btnReject} onPress={() => cambiaStatoManutenzione(s.id, 'Da risolvere', s)}>
                                  <Text style={styles.btnText}>{t('riportaADaRisolvere', lang)}</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          )}

                          {puoVedereDiario && (
                            <View style={styles.diarioBlocco}>
                              <Text style={[styles.label, { marginTop: 16 }]}>{t('diarioLavoro', lang)}</Text>
                              {(s.diario || []).length === 0 && (
                                <Text style={styles.infoText}>{t('diarioVuoto', lang)}</Text>
                              )}
                              {[...(s.diario || [])].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || '')).map((voce, i) => (
                                <View key={i} style={styles.diarioVoce}>
                                  <View style={styles.diarioVoceHeader}>
                                    <Text style={styles.diarioAutore}>{voce.autore}</Text>
                                    <Text style={styles.diarioTimestamp}>{formattaDataOra(voce.timestamp, lang)}</Text>
                                  </View>
                                  <Text style={styles.diarioTesto}>{voce.testo}</Text>
                                </View>
                              ))}
                              {puoScrivereDiario && (
                                <>
                                  <TextInput
                                    style={[styles.input, { height: 70, textAlignVertical: 'top', marginTop: 8 }]}
                                    placeholder={t('diarioPlaceholder', lang)}
                                    placeholderTextColor={colors.placeholder}
                                    value={nuovaVoceDiario}
                                    onChangeText={setNuovaVoceDiario}
                                    multiline
                                  />
                                  <TouchableOpacity style={styles.btnApprove} onPress={() => aggiungiVoceDiario(s.id)}>
                                    <Text style={styles.btnText}>{t('aggiungiAggiornamento', lang)}</Text>
                                  </TouchableOpacity>
                                </>
                              )}
                            </View>
                          )}
                        </ScrollView>
                      </>
                    )}
                  </View>
                </View>
              </Modal>
            </ScrollView>
          );
        })()}

        {/* ------ VISTA GESTIONE PRENOTAZIONI ------ */}
        {vistaAttiva === 'gestione' && (canApprovarePrenotazioni ? (() => {
          const prenotazioniSpecialiTutte = prenotazioni
            .filter((p) => !!p.richiedeAutorizzazioneSpeciale)
            .sort((a, b) => b.data.localeCompare(a.data));

          const attive = prenotazioni.filter((p) => p.data >= oggiStr).sort((a, b) => b.data.localeCompare(a.data));
          const meseCorrenteStr = oggiStr.substring(0, 7);
          const mesiAttivi = Array.from(new Set([meseCorrenteStr, ...attive.map((p) => p.data.substring(0, 7))])).sort();

          const selezioneAttiva = gestioneMeseSelezionato !== null ? gestioneMeseSelezionato : meseCorrenteStr;
          const [annoSel, meseSel] = selezioneAttiva.split('-').map(Number);
          const giorniNelMese = new Date(annoSel, meseSel, 0).getDate();

          const prenotazioniGiornoGestione = (giornoStr) => prenotazioni.filter((p) => p.data === giornoStr);
          const haPendenti = (giornoStr) => prenotazioniGiornoGestione(giornoStr).some((p) => p.stato === 'In attesa');
          const prenotazioniDelGiornoGestione = giornoGestioneSelezionato ? prenotazioniGiornoGestione(giornoGestioneSelezionato) : [];

          return (
            <ScrollView contentContainerStyle={styles.bodyContent}>
              <Text style={[styles.sectionHeaderTitle, { marginBottom: 16 }]}>{t('navGestione', lang)}</Text>

              {gestioneVistaSpeciali ? (
                <Pressable style={{ flex: 1 }} onPress={() => setGestioneVistaSpeciali(false)}>
                  <TouchableOpacity style={styles.backLinkRow} onPress={() => setGestioneVistaSpeciali(false)}>
                    <Text style={styles.backLinkText}>{isRTL ? `${t('torna', lang)} ›` : `‹ ${t('torna', lang)}`}</Text>
                  </TouchableOpacity>
                  <Text style={[styles.label, { marginBottom: 12 }]}>{t('prenotazioniSpeciali', lang)}</Text>

                  {prenotazioniSpecialiTutte.length === 0 && (
                    <Text style={styles.infoText}>{t('nessunaPrenotazione', lang)}</Text>
                  )}

                  {prenotazioniSpecialiTutte.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.tableScrollWrap}>
                      <View style={[styles.tableCard, styles.tableCardScrollable, { minWidth: 520 }]}>
                        <View style={styles.tableHeaderRow}>
                          <Text style={[styles.tableHeaderCell, styles.tableColAula]}>{t('aula', lang)}</Text>
                          <Text style={[styles.tableHeaderCell, styles.tableColUtente]}>{t('utente', lang)}</Text>
                          <Text style={[styles.tableHeaderCell, styles.tableColTipo]}>{t('orario', lang)}</Text>
                          <Text style={[styles.tableHeaderCell, styles.tableColStato]}>{t('stato', lang)}</Text>
                          <Text style={[styles.tableHeaderCell, styles.tableColData]}>{t('data', lang)}</Text>
                        </View>
                        {prenotazioniSpecialiTutte.map((p, idx) => {
                          const coloreStatoPrenotazione = p.stato === 'Approvata' ? colors.success : p.stato === 'Rifiutata' ? colors.danger : colors.primary;
                          const etichettaStatoPrenotazione = p.stato === 'In attesa' ? t('inAttesa', lang) : p.stato === 'Approvata' ? t('approvata', lang) : p.stato === 'Rifiutata' ? t('rifiutata', lang) : p.stato;
                          return (
                            <TouchableOpacity key={p.id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]} onPress={() => setPrenotazioneDettaglio(p)}>
                              <Text style={[styles.tableCell, styles.tableColAula]} numberOfLines={1}><Text style={{ color: colors.danger }}>★ </Text>{risolviNomeAula(p.aulaNome, lang)}{p.sezione ? ` (${risolviNomeSezione(p.sezione, lang)})` : ''}</Text>
                              <Text style={[styles.tableCell, styles.tableColUtente]} numberOfLines={1}>{p.utenteNome}</Text>
                              <Text style={[styles.tableCell, styles.tableColTipo]} numberOfLines={1}>{numArabo(p.fasce.join(', '), lang)}</Text>
                              <View style={styles.tableColStato}>
                                <View style={[styles.statoBadge, { backgroundColor: coloreStatoPrenotazione }]}>
                                  <Text style={styles.statoBadgeText}>{etichettaStatoPrenotazione}</Text>
                                </View>
                              </View>
                              <Text style={[styles.tableCell, styles.tableColData]}>{dataArabo(p.data, lang)}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </ScrollView>
                  )}
                </Pressable>
              ) : (
                <>
                  <View style={Platform.OS === 'android' ? styles.specialiMeseRowAndroid : styles.specialiMeseRowWeb}>
                    <TouchableOpacity style={[styles.specialiButton, Platform.OS === 'android' ? styles.specialiButtonAndroidHalf : styles.specialiButtonWebRow]} onPress={() => setGestioneVistaSpeciali(true)}>
                      <Text style={styles.specialiButtonText}>★ {t('speciali', lang)}</Text>
                      <View style={styles.specialiButtonBadge}>
                        <Text style={styles.specialiButtonBadgeText}>{numArabo(prenotazioniSpecialiTutte.length, lang)}</Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.dropdownTrigger, Platform.OS === 'android' ? styles.dropdownTriggerAndroidHalf : styles.dropdownTriggerWebRow]} onPress={() => setFiltroMeseGestioneDropdownAperto(true)}>
                      <Text style={styles.dropdownTriggerText}>{formattaMeseAnno(selezioneAttiva, lang)}</Text>
                      <Text style={styles.dropdownArrow}>▼</Text>
                    </TouchableOpacity>
                  </View>

                  <Modal visible={filtroMeseGestioneDropdownAperto} animationType="fade" transparent onRequestClose={() => setFiltroMeseGestioneDropdownAperto(false)}>
                    <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFiltroMeseGestioneDropdownAperto(false)}>
                      <View style={styles.dropdownOptionsList}>
                        {mesiAttivi.map((ym) => {
                          const attivo = selezioneAttiva === ym;
                          return (
                            <TouchableOpacity key={ym} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setGestioneMeseSelezionato(ym); setFiltroMeseGestioneDropdownAperto(false); }}>
                              <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{formattaMeseAnno(ym, lang)}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </TouchableOpacity>
                  </Modal>

                  <View style={{ flexDirection: 'row', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={[styles.dayLegendDot, { backgroundColor: colors.success }]} />
                      <Text style={styles.infoTextSmall}>{t('legendaNessunaAttesa', lang)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={[styles.dayLegendDot, { backgroundColor: colors.warning }]} />
                      <Text style={styles.infoTextSmall}>{t('legendaInAttesa', lang)}</Text>
                    </View>
                  </View>

                  <View style={styles.dayGrid}>
                    {Array.from({ length: giorniNelMese }, (_, i) => i + 1).map((giorno) => {
                      const giornoStr = `${selezioneAttiva}-${String(giorno).padStart(2, '0')}`;
                      const pendente = haPendenti(giornoStr);
                      return (
                        <TouchableOpacity
                          key={giornoStr}
                          style={[styles.dayButton, pendente ? styles.dayButtonPending : styles.dayButtonFree]}
                          onPress={() => setGiornoGestioneSelezionato(giornoStr)}
                        >
                          <Text style={[styles.dayButtonText, pendente && styles.dayButtonTextPending]}>{numArabo(giorno, lang)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              <Modal visible={giornoGestioneSelezionato !== null} animationType="slide" transparent onRequestClose={() => setGiornoGestioneSelezionato(null)}>
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContentFixed}>
                    <View style={styles.modalHeaderFixed}>
                      <Text style={styles.modalTitle}>{giornoGestioneSelezionato}</Text>
                      <TouchableOpacity onPress={() => setGiornoGestioneSelezionato(null)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
                    </View>
                    <ScrollView style={styles.modalBodyScrollable}>
                      {prenotazioniDelGiornoGestione.length === 0 && (
                        <Text style={styles.infoText}>{t('nessunaPrenotazione', lang)}</Text>
                      )}
                      {prenotazioniDelGiornoGestione.map((p) => {
                        const coloreStatoPrenotazione = p.stato === 'Approvata' ? colors.success : p.stato === 'Rifiutata' ? colors.danger : colors.primary;
                        const etichettaStatoPrenotazione = p.stato === 'In attesa' ? t('inAttesa', lang) : p.stato === 'Approvata' ? t('approvata', lang) : p.stato === 'Rifiutata' ? t('rifiutata', lang) : p.stato;
                        return (
                          <TouchableOpacity key={p.id} style={styles.calRow} onPress={() => setPrenotazioneDettaglio(p)}>
                            <Text style={styles.calRowText} numberOfLines={2} ellipsizeMode="tail">
                              {p.richiedeAutorizzazioneSpeciale ? <Text style={{ color: colors.danger }}>★ </Text> : null}
                              <Text style={styles.calRowAula}>{risolviNomeAula(p.aulaNome, lang)}{p.sezione ? ` (${risolviNomeSezione(p.sezione, lang)})` : ''}</Text>
                              {'  '}· {p.utenteNome} · {numArabo(p.fasce.join(', '), lang)}
                            </Text>
                            <View style={[styles.statoBadge, { backgroundColor: coloreStatoPrenotazione }]}>
                              <Text style={styles.statoBadgeText}>{etichettaStatoPrenotazione}</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                </View>
              </Modal>

              <Modal visible={!!prenotazioneDettaglio} animationType="slide" transparent onRequestClose={() => setPrenotazioneDettaglio(null)}>
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContentFixed}>
                    {prenotazioneDettaglio && (
                      <>
                        <View style={styles.modalHeaderFixed}>
                          <Text style={styles.modalTitle} numberOfLines={1}>{risolviNomeAula(prenotazioneDettaglio.aulaNome, lang)}{prenotazioneDettaglio.sezione ? ` (${risolviNomeSezione(prenotazioneDettaglio.sezione, lang)})` : ''}</Text>
                          <TouchableOpacity onPress={() => setPrenotazioneDettaglio(null)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                            <View style={[styles.statoBadge, {
                              backgroundColor: prenotazioneDettaglio.stato === 'Approvata' ? colors.success : prenotazioneDettaglio.stato === 'Rifiutata' ? colors.danger : colors.primary
                            }]}>
                              <Text style={styles.statoBadgeText}>
                                {prenotazioneDettaglio.stato === 'In attesa' ? t('inAttesa', lang) : prenotazioneDettaglio.stato === 'Approvata' ? t('approvata', lang) : prenotazioneDettaglio.stato === 'Rifiutata' ? t('rifiutata', lang) : prenotazioneDettaglio.stato}
                              </Text>
                            </View>
                            {prenotazioneDettaglio.richiedeAutorizzazioneSpeciale && (
                              <View style={[styles.statoBadge, { backgroundColor: colors.danger }]}>
                                <Text style={styles.statoBadgeText}>★ {t('etichettaSpeciale', lang)}</Text>
                              </View>
                            )}
                          </View>

                          <Text style={styles.gestioneListMeta}>{t('utente', lang)}: {prenotazioneDettaglio.utenteNome} ({prenotazioneDettaglio.utenteEmail})</Text>
                          <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>{t('data', lang)}: {dataArabo(prenotazioneDettaglio.data, lang)} | {t('ore', lang)}: {numArabo(prenotazioneDettaglio.fasce.join(', '), lang)}</Text>
                          {prenotazioneDettaglio.motivo ? <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>{t('motivo', lang)}: {prenotazioneDettaglio.motivo}</Text> : null}
                          {prenotazioneDettaglio.studenteIPI ? (
                            <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>
                              {prenotazioneDettaglio.studenteIPI === 'si' ? t('sonoStudenteIPI', lang) : t('nonSonoStudenteIPI', lang)}
                            </Text>
                          ) : null}
                          {prenotazioneDettaglio.classe ? <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>{t('classe', lang)}: {prenotazioneDettaglio.classe}</Text> : null}
                          {prenotazioneDettaglio.insegnanteRiferimento ? <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>{t('insegnanteRiferimento', lang)} {prenotazioneDettaglio.insegnanteRiferimento}</Text> : null}
                          {prenotazioneDettaglio.partecipanti && prenotazioneDettaglio.partecipanti.length > 0 && (
                            <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>{t('partecipanti', lang)}: {prenotazioneDettaglio.partecipanti.join(', ')}</Text>
                          )}

                          <View style={[styles.actionRow, { marginTop: 16 }]}>
                            {prenotazioneDettaglio.stato === 'In attesa' && (
                              <>
                                <TouchableOpacity style={styles.btnApprove} onPress={() => { cambiaStatoPrenotazione(prenotazioneDettaglio.id, 'Approvata', prenotazioneDettaglio.utenteEmail, prenotazioneDettaglio.aulaNome, prenotazioneDettaglio.data, prenotazioneDettaglio.fasce); setPrenotazioneDettaglio(null); }}>
                                  <Text style={styles.btnText}>{t('approva', lang)}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.btnReject} onPress={() => { cambiaStatoPrenotazione(prenotazioneDettaglio.id, 'Rifiutata', prenotazioneDettaglio.utenteEmail, prenotazioneDettaglio.aulaNome, prenotazioneDettaglio.data, prenotazioneDettaglio.fasce); setPrenotazioneDettaglio(null); }}>
                                  <Text style={styles.btnText}>{t('rifiuta', lang)}</Text>
                                </TouchableOpacity>
                              </>
                            )}
                            <TouchableOpacity style={styles.btnDelete} onPress={() => { eliminaPrenotazione(prenotazioneDettaglio.id); setPrenotazioneDettaglio(null); }}>
                              <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('elimina', lang)}</Text>
                            </TouchableOpacity>
                            {prenotazioneDettaglio.gruppoRipetizione && (
                              <TouchableOpacity style={styles.btnReject} onPress={() => { eliminaGruppoPrenotazioni(prenotazioneDettaglio.gruppoRipetizione); setPrenotazioneDettaglio(null); }}>
                                <Text style={styles.btnText}>{t('eliminaBlocco', lang)}</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </ScrollView>
                      </>
                    )}
                  </View>
                </View>
              </Modal>
            </ScrollView>
          );
        })() : <AccessoNegato />)}

        {/* ------ VISTA IMPOSTAZIONI (con menu e sottoviste) ------ */}
        {vistaAttiva === 'impostazioni' && (() => {
          const utentiFiltrati = utentiLista.filter((u) => {
            const query = cercaUtenteQuery.trim().toLowerCase();
            if (!query) return true;
            const nomeMatch = u.nome && u.nome.toLowerCase().includes(query);
            const emailMatch = u.email && u.email.toLowerCase().includes(query);
            return nomeMatch || emailMatch;
          });

          const tipiEtichette = {
            [TIPI_REGISTRO.CREAZIONE_UTENTE]: 'Creazione utente',
            [TIPI_REGISTRO.MODIFICA_RUOLO_UTENTE]: 'Modifica ruolo utente',
            [TIPI_REGISTRO.ELIMINAZIONE_UTENTE]: 'Eliminazione utente',
            [TIPI_REGISTRO.AGGIUNTA_AULA]: 'Aggiunta aula',
            [TIPI_REGISTRO.MODIFICA_AULA]: 'Modifica aula',
            [TIPI_REGISTRO.ELIMINAZIONE_AULA]: 'Eliminazione aula',
            [TIPI_REGISTRO.CREAZIONE_PRENOTAZIONE]: 'Creazione prenotazione',
            [TIPI_REGISTRO.APPROVAZIONE_PRENOTAZIONE]: 'Approvazione prenotazione',
            [TIPI_REGISTRO.RIFIUTO_PRENOTAZIONE]: 'Rifiuto prenotazione',
            [TIPI_REGISTRO.AGGIUNTA_DOMINIO]: 'Aggiunta dominio',
            [TIPI_REGISTRO.RIMOZIONE_DOMINIO]: 'Rimozione dominio',
            [TIPI_REGISTRO.CREAZIONE_SEGNALAZIONE]: 'Creazione segnalazione',
            [TIPI_REGISTRO.PRESA_IN_CARICO_SEGNALAZIONE]: 'Presa in carico segnalazione',
            [TIPI_REGISTRO.RISOLUZIONE_SEGNALAZIONE]: 'Risoluzione segnalazione',
            aula_studio_prenotazione: 'Aula Studio: prenotazione',
            aula_studio_cancellazione: 'Aula Studio: cancellazione',
            aula_studio_promozione_waitlist: 'Aula Studio: promozione da lista d\'attesa',
            aula_studio_aggiunta_manuale: 'Aula Studio: aggiunta manuale',
            aula_studio_presenza_aggiornata: 'Aula Studio: presenza aggiornata',
            aula_studio_pallino_rosso: 'Aula Studio: pallino rosso',
            aula_studio_azione_terzo_pallino: 'Aula Studio: azione al 3° pallino',
            aula_studio_modifica_config: 'Aula Studio: modifica impostazioni'
          };

          // Punto 6a: nelle sottoviste di sola lettura (senza form/modale a rischio), un tap
          // nell'area vuota della schermata equivale a premere "Torna" — scorciatoia in più,
          // il pulsante esplicito resta comunque presente.
          const VOCI_TAP_VUOTO_TORNA = ['preferenze', 'notifiche', 'registro', 'profili', 'esporta', 'blocca', 'avanzate', 'utenti'];
          const tapVuotoTornaAttivo = VOCI_TAP_VUOTO_TORNA.includes(impostazioniVista);

          return (
            <ScrollView contentContainerStyle={styles.bodyContent}>
              <Text style={[styles.sectionHeaderTitle, { marginBottom: 14 }]}>{t('navImpostazioni', lang)}</Text>

              {impostazioniVista !== 'menu' && (
                <TouchableOpacity
                  style={styles.backLinkRow}
                  onPress={() => {
                    if (impostazioniVista === 'auleSezione' || impostazioniVista === 'aulaStudio') {
                      setImpostazioniVista('aule');
                    } else {
                      setImpostazioniVista('menu');
                    }
                  }}
                >
                  <Text style={styles.backLinkText}>{isRTL ? `${t('torna', lang)} ›` : `‹ ${t('torna', lang)}`}</Text>
                </TouchableOpacity>
              )}

              <Pressable style={{ flex: 1 }} onPress={tapVuotoTornaAttivo ? () => setImpostazioniVista('menu') : undefined}>

              {impostazioniVista === 'menu' && (
                <>
                  <Text style={styles.settingsMenuSottotitolo}>{t('impostazioniMenuSottotitolo', lang)}</Text>
                  <View style={styles.settingsMenuList}>
                    <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('preferenze')}>
                      <View style={styles.settingsMenuItemLeft}>
                        <Text style={styles.settingsMenuItemIcon}>⚙️</Text>
                        <Text style={styles.settingsMenuItemLabel}>{t('preferenze', lang)}</Text>
                      </View>
                      <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('notifiche')}>
                      <View style={styles.settingsMenuItemLeft}>
                        <Text style={styles.settingsMenuItemIcon}>🔔</Text>
                        <Text style={styles.settingsMenuItemLabel}>{t('sezioneNotifiche', lang)}</Text>
                      </View>
                      <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                    </TouchableOpacity>

                    {canGestireUtenti && (
                      <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('utenti')}>
                        <View style={styles.settingsMenuItemLeft}>
                          <Text style={styles.settingsMenuItemIcon}>👥</Text>
                          <Text style={styles.settingsMenuItemLabel}>{t('listaAggiuntaUtenti', lang)}</Text>
                        </View>
                        <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                      </TouchableOpacity>
                    )}

                    {canGestireDominiEmail && (
                      <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('domini')}>
                        <View style={styles.settingsMenuItemLeft}>
                          <Text style={styles.settingsMenuItemIcon}>🌐</Text>
                          <Text style={styles.settingsMenuItemLabel}>{t('permessiDomini', lang)}</Text>
                        </View>
                        <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                      </TouchableOpacity>
                    )}

                    {canGestireClassi && (
                      <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('classi')}>
                        <View style={styles.settingsMenuItemLeft}>
                          <Text style={styles.settingsMenuItemIcon}>📚</Text>
                          <Text style={styles.settingsMenuItemLabel}>{t('classi', lang)}</Text>
                        </View>
                        <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                      </TouchableOpacity>
                    )}

                    {canResettareDati && (
                      <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('reset')}>
                        <View style={styles.settingsMenuItemLeft}>
                          <Text style={styles.settingsMenuItemIcon}>🗑️</Text>
                          <Text style={styles.settingsMenuItemLabel}>{t('areaResetGestore', lang)}</Text>
                        </View>
                        <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                      </TouchableOpacity>
                    )}

                    {userRole === 'gestore' && (
                      <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('avanzate')}>
                        <View style={styles.settingsMenuItemLeft}>
                          <Text style={styles.settingsMenuItemIcon}>🔧</Text>
                          <Text style={styles.settingsMenuItemLabel}>{t('impostazioniAvanzate', lang)}</Text>
                        </View>
                        <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                      </TouchableOpacity>
                    )}

                    {canGestireManuali && (
                      <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('manuali')}>
                        <View style={styles.settingsMenuItemLeft}>
                          <Text style={styles.settingsMenuItemIcon}>📖</Text>
                          <Text style={styles.settingsMenuItemLabel}>{t('menuManuali', lang)}</Text>
                        </View>
                        <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                      </TouchableOpacity>
                    )}

                    {canGestireUtenti && (
                      <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('blocca')}>
                        <View style={styles.settingsMenuItemLeft}>
                          <Text style={styles.settingsMenuItemIcon}>🚫</Text>
                          <Text style={styles.settingsMenuItemLabel}>{t('areaBloccaGestore', lang)}</Text>
                        </View>
                        <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                      </TouchableOpacity>
                    )}

                    {canGestireAule && (
                      <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('aule')}>
                        <View style={styles.settingsMenuItemLeft}>
                          <Text style={styles.settingsMenuItemIcon}>🏫</Text>
                          <Text style={styles.settingsMenuItemLabel}>{lang === 'ar' ? 'القاعات' : 'Aule'}</Text>
                        </View>
                        <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                      </TouchableOpacity>
                    )}

                    {(canEsportareUtentiPrenotazioni || canEsportarePrenotazioniSegnalazioni || canGestireAulaStudio) && (
                      <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('esporta')}>
                        <View style={styles.settingsMenuItemLeft}>
                          <Text style={styles.settingsMenuItemIcon}>📤</Text>
                          <Text style={styles.settingsMenuItemLabel}>{t('areaEsportaGestore', lang)}</Text>
                        </View>
                        <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                      </TouchableOpacity>
                    )}

                    {canVedereRegistroAttivita && (
                      <TouchableOpacity style={styles.settingsMenuItem} onPress={() => { setImpostazioniVista('registro'); caricaRegistroAttivita(); }}>
                        <View style={styles.settingsMenuItemLeft}>
                          <Text style={styles.settingsMenuItemIcon}>📋</Text>
                          <Text style={styles.settingsMenuItemLabel}>{t('registroAttivita', lang)}</Text>
                        </View>
                        <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                      </TouchableOpacity>
                    )}

                    {canVedereProfili && (
                      <TouchableOpacity style={styles.settingsMenuItem} onPress={() => { setImpostazioniVista('profili'); }}>
                        <View style={styles.settingsMenuItemLeft}>
                          <Text style={styles.settingsMenuItemIcon}>📋</Text>
                          <Text style={styles.settingsMenuItemLabel}>{t('profili', lang)}</Text>
                        </View>
                        <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              )}

              {/* Sottovista: Aule — menù con le 4 sezioni Home + Aula Studio (sostituisce il pulsante "✎ Modifica" della Home). */}
              {impostazioniVista === 'aule' && canGestireAule && (
                <>
                  <Text style={styles.settingsMenuSottotitolo}>
                    {lang === 'ar' ? 'إدارة الأقسام والقاعات المعروضة في الصفحة الرئيسية.' : 'Gestisci le sezioni e le aule mostrate nella Home.'}
                  </Text>
                  <View style={styles.settingsMenuList}>
                    {sezioniLista.map((sez, idx) => {
                      const isAulaStudio = sez.speciale === 'aulaStudio';
                      return (
                        <View key={sez.id} style={[styles.settingsMenuItem, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                            onPress={() => {
                              if (isAulaStudio) {
                                setImpostazioniVista('aulaStudio');
                              } else {
                                setSezioneSelezionata(sez.nome);
                                setImpostazioniVista('auleSezione');
                              }
                            }}
                          >
                            <View style={styles.settingsMenuItemLeft}>
                              <Text style={styles.settingsMenuItemIcon}>{isAulaStudio ? '📖' : '🏫'}</Text>
                              <Text style={styles.settingsMenuItemLabel}>{risolviNomeSezione(sez.nome, lang)}</Text>
                            </View>
                            <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                          </TouchableOpacity>
                          <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                            <TouchableOpacity style={styles.smallMoveBtn} onPress={() => spostaSezione(idx, 'su')} disabled={idx === 0}>
                              <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>▲</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.smallMoveBtn} onPress={() => spostaSezione(idx, 'giu')} disabled={idx === sezioniLista.length - 1}>
                              <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>▼</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.smallEditBtn} onPress={() => apriModificaSezione(sez)}>
                              <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('modifica', lang)}</Text>
                            </TouchableOpacity>
                            {!isAulaStudio && (
                              <TouchableOpacity style={styles.smallDeleteBtn} onPress={() => eliminaSezione(sez.id)}>
                                <Text style={styles.btnText}>{t('elimina', lang)}</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                  <TouchableOpacity style={[styles.addButton, { marginTop: 14, alignSelf: isRTL ? 'flex-end' : 'flex-start' }]} onPress={() => setModalNuovaSezione(true)}>
                    <Text style={styles.addButtonText}>{t('aggiungiSezione', lang)}</Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Sottovista: Aule di una sezione (raggiunta da Impostazioni → Aule → una delle 4 sezioni). */}
              {impostazioniVista === 'auleSezione' && canGestireAule && sezioneSelezionata && (
                <View>
                  <View style={styles.sectionTitleRow}>
                    <Text style={styles.sectionHeaderTitle}>{risolviNomeSezione(sezioneSelezionata, lang)}</Text>
                  </View>
                  {aule.filter((a) => a.sezione === sezioneSelezionata).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)).map((aula, idx, arr) => (
                    <View key={aula.id} style={styles.aulaCard}>
                      <View>
                        <Text style={styles.aulaTitle}>{risolviNomeAula(aula.nome, lang)}</Text>
                        <Text style={styles.aulaDesc}>{t('capienza', lang)}: {numArabo(aula.capienza, lang)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <TouchableOpacity style={styles.smallMoveBtn} onPress={() => spostaAula(aula.id, 'su')} disabled={idx === 0}>
                          <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>▲</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.smallMoveBtn} onPress={() => spostaAula(aula.id, 'giu')} disabled={idx === arr.length - 1}>
                          <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>▼</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.smallEditBtn} onPress={() => apriModificaAula(aula)}>
                          <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('modifica', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.smallMoveBtn} onPress={() => apriBloccaAula(aula)}>
                          <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('bloccaAula', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.smallDeleteBtn} onPress={() => eliminaAula(aula.id)}>
                          <Text style={styles.btnText}>{t('elimina', lang)}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                  <TouchableOpacity style={[styles.addButton, { alignSelf: isRTL ? 'flex-end' : 'flex-start', marginTop: 4 }]} onPress={apriNuovaAula}>
                    <Text style={styles.addButtonText}>{t('aggiungiAula', lang)}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Sottovista: Impostazioni Aula Studio */}
              {impostazioniVista === 'aulaStudio' && canGestireAulaStudio && (
                <AulaStudioImpostazioni
                  db={db}
                  user={user}
                  userName={userName}
                  userRole={userRole}
                  lang={lang as any}
                  isRTL={isRTL}
                  colors={colors as any}
                  t={t}
                  mostraAlert={mostraAlert}
                  canGestireAulaStudio={canGestireAulaStudio}
                  registraAttivita={registraAttivita}
                  inviaNotificaConPreferenza={inviaNotificaConPreferenza}
                  scriviECondividiExcel={scriviECondividiExcel}
                  classiLista={classiLista}
                  profiloAulaStudio={profiloAulaStudio}
                  onProfiloAulaStudioSalvato={caricaDatiGenerali}
                  gestoriAulaStudio={gestoriAulaStudio}
                />
              )}

              {/* Sottovista: Preferenze */}
              {impostazioniVista === 'preferenze' && (
                <View style={[styles.settingsCard, styles.settingsCardNarrow]}>
                  <Text style={styles.settingsCardTitle}>{t('preferenze', lang)}</Text>
                  <Text style={[styles.label, { marginBottom: 8, marginTop: 0 }]}>{t('aspetto', lang)}</Text>
                  <TouchableOpacity style={styles.checkboxRow} onPress={() => setIsDarkMode(!isDarkMode)}>
                    <View style={[styles.checkboxBox, isDarkMode && styles.checkboxBoxChecked]}>
                      {isDarkMode && <Text style={styles.checkboxCheckmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkboxLabel}>{isDarkMode ? `🌙 ${t('modalitaScuraAttiva', lang)}` : `☀️ ${t('modalitaChiaraAttiva', lang)}`}</Text>
                  </TouchableOpacity>

                  <Text style={[styles.label, { marginTop: 14, marginBottom: 8 }]}>{t('lingua', lang)}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={[styles.tabButton, lang === 'it' && styles.tabButtonActive]} onPress={() => setLang('it')}>
                      <Text style={[styles.tabButtonText, lang === 'it' && styles.tabButtonTextActive]}>Italiano</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.tabButton, lang === 'ar' && styles.tabButtonActive]} onPress={() => setLang('ar')}>
                      <Text style={[styles.tabButtonText, lang === 'ar' && styles.tabButtonTextActive]}>العربية</Text>
                    </TouchableOpacity>
                  </View>

                  {Platform.OS !== 'web' && (
                    <>
                      <Text style={[styles.label, { marginTop: 14, marginBottom: 8 }]}>{t('sbloccoImpronta', lang)}</Text>
                      <TouchableOpacity style={styles.checkboxRow} onPress={toggleBiometrico}>
                        <View style={[styles.checkboxBox, biometricoAttivo && styles.checkboxBoxChecked]}>
                          {biometricoAttivo && <Text style={styles.checkboxCheckmark}>✓</Text>}
                        </View>
                        <Text style={styles.checkboxLabel}>👆 {t('sbloccoImpronta', lang)}</Text>
                      </TouchableOpacity>
                      <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>{t('sbloccoImprontaSpiegazione', lang)}</Text>
                    </>
                  )}
                </View>
              )}

              {/* Sottovista: Notifiche */}
              {impostazioniVista === 'notifiche' && (() => {
                const categorieNotifiche = getCategorieVisibili(userRole, lang);
                const categoriePrenotazione = categorieNotifiche.filter((cat) =>
                  cat.key === CATEGORIE_NOTIFICHE.ESITO_PRENOTAZIONE || cat.key === CATEGORIE_NOTIFICHE.NUOVA_PRENOTAZIONE
                );
                const categorieManutenzione = categorieNotifiche.filter((cat) =>
                  cat.key === CATEGORIE_NOTIFICHE.NUOVA_SEGNALAZIONE || cat.key === CATEGORIE_NOTIFICHE.INIZIO_LAVORO || cat.key === CATEGORIE_NOTIFICHE.FINE_LAVORO
                );
                const categorieAulaStudio = categorieNotifiche.filter((cat) =>
                  cat.key === CATEGORIE_NOTIFICHE.RICHIESTA_TURNO_AULA_STUDIO || cat.key === CATEGORIE_NOTIFICHE.ESITO_TURNO_AULA_STUDIO
                );
                return (
                  <View style={[styles.settingsCard, styles.settingsCardNarrow]}>
                    <Text style={styles.settingsCardTitle}>{t('sezioneNotifiche', lang)}</Text>

                    {categoriePrenotazione.length > 0 && (
                      <>
                        <Text style={styles.notificheGruppoTitolo}>{t('gruppoNotifichePrenotazione', lang)}</Text>
                        {categoriePrenotazione.map((cat) => (
                          <View key={cat.key}>
                            <TouchableOpacity style={styles.checkboxRow} onPress={() => toggleNotifica(cat.key)}>
                              <View style={[styles.checkboxBox, notifichePrefs[cat.key] && styles.checkboxBoxChecked]}>
                                {notifichePrefs[cat.key] && <Text style={styles.checkboxCheckmark}>✓</Text>}
                              </View>
                              <Text style={styles.checkboxLabel}>{cat.label}</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </>
                    )}

                    {categorieManutenzione.length > 0 && (
                      <>
                        <Text style={styles.notificheGruppoTitolo}>{t('gruppoNotificheManutenzione', lang)}</Text>
                        {categorieManutenzione.map((cat) => (
                          <View key={cat.key}>
                            <TouchableOpacity style={styles.checkboxRow} onPress={() => toggleNotifica(cat.key)}>
                              <View style={[styles.checkboxBox, notifichePrefs[cat.key] && styles.checkboxBoxChecked]}>
                                {notifichePrefs[cat.key] && <Text style={styles.checkboxCheckmark}>✓</Text>}
                              </View>
                              <Text style={styles.checkboxLabel}>{cat.label}</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </>
                    )}

                    {categorieAulaStudio.length > 0 && (
                      <>
                        <Text style={styles.notificheGruppoTitolo}>{t('gruppoNotificheAulaStudio', lang)}</Text>
                        {categorieAulaStudio.map((cat) => (
                          <View key={cat.key}>
                            <TouchableOpacity style={styles.checkboxRow} onPress={() => toggleNotifica(cat.key)}>
                              <View style={[styles.checkboxBox, notifichePrefs[cat.key] && styles.checkboxBoxChecked]}>
                                {notifichePrefs[cat.key] && <Text style={styles.checkboxCheckmark}>✓</Text>}
                              </View>
                              <Text style={styles.checkboxLabel}>{cat.label}</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </>
                    )}

                    <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>
                      {lang === 'ar' ? 'سيتم تطبيق التفضيلات على جميع أجهزتك' : 'Le preferenze saranno applicate su tutti i tuoi dispositivi'}
                    </Text>
                  </View>
                );
              })()}

              {/* Sottovista: Utenti */}
              {impostazioniVista === 'utenti' && canGestireUtenti && (
                <View style={styles.settingsCard}>
                  <Text style={styles.settingsCardTitle}>{t('listaAggiuntaUtenti', lang)}</Text>
                  <TextInput
                    style={[styles.input, { marginBottom: 16 }]}
                    placeholder={t('cercaUtente', lang)}
                    placeholderTextColor={colors.placeholder}
                    value={cercaUtenteQuery}
                    onChangeText={setCercaUtenteQuery}
                  />

                  <TouchableOpacity style={[styles.addButton, { alignSelf: 'flex-start', marginBottom: 16 }]} onPress={() => { setNuovoUtenteRuolo('utente'); setNuovoRuoloPersonalizzatoAttivo(false); setModalAggiungiUtente(true); }}>
                    <Text style={styles.addButtonText}>{t('aggiungiUtente', lang)}</Text>
                  </TouchableOpacity>

                  <Text style={[styles.infoTextSmall, { marginBottom: 6 }]}>{t('notaEliminaUtenteLista', lang)}</Text>
                  <Text style={[styles.infoTextSmall, { marginBottom: 14, fontStyle: 'italic' }]}>{t('toccaRigaUtente', lang)}</Text>

                  {utentiFiltrati.length === 0 ? (
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t('nessunUtenteTrovatoBlocco', lang)}</Text>
                  ) : (
                    <ScrollView horizontal={Platform.OS !== 'android'} showsHorizontalScrollIndicator={true} style={styles.tableScrollWrap}>
                      <View style={[styles.tableCard, styles.tableCardScrollable, { minWidth: '100%' }]}>
                        <View style={styles.tableHeaderRow}>
                          <Text style={[styles.tableHeaderCell, styles.utentiColNome]}>{t('nome', lang)}</Text>
                          <Text style={[styles.tableHeaderCell, styles.utentiColEmail]}>{t('email', lang)}</Text>
                          {Platform.OS !== 'android' && (
                            <Text style={[styles.tableHeaderCell, styles.utentiColStato]}>{t('colonnaStatoEmail', lang)}</Text>
                          )}
                        </View>
                        {utentiFiltrati.map((u, idx) => (
                          <TouchableOpacity key={u.id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]} onPress={() => setUtenteDettaglioTarget(u)}>
                            <Text style={[styles.tableCell, styles.utentiColNome]} numberOfLines={1}>{u.nome}{u.bloccato ? ` (${t('utenteBloccatoBadge', lang)})` : ''}</Text>
                            <Text style={[styles.tableCell, styles.utentiColEmail]} numberOfLines={1}>{u.email}</Text>
                            {Platform.OS !== 'android' && (
                              <View style={styles.utentiColStato}>
                                <View style={[styles.statoBadge, { backgroundColor: u.primoAccessoEffettuato === false ? colors.warning : colors.success }]}>
                                  <Text style={styles.statoBadgeText}>{u.primoAccessoEffettuato === false ? t('invitoInAttesa', lang) : t('emailVerificata', lang)}</Text>
                                </View>
                              </View>
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  )}
                </View>
              )}

              {/* Sottovista: Domini */}
              {impostazioniVista === 'domini' && canGestireDominiEmail && (
                <View style={styles.settingsCard}>
                  <Text style={styles.settingsCardTitle}>{t('permessiDomini', lang)}</Text>
                  <View style={styles.formRow}>
                    <TextInput style={[styles.input, { flex: 1 }]} placeholder="es. bearzi.it" placeholderTextColor={colors.placeholder} autoCapitalize="none" value={nuovoDominio} onChangeText={setNuovoDominio} />
                    <TouchableOpacity style={styles.addButton} onPress={aggiungiDominio}>
                      <Text style={styles.addButtonText}>{t('aggiungiDominio', lang)}</Text>
                    </TouchableOpacity>
                  </View>
                  {dominiLista.length === 0 && (
                    <Text style={styles.infoText}>{t('nessunDominio', lang)}</Text>
                  )}
                  {dominiLista.map((d) => (
                    <View key={d.id} style={styles.rowBetween}>
                      <Text style={styles.infoText}>@{d.domain}</Text>
                      <TouchableOpacity style={styles.smallDeleteBtn} onPress={() => rimuoviDominio(d.id)}>
                        <Text style={styles.btnText}>{t('rimuovi', lang)}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* Sottovista: Classi */}
              {impostazioniVista === 'classi' && canGestireClassi && (
                <View style={[styles.settingsCard, Platform.OS === 'web' && styles.settingsCardClassiWideWeb]}>
                  <Text style={styles.settingsCardTitle}>{t('gestioneClassi', lang)}</Text>

                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                    <TouchableOpacity
                      style={[
                        styles.editToggleBtn,
                        { backgroundColor: modalitaModificaClassi ? colors.success : colors.primary }
                      ]}
                      onPress={() => setModalitaModificaClassi(!modalitaModificaClassi)}
                    >
                      <Text style={styles.editToggleBtnText}>{modalitaModificaClassi ? `✓ ${t('fine', lang)}` : `✎ ${t('modifica', lang)}`}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editToggleBtn, { backgroundColor: colors.primary }]}
                      onPress={() => {
                        if (mostraFormAggiungiClasse && !classeInModifica) {
                          setMostraFormAggiungiClasse(false);
                        } else {
                          setClasseInModifica(null);
                          setNuovaClasseNome('');
                          setMostraFormAggiungiClasse(true);
                        }
                      }}
                    >
                      <Text style={styles.editToggleBtnText}>{Platform.OS === 'android' ? t('aggiungiClasse', lang) : `+ ${t('aggiungiClasse', lang)}`}</Text>
                    </TouchableOpacity>
                  </View>

                  {mostraFormAggiungiClasse && (
                    <View style={styles.formRow}>
                      <View style={{ flexDirection: 'row', gap: 8, marginRight: 8 }}>
                        <TouchableOpacity
                          style={[styles.editToggleBtn, { backgroundColor: nuovaClasseTipo === 'medie' ? colors.primary : colors.surfaceAlt }]}
                          onPress={() => setNuovaClasseTipo('medie')}
                        >
                          <Text style={[styles.editToggleBtnText, { color: nuovaClasseTipo === 'medie' ? colors.primaryText : colors.textMain }]}>{t('aulaStudioTipoMedie', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.editToggleBtn, { backgroundColor: nuovaClasseTipo === 'ipi' ? colors.primary : colors.surfaceAlt }]}
                          onPress={() => setNuovaClasseTipo('ipi')}
                        >
                          <Text style={[styles.editToggleBtnText, { color: nuovaClasseTipo === 'ipi' ? colors.primaryText : colors.textMain }]}>{t('aulaStudioTipoIpi', lang)}</Text>
                        </TouchableOpacity>
                      </View>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder={t('nomeClasse', lang)}
                        placeholderTextColor={colors.placeholder}
                        autoCapitalize="characters"
                        value={nuovaClasseNome}
                        onChangeText={setNuovaClasseNome}
                      />
                      {classeInModifica ? (
                        <>
                          <TouchableOpacity style={styles.addButton} onPress={aggiungiClasse}>
                            <Text style={styles.addButtonText}>{t('salvaClasse', lang)}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.smallEditBtn} onPress={annullaModificaClasse}>
                            <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('annullaModifica', lang)}</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <TouchableOpacity style={styles.addButton} onPress={aggiungiClasse}>
                          <Text style={styles.addButtonText}>{t('aggiungiClasse', lang)}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {classiLista.length === 0 && (
                    <Text style={styles.infoText}>{t('nessunaClasse', lang)}</Text>
                  )}
                  {[
                    { chiave: 'medie', titolo: t('aulaStudioTipoMedie', lang), elenco: classiLista.filter((c) => c.tipo === 'medie') },
                    { chiave: 'ipi', titolo: t('aulaStudioTipoIpi', lang), elenco: classiLista.filter((c) => c.tipo === 'ipi') },
                    { chiave: 'altro', titolo: t('classiDaClassificare', lang), elenco: classiLista.filter((c) => c.tipo !== 'medie' && c.tipo !== 'ipi') },
                  ].map((gruppo) => gruppo.elenco.length === 0 ? null : (
                    <View key={gruppo.chiave} style={{ marginBottom: 14 }}>
                      <Text style={[styles.sectionHeaderTitle, { fontSize: 15, marginBottom: 8 }]}>{gruppo.titolo}</Text>
                      {gruppo.chiave === 'altro' && modalitaModificaClassi && (
                        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                          <TouchableOpacity style={styles.smallEditBtn} onPress={() => classificaClassiNonAssegnate('medie')}>
                            <Text style={styles.btnText}>{t('classificaComeMedie', lang)}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.smallEditBtn} onPress={() => classificaClassiNonAssegnate('ipi')}>
                            <Text style={styles.btnText}>{t('classificaComeIpi', lang)}</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      <View style={styles.classiGrid}>
                        {gruppo.elenco.map((c) => (
                          <View key={c.id} style={styles.classeCard}>
                            <Text style={styles.classeCardNome} numberOfLines={1}>{c.nome}</Text>
                            {modalitaModificaClassi && (
                              <View style={styles.classeCardAzioni}>
                                <TouchableOpacity style={styles.classeCardBtnModifica} onPress={() => avviaModificaClasse(c)}>
                                  <Text style={styles.classeCardBtnModificaText}>{t('modifica', lang)}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.classeCardBtnRimuovi} onPress={() => eliminaClasse(c.id)}>
                                  <Text style={styles.classeCardBtnRimuoviText}>✕</Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Sottovista: Reset */}
              {impostazioniVista === 'reset' && canResettareDati && (
                <View style={styles.resetPanelCard}>
                  <Text style={[styles.aulaTitle, { color: colors.primary, marginBottom: 14 }]}>{t('areaResetGestore', lang)}</Text>

                  <Text style={[styles.label, { marginBottom: 10 }]}>{t('resetSceltaTipo', lang)}</Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                    <TouchableOpacity
                      style={[styles.tabButton, resetTipoSelezionato === 'prenotazioni' && styles.tabButtonActive]}
                      onPress={() => setResetTipoSelezionato('prenotazioni')}
                    >
                      <Text style={[styles.tabButtonText, resetTipoSelezionato === 'prenotazioni' && styles.tabButtonTextActive]}>{t('resetTipoPrenotazioni', lang)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.tabButton, resetTipoSelezionato === 'manutenzione' && styles.tabButtonActive]}
                      onPress={() => setResetTipoSelezionato('manutenzione')}
                    >
                      <Text style={[styles.tabButtonText, resetTipoSelezionato === 'manutenzione' && styles.tabButtonTextActive]}>{t('resetTipoManutenzione', lang)}</Text>
                    </TouchableOpacity>
                  </View>

                  {resetTipoSelezionato === 'prenotazioni' ? (
                    // Reset prenotazioni
                    <>
                      <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaModalitaReset', lang)}</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                        <TouchableOpacity style={[styles.tabButton, resetModalita === 'mensile' && styles.tabButtonActive]} onPress={() => setResetModalita('mensile')}>
                          <Text style={[styles.tabButtonText, resetModalita === 'mensile' && styles.tabButtonTextActive]}>{t('mensile', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabButton, resetModalita === 'annuale' && styles.tabButtonActive]} onPress={() => setResetModalita('annuale')}>
                          <Text style={[styles.tabButtonText, resetModalita === 'annuale' && styles.tabButtonTextActive]}>{t('annuale', lang)}</Text>
                        </TouchableOpacity>
                      </View>

                      {resetModalita === 'mensile' ? (
                        <View style={{ marginBottom: 16 }}>
                          <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaMese', lang)}</Text>
                          <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setResetMeseDropdownAperto(true)}>
                            <Text style={styles.dropdownTriggerText}>{formattaMeseAnno(resetMeseSelezionato, lang)}</Text>
                            <Text style={styles.dropdownArrow}>▼</Text>
                          </TouchableOpacity>
                          <Modal visible={resetMeseDropdownAperto} animationType="fade" transparent onRequestClose={() => setResetMeseDropdownAperto(false)}>
                            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setResetMeseDropdownAperto(false)}>
                              <View style={styles.dropdownOptionsList}>
                                {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m) => {
                                  const annoCorrente = resetMeseSelezionato.split('-')[0] || String(new Date().getFullYear());
                                  const ym = `${annoCorrente}-${m}`;
                                  const attivo = resetMeseSelezionato === ym;
                                  return (
                                    <TouchableOpacity key={ym} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setResetMeseSelezionato(ym); setResetMeseDropdownAperto(false); }}>
                                      <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{formattaMeseAnno(ym, lang)}</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </TouchableOpacity>
                          </Modal>
                        </View>
                      ) : (
                        <View style={{ marginBottom: 16 }}>
                          <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaAnno', lang)}</Text>
                          <TextInput
                            style={styles.input}
                            placeholder="2026"
                            placeholderTextColor={colors.placeholder}
                            keyboardType="numeric"
                            value={resetAnnoSelezionato}
                            onChangeText={setResetAnnoSelezionato}
                          />
                        </View>
                      )}

                      <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.danger, marginTop: 8 }]} onPress={eseguiResetPrenotazioni}>
                        <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>{t('eseguiReset', lang)}</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    // Reset manutenzione (archivio)
                    <>
                      <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaModalitaReset', lang)}</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                        <TouchableOpacity style={[styles.tabButton, archivioManutenzioneModalita === 'mensile' && styles.tabButtonActive]} onPress={() => setArchivioManutenzioneModalita('mensile')}>
                          <Text style={[styles.tabButtonText, archivioManutenzioneModalita === 'mensile' && styles.tabButtonTextActive]}>{t('mensile', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabButton, archivioManutenzioneModalita === 'annuale' && styles.tabButtonActive]} onPress={() => setArchivioManutenzioneModalita('annuale')}>
                          <Text style={[styles.tabButtonText, archivioManutenzioneModalita === 'annuale' && styles.tabButtonTextActive]}>{t('annuale', lang)}</Text>
                        </TouchableOpacity>
                      </View>

                      {archivioManutenzioneModalita === 'mensile' ? (
                        <View style={{ marginBottom: 16 }}>
                          <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaMese', lang)}</Text>
                          <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setArchivioManutenzioneMeseDropdownAperto(true)}>
                            <Text style={styles.dropdownTriggerText}>{formattaMeseAnno(archivioManutenzioneMeseSelezionato, lang)}</Text>
                            <Text style={styles.dropdownArrow}>▼</Text>
                          </TouchableOpacity>
                          <Modal visible={archivioManutenzioneMeseDropdownAperto} animationType="fade" transparent onRequestClose={() => setArchivioManutenzioneMeseDropdownAperto(false)}>
                            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setArchivioManutenzioneMeseDropdownAperto(false)}>
                              <View style={styles.dropdownOptionsList}>
                                <ScrollView style={{ maxHeight: 400 }}>
                                  {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m) => {
                                    const annoCorrente = archivioManutenzioneMeseSelezionato.split('-')[0] || String(new Date().getFullYear());
                                    const ym = `${annoCorrente}-${m}`;
                                    const attivo = archivioManutenzioneMeseSelezionato === ym;
                                    return (
                                      <TouchableOpacity key={ym} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setArchivioManutenzioneMeseSelezionato(ym); setArchivioManutenzioneMeseDropdownAperto(false); }}>
                                        <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{formattaMeseAnno(ym, lang)}</Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </ScrollView>
                              </View>
                            </TouchableOpacity>
                          </Modal>
                        </View>
                      ) : (
                        <View style={{ marginBottom: 16 }}>
                          <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaAnno', lang)}</Text>
                          <TextInput
                            style={styles.input}
                            placeholder="2026"
                            placeholderTextColor={colors.placeholder}
                            keyboardType="numeric"
                            value={archivioManutenzioneAnnoSelezionato}
                            onChangeText={setArchivioManutenzioneAnnoSelezionato}
                          />
                        </View>
                      )}

                      <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.danger, marginTop: 8 }]} onPress={eliminaArchivioManutenzione}>
                        <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>{t('eseguiResetManutenzione', lang)}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}

              {/* Sottovista: Blocca */}
              {impostazioniVista === 'blocca' && canGestireUtenti && (() => {
                const queryBlocco = bloccaCercaQuery.trim().toLowerCase();
                const suggerimentiBlocco = queryBlocco.length === 0 ? [] : utentiLista
                  .filter((u) => {
                    if (u.email === user.email) return false;
                    const nomeMatch = u.nome && u.nome.toLowerCase().includes(queryBlocco);
                    const emailMatch = u.email && u.email.toLowerCase().includes(queryBlocco);
                    return nomeMatch || emailMatch;
                  })
                  .slice(0, 8);

                const utentiPeriodo = utentiLista
                  .filter((u) => {
                    if (!u.createdAt) return false;
                    return bloccaModalita === 'mensile'
                      ? u.createdAt.startsWith(bloccaMeseSelezionato)
                      : u.createdAt.startsWith(bloccaAnnoSelezionato);
                  })
                  .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

                return (
                  <View style={styles.resetPanelCard}>
                    <Text style={[styles.aulaTitle, { color: colors.primary, marginBottom: 14 }]}>{t('areaBloccaGestore', lang)}</Text>

                    <Text style={[styles.label, { marginBottom: 10 }]}>{t('cercaUtente', lang)}</Text>
                    <TextInput
                      style={styles.input}
                      placeholder={t('cercaUtenteBlocco', lang)}
                      placeholderTextColor={colors.placeholder}
                      autoCapitalize="none"
                      value={bloccaCercaQuery}
                      onChangeText={setBloccaCercaQuery}
                    />
                    {queryBlocco.length > 0 && (
                      <View style={[styles.dropdownOptionsList, { width: '100%', maxWidth: undefined, marginBottom: 16 }]}>
                        {suggerimentiBlocco.length === 0 ? (
                          <Text style={{ color: colors.textMuted, fontSize: 13, padding: 10 }}>{t('nessunUtenteTrovatoBlocco', lang)}</Text>
                        ) : suggerimentiBlocco.map((u) => (
                          <View key={u.id} style={[styles.dropdownOption, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }]}>
                            <View style={{ flexShrink: 1 }}>
                              <Text style={styles.dropdownOptionText}>{u.nome}</Text>
                              <Text style={{ color: colors.textMuted, fontSize: 12 }}>{u.email}</Text>
                            </View>
                            <TouchableOpacity
                              style={[styles.excelDeleteBtn, { backgroundColor: u.bloccato ? colors.success : colors.danger, margin: 0 }]}
                              onPress={() => eseguiBloccoSingolo(u, !u.bloccato)}
                            >
                              <Text style={styles.excelDeleteText}>{u.bloccato ? t('sbloccaSingolo', lang) : t('bloccaSingolo', lang)}</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}

                    <Text style={[styles.label, { marginBottom: 10 }]}>{t('bloccaSceltaModalita', lang)}</Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                      <TouchableOpacity
                        style={[styles.tabButton, bloccaModalita === 'mensile' && styles.tabButtonActive]}
                        onPress={() => setBloccaModalita('mensile')}
                      >
                        <Text style={[styles.tabButtonText, bloccaModalita === 'mensile' && styles.tabButtonTextActive]}>{t('mensile', lang)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.tabButton, bloccaModalita === 'annuale' && styles.tabButtonActive]}
                        onPress={() => setBloccaModalita('annuale')}
                      >
                        <Text style={[styles.tabButtonText, bloccaModalita === 'annuale' && styles.tabButtonTextActive]}>{t('annuale', lang)}</Text>
                      </TouchableOpacity>
                    </View>

                    {bloccaModalita === 'mensile' ? (
                      <View style={{ marginBottom: 16 }}>
                        <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaMese', lang)}</Text>
                        <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setBloccaMeseDropdownAperto(true)}>
                          <Text style={styles.dropdownTriggerText}>{formattaMeseAnno(bloccaMeseSelezionato, lang)}</Text>
                          <Text style={styles.dropdownArrow}>▼</Text>
                        </TouchableOpacity>
                        <Modal visible={bloccaMeseDropdownAperto} animationType="fade" transparent onRequestClose={() => setBloccaMeseDropdownAperto(false)}>
                          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setBloccaMeseDropdownAperto(false)}>
                            <View style={styles.dropdownOptionsList}>
                              <ScrollView style={{ maxHeight: 400 }}>
                                {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m) => {
                                  const annoCorrente = bloccaMeseSelezionato.split('-')[0] || String(new Date().getFullYear());
                                  const ym = `${annoCorrente}-${m}`;
                                  const attivo = bloccaMeseSelezionato === ym;
                                  return (
                                    <TouchableOpacity key={ym} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setBloccaMeseSelezionato(ym); setBloccaMeseDropdownAperto(false); }}>
                                      <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{formattaMeseAnno(ym, lang)}</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </ScrollView>
                            </View>
                          </TouchableOpacity>
                        </Modal>
                      </View>
                    ) : (
                      <View style={{ marginBottom: 16 }}>
                        <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaAnno', lang)}</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="2026"
                          placeholderTextColor={colors.placeholder}
                          keyboardType="numeric"
                          value={bloccaAnnoSelezionato}
                          onChangeText={setBloccaAnnoSelezionato}
                        />
                      </View>
                    )}

                    <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                      <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.danger, marginTop: 8, flexGrow: 1 }]} onPress={() => eseguiBloccoUtenti(true)}>
                        <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>{t('bloccaUtentiAzione', lang)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.success, marginTop: 8, flexGrow: 1 }]} onPress={() => eseguiBloccoUtenti(false)}>
                        <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>{t('sbloccaUtentiAzione', lang)}</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={[styles.label, { marginTop: 20, marginBottom: 10 }]}>{t('elencoUtentiPeriodo', lang)}</Text>
                    {utentiPeriodo.length === 0 ? (
                      <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t('nessunUtentePeriodo', lang)}</Text>
                    ) : Platform.OS === 'web' ? (
                      <View style={styles.excelTable}>
                        <View style={styles.excelRowHeader}>
                          <Text style={[styles.excelCellHeader, { flex: 2 }]}>{t('nome', lang)}</Text>
                          <Text style={[styles.excelCellHeader, { flex: 2 }]}>{t('email', lang)}</Text>
                          <Text style={[styles.excelCellHeader, { flex: 2 }]}>{t('colonnaRegistrazione', lang)}</Text>
                          <Text style={[styles.excelCellHeader, { flex: 1 }]}>{t('colonnaAzione', lang)}</Text>
                        </View>
                        {utentiPeriodo.map((u, idx) => (
                          <View key={u.id} style={[styles.excelRow, idx % 2 === 0 ? styles.excelRowEven : styles.excelRowOdd]}>
                            <Text style={[styles.excelCell, { flex: 2 }]} numberOfLines={1}>{u.nome}{u.bloccato ? ` (${t('utenteBloccatoBadge', lang)})` : ''}</Text>
                            <Text style={[styles.excelCell, { flex: 2 }]} numberOfLines={1}>{u.email}</Text>
                            <Text style={[styles.excelCell, { flex: 2 }]} numberOfLines={1}>{formattaDataOra(u.createdAt, lang)}</Text>
                            <View style={{ flex: 1, alignItems: 'center', padding: 10 }}>
                              {u.email !== user.email && (
                                <TouchableOpacity
                                  style={[styles.excelDeleteBtn, { backgroundColor: u.bloccato ? colors.success : colors.danger, margin: 0 }]}
                                  onPress={() => eseguiBloccoSingolo(u, !u.bloccato)}
                                >
                                  <Text style={styles.excelDeleteText}>{u.bloccato ? t('sbloccaSingolo', lang) : t('bloccaSingolo', lang)}</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      // ---- Versione Android: righe orizzontali compatte (Nome + Email), con "Apri" per i dettagli ----
                      <View>
                        <Text style={[styles.compactHintText, isRTL && { textAlign: 'right' }]}>
                          {t('toccaPerDettagli', lang)}
                        </Text>
                        <View style={styles.excelTable}>
                          {utentiPeriodo.map((u, idx) => {
                            const espansa = !!righeEspanseBloccoUtenti[u.id];
                            return (
                              <View key={u.id} style={[idx % 2 === 0 ? styles.excelRowEven : styles.excelRowOdd, idx !== utentiPeriodo.length - 1 && { borderBottomWidth: 1, borderColor: colors.surface }]}>
                                <TouchableOpacity
                                  style={styles.compactUserRow}
                                  onPress={() => setRigheEspanseBloccoUtenti(prev => ({ ...prev, [u.id]: !prev[u.id] }))}
                                >
                                  <View style={{ flex: 1 }}>
                                    <Text style={[styles.compactUserName, isRTL && { textAlign: 'right' }]} numberOfLines={1}>
                                      {u.nome}{u.bloccato ? ` (${t('utenteBloccatoBadge', lang)})` : ''}
                                    </Text>
                                    <Text style={[styles.compactUserEmail, isRTL && { textAlign: 'right' }]} numberOfLines={1}>{u.email}</Text>
                                  </View>
                                  <Text style={styles.compactUserExpandIcon}>{espansa ? '▲' : '▼'}</Text>
                                </TouchableOpacity>
                                {espansa && (
                                  <View style={[styles.compactUserDetails, isRTL && { alignItems: 'flex-end' }]}>
                                    <Text style={[styles.compactUserDetailRow, isRTL && { textAlign: 'right' }]}>
                                      {t('colonnaRegistrazione', lang)}: {formattaDataOra(u.createdAt, lang)}
                                    </Text>
                                    {u.email !== user.email && (
                                      <TouchableOpacity
                                        style={[styles.excelDeleteBtn, { backgroundColor: u.bloccato ? colors.success : colors.danger, alignSelf: isRTL ? 'flex-end' : 'flex-start', marginTop: 8 }]}
                                        onPress={() => eseguiBloccoSingolo(u, !u.bloccato)}
                                      >
                                        <Text style={styles.excelDeleteText}>{u.bloccato ? t('sbloccaSingolo', lang) : t('bloccaSingolo', lang)}</Text>
                                      </TouchableOpacity>
                                    )}
                                  </View>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    )}
                  </View>
                );
              })()}

              {/* Sottovista: Esporta */}
              {impostazioniVista === 'esporta' && (canEsportareUtentiPrenotazioni || canEsportarePrenotazioniSegnalazioni || canGestireAulaStudio) && (
                <View style={styles.resetPanelCard}>
                  <Text style={[styles.aulaTitle, { color: colors.primary, marginBottom: 14 }]}>{t('areaEsportaGestore', lang)}</Text>

                  <Text style={[styles.label, { marginBottom: 10 }]}>{t('resetSceltaTipo', lang)}</Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                    {(canEsportareUtentiPrenotazioni || canEsportarePrenotazioniSegnalazioni) && (
                      <TouchableOpacity
                        style={[styles.tabButton, esportaTipoSelezionato === 'prenotazioni' && styles.tabButtonActive]}
                        onPress={() => setEsportaTipoSelezionato('prenotazioni')}
                      >
                        <Text style={[styles.tabButtonText, esportaTipoSelezionato === 'prenotazioni' && styles.tabButtonTextActive]}>{t('resetTipoPrenotazioni', lang)}</Text>
                      </TouchableOpacity>
                    )}
                    {canGestireAulaStudio && (
                      <TouchableOpacity
                        style={[styles.tabButton, esportaTipoSelezionato === 'aulaStudio' && styles.tabButtonActive]}
                        onPress={() => setEsportaTipoSelezionato('aulaStudio')}
                      >
                        <Text style={[styles.tabButtonText, esportaTipoSelezionato === 'aulaStudio' && styles.tabButtonTextActive]}>
                          {lang === 'ar' ? 'قاعة الدراسة' : 'Aula Studio'}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {canEsportarePrenotazioniSegnalazioni && (
                      <TouchableOpacity
                        style={[styles.tabButton, esportaTipoSelezionato === 'manutenzione' && styles.tabButtonActive]}
                        onPress={() => setEsportaTipoSelezionato('manutenzione')}
                      >
                        <Text style={[styles.tabButtonText, esportaTipoSelezionato === 'manutenzione' && styles.tabButtonTextActive]}>{t('resetTipoManutenzione', lang)}</Text>
                      </TouchableOpacity>
                    )}
                    {canEsportareUtentiPrenotazioni && (
                      <TouchableOpacity
                        style={[styles.tabButton, esportaTipoSelezionato === 'utenti' && styles.tabButtonActive]}
                        onPress={() => setEsportaTipoSelezionato('utenti')}
                      >
                        <Text style={[styles.tabButtonText, esportaTipoSelezionato === 'utenti' && styles.tabButtonTextActive]}>{t('resetTipoUtenti', lang)}</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {esportaTipoSelezionato === 'aulaStudio' && canGestireAulaStudio && (
                    <AulaStudioEsportaPanel
                      db={db}
                      lang={lang as any}
                      colors={colors as any}
                      t={t}
                      mostraAlert={mostraAlert}
                      scriviECondividiExcel={scriviECondividiExcel}
                    />
                  )}

                  {esportaTipoSelezionato === 'prenotazioni' && (canEsportareUtentiPrenotazioni || canEsportarePrenotazioniSegnalazioni) && (
                    <>
                      <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaModalitaReset', lang)}</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                        <TouchableOpacity style={[styles.tabButton, resetModalita === 'mensile' && styles.tabButtonActive]} onPress={() => setResetModalita('mensile')}>
                          <Text style={[styles.tabButtonText, resetModalita === 'mensile' && styles.tabButtonTextActive]}>{t('mensile', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabButton, resetModalita === 'annuale' && styles.tabButtonActive]} onPress={() => setResetModalita('annuale')}>
                          <Text style={[styles.tabButtonText, resetModalita === 'annuale' && styles.tabButtonTextActive]}>{t('annuale', lang)}</Text>
                        </TouchableOpacity>
                      </View>

                      {resetModalita === 'mensile' ? (
                        <View style={{ marginBottom: 16 }}>
                          <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaMese', lang)}</Text>
                          <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setResetMeseDropdownAperto(true)}>
                            <Text style={styles.dropdownTriggerText}>{formattaMeseAnno(resetMeseSelezionato, lang)}</Text>
                            <Text style={styles.dropdownArrow}>▼</Text>
                          </TouchableOpacity>
                          <Modal visible={resetMeseDropdownAperto} animationType="fade" transparent onRequestClose={() => setResetMeseDropdownAperto(false)}>
                            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setResetMeseDropdownAperto(false)}>
                              <View style={styles.dropdownOptionsList}>
                                {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m) => {
                                  const annoCorrente = resetMeseSelezionato.split('-')[0] || String(new Date().getFullYear());
                                  const ym = `${annoCorrente}-${m}`;
                                  const attivo = resetMeseSelezionato === ym;
                                  return (
                                    <TouchableOpacity key={ym} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setResetMeseSelezionato(ym); setResetMeseDropdownAperto(false); }}>
                                      <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{formattaMeseAnno(ym, lang)}</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </TouchableOpacity>
                          </Modal>
                        </View>
                      ) : (
                        <View style={{ marginBottom: 16 }}>
                          <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaAnno', lang)}</Text>
                          <TextInput
                            style={styles.input}
                            placeholder="2026"
                            placeholderTextColor={colors.placeholder}
                            keyboardType="numeric"
                            value={resetAnnoSelezionato}
                            onChangeText={setResetAnnoSelezionato}
                          />
                        </View>
                      )}

                      <TouchableOpacity
                        style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: esportazioneInCorso ? 0.6 : 1, marginTop: 8 }]}
                        onPress={esportaPrenotazioniExcel}
                        disabled={esportazioneInCorso}
                      >
                        {esportazioneInCorso ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>📊 {t('esportaExcelDettagliato', lang)}</Text>}
                      </TouchableOpacity>
                    </>
                  )}

                  {esportaTipoSelezionato === 'manutenzione' && canEsportarePrenotazioniSegnalazioni && (
                    <>
                      <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaModalitaReset', lang)}</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                        <TouchableOpacity style={[styles.tabButton, archivioManutenzioneModalita === 'mensile' && styles.tabButtonActive]} onPress={() => setArchivioManutenzioneModalita('mensile')}>
                          <Text style={[styles.tabButtonText, archivioManutenzioneModalita === 'mensile' && styles.tabButtonTextActive]}>{t('mensile', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabButton, archivioManutenzioneModalita === 'annuale' && styles.tabButtonActive]} onPress={() => setArchivioManutenzioneModalita('annuale')}>
                          <Text style={[styles.tabButtonText, archivioManutenzioneModalita === 'annuale' && styles.tabButtonTextActive]}>{t('annuale', lang)}</Text>
                        </TouchableOpacity>
                      </View>

                      {archivioManutenzioneModalita === 'mensile' ? (
                        <View style={{ marginBottom: 16 }}>
                          <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaMese', lang)}</Text>
                          <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setArchivioManutenzioneMeseDropdownAperto(true)}>
                            <Text style={styles.dropdownTriggerText}>{formattaMeseAnno(archivioManutenzioneMeseSelezionato, lang)}</Text>
                            <Text style={styles.dropdownArrow}>▼</Text>
                          </TouchableOpacity>
                          <Modal visible={archivioManutenzioneMeseDropdownAperto} animationType="fade" transparent onRequestClose={() => setArchivioManutenzioneMeseDropdownAperto(false)}>
                            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setArchivioManutenzioneMeseDropdownAperto(false)}>
                              <View style={styles.dropdownOptionsList}>
                                <ScrollView style={{ maxHeight: 400 }}>
                                  {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m) => {
                                    const annoCorrente = archivioManutenzioneMeseSelezionato.split('-')[0] || String(new Date().getFullYear());
                                    const ym = `${annoCorrente}-${m}`;
                                    const attivo = archivioManutenzioneMeseSelezionato === ym;
                                    return (
                                      <TouchableOpacity key={ym} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setArchivioManutenzioneMeseSelezionato(ym); setArchivioManutenzioneMeseDropdownAperto(false); }}>
                                        <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{formattaMeseAnno(ym, lang)}</Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </ScrollView>
                              </View>
                            </TouchableOpacity>
                          </Modal>
                        </View>
                      ) : (
                        <View style={{ marginBottom: 16 }}>
                          <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaAnno', lang)}</Text>
                          <TextInput
                            style={styles.input}
                            placeholder="2026"
                            placeholderTextColor={colors.placeholder}
                            keyboardType="numeric"
                            value={archivioManutenzioneAnnoSelezionato}
                            onChangeText={setArchivioManutenzioneAnnoSelezionato}
                          />
                        </View>
                      )}

                      <TouchableOpacity
                        style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: esportazioneInCorso ? 0.6 : 1, marginTop: 8 }]}
                        onPress={esportaManutenzioneExcel}
                        disabled={esportazioneInCorso}
                      >
                        {esportazioneInCorso ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>📊 {t('esportaExcelDettagliato', lang)}</Text>}
                      </TouchableOpacity>
                    </>
                  )}

                  {esportaTipoSelezionato === 'utenti' && canEsportareUtentiPrenotazioni && (
                    <TouchableOpacity
                      style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: esportazioneInCorso ? 0.6 : 1, marginTop: 8 }]}
                      onPress={esportaUtentiExcel}
                      disabled={esportazioneInCorso}
                    >
                      {esportazioneInCorso ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>📊 {t('esportaExcelDettagliato', lang)}</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Sottovista: Registro Attività */}
              {impostazioniVista === 'registro' && canVedereRegistroAttivita && (() => {
                const datiFiltrati = registroAttivita.filter(r => {
                  if (filtroTipoRegistro !== 'Tutte' && r.tipo !== filtroTipoRegistro) return false;
                  const chiave = filtroModalitaRegistro === 'mensile' ? filtroMeseRegistro : filtroAnnoRegistro;
                  return r.timestamp && r.timestamp.startsWith(chiave);
                });

                const esportaRegistroExcelLocal = async () => {
                  if (datiFiltrati.length === 0) {
                    mostraAlert('', t('nessunDatoDaEsportare', lang));
                    return;
                  }
                  setEsportazioneInCorso(true);
                  try {
                    const righe = datiFiltrati.map(r => ({
                      [t('data', lang)]: formattaDataOra(r.timestamp, lang),
                      [t('utente', lang)]: r.userName || r.userEmail,
                      'Tipo': tipiEtichette[r.tipo] || r.tipo,
                      'Dettaglio': r.dettaglio
                    }));
                    const chiave = filtroModalitaRegistro === 'mensile' ? filtroMeseRegistro : filtroAnnoRegistro;
                    const nomeFile = `registro_attivita_${chiave.replace(/[^0-9A-Za-z_-]/g, '')}.xlsx`;
                    await scriviECondividiExcel(nomeFile, righe);
                    mostraAlert('', t('esportazioneCompletata', lang, righe.length));
                  } catch (e) {
                    console.error('Errore esportazione registro:', e);
                    mostraAlert(t('errore', lang), t('erroreEsportazione', lang));
                  } finally {
                    setEsportazioneInCorso(false);
                  }
                };

                return (
                  <>
                  <View style={styles.resetPanelCard}>
                    <Text style={[styles.aulaTitle, { color: colors.primary, marginBottom: 14 }]}>{t('registroAttivita', lang)}</Text>

                    <Text style={[styles.label, { marginBottom: 10 }]}>{lang === 'ar' ? 'تصفية حسب نوع الإجراء:' : 'Filtra per tipo di azione:'}</Text>
                    <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setFiltroTipoRegistroDropdownAperto(true)}>
                      <Text style={styles.dropdownTriggerText}>{filtroTipoRegistro === 'Tutte' ? t('tutte', lang) : (tipiEtichette[filtroTipoRegistro] || filtroTipoRegistro)}</Text>
                      <Text style={styles.dropdownArrow}>▼</Text>
                    </TouchableOpacity>
                    <Modal visible={filtroTipoRegistroDropdownAperto} animationType="fade" transparent onRequestClose={() => setFiltroTipoRegistroDropdownAperto(false)}>
                      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFiltroTipoRegistroDropdownAperto(false)}>
                        <View style={styles.dropdownOptionsList}>
                          <ScrollView style={{ maxHeight: 400 }}>
                            <TouchableOpacity style={[styles.dropdownOption, filtroTipoRegistro === 'Tutte' && styles.dropdownOptionActive]} onPress={() => { setFiltroTipoRegistro('Tutte'); setFiltroTipoRegistroDropdownAperto(false); }}>
                              <Text style={[styles.dropdownOptionText, filtroTipoRegistro === 'Tutte' && styles.dropdownOptionTextActive]}>{t('tutte', lang)}</Text>
                            </TouchableOpacity>
                            {Object.keys(TIPI_REGISTRO).map(key => {
                              const tipo = TIPI_REGISTRO[key];
                              const etichetta = tipiEtichette[tipo] || tipo;
                              const attivo = filtroTipoRegistro === tipo;
                              return (
                                <TouchableOpacity key={tipo} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setFiltroTipoRegistro(tipo); setFiltroTipoRegistroDropdownAperto(false); }}>
                                  <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{etichetta}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>
                        </View>
                      </TouchableOpacity>
                    </Modal>

                    <Text style={[styles.label, { marginTop: 14, marginBottom: 10 }]}>{t('selezionaModalitaReset', lang)}</Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                      <TouchableOpacity style={[styles.tabButton, filtroModalitaRegistro === 'mensile' && styles.tabButtonActive]} onPress={() => setFiltroModalitaRegistro('mensile')}>
                        <Text style={[styles.tabButtonText, filtroModalitaRegistro === 'mensile' && styles.tabButtonTextActive]}>{t('mensile', lang)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.tabButton, filtroModalitaRegistro === 'annuale' && styles.tabButtonActive]} onPress={() => setFiltroModalitaRegistro('annuale')}>
                        <Text style={[styles.tabButtonText, filtroModalitaRegistro === 'annuale' && styles.tabButtonTextActive]}>{t('annuale', lang)}</Text>
                      </TouchableOpacity>
                    </View>

                    {filtroModalitaRegistro === 'mensile' ? (
                      <View style={{ marginBottom: 16 }}>
                        <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaMese', lang)}</Text>
                        <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setFiltroMeseRegistroDropdownAperto(true)}>
                          <Text style={styles.dropdownTriggerText}>{formattaMeseAnno(filtroMeseRegistro, lang)}</Text>
                          <Text style={styles.dropdownArrow}>▼</Text>
                        </TouchableOpacity>
                        <Modal visible={filtroMeseRegistroDropdownAperto} animationType="fade" transparent onRequestClose={() => setFiltroMeseRegistroDropdownAperto(false)}>
                          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFiltroMeseRegistroDropdownAperto(false)}>
                            <View style={styles.dropdownOptionsList}>
                              <ScrollView style={{ maxHeight: 400 }}>
                                {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m) => {
                                  const annoCorrente = filtroMeseRegistro.split('-')[0] || String(new Date().getFullYear());
                                  const ym = `${annoCorrente}-${m}`;
                                  const attivo = filtroMeseRegistro === ym;
                                  return (
                                    <TouchableOpacity key={ym} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setFiltroMeseRegistro(ym); setFiltroMeseRegistroDropdownAperto(false); }}>
                                      <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{formattaMeseAnno(ym, lang)}</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </ScrollView>
                            </View>
                          </TouchableOpacity>
                        </Modal>
                      </View>
                    ) : (
                      <View style={{ marginBottom: 16 }}>
                        <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaAnno', lang)}</Text>
                        <TextInput style={styles.input} placeholder="2026" placeholderTextColor={colors.placeholder} keyboardType="numeric" value={filtroAnnoRegistro} onChangeText={setFiltroAnnoRegistro} />
                      </View>
                    )}

                    <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: esportazioneInCorso ? 0.6 : 1, marginBottom: 16 }]} onPress={esportaRegistroExcelLocal} disabled={esportazioneInCorso}>
                      {esportazioneInCorso ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>📊 Esporta Excel</Text>}
                    </TouchableOpacity>

                    {datiFiltrati.length === 0 ? (
                      <Text style={styles.infoText}>{t('nessunaAttivita', lang)}</Text>
                    ) : (
                      <ScrollView horizontal={Platform.OS !== 'android'} showsHorizontalScrollIndicator={true} style={styles.tableScrollWrap}>
                        <View style={[styles.tableCard, styles.tableCardScrollable, { minWidth: Platform.OS === 'android' ? '100%' : 380 }]}>
                          <View style={styles.tableHeaderRow}>
                            {Platform.OS !== 'android' && (
                              <Text style={[styles.tableHeaderCell, { flex: 1.3, minWidth: 110 }]}>{t('nome', lang)}</Text>
                            )}
                            <Text style={[styles.tableHeaderCell, { flex: Platform.OS === 'android' ? 1 : 1.6, minWidth: Platform.OS === 'android' ? 90 : 150 }]}>
                              {Platform.OS === 'android' ? 'Utente' : t('email', lang)}
                            </Text>
                            <Text style={[styles.tableHeaderCell, { flex: 1.3, minWidth: 100 }]}>{t('tipoLabel', lang)}</Text>
                          </View>
                          {datiFiltrati.map((r, idx) => (
                            <TouchableOpacity key={r.id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]} onPress={() => setRegistroDettaglio(r)}>
                              {Platform.OS !== 'android' && (
                                <Text style={[styles.tableCell, { flex: 1.3, minWidth: 110 }]} numberOfLines={1}>{r.userName || '-'}</Text>
                              )}
                              <Text style={[styles.tableCell, { flex: Platform.OS === 'android' ? 1 : 1.6, minWidth: Platform.OS === 'android' ? 90 : 150 }]} numberOfLines={1}>
                                {Platform.OS === 'android' ? (r.userName || r.userEmail) : (r.userEmail || '-')}
                              </Text>
                              <Text style={[styles.tableCell, { flex: 1.3, minWidth: 100 }]} numberOfLines={1}>{tipiEtichette[r.tipo] || r.tipo}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                    )}
                  </View>

                  {/* Dettaglio riga Registro Attività (tocco/click su una riga) */}
                  <Modal visible={!!registroDettaglio} animationType="slide" transparent onRequestClose={() => setRegistroDettaglio(null)}>
                    <View style={styles.modalOverlay}>
                      <View style={styles.modalContentFixed}>
                        {registroDettaglio && (
                          <>
                            <View style={styles.modalHeaderFixed}>
                              <Text style={styles.modalTitle} numberOfLines={1}>{tipiEtichette[registroDettaglio.tipo] || registroDettaglio.tipo}</Text>
                              <TouchableOpacity onPress={() => setRegistroDettaglio(null)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
                            </View>
                            <ScrollView style={styles.modalBodyScrollable}>
                              <Text style={styles.gestioneListMeta}>{t('data', lang)}: {formattaDataOra(registroDettaglio.timestamp, lang)}</Text>
                              <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>{t('utente', lang)}: {registroDettaglio.userName || registroDettaglio.userEmail}</Text>
                              <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>Tipo: {tipiEtichette[registroDettaglio.tipo] || registroDettaglio.tipo}</Text>
                              <Text style={[styles.label, { marginTop: 14 }]}>{t('dettaglioLabel', lang)}</Text>
                              <Text style={styles.gestioneListMeta}>{registroDettaglio.dettaglio}</Text>
                            </ScrollView>
                          </>
                        )}
                      </View>
                    </View>
                  </Modal>
                  </>
                );
              })()}

              {/* Sottovista: Manuali (caricamento manuale amministrativo IT/AR, solo gestore/web) */}
              {impostazioniVista === 'manuali' && canGestireManuali && (
                <View style={styles.resetPanelCard}>
                  <Text style={[styles.aulaTitle, { color: colors.primary, marginBottom: 6 }]}>{t('menuManuali', lang)}</Text>
                  <Text style={[styles.infoTextSmall, { marginBottom: 18, fontSize: 13 }]}>{t('manualiImpostazioniSottotitolo', lang)}</Text>

                  {[{ chiave: 'it', titolo: t('manualiTitoloIt', lang) }, { chiave: 'ar', titolo: t('manualiTitoloAr', lang) }].map(({ chiave: linguaManuale, titolo }) => {
                    const meta = manualiMeta[linguaManuale];
                    const statoCorrente = manualiStato[linguaManuale];
                    return (
                      <View key={linguaManuale} style={[styles.manualeUploadRow, { borderColor: colors.border }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.label, { marginBottom: 4 }]}>{titolo}</Text>
                          {meta === undefined && <Text style={styles.infoTextSmall}>{t('manualiVerificaCaricamento', lang)}</Text>}
                          {meta === false && <Text style={styles.infoTextSmall}>{t('manualiNessunFileCaricato', lang)}</Text>}
                          {meta && <Text style={styles.infoTextSmall}>{t('manualiUltimoAggiornamento', lang, formattaDataOra(meta.updated, lang))}</Text>}
                          {statoCorrente === 'success' && <Text style={[styles.infoTextSmall, { color: colors.success, marginTop: 4 }]}>✓ {t('manualiCaricatoConSuccesso', lang)}</Text>}
                          {statoCorrente === 'error' && <Text style={[styles.infoTextSmall, { color: colors.danger, marginTop: 4 }]}>{t('manualiErroreCaricamento', lang)}</Text>}
                        </View>
                        <TouchableOpacity
                          style={styles.addButton}
                          onPress={() => caricaManuale(linguaManuale)}
                          disabled={statoCorrente === 'uploading'}
                        >
                          {statoCorrente === 'uploading'
                            ? <ActivityIndicator color={colors.primaryText} />
                            : <Text style={styles.addButtonText}>{meta ? t('manualiSostituisci', lang) : t('manualiCaricaNuovo', lang)}</Text>}
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Sottovista: Impostazioni Avanzate */}
              {impostazioniVista === 'avanzate' && (
                <View style={styles.settingsCard}>
                  <Text style={styles.settingsCardTitle}>{t('impostazioniAvanzate', lang)}</Text>
                  <Text style={[styles.infoText, { marginBottom: 12 }]}>
                    {t('impostazioniAvanzateDescrizione', lang)}
                  </Text>

                  {utentiLista.filter(u => u.id !== user.uid).length === 0 ? (
                    <Text style={styles.infoText}>{t('nessunAltroUtente', lang)}</Text>
                  ) : Platform.OS === 'web' ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.tableScrollWrap}>
                      <View style={[styles.tableCard, styles.tableCardScrollable, { minWidth: 760, width: '100%' }]}>
                        <View style={styles.tableHeaderRow}>
                          <Text style={[styles.tableHeaderCell, { width: 160 }]}>{t('nome', lang)}</Text>
                          <Text style={[styles.tableHeaderCell, { width: 290 }]}>{t('email', lang)}</Text>
                          <Text style={[styles.tableHeaderCell, styles.permTableHeaderCellCenter, { width: 170 }]}>{t('ruolo', lang)}</Text>
                          <Text style={[styles.tableHeaderCell, styles.permTableHeaderCellCenter, { width: 100 }]}>{t('azioni', lang)}</Text>
                        </View>
                        {utentiLista.filter(u => u.id !== user.uid).map((u, idx) => {
                          const hasOverrides = u.permessiSovrascritti && Object.keys(u.permessiSovrascritti).length > 0;
                          return (
                            <View key={u.id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                              <Text style={[styles.tableCell, { width: 160 }]} numberOfLines={2}>{u.nome}</Text>
                              <Text style={[styles.tableCell, { width: 290 }]} numberOfLines={1}>{u.email}</Text>
                              <Text style={[styles.tableCell, { textAlign: 'center' }, { width: 170 }]} numberOfLines={1}>{etichettaRuolo(u.role, lang)}</Text>
                              <View style={{ width: 100, alignItems: 'center' }}>
                                <TouchableOpacity
                                  style={[styles.smallEditBtn, { backgroundColor: hasOverrides ? colors.success : colors.primary }]}
                                  onPress={() => {
                                    setUtentePermessiTarget(u);
                                    const basePermessi = {
                                      puoGestireAule: puoGestireAule(u.role),
                                      puoApprovarePrenotazioni: puoApprovarePrenotazioni(u.role),
                                      puoGestireManutenzione: puoGestireManutenzione(u.role),
                                      puoGestireUtenti: puoGestireUtenti(u.role),
                                      puoGestireDominiEmail: puoGestireDominiEmail(u.role),
                                      puoGestireBlocchi: puoGestireUtenti(u.role),
                                      puoResettareDati: puoResettareDati(u.role),
                                      puoEsportareUtentiPrenotazioni: puoEsportareUtentiPrenotazioni(u.role),
                                      puoEsportarePrenotazioniSegnalazioni: puoEsportarePrenotazioniSegnalazioni(u.role),
                                      puoVedereRegistroAttivita: puoVedereRegistroAttivita(u.role),
                                      // Nuovi permessi
                                      puoVedereProfili: puoVedereProfili(u.role),
                                      puoModificareProfili: puoModificareProfili(u.role),
                                      puoGestireClassi: puoGestireClassi(u.role),
                                      puoCreareRuoliPersonalizzati: puoCreareRuoliPersonalizzati(u.role),
                                      puoAssegnarePermessiRuoliPersonalizzati: puoAssegnarePermessiRuoliPersonalizzati(u.role),
                                      puoGestireAulaStudio: puoGestireAulaStudio(u.role)
                                    };
                                    const overrides = u.permessiSovrascritti || {};
                                    setPermessiModifica({ ...basePermessi, ...overrides });
                                  }}
                                >
                                  <Text style={[styles.btnText, { color: '#FFF' }]}>
                                    {hasOverrides ? t('modificaBreve', lang) : t('impostaBreve', lang)}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </ScrollView>
                  ) : (
                    // ---- Versione Android: righe compatte (Nome + Ruolo), con "Apri" per Email e Azioni ----
                    <View>
                      <Text style={[styles.compactHintText, isRTL && { textAlign: 'right' }]}>
                        {t('toccaPerDettagli', lang)}
                      </Text>
                      <View style={styles.excelTable}>
                        {utentiLista.filter(u => u.id !== user.uid).map((u, idx, arr) => {
                          const hasOverrides = u.permessiSovrascritti && Object.keys(u.permessiSovrascritti).length > 0;
                          const espansa = !!righeEspansePermessiAvanzati[u.id];
                          return (
                            <View key={u.id} style={[idx % 2 === 0 ? styles.excelRowEven : styles.excelRowOdd, idx !== arr.length - 1 && { borderBottomWidth: 1, borderColor: colors.surface }]}>
                              <TouchableOpacity
                                style={styles.compactUserRow}
                                onPress={() => setRigheEspansePermessiAvanzati(prev => ({ ...prev, [u.id]: !prev[u.id] }))}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={[styles.compactUserName, isRTL && { textAlign: 'right' }]} numberOfLines={1}>{u.nome}</Text>
                                  <Text style={[styles.compactUserEmail, isRTL && { textAlign: 'right' }]} numberOfLines={1}>{etichettaRuolo(u.role, lang)}</Text>
                                </View>
                                <Text style={styles.compactUserExpandIcon}>{espansa ? '▲' : '▼'}</Text>
                              </TouchableOpacity>
                              {espansa && (
                                <View style={[styles.compactUserDetails, isRTL && { alignItems: 'flex-end' }]}>
                                  <Text style={[styles.compactUserDetailRow, isRTL && { textAlign: 'right' }]} numberOfLines={2}>
                                    {t('email', lang)}: {u.email}
                                  </Text>
                                  <TouchableOpacity
                                    style={[styles.smallEditBtn, { backgroundColor: hasOverrides ? colors.success : colors.primary, alignSelf: isRTL ? 'flex-end' : 'flex-start', marginTop: 8 }]}
                                    onPress={() => {
                                      setUtentePermessiTarget(u);
                                      const basePermessi = {
                                        puoGestireAule: puoGestireAule(u.role),
                                        puoApprovarePrenotazioni: puoApprovarePrenotazioni(u.role),
                                        puoGestireManutenzione: puoGestireManutenzione(u.role),
                                        puoGestireUtenti: puoGestireUtenti(u.role),
                                        puoGestireDominiEmail: puoGestireDominiEmail(u.role),
                                        puoGestireBlocchi: puoGestireUtenti(u.role),
                                        puoResettareDati: puoResettareDati(u.role),
                                        puoEsportareUtentiPrenotazioni: puoEsportareUtentiPrenotazioni(u.role),
                                        puoEsportarePrenotazioniSegnalazioni: puoEsportarePrenotazioniSegnalazioni(u.role),
                                        puoVedereRegistroAttivita: puoVedereRegistroAttivita(u.role),
                                        // Nuovi permessi
                                        puoVedereProfili: puoVedereProfili(u.role),
                                        puoModificareProfili: puoModificareProfili(u.role),
                                        puoGestireClassi: puoGestireClassi(u.role),
                                        puoCreareRuoliPersonalizzati: puoCreareRuoliPersonalizzati(u.role),
                                        puoAssegnarePermessiRuoliPersonalizzati: puoAssegnarePermessiRuoliPersonalizzati(u.role),
                                        puoGestireAulaStudio: puoGestireAulaStudio(u.role)
                                      };
                                      const overrides = u.permessiSovrascritti || {};
                                      setPermessiModifica({ ...basePermessi, ...overrides });
                                    }}
                                  >
                                    <Text style={[styles.btnText, { color: '#FFF' }]}>
                                      {hasOverrides ? t('modificaBreve', lang) : t('impostaBreve', lang)}
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* Sottovista: PROFILI (NUOVA) */}
              {impostazioniVista === 'profili' && canVedereProfili && (() => {
                // Stato locale per i filtri (già definito globalmente)
                // e per la modifica profilo (già definito)
                return (
                  <View style={[styles.settingsCard, Platform.OS === 'web' && { maxWidth: 1100 }]}>
                    <Text style={styles.settingsCardTitle}>{t('profili', lang)}</Text>
                    <Text style={[styles.infoText, { marginTop: -4, marginBottom: 12 }]}>{t('notaClicRigaProfilo', lang)}</Text>

                    {/* Filtri */}
                    <TextInput
                      style={[styles.input, { marginBottom: 8 }]}
                      placeholder={t('filtraNomeEmail', lang)}
                      placeholderTextColor={colors.placeholder}
                      value={filtriProfili.ricerca}
                      onChangeText={(text) => setFiltriProfili(prev => ({ ...prev, ricerca: text }))}
                    />

                    <Text style={[styles.label, { marginBottom: 4, fontSize: 12 }]}>{t('filtraRuolo', lang)}</Text>
                    <TouchableOpacity style={[styles.dropdownTrigger, { marginBottom: 12 }]} onPress={() => setFiltroRuoloProfiliDropdownAperto(true)}>
                      <Text style={styles.dropdownTriggerText}>{filtriProfili.ruolo === 'tutti' ? t('tutte', lang) : etichettaRuolo(filtriProfili.ruolo, lang)}</Text>
                      <Text style={styles.dropdownArrow}>▼</Text>
                    </TouchableOpacity>
                    <Modal visible={filtroRuoloProfiliDropdownAperto} animationType="fade" transparent onRequestClose={() => setFiltroRuoloProfiliDropdownAperto(false)}>
                      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFiltroRuoloProfiliDropdownAperto(false)}>
                        <View style={[styles.dropdownOptionsList, { maxHeight: '75%' }]}>
                          <ScrollView>
                            <TouchableOpacity style={[styles.dropdownOption, filtriProfili.ruolo === 'tutti' && styles.dropdownOptionActive]} onPress={() => { setFiltriProfili(prev => ({ ...prev, ruolo: 'tutti' })); setFiltroRuoloProfiliDropdownAperto(false); }}>
                              <Text style={[styles.dropdownOptionText, filtriProfili.ruolo === 'tutti' && styles.dropdownOptionTextActive]}>{t('tutte', lang)}</Text>
                            </TouchableOpacity>
                            {['utente','studente','insegnante','gestore','economo','segreteria','presideIpi','vicePresideIpi','presideAbm','oratorio','manutentore'].map(r => {
                              const attivo = filtriProfili.ruolo === r;
                              return (
                                <TouchableOpacity key={r} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setFiltriProfili(prev => ({ ...prev, ruolo: r })); setFiltroRuoloProfiliDropdownAperto(false); }}>
                                  <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{etichettaRuolo(r, lang)}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>
                        </View>
                      </TouchableOpacity>
                    </Modal>

                    <TouchableOpacity style={[styles.smallEditBtn, { alignSelf: 'flex-start', marginBottom: 12 }]} onPress={() => setFiltriProfili({ ricerca: '', ruolo: 'tutti', classe: 'tutte', annoScolastico: 'tutti' })}>
                      <Text style={[styles.btnText, { color: '#FFF' }]}>{t('reimpostaFiltri', lang)}</Text>
                    </TouchableOpacity>

                    {/* Profili: lista di dati */}
                    {utentiProfiliFiltrati.length === 0 ? (
                      <Text style={styles.infoText}>{t('nessunProfilo', lang)}</Text>
                    ) : Platform.OS === 'web' ? (
                      /* --- WEB: tabella allargata, colonne ben distanziate --- */
                      <ScrollView horizontal>
                        <View style={styles.tableCard}>
                          <View style={styles.tableHeaderRow}>
                            <Text style={[styles.tableHeaderCell, { minWidth: 200, flex: 1.6 }]}>{t('nome', lang)}</Text>
                            <Text style={[styles.tableHeaderCell, { minWidth: 260, flex: 2 }]}>{t('email', lang)}</Text>
                            <Text style={[styles.tableHeaderCell, { minWidth: 160, flex: 1.2 }]}>{t('ruolo', lang)}</Text>
                            <Text style={[styles.tableHeaderCell, { minWidth: 100, flex: 0.8 }]}>{t('classe', lang)}</Text>
                            <Text style={[styles.tableHeaderCell, { minWidth: 90, flex: 0.7 }]}>{t('eta', lang)}</Text>
                            {canModificareProfili && (
                              <Text style={[styles.tableHeaderCell, { minWidth: 130, flex: 1 }]}>{t('dataScadenza', lang)}</Text>
                            )}
                          </View>
                          {utentiProfiliFiltrati.map((u, idx) => (
                            <TouchableOpacity
                              key={u.id}
                              style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}
                              onPress={() => {
                                setUtenteProfiloModifica(u);
                                setProfiloModificaDati({
                                  nome: u.nome || '',
                                  annoScolastico: u.annoScolastico || '',
                                  classe: u.classe || '',
                                  dataNascita: u.dataNascita || '',
                                  dataScadenza: u.dataScadenza || ''
                                });
                              }}
                            >
                              <Text style={[styles.tableCell, { minWidth: 200, flex: 1.6 }]} numberOfLines={1}>{u.nome}</Text>
                              <Text style={[styles.tableCell, { minWidth: 260, flex: 2 }]} numberOfLines={1}>{u.email}</Text>
                              <Text style={[styles.tableCell, { minWidth: 160, flex: 1.2 }]} numberOfLines={1}>{etichettaRuolo(u.role, lang)}{u.rolePersonalizzato ? ` (${u.rolePersonalizzato})` : ''}</Text>
                              <Text style={[styles.tableCell, { minWidth: 100, flex: 0.8 }]}>{u.classe || '—'}</Text>
                              <Text style={[styles.tableCell, { minWidth: 90, flex: 0.7 }]}>{u.dataNascita ? calcolaEta(u.dataNascita) : '—'}</Text>
                              {canModificareProfili && (
                                <Text style={[styles.tableCell, { minWidth: 130, flex: 1 }]}>{u.dataScadenza ? formattaDataOra(u.dataScadenza, lang) : '—'}</Text>
                              )}
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                    ) : (
                      /* --- ANDROID/iOS: elenco di schede verticali (più leggibile di una tabella con scroll orizzontale) --- */
                      <View>
                        {utentiProfiliFiltrati.map((u) => (
                          <TouchableOpacity
                            key={u.id}
                            style={styles.profiloCardMobile}
                            onPress={() => {
                              setUtenteProfiloModifica(u);
                              setProfiloModificaDati({
                                nome: u.nome || '',
                                annoScolastico: u.annoScolastico || '',
                                classe: u.classe || '',
                                dataNascita: u.dataNascita || '',
                                dataScadenza: u.dataScadenza || ''
                              });
                            }}
                          >
                            <Text style={styles.profiloCardMobileNome} numberOfLines={1}>{u.nome}</Text>
                            <Text style={styles.profiloCardMobileEmail} numberOfLines={1}>{u.email}</Text>

                            <View style={styles.profiloCardMobileRow}>
                              <Text style={styles.profiloCardMobileLabel}>{t('ruolo', lang)}</Text>
                              <Text style={styles.profiloCardMobileValue} numberOfLines={1}>{etichettaRuolo(u.role, lang)}{u.rolePersonalizzato ? ` (${u.rolePersonalizzato})` : ''}</Text>
                            </View>
                            <View style={styles.profiloCardMobileRow}>
                              <Text style={styles.profiloCardMobileLabel}>{t('classe', lang)}</Text>
                              <Text style={styles.profiloCardMobileValue}>{u.classe || '—'}</Text>
                            </View>
                            <View style={styles.profiloCardMobileRow}>
                              <Text style={styles.profiloCardMobileLabel}>{t('eta', lang)}</Text>
                              <Text style={styles.profiloCardMobileValue}>{u.dataNascita ? calcolaEta(u.dataNascita) : '—'}</Text>
                            </View>
                            {canModificareProfili && (
                              <View style={[styles.profiloCardMobileRow, { borderBottomWidth: 0 }]}>
                                <Text style={styles.profiloCardMobileLabel}>{t('dataScadenza', lang)}</Text>
                                <Text style={styles.profiloCardMobileValue}>{u.dataScadenza ? formattaDataOra(u.dataScadenza, lang) : '—'}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })()}

              </Pressable>
            </ScrollView>
          );
        })()}

        {/* ==========================================================
            BARRA DI NAVIGAZIONE INFERIORE (SOLO ANDROID)
            ========================================================== */}
        {Platform.OS === 'android' && (
          <View style={[styles.bottomTabBar, { paddingBottom: Math.max(insets.bottom, 8) + 10 }]}>
            <TouchableOpacity style={styles.bottomTabItem} onPress={() => { setVistaAttiva('home'); setSezioneSelezionata(null); }}>
              <Text style={[styles.bottomTabIcon, vistaAttiva === 'home' && styles.bottomTabIconActive]}>🏠</Text>
              <Text style={[styles.bottomTabLabel, vistaAttiva === 'home' && styles.bottomTabLabelActive]} numberOfLines={1}>{t('navHome', lang)}</Text>
            </TouchableOpacity>
            {!canApprovarePrenotazioni && (
              <TouchableOpacity style={styles.bottomTabItem} onPress={() => setVistaAttiva('calendario')}>
                <Text style={[styles.bottomTabIcon, vistaAttiva === 'calendario' && styles.bottomTabIconActive]}>📅</Text>
                <Text style={[styles.bottomTabLabel, vistaAttiva === 'calendario' && styles.bottomTabLabelActive]} numberOfLines={1}>{t('navCalendario', lang)}</Text>
              </TouchableOpacity>
            )}
            {canApprovarePrenotazioni && (
              <TouchableOpacity style={styles.bottomTabItem} onPress={() => setVistaAttiva('gestione')}>
                <Text style={[styles.bottomTabIcon, vistaAttiva === 'gestione' && styles.bottomTabIconActive]}>📋</Text>
                <Text style={[styles.bottomTabLabel, vistaAttiva === 'gestione' && styles.bottomTabLabelActive]} numberOfLines={1}>{t('navGestione', lang)}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.bottomTabItem} onPress={() => setVistaAttiva('manutenzione')}>
              <Text style={[styles.bottomTabIcon, vistaAttiva === 'manutenzione' && styles.bottomTabIconActive]}>🛠️</Text>
              <Text style={[styles.bottomTabLabel, vistaAttiva === 'manutenzione' && styles.bottomTabLabelActive]} numberOfLines={1}>{t('navManutenzione', lang)}</Text>
            </TouchableOpacity>
            {/* "Aula Studio" è stata spostata come voce nella Home: vedi styles.cardGrid in VISTA HOME. */}
            <TouchableOpacity style={styles.bottomTabItem} onPress={() => setVistaAttiva('impostazioni')}>
              <Text style={[styles.bottomTabIcon, vistaAttiva === 'impostazioni' && styles.bottomTabIconActive]}>⚙️</Text>
              <Text style={[styles.bottomTabLabel, vistaAttiva === 'impostazioni' && styles.bottomTabLabelActive]} numberOfLines={1}>{t('navImpostazioni', lang)}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ==========================================================
          MODALI PRINCIPALI (PRENOTAZIONE, AULA, BLOCCO, UTENTI, PERMESSI, PROFILI)
          ========================================================== */}

      {/* Modale Prenotazione */}
      <Modal visible={aulaInPrenotazione !== null} animationType="slide" transparent onRequestClose={chiudiModalePrenotazione}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{t('prenota', lang)} {risolviNomeAula(aulaInPrenotazione?.nome, lang)}</Text>
              <TouchableOpacity onPress={chiudiModalePrenotazione}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalBodyScrollable}
              contentContainerStyle={{ paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              <Text style={styles.label}>{t('dataMaxMesi', lang, MESI_MASSIMI_PRENOTAZIONE)}</Text>

              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={dataPrenotazione}
                  min={new Date().toISOString().split('T')[0]}
                  max={maxCalendarDate.toISOString().split('T')[0]}
                  onChange={onChangeDateWeb}
                  style={webDateInputStyle}
                />
              ) : (
                <>
                  <TouchableOpacity style={styles.datePickerButton} onPress={() => setShowDatePicker(true)}>
                    <Text style={styles.datePickerButtonText}>📅 {dataPrenotazione}</Text>
                  </TouchableOpacity>
                  {showDatePicker && (
                    <DateTimePicker
                      value={dataPrenotazioneObj}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'default'}
                      minimumDate={new Date()}
                      maximumDate={maxCalendarDate}
                      onChange={onChangeDate}
                    />
                  )}
                </>
              )}

              <TouchableOpacity style={styles.checkboxRow} onPress={() => setRipeti(!ripeti)}>
                <View style={[styles.checkboxBox, ripeti && styles.checkboxBoxChecked]}>
                  {ripeti && <Text style={styles.checkboxCheckmark}>✓</Text>}
                </View>
                <Text style={styles.checkboxLabel}>{t('ripetiSettimanalmente', lang)}</Text>
              </TouchableOpacity>

              {ripeti && (
                <View style={{ marginBottom: 8 }}>
                  <Text style={styles.label}>{t('finoAl', lang)}</Text>
                  {Platform.OS === 'web' ? (
                    <input
                      type="date"
                      value={dataFineRipetizione}
                      min={dataPrenotazione}
                      max={maxCalendarDateRipetizione.toISOString().split('T')[0]}
                      onChange={onChangeDateFineWeb}
                      style={webDateInputStyle}
                    />
                  ) : (
                    <>
                      <TouchableOpacity style={styles.datePickerButton} onPress={() => setShowDatePickerFine(true)}>
                        <Text style={styles.datePickerButtonText}>📅 {dataFineRipetizione || '—'}</Text>
                      </TouchableOpacity>
                      {showDatePickerFine && (
                        <DateTimePicker
                          value={dataFineRipetizioneObj}
                          mode="date"
                          display={Platform.OS === 'ios' ? 'inline' : 'default'}
                          minimumDate={dataPrenotazioneObj}
                          maximumDate={maxCalendarDateRipetizione}
                          onChange={onChangeDateFine}
                        />
                      )}
                    </>
                  )}
                  {Boolean(dataFineRipetizione) && dataFineRipetizione > dataPrenotazione && (
                    <Text style={styles.ripetizioneRiepilogo}>
                      {t('ripetizioneRiepilogo', lang, generaDateRipetizione(dataPrenotazioneObj, dataFineRipetizione).length, nomeGiornoSettimana(dataPrenotazione, lang))}
                    </Text>
                  )}
                  {Boolean(dataFineRipetizione) && dataFineRipetizione > limiteNormaleStr && (
                    <View style={styles.avvisoSpeciale}>
                      <Text style={styles.avvisoSpecialeTesto}>{t('avvisoAutorizzazioneSpeciale', lang)}</Text>
                    </View>
                  )}
                </View>
              )}

              <Text style={styles.label}>{t('fasceOrarie', lang)}</Text>
              <View style={styles.fasceGrid}>
                {FASCE_ORARIE.map(fascia => {
                  const occupata = prenotazioni.some((p) => p.aulaId === aulaInPrenotazione?.id && p.data === dataPrenotazione && p.stato !== 'Rifiutata' && p.fasce.includes(fascia));
                  const orarioFineFascia = fascia.split('-')[1];
                  const oraAttualeStr = new Date().toTimeString().slice(0, 5);
                  const passata = !occupata && dataPrenotazione === oggiStr && orarioFineFascia <= oraAttualeStr;
                  const selezionata = fasceSelezionate.includes(fascia);
                  return (
                    <TouchableOpacity
                      key={fascia}
                      disabled={occupata || passata}
                      style={[
                        styles.fasciaChip,
                        selezionata && styles.fasciaSelected,
                        occupata && styles.fasciaOccupata,
                        passata && styles.fasciaPassata
                      ]}
                      onPress={() => toggleFascia(fascia)}
                    >
                      <Text style={[styles.fasciaText, selezionata && styles.fasciaTextSelected, (occupata || passata) && styles.fasciaTextDisabilitata]}>
                        {occupata ? '🔒 ' : passata ? '🕐 ' : ''}{numArabo(fascia, lang)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                <Text style={styles.infoTextSmall}>🔒 {lang === 'ar' ? 'محجوزة من مستخدم آخر' : 'Occupata da un altro utente'}</Text>
                <Text style={styles.infoTextSmall}>🕐 {lang === 'ar' ? 'الوقت قد مضى' : 'Orario già passato'}</Text>
              </View>

              <Text style={styles.label}>{t('motivoUso', lang)}</Text>
              <TextInput style={styles.input} placeholder={t('motivoObbligatorio', lang)} placeholderTextColor={colors.placeholder} value={motivo} onChangeText={setMotivo} />

              <Text style={styles.label}>{t('insegnanteRiferimento', lang)}</Text>
              <TextInput style={styles.input} placeholder={t('insegnanteRiferimentoPlaceholder', lang)} placeholderTextColor={colors.placeholder} value={insegnanteRiferimento} onChangeText={setInsegnanteRiferimento} />

              {sezioneSelezionata === 'Scuola Professionale' && (
                <>
                  <Text style={styles.label}>{t('domandaStudenteIPI', lang)}</Text>
                  <TouchableOpacity style={styles.checkboxRow} onPress={() => setStudenteIPI('si')}>
                    <View style={[styles.checkboxBox, studenteIPI === 'si' && styles.checkboxBoxChecked]}>
                      {studenteIPI === 'si' && <Text style={styles.checkboxCheckmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkboxLabel}>{t('sonoStudenteIPI', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.checkboxRow} onPress={() => { setStudenteIPI('no'); setClasse(''); }}>
                    <View style={[styles.checkboxBox, studenteIPI === 'no' && styles.checkboxBoxChecked]}>
                      {studenteIPI === 'no' && <Text style={styles.checkboxCheckmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkboxLabel}>{t('nonSonoStudenteIPI', lang)}</Text>
                  </TouchableOpacity>

                  {studenteIPI === 'si' && (
                    <>
                      <Text style={styles.label}>{t('nomeClasse', lang)}</Text>
                      <TextInput style={styles.input} placeholder={t('classeObbligatoriaCFP', lang)} placeholderTextColor={colors.placeholder} value={classe} onChangeText={setClasse} />
                    </>
                  )}
                </>
              )}

              <Text style={styles.label}>{t('nomiPartecipanti', lang)}</Text>
              {partecipanti.map((p, idx) => (
                <View key={idx} style={styles.dynamicFieldRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder={`Partecipante ${idx + 1}`}
                    placeholderTextColor={colors.placeholder}
                    value={p}
                    onChangeText={(val) => modificaPartecipante(idx, val)}
                  />
                  {partecipanti.length > 1 && (
                    <TouchableOpacity style={styles.removeFieldBtn} onPress={() => rimuoviCampoPartecipante(idx)}>
                      <Text style={styles.btnText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <TouchableOpacity style={styles.addFieldBtn} onPress={aggiungiCampoPartecipante}>
                <Text style={styles.addFieldBtnText}>{t('aggiungiPartecipante', lang)}</Text>
              </TouchableOpacity>
            </ScrollView>

            <View style={styles.modalFooterFixed}>
              <TouchableOpacity style={styles.primaryButton} onPress={inviaPrenotazione}>
                <Text style={styles.buttonText}>{t('confermaPrenotazione', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modale Nuova Sezione */}
      <Modal visible={modalNuovaSezione} animationType="slide" transparent onRequestClose={chiudiModaleNuovaSezione}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{t('aggiungiSezione', lang)}</Text>
              <TouchableOpacity onPress={chiudiModaleNuovaSezione}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>{t('nomeNuovaSezione', lang)}</Text>
              <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={t('nomeNuovaSezione', lang)} placeholderTextColor={colors.placeholder} value={nuovaSezioneNome} onChangeText={setNuovaSezioneNome} />
              <Text style={styles.label}>{t('nomeNuovaSezioneAr', lang)}</Text>
              <TextInput style={[styles.input, { textAlign: 'right' }]} placeholder={t('nomeNuovaSezioneAr', lang)} placeholderTextColor={colors.placeholder} value={nuovaSezioneNomeAr} onChangeText={setNuovaSezioneNomeAr} />
            </ScrollView>
            <View style={styles.modalFooterFixed}>
              <TouchableOpacity style={styles.primaryButton} onPress={aggiungiSezione}>
                <Text style={styles.buttonText}>{t('aggiungiSezione', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modale Modifica Sezione */}
      <Modal visible={modalModificaSezione} animationType="slide" transparent onRequestClose={() => setModalModificaSezione(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{t('modificaSezioneTitolo', lang)}</Text>
              <TouchableOpacity onPress={() => setModalModificaSezione(false)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>{t('nomeSezioneLabel', lang)}</Text>
              <TextInput style={styles.input} placeholder="es. Scuola Professionale" placeholderTextColor={colors.placeholder} value={nomeSezioneInModifica} onChangeText={setNomeSezioneInModifica} />
              <Text style={styles.label}>{t('nomeSezioneAr', lang)}</Text>
              <TextInput style={[styles.input, { textAlign: 'right' }]} placeholder={t('nomeNuovaSezioneAr', lang)} placeholderTextColor={colors.placeholder} value={nomeSezioneInModificaAr} onChangeText={setNomeSezioneInModificaAr} />
            </ScrollView>
            <View style={styles.modalFooterFixed}>
              <TouchableOpacity style={styles.primaryButton} onPress={salvaSezioneModificata}>
                <Text style={styles.buttonText}>{t('salvaModifiche', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modale Nuova Aula / Modifica Aula */}
      <Modal visible={modalNuovaAula} animationType="slide" transparent onRequestClose={() => setModalNuovaAula(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{aulaInModifica ? t('modificaAula', lang) : t('nuovaAula', lang)} — {risolviNomeSezione(sezioneSelezionata, lang)}</Text>
              <TouchableOpacity onPress={() => setModalNuovaAula(false)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>{t('nomeAula', lang)}:</Text>
              <TextInput style={styles.input} placeholder={t('nomeAula', lang)} placeholderTextColor={colors.placeholder} value={nomeNuovaAula} onChangeText={setNomeNuovaAula} />
              <Text style={styles.label}>{t('nomeAulaAr', lang)}</Text>
              <TextInput style={[styles.input, { textAlign: 'right' }]} placeholder={t('nomeAulaArPlaceholder', lang)} placeholderTextColor={colors.placeholder} value={nomeNuovaAulaAr} onChangeText={setNomeNuovaAulaAr} />
              <Text style={styles.label}>{t('capienza', lang)}:</Text>
              <TextInput style={styles.input} placeholder={t('capienza', lang)} placeholderTextColor={colors.placeholder} keyboardType="numeric" value={capienzaNuovaAula} onChangeText={setCapienzaNuovaAula} />
            </ScrollView>
            <View style={styles.modalFooterFixed}>
              <TouchableOpacity style={styles.primaryButton} onPress={salvaAula}>
                <Text style={styles.buttonText}>{aulaInModifica ? t('salvaModifiche', lang) : t('creaAula', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modale Blocca Aula */}
      <Modal visible={modalBloccoAula} animationType="slide" transparent onRequestClose={chiudiBloccaAula}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{t('bloccaAulaTitolo', lang, aulaDaBloccare?.nome || '')}</Text>
              <TouchableOpacity onPress={chiudiBloccaAula}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
              <Text style={[styles.infoTextSmall, { marginBottom: 14 }]}>{t('bloccaAulaSpiegazione', lang)}</Text>
              <Text style={styles.label}>{t('dataInizioBlocco', lang)}</Text>
              {Platform.OS === 'web' ? (
                <input type="date" value={dataInizioBlocco} onChange={onChangeDateBloccoInizioWeb} style={webDateInputStyle} />
              ) : (
                <>
                  <TouchableOpacity style={styles.datePickerButton} onPress={() => setShowDatePickerBloccoInizio(true)}>
                    <Text style={styles.datePickerButtonText}>📅 {dataInizioBlocco || '—'}</Text>
                  </TouchableOpacity>
                  {showDatePickerBloccoInizio && (
                    <DateTimePicker value={dataInizioBloccoObj} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={onChangeDateBloccoInizio} />
                  )}
                </>
              )}
              <Text style={styles.label}>{t('dataFineBlocco', lang)}</Text>
              {Platform.OS === 'web' ? (
                <input type="date" value={dataFineBlocco} min={dataInizioBlocco || undefined} onChange={onChangeDateBloccoFineWeb} style={webDateInputStyle} />
              ) : (
                <>
                  <TouchableOpacity style={styles.datePickerButton} onPress={() => setShowDatePickerBloccoFine(true)}>
                    <Text style={styles.datePickerButtonText}>📅 {dataFineBlocco || '—'}</Text>
                  </TouchableOpacity>
                  {showDatePickerBloccoFine && (
                    <DateTimePicker value={dataFineBloccoObj} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} minimumDate={dataInizioBloccoObj} onChange={onChangeDateBloccoFine} />
                  )}
                </>
              )}
              <Text style={styles.label}>{t('motivo', lang)}</Text>
              <TextInput style={styles.input} placeholder={t('motivoBloccoPlaceholder', lang)} placeholderTextColor={colors.placeholder} value={motivoBlocco} onChangeText={setMotivoBlocco} />
            </ScrollView>
            <View style={styles.modalFooterFixed}>
              <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.danger }]} onPress={confermaBloccoAula}>
                <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>{t('confermaBlocco', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modale Aggiungi Utente (con ruolo personalizzato e profilo temporaneo) */}
      <Modal visible={modalAggiungiUtente} animationType="slide" transparent onRequestClose={() => setModalAggiungiUtente(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{t('aggiungiUtente', lang)}</Text>
              <TouchableOpacity onPress={() => setModalAggiungiUtente(false)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>{t('nome', lang)}:</Text>
              <TextInput style={styles.input} placeholder={t('nome', lang)} placeholderTextColor={colors.placeholder} value={nuovoUtenteNome} onChangeText={setNuovoUtenteNome} />
              <Text style={styles.label}>{t('email', lang)}:</Text>
              <TextInput style={styles.input} placeholder={t('email', lang)} placeholderTextColor={colors.placeholder} autoCapitalize="none" keyboardType="email-address" value={nuovoUtenteEmail} onChangeText={setNuovoUtenteEmail} />

              <Text style={styles.label}>{t('ruolo', lang)}:</Text>
              {!nuovoRuoloPersonalizzatoAttivo ? (
                <>
                  <TouchableOpacity style={styles.datePickerButton} onPress={() => setModalScegliRuoloNuovoUtente(true)}>
                    <Text style={styles.datePickerButtonText}>{etichettaRuolo(nuovoUtenteRuolo, lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setNuovoRuoloPersonalizzatoAttivo(true); setNuovoUtenteRuolo(''); }}>
                    <Text style={[styles.infoTextSmall, { color: colors.primary, fontWeight: '700', marginBottom: 12 }]}>
                      {lang === 'ar' ? '+ دور مخصص جديد' : '+ Aggiungi un nuovo ruolo'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TextInput
                    style={[styles.input, { marginBottom: 8 }]}
                    placeholder="es. Animatore, Collaboratore..."
                    placeholderTextColor={colors.placeholder}
                    value={nuovoUtenteRuolo}
                    onChangeText={setNuovoUtenteRuolo}
                  />
                  <Text style={[styles.infoTextSmall, { marginBottom: 4 }]}>
                    {lang === 'ar' ? 'أدخل اسم الدور الجديد. سيتم استخدامه كدور افتراضي لهذا المستخدم.' : 'Inserisci il nome del nuovo ruolo: verrà impostato come ruolo predefinito di questo utente.'}
                  </Text>
                  <TouchableOpacity onPress={() => { setNuovoRuoloPersonalizzatoAttivo(false); setNuovoUtenteRuolo('utente'); }}>
                    <Text style={[styles.infoTextSmall, { color: colors.primary, fontWeight: '700', marginBottom: 12 }]}>
                      {lang === 'ar' ? '← اختر من الأدوار الموجودة' : '← Scegli tra i ruoli esistenti'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
              <Text style={[styles.infoTextSmall, { marginBottom: 12 }]}>
                {lang === 'ar' ? 'يمكن منح صلاحيات خاصة لاحقًا من الإعدادات المتقدمة' : "Eventuali permessi speciali per questo utente si assegnano in un secondo momento dalle impostazioni avanzate."}
              </Text>

              <Text style={styles.label}>{t('password', lang)}:</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <TextInput style={[styles.input, { flex: 1 }]} placeholder={t('password', lang)} placeholderTextColor={colors.placeholder} autoCapitalize="none" value={nuovoUtentePassword} onChangeText={setNuovoUtentePassword} />
                <TouchableOpacity style={styles.smallEditBtn} onPress={generaPasswordCasuale}>
                  <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('generaPassword', lang)}</Text>
                </TouchableOpacity>
              </View>

              {/* Profilo temporaneo */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8 }}>
                <TouchableOpacity onPress={() => setIsTemporaneo(!isTemporaneo)} style={{ marginRight: 8 }}>
                  <View style={[styles.checkboxBox, isTemporaneo && styles.checkboxBoxChecked]}>
                    {isTemporaneo && <Text style={styles.checkboxCheckmark}>✓</Text>}
                  </View>
                </TouchableOpacity>
                <Text style={styles.checkboxLabel}>{t('profiloTemporaneo', lang)}</Text>
              </View>
              {isTemporaneo && (
                <>
                  <Text style={styles.label}>{t('dataScadenza', lang)}</Text>
                  {Platform.OS === 'web' ? (
                    <input
                      type="date"
                      value={dataScadenzaUtente}
                      onChange={(e) => setDataScadenzaUtente(e.target.value)}
                      style={webDateInputStyle}
                    />
                  ) : (
                    <>
                      <TouchableOpacity style={styles.datePickerButton} onPress={() => setShowDatePickerScadenza(true)}>
                        <Text style={styles.datePickerButtonText}>{dataScadenzaUtente || 'Seleziona data'}</Text>
                      </TouchableOpacity>
                      {showDatePickerScadenza && (
                        <DateTimePicker
                          value={dataScadenzaUtente ? new Date(dataScadenzaUtente + 'T00:00:00') : new Date()}
                          mode="date"
                          display={Platform.OS === 'ios' ? 'inline' : 'default'}
                          minimumDate={new Date()}
                          onChange={(event, selectedDate) => {
                            setShowDatePickerScadenza(Platform.OS === 'ios');
                            if (selectedDate) {
                              setDataScadenzaUtente(selectedDate.toISOString().split('T')[0]);
                            }
                          }}
                        />
                      )}
                    </>
                  )}
                </>
              )}

              <Text style={[styles.infoTextSmall, { marginBottom: 12 }]}>{t('notaUtenteManualeBypass', lang)}</Text>
            </ScrollView>
            <View style={styles.modalFooterFixed}>
              <TouchableOpacity style={styles.primaryButton} onPress={aggiungiUtenteManuale}>
                <Text style={styles.buttonText}>{t('inviaInvito', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modale Dettaglio Utente */}
      <Modal visible={!!utenteDettaglioTarget} animationType="slide" transparent onRequestClose={() => setUtenteDettaglioTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            {utenteDettaglioTarget && (
              <>
                <View style={styles.modalHeaderFixed}>
                  <Text style={styles.modalTitle} numberOfLines={1}>{utenteDettaglioTarget.nome}</Text>
                  <TouchableOpacity onPress={() => setUtenteDettaglioTarget(null)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
                </View>
                <ScrollView style={styles.modalBodyScrollable}>
                  <Text style={styles.gestioneListMeta}>{t('email', lang)}: {utenteDettaglioTarget.email}</Text>
                  <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>{t('colonnaRuolo', lang)}: {etichettaRuolo(utenteDettaglioTarget.role, lang)}{utenteDettaglioTarget.rolePersonalizzato ? ` (${utenteDettaglioTarget.rolePersonalizzato})` : ''}</Text>
                  <View style={{ flexDirection: 'row', marginTop: 10, marginBottom: 4 }}>
                    <View style={[styles.statoBadge, { backgroundColor: utenteDettaglioTarget.primoAccessoEffettuato === false ? colors.warning : colors.success }]}>
                      <Text style={styles.statoBadgeText}>
                        {utenteDettaglioTarget.primoAccessoEffettuato === false ? t('invitoInAttesa', lang) : t('emailVerificata', lang)}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.utentiAzioneRow, { marginTop: 16 }]}>
                    {utenteDettaglioTarget.primoAccessoEffettuato === false && (
                      <TouchableOpacity style={styles.utentiAzioneBtn} onPress={() => rinviaInvitoUtente(utenteDettaglioTarget.email)}>
                        <Text style={[styles.utentiAzioneBtnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('rinviaInvito', lang)}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.utentiAzioneBtn} onPress={() => { setUtenteRuoloModalTarget({ id: utenteDettaglioTarget.id, role: utenteDettaglioTarget.role }); setUtenteDettaglioTarget(null); }}>
                      <Text style={[styles.utentiAzioneBtnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('cambiaRuolo', lang)}</Text>
                    </TouchableOpacity>
                    {utenteDettaglioTarget.email !== user.email && (
                      <TouchableOpacity style={styles.utentiAzioneDeleteBtn} onPress={() => { eliminaUtenteDallaLista(utenteDettaglioTarget); setUtenteDettaglioTarget(null); }}>
                        <Text style={styles.utentiAzioneDeleteBtnText}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Modale Cambia Ruolo (dropdown) */}
      <Modal visible={utenteRuoloModalTarget !== null} animationType="fade" transparent onRequestClose={() => setUtenteRuoloModalTarget(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setUtenteRuoloModalTarget(null)}>
          <View style={[styles.dropdownOptionsList, { maxHeight: '75%' }]}>
            <Text style={[styles.label, { textAlign: 'center', marginBottom: 8 }]}>{t('scegliRuolo', lang)}</Text>
            <ScrollView>
              {RUOLI_TUTTI.map((ruolo) => {
                const attivo = utenteRuoloModalTarget?.role === ruolo;
                return (
                  <TouchableOpacity key={ruolo} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => utenteRuoloModalTarget && impostaRuoloUtente(utenteRuoloModalTarget.id, ruolo)}>
                    <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{etichettaRuolo(ruolo, lang)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modale Scegli Ruolo per il nuovo utente (sezione Aggiungi Utente) */}
      <Modal visible={modalScegliRuoloNuovoUtente} animationType="fade" transparent onRequestClose={() => setModalScegliRuoloNuovoUtente(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalScegliRuoloNuovoUtente(false)}>
          <View style={[styles.dropdownOptionsList, { maxHeight: '75%' }]}>
            <Text style={[styles.label, { textAlign: 'center', marginBottom: 8 }]}>{t('scegliRuolo', lang)}</Text>
            <ScrollView>
              {RUOLI_TUTTI.map((ruolo) => {
                const attivo = nuovoUtenteRuolo === ruolo;
                return (
                  <TouchableOpacity key={ruolo} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setNuovoUtenteRuolo(ruolo); setModalScegliRuoloNuovoUtente(false); }}>
                    <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{etichettaRuolo(ruolo, lang)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modale Profilo Personale (clic su nome in header) */}
      <Modal visible={modalProfiloPersonale} animationType="slide" transparent onRequestClose={() => setModalProfiloPersonale(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{t('profiloPersonale', lang)}</Text>
              <TouchableOpacity onPress={() => setModalProfiloPersonale(false)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBodyScrollable}>
              {currentUserData && (
                <>
                  <Text style={styles.gestioneListMeta}><Text style={{ fontWeight: 'bold' }}>{t('nome', lang)}:</Text> {currentUserData.nome}</Text>
                  <Text style={styles.gestioneListMeta}><Text style={{ fontWeight: 'bold' }}>{t('email', lang)}:</Text> {currentUserData.email}</Text>
                  <Text style={styles.gestioneListMeta}><Text style={{ fontWeight: 'bold' }}>{t('ruolo', lang)}:</Text> {etichettaRuolo(currentUserData.role, lang)}{currentUserData.rolePersonalizzato ? ` (${currentUserData.rolePersonalizzato})` : ''}</Text>
                  {currentUserData.role === 'studente' && (
                    <>
                      <Text style={styles.gestioneListMeta}><Text style={{ fontWeight: 'bold' }}>{t('annoScolastico', lang)}:</Text> {currentUserData.annoScolastico || '—'}</Text>
                      <Text style={styles.gestioneListMeta}><Text style={{ fontWeight: 'bold' }}>{t('classe', lang)}:</Text> {currentUserData.classe || '—'}</Text>
                    </>
                  )}
                  <Text style={styles.gestioneListMeta}><Text style={{ fontWeight: 'bold' }}>{t('dataNascita', lang)}:</Text> {currentUserData.dataNascita || '—'}</Text>
                  <Text style={styles.gestioneListMeta}><Text style={{ fontWeight: 'bold' }}>{t('eta', lang)}:</Text> {currentUserData.dataNascita ? calcolaEta(currentUserData.dataNascita) : '—'}</Text>
                  <Text style={styles.gestioneListMeta}><Text style={{ fontWeight: 'bold' }}>{t('dataRegistrazione', lang)}:</Text> {currentUserData.createdAt ? formattaDataOra(currentUserData.createdAt, lang) : '—'}</Text>
                  {currentUserData.dataScadenza && (
                    <Text style={[styles.gestioneListMeta, { color: colors.danger }]}><Text style={{ fontWeight: 'bold' }}>{t('dataScadenza', lang)}:</Text> {formattaDataOra(currentUserData.dataScadenza, lang)}</Text>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modale Modifica Profilo (da sezione Profili) */}
      <Modal visible={!!utenteProfiloModifica} animationType="slide" transparent onRequestClose={() => { setUtenteProfiloModifica(null); setProfiloModificaDati({}); }}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{canModificareProfili ? t('modificaProfilo', lang) : t('profiloPersonale', lang)}</Text>
              <TouchableOpacity onPress={() => { setUtenteProfiloModifica(null); setProfiloModificaDati({}); }}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
              {utenteProfiloModifica && (
                <>
                  <Text style={styles.label}>{t('nome', lang)}</Text>
                  <TextInput
                    style={[styles.input, !canModificareProfili && { backgroundColor: colors.surfaceAlt }]}
                    value={profiloModificaDati.nome || ''}
                    onChangeText={(text) => canModificareProfili && setProfiloModificaDati(prev => ({ ...prev, nome: text }))}
                    editable={canModificareProfili}
                    placeholderTextColor={colors.placeholder}
                  />
                  <Text style={styles.label}>{t('email', lang)}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.surfaceAlt }]}
                    value={utenteProfiloModifica.email || ''}
                    editable={false}
                    placeholderTextColor={colors.placeholder}
                  />

                  <Text style={styles.label}>{t('ruolo', lang)}</Text>
                  {canModificareProfili ? (
                    <TouchableOpacity
                      style={styles.dropdownTrigger}
                      onPress={() => setModalScegliRuoloProfilo(true)}
                    >
                      <Text style={styles.dropdownTriggerText}>
                        {etichettaRuolo(utenteProfiloModifica.role, lang)}{utenteProfiloModifica.rolePersonalizzato ? ` (${utenteProfiloModifica.rolePersonalizzato})` : ''}
                      </Text>
                      <Text style={styles.dropdownArrow}>▼</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={[styles.input, { backgroundColor: colors.surfaceAlt, justifyContent: 'center' }]}>
                      <Text style={{ color: colors.textMain }}>
                        {etichettaRuolo(utenteProfiloModifica.role, lang)}{utenteProfiloModifica.rolePersonalizzato ? ` (${utenteProfiloModifica.rolePersonalizzato})` : ''}
                      </Text>
                    </View>
                  )}

                  {utenteProfiloModifica.role === 'studente' && (
                    <>
                      <Text style={[styles.label, { marginTop: 8 }]}>{t('annoScolastico', lang)}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <View style={[styles.datePickerButton, { flex: 1, marginBottom: 0 }]}>
                          <Text style={styles.datePickerButtonText}>{profiloModificaDati.annoScolastico || annoScolasticoAttuale()}</Text>
                        </View>
                        {canModificareProfili && (
                          <TouchableOpacity style={styles.smallEditBtn} onPress={() => setProfiloModificaDati(prev => ({ ...prev, annoScolastico: annoScolasticoAttuale() }))}>
                            <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('generaAnnoScolastico', lang)}</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      <Text style={[styles.label, { marginTop: 8 }]}>{t('classe', lang)}</Text>
                      <TouchableOpacity
                        style={styles.datePickerButton}
                        onPress={() => canModificareProfili && setModalScegliClasseProfilo(true)}
                        disabled={!canModificareProfili}
                      >
                        <Text style={styles.datePickerButtonText}>{profiloModificaDati.classe || t('classe', lang)}</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  <Text style={[styles.label, { marginTop: 8 }]}>{t('dataNascita', lang)}</Text>
                  {Platform.OS === 'web' ? (
                    <input
                      type="date"
                      value={profiloModificaDati.dataNascita || ''}
                      onChange={(e) => canModificareProfili && setProfiloModificaDati(prev => ({ ...prev, dataNascita: e.target.value }))}
                      style={webDateInputStyle}
                      disabled={!canModificareProfili}
                    />
                  ) : (
                    <TouchableOpacity
                      style={[styles.datePickerButton, !canModificareProfili && { opacity: 0.6 }]}
                      onPress={() => canModificareProfili && setShowDatePickerProfiloNascita(true)}
                      disabled={!canModificareProfili}
                    >
                      <Text style={styles.datePickerButtonText}>{profiloModificaDati.dataNascita || 'Seleziona'}</Text>
                    </TouchableOpacity>
                  )}
                  {showDatePickerProfiloNascita && (
                    <DateTimePicker
                      value={profiloModificaDati.dataNascita ? new Date(profiloModificaDati.dataNascita + 'T00:00:00') : new Date()}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'default'}
                      maximumDate={new Date()}
                      onChange={(event, selectedDate) => {
                        setShowDatePickerProfiloNascita(Platform.OS === 'ios');
                        if (selectedDate) {
                          setProfiloModificaDati(prev => ({ ...prev, dataNascita: selectedDate.toISOString().split('T')[0] }));
                        }
                      }}
                    />
                  )}
                  {profiloModificaDati.dataNascita && (
                    <Text style={styles.infoTextSmall}>{t('eta', lang)}: {calcolaEta(profiloModificaDati.dataNascita)}</Text>
                  )}

                  <Text style={[styles.label, { marginTop: 8 }]}>{t('dataScadenza', lang)} (opzionale)</Text>
                  {Platform.OS === 'web' ? (
                    <input
                      type="date"
                      value={profiloModificaDati.dataScadenza || ''}
                      onChange={(e) => canModificareProfili && setProfiloModificaDati(prev => ({ ...prev, dataScadenza: e.target.value }))}
                      style={webDateInputStyle}
                      disabled={!canModificareProfili}
                    />
                  ) : (
                    <TouchableOpacity
                      style={[styles.datePickerButton, !canModificareProfili && { opacity: 0.6 }]}
                      onPress={() => canModificareProfili && setShowDatePickerProfiloScadenza(true)}
                      disabled={!canModificareProfili}
                    >
                      <Text style={styles.datePickerButtonText}>{profiloModificaDati.dataScadenza || 'Nessuna'}</Text>
                    </TouchableOpacity>
                  )}
                  {showDatePickerProfiloScadenza && (
                    <DateTimePicker
                      value={profiloModificaDati.dataScadenza ? new Date(profiloModificaDati.dataScadenza + 'T00:00:00') : new Date()}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'default'}
                      onChange={(event, selectedDate) => {
                        setShowDatePickerProfiloScadenza(Platform.OS === 'ios');
                        if (selectedDate) {
                          setProfiloModificaDati(prev => ({ ...prev, dataScadenza: selectedDate.toISOString().split('T')[0] }));
                        }
                      }}
                    />
                  )}

                  {canModificareProfili && (
                    <TouchableOpacity style={[styles.primaryButton, { marginTop: 16 }]} onPress={salvaModificaProfilo}>
                      <Text style={styles.buttonText}>{t('salvaModifiche', lang)}</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </ScrollView>

            {/* Dropdown "Scegli Classe" disegnato SOPRA il contenuto di questa
                stessa modale (non è una Modal separata) così è sempre visibile
                e selezionabile, invece di finire dietro la finestra Modifica Profilo. */}
            {modalScegliClasseProfilo && (
              <TouchableOpacity
                style={styles.dropdownOverlayInModal}
                activeOpacity={1}
                onPress={() => setModalScegliClasseProfilo(false)}
              >
                <View style={[styles.dropdownOptionsList, { maxHeight: '75%' }]}>
                  <Text style={[styles.label, { textAlign: 'center', marginBottom: 8 }]}>{t('classe', lang)}</Text>
                  <ScrollView>
                    {(classiLista.length > 0 ? classiLista.map(c => c.nome) : CLASSI_DISPONIBILI).map((cls) => {
                      const attivo = profiloModificaDati.classe === cls;
                      return (
                        <TouchableOpacity key={cls} style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]} onPress={() => { setProfiloModificaDati(prev => ({ ...prev, classe: cls })); setModalScegliClasseProfilo(false); }}>
                          <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{cls}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            )}

            {/* Dropdown "Scegli Ruolo", stesso principio: disegnato dentro questa
                modale invece che come Modal separata, così non finisce mai dietro. */}
            {modalScegliRuoloProfilo && utenteProfiloModifica && (
              <TouchableOpacity
                style={styles.dropdownOverlayInModal}
                activeOpacity={1}
                onPress={() => setModalScegliRuoloProfilo(false)}
              >
                <View style={[styles.dropdownOptionsList, { maxHeight: '75%' }]}>
                  <Text style={[styles.label, { textAlign: 'center', marginBottom: 8 }]}>{t('scegliRuolo', lang)}</Text>
                  <ScrollView>
                    {RUOLI_TUTTI.map((ruolo) => {
                      const attivo = utenteProfiloModifica.role === ruolo;
                      return (
                        <TouchableOpacity
                          key={ruolo}
                          style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]}
                          onPress={() => { impostaRuoloUtente(utenteProfiloModifica.id, ruolo); setModalScegliRuoloProfilo(false); }}
                        >
                          <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{etichettaRuolo(ruolo, lang)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modale Impostazioni Avanzate – Permessi (tabella semplice) */}
      <Modal visible={utentePermessiTarget !== null} animationType="slide" transparent onRequestClose={() => setUtentePermessiTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContentFixed, styles.modalContentWide, { maxHeight: '90%' }]}>
            {utentePermessiTarget && (
              <>
                <View style={styles.modalHeaderFixed}>
                  <Text style={styles.modalTitle} numberOfLines={1}>{lang === 'ar' ? `الصلاحيات لـ ${utentePermessiTarget.nome}` : `Permessi per ${utentePermessiTarget.nome}`}</Text>
                  <TouchableOpacity onPress={() => setUtentePermessiTarget(null)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
                </View>
                <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
                  <Text style={[styles.label, { marginBottom: 8 }]}>{lang === 'ar' ? 'الدور الأساسي: ' : 'Ruolo base: '}<Text style={{ fontWeight: '700' }}>{etichettaRuolo(utentePermessiTarget.role, lang)}</Text></Text>

                  <View style={styles.legendaRow}>
                    <View style={styles.legendaItem}>
                      <View style={[styles.legendaDot, { backgroundColor: colors.textMuted }]} />
                      <Text style={styles.infoTextSmall}>{lang === 'ar' ? 'حسب الدور الأساسي' : 'Standard (dal ruolo)'}</Text>
                    </View>
                    <View style={styles.legendaItem}>
                      <View style={[styles.legendaDot, { backgroundColor: colors.primary }]} />
                      <Text style={styles.infoTextSmall}>{lang === 'ar' ? 'مخصّص' : 'Personalizzato'}</Text>
                    </View>
                  </View>

                  <View style={styles.permTable}>
                    <View style={styles.permTableHeaderRow}>
                      <Text style={[styles.permTableHeaderCell, { flex: 3 }]}>{t('permessoLabel', lang)}</Text>
                      <Text style={[styles.permTableHeaderCell, styles.permTableHeaderCellCenter, { flex: 1 }]}>{t('attivoLabel', lang)}</Text>
                    </View>
                    {(() => {
                      let categoriaCorrente: any = null;
                      let rigaIdx = 0;
                      return RIGHE_TABELLA_PERMESSI.map((riga) => {
                        const value = permessiModifica[riga.permessoKey];
                        const defaultValue = riga.defaultFn(utentePermessiTarget.role);
                        const isOverride = value !== defaultValue;
                        const nuovaCategoria = riga.categoriaKey !== categoriaCorrente;
                        categoriaCorrente = riga.categoriaKey;
                        const isAlt = rigaIdx % 2 === 1;
                        rigaIdx += 1;
                        return (
                          <View key={riga.permessoKey}>
                            {nuovaCategoria && (
                              <View style={styles.permTableCategoriaRow}>
                                <Text style={styles.permTableCategoriaText}>{t(riga.categoriaKey, lang)}</Text>
                              </View>
                            )}
                            <TouchableOpacity
                              style={[styles.permTableRow, isAlt && styles.tableRowAlt]}
                              onPress={() => togglePermesso(riga.permessoKey)}
                            >
                              <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingRight: 8 }}>
                                <Text style={styles.permTableCellLabel}>{lang === 'ar' ? riga.labelAr : riga.label}</Text>
                                {isOverride && (
                                  <View style={styles.permessoBadgeOverride}>
                                    <Text style={styles.permessoBadgeOverrideText}>{lang === 'ar' ? 'مخصّص' : 'Personalizzato'}</Text>
                                  </View>
                                )}
                                <View style={[styles.permTableCellToggle, { flex: 0 }]}>
                                  <View style={[styles.checkboxBox, value && styles.checkboxBoxChecked]}>
                                    {value && <Text style={styles.checkboxCheckmark}>✓</Text>}
                                  </View>
                                </View>
                              </View>
                            </TouchableOpacity>
                          </View>
                        );
                      });
                    })()}
                  </View>
                </ScrollView>
                <View style={styles.modalFooterFixed}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.danger, flex: 1 }]} onPress={() => { setPermessiModifica({}); setUtentePermessiTarget(null); }}>
                      <Text style={[styles.buttonText, { color: '#FFF' }]}>{t('resetLabel', lang)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.primaryButton, { flex: 2 }]} onPress={salvaPermessiUtente}>
                      <Text style={styles.buttonText}>{t('salva', lang)}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ================================================================
// PARTE 5 – STILI DINAMICI E FUNZIONI DI SUPPORTO
// ================================================================

// --- Funzione per l'ombra (soft shadow) ---
const softShadow = (colors: any, opacity = 0.08, radius = 8, y = 2) => ({
  shadowColor: colors.shadow,
  shadowOffset: { width: 0, height: y },
  shadowOpacity: opacity,
  shadowRadius: radius,
  elevation: Math.max(1, Math.round(radius / 3))
});

// --- Funzione per il date picker della data di nascita (profilo) ---
// (questa funzione era già usata nella UI ma non ancora definita)
const onChangeDateNascita = (event: any, selectedDate: any) => {
  // Nota: questa funzione va definita all'interno del componente App,
  // ma per completezza la mettiamo qui come riferimento.
  // Nel codice reale è già stata dichiarata nella parte 2.
};

// --- Stili dinamici (tutti i fogli di stile dell'app) ---
const getDynamicStyles = (colors: any, isRTL: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: ANDROID_STATUSBAR_HEIGHT,
    ...(Platform.OS === 'web' ? ({ height: '100vh', maxHeight: '100vh', overflow: 'hidden' } as any) : {}),
  },


  // ---- Schermata di autenticazione ----
  authBox: { flex: 1, width: '100%' },
  contentWatermark: {
    position: 'absolute',
    opacity: colors.watermarkOpacity,
  },
  authBackground: { flex: 1, width: '100%' },
  authWatermarkWrap: {
    // MODIFICATO: era centrato a schermo intero (alignItems/justifyContent:
    // 'center'), il che lo faceva finire esattamente dietro ai campi
    // Email/Password (anch'essi centrati nella metà inferiore dello
    // schermo), dando l'impressione che il logo fosse "incollato" alle
    // caselle di accesso. Ora è ancorato in alto, nell'area del titolo, ben
    // sopra al modulo di login.
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: '12%',
  },
  authWatermarkFixed: {
    width: 220,
    height: 220,
    opacity: colors.watermarkOpacity,
  },
  authOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(10,14,22,0.60)',
  },
  authTopBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  authCenter: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'web' ? 56 : 16,
    paddingBottom: Platform.OS === 'android' ? 40 : 90,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  forgotPasswordText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },

  // ---- Campi di input ----
  input: {
    backgroundColor: colors.surface,
    color: colors.textMain,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    fontSize: Platform.OS === 'web' ? 15 : 15,
  },
  passwordFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    marginBottom: 12,
    [isRTL ? 'paddingLeft' : 'paddingRight']: 44,
  },
  passwordToggleBtn: {
    position: 'absolute',
    [isRTL ? 'left' : 'right']: 12,
    top: 0,
    bottom: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  passwordToggleIcon: { fontSize: 18 },

  // ---- Pulsanti ----
  primaryButton: {
    backgroundColor: colors.primary,
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    ...softShadow(colors, 0.18, 6, 3),
  },
  buttonText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: Platform.OS === 'web' ? 16 : 16,
  },
  switchAuthText: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 16,
  },
  primaryButtonSmall: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  buttonTextSmall: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 14,
  },

  // ---- Header ----
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 14,
    paddingVertical: Platform.OS === 'web' ? 20 : 14,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.border,
    ...softShadow(colors, 0.05, 6, 2),
  },
  headerSideGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerCenterGroup: {
    alignItems: 'center',
    flexShrink: 0,
  },
  headerIconsRow: Platform.OS === 'web'
    ? { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }
    : { flexDirection: 'row', alignItems: 'center', gap: 8, rowGap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1 },
  headerIconsRowLTR: {},
  headerIconsRowRTL: {},
  headerTitleCentered: {
    color: colors.textMain,
    fontSize: Platform.OS === 'web' ? 15 : 13,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
    lineHeight: Platform.OS === 'web' ? 18 : 16,
  },
  headerSubtitleCentered: {
    color: colors.textMuted,
    fontSize: Platform.OS === 'web' ? 15 : 12,
    fontFamily: FONT_FAMILY,
    lineHeight: Platform.OS === 'web' ? 19 : 15,
    marginTop: 6,
  },
  roleGold: {
    color: colors.primary,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  logoutBtn: {
    backgroundColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
  },
  logoutText: {
    color: colors.textMain,
    fontSize: 16,
  },
  langBtnHeader: {
    backgroundColor: colors.border,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.moveBtn,
  },
  notificaBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.danger,
    borderRadius: 11,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notificaBadgeText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11,
  },
  langTextHeader: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: '700',
  },

  // ---- Navigazione ----
  navBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    flexWrap: 'wrap',
  },
  navItem: {
    color: colors.textSub,
    fontWeight: '500',
    paddingVertical: 13,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  navActive: {
    color: colors.primary,
    fontWeight: '700',
    borderBottomWidth: 2,
    borderColor: colors.primary,
  },

  // ---- Bottom tab (Android) ----
  bottomTabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 8,
    paddingBottom: 14,
    ...softShadow(colors, 0.08, 8, -2),
  },
  bottomTabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
  },
  bottomTabIcon: { fontSize: 20, opacity: 0.55 },
  bottomTabIconActive: { opacity: 1 },
  bottomTabLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    fontFamily: FONT_FAMILY,
  },
  bottomTabLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },

  // ---- Card e layout ----
  cardGrid: { gap: 8, marginBottom: 18 },
  cleanCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  cleanCard: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...softShadow(colors),
  },
  cleanCardText: {
    color: colors.textMain,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  bodyContent: {
    padding: 16,
    paddingBottom: 48,
    maxWidth: 820,
    width: '100%',
    alignSelf: 'center',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
    gap: 8,
  },
  // Solo WEB: centra sulla pagina il blocco Manutenzione (titolo+bottone, filtro stato, tabella)
  // facendolo restringere alla larghezza naturale della tabella, cosi' filtro e bottone
  // risultano allineati con i bordi della tabella invece di occupare tutta la larghezza.
  manutenzioneWebOuter: {
    width: '100%',
    alignItems: 'center',
  },
  sectionHeaderTitle: {
    color: colors.textMain,
    fontSize: 19,
    fontWeight: '700',
  },
  aulaCard: {
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    ...softShadow(colors, 0.05, 6, 2),
  },
  aulaTitle: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: '700',
  },
  aulaDesc: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },

  // ---- Impostazioni ----
  settingsCard: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
    maxWidth: 720,
    width: '100%',
    ...softShadow(colors, 0.05, 6, 2),
  },
  settingsCardNarrow: { maxWidth: 720 },
  // Solo Web: allarga la card "Gestione Classi" così la griglia sotto usa lo spazio libero
  settingsCardClassiWideWeb: { maxWidth: 800 },
  settingsCardTitle: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  notificheGruppoTitolo: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingsMenuSottotitolo: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 16,
  },
  settingsMenuList: Platform.OS === 'web'
    ? { flexDirection: 'row', flexWrap: 'wrap', gap: 12, rowGap: 12, maxWidth: 820, width: '100%', alignSelf: isRTL ? 'flex-end' : 'flex-start' }
    : { gap: 10, maxWidth: 720, width: '100%', alignSelf: isRTL ? 'flex-end' : 'flex-start' },
  settingsMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    minHeight: 52,
    ...(Platform.OS === 'web' ? { width: '48.5%' } : {}),
    ...softShadow(colors, 0.05, 6, 2),
  },
  settingsMenuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  settingsMenuItemIcon: { fontSize: 20 },
  settingsMenuItemLabel: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: isRTL ? 'right' : 'left',
  },
  settingsMenuItemChevron: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '700',
    flexShrink: 0,
    marginLeft: isRTL ? 0 : 8,
    marginRight: isRTL ? 8 : 0,
  },
  resetPanelCard: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    maxWidth: 720,
    width: '100%',
    ...softShadow(colors, 0.05, 6, 2),
  },
  manualeUploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
  },

  // ---- Tabelle ----
  tableCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  // Wrapper per rendere le tabelle scorrevoli orizzontalmente quando lo spazio non basta
  // (soprattutto su Android/telefoni stretti), così le colonne non vengono più "mangiate".
  tableScrollWrap: {
    width: '100%',
    marginBottom: 16,
  },
  tableCardScrollable: {
    flex: 1,
    marginBottom: 0,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 2,
    borderColor: colors.primary,
  },
  tableHeaderCell: {
    color: colors.textMain,
    fontWeight: '700',
    fontSize: Platform.OS === 'web' ? 14 : 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    textAlign: isRTL ? 'right' : 'left',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  tableRowAlt: { backgroundColor: colors.altRow },
  tableCell: {
    color: colors.textSub,
    fontSize: Platform.OS === 'web' ? 14 : 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    textAlign: isRTL ? 'right' : 'left',
  },

  // ---- Profili: schede verticali (Android/iOS) ----
  profiloCardMobile: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 10,
  },
  profiloCardMobileNome: {
    color: colors.textMain,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
    textAlign: isRTL ? 'right' : 'left',
  },
  profiloCardMobileEmail: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 8,
    textAlign: isRTL ? 'right' : 'left',
  },
  profiloCardMobileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  profiloCardMobileLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  profiloCardMobileValue: {
    color: colors.textSub,
    fontSize: 13,
    flexShrink: 1,
    marginLeft: isRTL ? 0 : 8,
    marginRight: isRTL ? 8 : 0,
    textAlign: isRTL ? 'left' : 'right',
  },

  // ---- Colonne tabella ----
  tableColAula: { flex: 1.3, minWidth: 130 },
  tableColUtente: { flex: 1.1, minWidth: 100 },
  tableColTipo: { flex: 0.9, minWidth: 90 },
  tableColStato: { flex: 1, minWidth: 80 },
  tableColData: { flex: 0.9, minWidth: 80 },

  // ---- Badge stato ----
  statoBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  statoBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F8FAFC',
  },

  // ---- Checkbox ----
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    marginTop: 2,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxBoxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxCheckmark: {
    color: colors.primaryText,
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxLabel: {
    color: colors.textMain,
    fontSize: 14,
    fontWeight: '600',
  },
  label: {
    color: colors.textMain,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 4,
  },

  // ---- Modale Permessi (Impostazioni Avanzate) – tabella ----
  permTable: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 8,
  },
  permTableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 2,
    borderColor: colors.primary,
  },
  permTableHeaderCell: {
    color: colors.textMain,
    fontWeight: '700',
    fontSize: Platform.OS === 'web' ? 14 : 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    textAlign: isRTL ? 'right' : 'left',
  },
  permTableHeaderCellCenter: { textAlign: 'center' },
  permTableCategoriaRow: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: isRTL ? 0 : 3,
    borderRightWidth: isRTL ? 3 : 0,
    borderLeftColor: colors.primary,
    borderRightColor: colors.primary,
  },
  permTableCategoriaText: {
    color: colors.textMain,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    textAlign: isRTL ? 'right' : 'left',
  },
  permTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  permTableCellLabel: {
    color: colors.textMain,
    fontSize: Platform.OS === 'web' ? 14 : 13,
  },
  permTableCellToggle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: isRTL ? 0 : 10,
    paddingRight: isRTL ? 10 : 0,
  },
  permessoBadgeOverride: {
    backgroundColor: 'transparent',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  permessoBadgeOverrideText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  legendaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 18,
  },
  legendaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendaDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // ---- Fasce orarie ----
  fasceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  fasciaChip: {
    backgroundColor: colors.surface,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  fasciaSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  fasciaOccupata: {
    backgroundColor: colors.border,
    opacity: 0.5,
  },
  fasciaPassata: {
    backgroundColor: colors.surfaceAlt,
    opacity: 0.35,
    borderStyle: 'dashed',
  },
  fasciaText: {
    color: colors.textMain,
    fontSize: Platform.OS === 'web' ? 15 : 13,
    textAlign: 'center',
  },
  fasciaTextSelected: {
    color: colors.primaryText,
    fontWeight: '700',
  },
  fasciaTextDisabilitata: {
    color: colors.textMuted,
  },

  // ---- Calendar / Grid giorni ----
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
    justifyContent: Platform.OS === 'android' ? 'center' : 'flex-start',
  },
  dayButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayButtonFree: { backgroundColor: colors.success },
  dayButtonBusy: { backgroundColor: colors.danger },
  dayButtonPast: { backgroundColor: colors.surface, opacity: 0.4 },
  dayButtonPending: { backgroundColor: colors.warning },
  dayButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  dayButtonTextPast: { color: colors.textMuted },
  dayButtonTextPending: { color: colors.warningText },
  dayLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  // ---- Modali ----
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  modalContentFixed: {
    backgroundColor: colors.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '85%',
    padding: 18,
    flexDirection: 'column',
    maxWidth: 500,
    width: '100%',
    alignSelf: 'center',
    ...softShadow(colors, 0.22, 16, 6),
  },
  // Variante più larga, per modali con contenuti tabellari (es. Permessi avanzati)
  modalContentWide: {
    maxWidth: Platform.OS === 'web' ? 560 : 500,
  },
  modalHeaderFixed: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    color: colors.textMain,
    fontSize: Platform.OS === 'web' ? 18 : 18,
    fontWeight: '700',
    flex: 1,
    paddingRight: 8,
  },
  closeText: {
    color: colors.textMain,
    fontSize: Platform.OS === 'web' ? 19 : 18,
  },
  modalBodyScrollable: {
    flexGrow: 0,
    flexShrink: 1,
  },
  modalFooterFixed: {
    paddingTop: 14,
    borderTopWidth: 1,
    borderColor: colors.border,
    marginTop: 10,
  },

  // ---- Dropdown ----
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
    ...softShadow(colors, 0.15, 6, 3),
  },
  dropdownTriggerText: {
    color: colors.textMain,
    fontSize: Platform.OS === 'web' ? 14 : 14,
    fontWeight: '600',
  },
  dropdownArrow: {
    color: colors.textMuted,
    fontSize: 12,
  },
  dropdownOptionsList: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    maxWidth: 340,
    width: '90%',
    alignSelf: 'center',
  },
  // Overlay per dropdown aperti SOPRA una finestra modale già visibile
  // (es. "Scegli Classe" dentro "Modifica Profilo"). Non è un nuovo Modal
  // nativo: è una View assoluta dentro la modale genitore, così è sempre
  // garantito che appaia sopra e non "dietro" la finestra che la contiene.
  dropdownOverlayInModal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: 20,
    borderRadius: 16,
    zIndex: 50,
    elevation: 50,
  },
  dropdownOption: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  dropdownOptionActive: {
    backgroundColor: colors.primary,
  },
  dropdownOptionText: {
    color: colors.textMain,
    fontSize: Platform.OS === 'web' ? 15 : 15,
  },
  dropdownOptionTextActive: {
    color: colors.primaryText,
    fontWeight: '700',
  },

  // ---- Gestione prenotazioni ----
  gestioneListMeta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  btnApprove: {
    backgroundColor: colors.success,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  btnReject: {
    backgroundColor: colors.danger,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  btnDelete: {
    backgroundColor: colors.moveBtn,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  btnText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 12,
  },

  // ---- Calendario righe ----
  calRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 7,
  },
  calRowText: {
    color: colors.textSub,
    fontSize: 13,
    flex: 1,
    paddingRight: 8,
  },
  calRowAula: {
    color: colors.textMain,
    fontWeight: '700',
  },
  calRowMia: {
    color: colors.primary,
    fontWeight: '700',
  },
  calRowOccupata: {
    color: colors.textMuted,
    fontWeight: '700',
  },
  calDeleteBtn: {
    backgroundColor: colors.moveBtn,
    width: 27,
    height: 27,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDeleteBtnText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },

  // ---- Storico / Diario ----
  storicoBlocco: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    marginBottom: 16,
    gap: 6,
  },
  storicoRiga: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  storicoLabel: {
    color: colors.textMuted,
    fontSize: 12,
  },
  storicoValore: {
    color: colors.textMain,
    fontSize: 12,
    fontWeight: '600',
  },
  diarioBlocco: { marginTop: 8 },
  diarioVoce: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    gap: 2,
  },
  diarioVoceNonLetta: {
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    ...softShadow(colors, 0.12, 4, 2),
  },
  diarioVoceLetta: { opacity: 0.68 },
  diarioVoceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  diarioAutore: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  diarioAutoreLetta: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  diarioPallino: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  diarioTimestamp: {
    color: colors.textMuted,
    fontSize: 11,
  },
  diarioTesto: {
    color: colors.textSub,
    fontSize: 13,
  },
  diarioVuoto: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 12,
  },

  // ---- Bottoni piccoli ----
  smallMoveBtn: {
    backgroundColor: colors.moveBtn,
    paddingHorizontal: 9,
    paddingVertical: 9,
    borderRadius: 10,
  },
  smallEditBtn: {
    backgroundColor: colors.border,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 10,
  },
  smallDeleteBtn: {
    backgroundColor: colors.danger,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 10,
  },
  editToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  editToggleBtnText: {
    color: colors.primaryText,
    fontWeight: '600',
    fontSize: 12,
  },

  // ---- Add button ----
  addButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
  },
  addButtonText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 14,
  },

  // ---- Tabs ----
  tabButton: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabButtonText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  tabButtonTextActive: {
    color: colors.primaryText,
    fontWeight: '700',
  },

  // ---- Filtri (chip) ----
  filterChip: {
    backgroundColor: colors.surface,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    color: colors.textMain,
    fontSize: 12,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: colors.primaryText,
    fontWeight: '700',
  },

  // ---- Month tabs ----
  monthTabChip: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  monthTabChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  monthTabChipText: {
    color: colors.textMain,
    fontSize: 13,
    fontWeight: '600',
  },
  monthTabChipTextActive: {
    color: colors.primaryText,
    fontWeight: '700',
  },

  // ---- Speciali ----
  specialiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  // Solo Android: riga che affianca "Speciali" e il selettore del mese, 50/50
  specialiMeseRowAndroid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  specialiButtonAndroidHalf: {
    flex: 1,
    justifyContent: 'center',
    marginBottom: 0,
    alignSelf: 'auto',
  },
  dropdownTriggerAndroidHalf: {
    flex: 1,
    marginBottom: 0,
  },
  // Solo WEB: riga che affianca "Speciali" e il selettore del mese, restringendo
  // quest'ultimo alla sua larghezza naturale invece di occupare tutta la riga.
  specialiMeseRowWeb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  specialiButtonWebRow: {
    marginBottom: 0,
  },
  dropdownTriggerWebRow: {
    marginBottom: 0,
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 200,
  },
  specialiButtonText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 13,
  },
  specialiButtonBadge: {
    backgroundColor: colors.danger,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  specialiButtonBadgeText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11,
  },

  // ---- Link "Indietro" ----
  backLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backLinkText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },

  // ---- Esportazione / Excel ----
  excelTable: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  excelRowHeader: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    borderBottomWidth: 1,
    borderColor: colors.moveBtn,
  },
  excelCellHeader: {
    color: colors.textMain,
    fontWeight: '700',
    padding: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  excelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: colors.surface,
  },
  excelRowEven: { backgroundColor: colors.bg },
  excelRowOdd: { backgroundColor: colors.altRow },
  excelCell: {
    color: colors.textSub,
    padding: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  excelDeleteBtn: {
    backgroundColor: colors.danger,
    padding: 7,
    borderRadius: 8,
    alignItems: 'center',
    margin: 4,
  },
  excelDeleteText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },

  // ---- Tabella utenti compatta (solo Android, sezione Impostazioni > Blocca) ----
  compactHintText: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  compactUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 10,
  },
  compactUserName: {
    color: colors.textMain,
    fontWeight: '700',
    fontSize: 14,
  },
  compactUserEmail: {
    color: colors.textSub,
    fontSize: 12,
    marginTop: 2,
  },
  compactUserExpandIcon: {
    color: colors.textMuted,
    fontSize: 12,
  },
  compactUserDetails: {
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  compactUserDetailRow: {
    color: colors.textSub,
    fontSize: 13,
  },

  // ---- Date picker ----
  datePickerButton: {
    backgroundColor: colors.surface,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  datePickerButtonText: {
    color: colors.primary,
    fontSize: 15,
  },

  // ---- Campi dinamici (partecipanti) ----
  dynamicFieldRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  removeFieldBtn: {
    backgroundColor: colors.danger,
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFieldBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    padding: 11,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  addFieldBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },

  // ---- Ripetizione ----
  ripetizioneRiepilogo: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 6,
    fontStyle: 'italic',
  },
  avvisoSpeciale: {
    backgroundColor: 'rgba(220,38,38,0.12)',
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  avvisoSpecialeTesto: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },

  // ---- Testi informativi ----
  infoText: {
    color: colors.textSub,
    fontSize: Platform.OS === 'web' ? 15 : 13,
    marginTop: 2,
  },
  infoTextSmall: {
    color: colors.textMuted,
    fontSize: 11,
  },
  blockedText: {
    color: colors.danger,
    textAlign: 'center',
    marginBottom: 12,
    fontSize: 15,
  },

  // ---- Download Android banner ----
  androidDownloadBanner: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  androidDownloadBannerTitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 8,
    textAlign: 'center',
  },
  androidDownloadBannerButton: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },

  // ---- App name ----
  appName: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
    letterSpacing: 0.5,
  },
  appNameSmall: {
    color: colors.primary,
    fontSize: Platform.OS === 'web' ? 17 : 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontFamily: FONT_FAMILY,
    marginTop: Platform.OS === 'web' ? 5 : 3,
    textAlign: 'center',
  },

  // ---- Verifica email ----
  verifyTitle: {
    color: colors.textMain,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  verifyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },

  // ---- Utenti ----
  utentiColNome: { flex: 1, minWidth: 130 },
  utentiColEmail: { flex: 2.3, minWidth: 200 },
  utentiColStato: { flex: 1.1, minWidth: 130 },
  utentiAzioneRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  utentiAzioneBtn: {
    backgroundColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
  },
  utentiAzioneBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  utentiAzioneDeleteBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utentiAzioneDeleteBtnText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },

  // ---- Riga tra due elementi (rowBetween) ----
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
    flexWrap: 'wrap',
    gap: 8,
  },

  // ---- Form row ----
  formRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
    alignItems: 'center',
  },

  // ---- Griglia schede Classi (Impostazioni > Classi) ----
  classiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  classeCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 92,
    alignItems: 'center',
    gap: 8,
  },
  classeCardNome: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: '700',
  },
  classeCardAzioni: {
    flexDirection: 'row',
    gap: 6,
  },
  classeCardBtnModifica: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  classeCardBtnModificaText: {
    color: colors.textMain,
    fontSize: 11,
    fontWeight: '700',
  },
  classeCardBtnRimuovi: {
    backgroundColor: colors.danger,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  classeCardBtnRimuoviText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

const qrStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: 320,
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
    color: '#1a1a1a',
  },
  choiceBtn: {
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  choiceBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  closeBtn: {
    marginTop: 8,
    paddingVertical: 8,
  },
  closeBtnText: {
    color: '#888',
    fontSize: 14,
  },
  qrImage: {
    width: 260,
    height: 260,
    marginBottom: 12,
  },
  hint: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginBottom: 8,
  },
});