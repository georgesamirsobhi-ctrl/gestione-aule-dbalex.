import DateTimePicker from '@react-native-community/datetimepicker';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { auth, db } from '../config/firebaseConfig';

const SEZIONI_INIZIALI = ['Scuola Base', 'Scuola Media', 'CFP', 'Comuni'];
const FASCE_ORARIE = [
  '08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00',
  '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00',
  '18:00-19:00', '19:00-20:00', '20:00-21:00', '21:00-22:00'
];
const MESI_MASSIMI_PRENOTAZIONE = 2;

// Configurazione EmailJS (gratuita, nessuna carta di credito richiesta).
// Vedi la guida per ottenere questi 3 valori dal tuo account emailjs.com.
const EMAILJS_SERVICE_ID = 'service_559jvp8';
const EMAILJS_TEMPLATE_ID = 'template_iqyqv3r';
const EMAILJS_PUBLIC_KEY = 'P_KoMJyLfM-f9X41s';

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
  return `${mesi[mese] || mese} ${anno}`;
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
      navPanoramica: 'Panoramica',
      navUtenti: 'Utenti',
      aggiungiSezione: '+ Aggiungi Sezione',
      nomeNuovaSezione: 'Nome nuova sezione',
      elimina: '✕',
      modifica: 'Modifica',
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
      aggiungiUtente: '+ Aggiungi Utente',
      notaUtenteManuale: "Nota: L'aggiunta manuale inserisce l'utente nel database per la gestione dei ruoli. L'utente deve comunque registrarsi e creare una password.",
      emailVerificata: '✓ Email verificata',
      emailNonVerificataBadge: '✕ Email non verificata',
      cambiaRuolo: 'Cambia Ruolo',
      aggiungiDominio: '+ Aggiungi Dominio',
      nessunDominio: 'Nessun dominio impostato: la registrazione è aperta a qualsiasi email.',
      rimuovi: '✕',
      dataMaxMesi: (mesi) => `Data (max ${mesi} mesi da oggi):`,
      fasceOrarie: 'Fasce Orarie (selezione multipla):',
      motivoUso: "Motivo dell'uso:",
      motivoObbligatorio: 'Motivo (obbligatorio)',
      nomeClasse: 'Nome della classe:',
      classeObbligatoriaCFP: 'Classe (obbligatorio per CFP)',
      nomiPartecipanti: 'Nomi dei partecipanti:',
      aggiungiPartecipante: '+ Aggiungi partecipante',
      confermaPrenotazione: 'Conferma prenotazione',
      modificaAula: 'Modifica Aula',
      nuovaAula: 'Nuova Aula',
      salvaModifiche: 'Salva Modifiche',
      creaAula: 'Crea Aula',
      nomeAula: 'Nome Aula',
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
      inserisciNomeCapienza: "Inserisci nome e capienza dell'aula.",
      eliminareAulaConferma: "Eliminare questa aula? Le eventuali prenotazioni collegate resteranno storicizzate.",
      nonPuoiEliminareTuoAccount: 'Non puoi eliminare il tuo stesso account.',
      eliminareUtenteConferma: 'Eliminare questo utente?',
      eliminareSezioneConferma: "Eliminare questa sezione? Le aule ed eventuali prenotazioni collegate resteranno storicizzate.",
      emailGiaRegistrataDettaglio: 'Questo indirizzo email esiste già in Firebase Authentication.',
      nessunUtenteAutenticato: 'Nessun utente autenticato al momento.',
      compilaMotivoFascia: 'Compila il motivo e seleziona almeno una fascia oraria.',
      classeObbligatoriaMessaggio: 'Il nome della classe è obbligatorio per le aule CFP.',
      inserisciNomeEmail: 'Inserisci nome ed email.'
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
      navPanoramica: 'نظرة عامة',
      navUtenti: 'المستخدمون',
      aggiungiSezione: '+ إضافة قسم',
      nomeNuovaSezione: 'اسم القسم الجديد',
      elimina: '✕',
      modifica: 'تعديل',
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
      aggiungiUtente: '+ إضافة مستخدم',
      notaUtenteManuale: "ملاحظة: الإضافة اليدوية تدخل المستخدم في قاعدة البيانات لإدارة الأدوار. يجب على المستخدم التسجيل وإنشاء كلمة مرور.",
      emailVerificata: '✓ تم التحقق من البريد',
      emailNonVerificataBadge: '✕ لم يتم التحقق من البريد',
      cambiaRuolo: 'تغيير الدور',
      aggiungiDominio: '+ إضافة نطاق',
      nessunDominio: 'لا توجد نطاقات محددة: التسجيل متاح لأي بريد إلكتروني.',
      rimuovi: '✕',
      dataMaxMesi: (mesi) => `التاريخ (الحد الأقصى ${mesi} أشهر من اليوم):`,
      fasceOrarie: 'الفترات الزمنية (تحديد متعدد):',
      motivoUso: 'سبب الاستخدام:',
      motivoObbligatorio: 'السبب (إلزامي)',
      nomeClasse: 'اسم الصف:',
      classeObbligatoriaCFP: 'الصف (إلزامي لـ CFP)',
      nomiPartecipanti: 'أسماء المشاركين:',
      aggiungiPartecipante: '+ إضافة مشارك',
      confermaPrenotazione: 'تأكيد الحجز',
      modificaAula: 'تعديل القاعة',
      nuovaAula: 'قاعة جديدة',
      salvaModifiche: 'حفظ التعديلات',
      creaAula: 'إنشاء قاعة',
      nomeAula: 'اسم القاعة',
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
      inserisciNomeCapienza: 'أدخل اسم وسعة القاعة.',
      eliminareAulaConferma: 'حذف هذه القاعة؟ ستظل أي حجوزات مرتبطة محفوظة في السجل.',
      nonPuoiEliminareTuoAccount: 'لا يمكنك حذف حسابك الخاص.',
      eliminareUtenteConferma: 'هل تريد حذف هذا المستخدم؟',
      eliminareSezioneConferma: 'حذف هذا القسم؟ ستظل القاعات والحجوزات المرتبطة محفوظة في السجل.',
      emailGiaRegistrataDettaglio: 'هذا البريد الإلكتروني مسجل بالفعل في Firebase Authentication.',
      nessunUtenteAutenticato: 'لا يوجد مستخدم مسجل الدخول حالياً.',
      compilaMotivoFascia: 'يرجى كتابة السبب واختيار فترة زمنية واحدة على الأقل.',
      classeObbligatoriaMessaggio: 'اسم الصف إلزامي لقاعات CFP.',
      inserisciNomeEmail: 'أدخل الاسم والبريد الإلكتروني.'
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

// Funzione Helper per generare la palette colori chiara o scura
const getThemeColors = (isDark) => ({
  bg: isDark ? '#0B1220' : '#F6F7FB',
  surface: isDark ? '#161F32' : '#FFFFFF',
  surfaceAlt: isDark ? '#1D2740' : '#FBFBFE',
  border: isDark ? '#2A3550' : '#E7E9F2',
  textMain: isDark ? '#F5F7FA' : '#111827',
  textMuted: isDark ? '#94A3B8' : '#6B7280',
  textSub: isDark ? '#CBD5E1' : '#374151',
  primary: '#C9A227',
  primaryText: '#111827',
  danger: isDark ? '#F87171' : '#DC2626',
  success: isDark ? '#34D399' : '#059669',
  moveBtn: isDark ? '#3A4762' : '#CBD5E1',
  altRow: isDark ? '#131B2E' : '#F5F6FA',
  overlay: isDark ? 'rgba(4,8,16,0.72)' : 'rgba(15,23,42,0.45)',
  placeholder: isDark ? '#8E9AAF' : '#6B7280',
  shadow: isDark ? '#000000' : '#1E293B'
});

export default function App() {
  const [lang, setLang] = useState('it');
  const [isDarkMode, setIsDarkMode] = useState(true); // Stato per il tema Dark/Light
  const isRTL = lang === 'ar';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nome, setNome] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);

  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState('utente');
  const [userName, setUserName] = useState('');
  const [blockedMessage, setBlockedMessage] = useState('');
  const [emailNonVerificata, setEmailNonVerificata] = useState(false);

  const [sezioneSelezionata, setSezioneSelezionata] = useState(null);
  const [vistaAttiva, setVistaAttiva] = useState('home');

  const [aule, setAule] = useState([]);
  const [prenotazioni, setPrenotazioni] = useState([]);
  const [dominiLista, setDominiLista] = useState([]);
  const [utentiLista, setUtentiLista] = useState([]);
  const [sezioniLista, setSezioniLista] = useState([]);
  const [nuovaSezioneNome, setNuovaSezioneNome] = useState('');

  const [sezioneInModifica, setSezioneInModifica] = useState(null);
  const [nomeSezioneInModifica, setNomeSezioneInModifica] = useState('');
  const [modalModificaSezione, setModalModificaSezione] = useState(false);

  const [filtroUtente, setFiltroUtente] = useState('');
  const [filtroAula, setFiltroAula] = useState('');
  const [filtroData, setFiltroData] = useState('');

  const [calendarioMeseSelezionato, setCalendarioMeseSelezionato] = useState(null);
  const [panoramicaMeseSelezionato, setPanoramicaMeseSelezionato] = useState(null);
  const [gestioneMeseSelezionato, setGestioneMeseSelezionato] = useState(null);

  const [filtroStatoGestione, setFiltroStatoGestione] = useState('In attesa');

  const [aulaInPrenotazione, setAulaInPrenotazione] = useState(null);
  const [dataPrenotazioneObj, setDataPrenotazioneObj] = useState(new Date());
  const [dataPrenotazione, setDataPrenotazione] = useState(new Date().toISOString().split('T')[0]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [fasceSelezionate, setFasceSelezionate] = useState([]);
  const [motivo, setMotivo] = useState('');
  const [classe, setClasse] = useState('');
  const [partecipanti, setPartecipanti] = useState(['']);

  const [modalNuovaAula, setModalNuovaAula] = useState(false);
  const [aulaInModifica, setAulaInModifica] = useState(null);
  const [nomeNuovaAula, setNomeNuovaAula] = useState('');
  const [capienzaNuovaAula, setCapienzaNuovaAula] = useState('');

  const [utentiSubTab, setUtentiSubTab] = useState('lista');
  const [nuovoUtenteNome, setNuovoUtenteNome] = useState('');
  const [nuovoUtenteEmail, setNuovoUtenteEmail] = useState('');
  const [nuovoDominio, setNuovoDominio] = useState('');

  // Generazione stili e colori reattiva basata sul tema selezionato
  const colors = getThemeColors(isDarkMode);
  const styles = getDynamicStyles(colors);
  
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

  // Invio email tramite l'estensione Firebase "Trigger Email" (firestore-send-email):
  // basta scrivere un documento nella collection 'mail' con questo formato esatto,
  // l'estensione (una volta installata e configurata in Firebase Console) pensa lei
  // a spedire davvero l'email tramite le credenziali SMTP che le fornirai.
  // Invio email tramite EmailJS: nessun piano Blaze, nessuna estensione Firebase,
  // nessuna carta di credito. Basta un account gratuito su emailjs.com.
  const inviaEmailReale = async (destinatarioEmail, oggetto, messaggio) => {
    if (EMAILJS_SERVICE_ID === 'il_tuo_service_id') {
      console.warn('EmailJS non ancora configurato: nessuna email inviata a', destinatarioEmail, '| Oggetto:', oggetto);
      return;
    }
    try {
      const risposta = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: EMAILJS_SERVICE_ID,
          template_id: EMAILJS_TEMPLATE_ID,
          user_id: EMAILJS_PUBLIC_KEY,
          template_params: {
            to_email: destinatarioEmail,
            subject: oggetto,
            message: messaggio
          }
        })
      });
      if (risposta.ok) {
        console.log('Email inviata correttamente a', destinatarioEmail);
      } else {
        const testoErrore = await risposta.text();
        console.error('EmailJS ha risposto con errore:', risposta.status, testoErrore);
      }
    } catch (error) {
      console.error("Errore nell'invio dell'email:", error);
    }
  };

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

  const handleAuth = async () => {
    if (!email || !password || (isRegistering && !nome)) {
      mostraAlert(t('attenzione', lang), t('compilaTuttiICampi', lang));
      return;
    }
    setLoading(true);
    setBlockedMessage('');

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

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
      if (isRegistering) {
        const res = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPassword);
        firebaseUser = res.user;
        await sendEmailVerification(firebaseUser);
        await setDoc(doc(db, 'users', firebaseUser.uid), { nome: nome.trim(), email: cleanEmail, role: 'utente', emailVerified: false });
        setUserName(nome.trim());
        setUserRole('utente');
        await inviaEmailReale(cleanEmail, 'Benvenuto', 'Account creato. Controlla la tua email per confermare l\'indirizzo.');
      } else {
        const res = await signInWithEmailAndPassword(auth, cleanEmail, cleanPassword);
        firebaseUser = res.user;
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          setUserRole(userDoc.data().role || 'utente');
          setUserName(userDoc.data().nome || cleanEmail);
        } else {
          await setDoc(doc(db, 'users', firebaseUser.uid), { nome: cleanEmail, email: cleanEmail, role: 'utente', emailVerified: firebaseUser.emailVerified });
          setUserName(cleanEmail);
          setUserRole('utente');
        }
      }

      setUser(firebaseUser);

      if (!firebaseUser.emailVerified) {
        setEmailNonVerificata(true);
      } else {
        setEmailNonVerificata(false);
        try { await updateDoc(doc(db, 'users', firebaseUser.uid), { emailVerified: true }); } catch (e) {}
        caricaDatiGenerali();
      }
    } catch (err: any) {
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

  const reinviaEmailVerifica = async () => {
    if (!auth.currentUser) {
      mostraAlert(t('errore', lang), t('nessunUtenteAutenticato', lang));
      return;
    }
    try {
      await sendEmailVerification(auth.currentUser);
      mostraAlert('', t('emailInviataDiNuovo', lang));
    } catch (e: any) {
      mostraAlert(t('errore', lang), e.code + ': ' + e.message);
    }
  };

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
    } catch (e: any) {
      mostraAlert(t('errore', lang), e.message);
    }
  };

  const handleLogout = async () => {
    setUser(null);
    setUserRole('utente');
    setEmailNonVerificata(false);
    setSezioneSelezionata(null);
    setVistaAttiva('home');
    setEmail('');
    setPassword('');
    setNome('');
    try {
      await signOut(auth);
    } catch (e) {
      console.error('Errore logout:', e);
    }
  };

  const caricaDatiGenerali = async () => {
    try {
      let snapAule = await getDocs(collection(db, 'aule'));
      if (snapAule.empty) {
        const auleIniziali = [
          { nome: 'Aula Magna', capienza: '120', sezione: 'Scuola Base', ordine: 0 },
          { nome: 'Laboratorio 1', capienza: '25', sezione: 'Scuola Base', ordine: 1 },
          { nome: 'Aula 1A', capienza: '30', sezione: 'Scuola Media', ordine: 0 },
          { nome: 'Aula 2B', capienza: '28', sezione: 'Scuola Media', ordine: 1 },
          { nome: 'Officina Meccanica', capienza: '20', sezione: 'CFP', ordine: 0 },
          { nome: 'Lab Elettrico', capienza: '18', sezione: 'CFP', ordine: 1 },
          { nome: 'Sala Consiliare', capienza: '50', sezione: 'Comuni', ordine: 0 },
          { nome: 'Sala Polifunzionale', capienza: '80', sezione: 'Comuni', ordine: 1 }
        ];
        for (const a of auleIniziali) { await addDoc(collection(db, 'aule'), a); }
        snapAule = await getDocs(collection(db, 'aule'));
      }
      setAule(snapAule.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (a.ordine ?? 0) - (b.ordine ?? 0)));

      const snapPrenotazioni = await getDocs(collection(db, 'prenotazioni'));
      setPrenotazioni(snapPrenotazioni.docs.map(d => ({ id: d.id, ...d.data() })));

      const snapDomini = await getDocs(collection(db, 'allowed_domains'));
      setDominiLista(snapDomini.docs.map(d => ({ id: d.id, ...d.data() })));

      const snapUtenti = await getDocs(collection(db, 'users'));
      setUtentiLista(snapUtenti.docs.map(d => ({ id: d.id, ...d.data() })));

      let snapSezioni = await getDocs(collection(db, 'sezioni'));
      if (snapSezioni.empty) {
        for (let i = 0; i < SEZIONI_INIZIALI.length; i++) {
          await addDoc(collection(db, 'sezioni'), { nome: SEZIONI_INIZIALI[i], ordine: i });
        }
        snapSezioni = await getDocs(collection(db, 'sezioni'));
      }
      setSezioniLista(snapSezioni.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (a.ordine ?? 0) - (b.ordine ?? 0)));
    } catch (e) {
      console.log('Errore caricamento dati:', e);
    }
  };

  useEffect(() => {
    if (user && !emailNonVerificata) caricaDatiGenerali();
  }, [user, vistaAttiva, emailNonVerificata]);

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
    setPartecipanti(['']);
    setDataPrenotazione(new Date().toISOString().split('T')[0]);
    setDataPrenotazioneObj(new Date());
    setShowDatePicker(false);
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

  const haConflittoUtente = (data, fasce) => {
    return prenotazioni.some((p: any) =>
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
    if (sezioneSelezionata === 'CFP' && !classe.trim()) {
      mostraAlert(t('attenzione', lang), t('classeObbligatoriaMessaggio', lang));
      return;
    }
    // MODIFICATO: il conflitto di orario tra aule diverse non blocca più l'invio
    // della richiesta — l'utente riceve solo un avviso informativo, poi la
    // prenotazione viene comunque salvata e inoltrata al gestore.
    const conflitto = haConflittoUtente(dataPrenotazione, fasceSelezionate);
    try {
      await addDoc(collection(db, 'prenotazioni'), {
        aulaId: aulaInPrenotazione.id,
        aulaNome: aulaInPrenotazione.nome,
        sezione: sezioneSelezionata,
        data: dataPrenotazione,
        fasce: fasceSelezionate,
        motivo: motivo.trim(),
        classe: sezioneSelezionata === 'CFP' ? classe.trim() : '',
        partecipanti: partecipanti.map(p => p.trim()).filter(p => p !== ''),
        utenteNome: userName,
        utenteEmail: user.email,
        stato: 'In attesa'
      });
      chiudiModalePrenotazione();
      caricaDatiGenerali();
      if (conflitto) {
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

    const oggetto = approvata
      ? `Prenotazione approvata / تم قبول الحجز: ${aulaNome}`
      : `Prenotazione rifiutata / تم رفض الحجز: ${aulaNome}`;

    const corpoIt = approvata
      ? `La tua richiesta per l'aula "${aulaNome}" in data ${data} (${dettagliOrario}) è stata APPROVATA.`
      : `La tua richiesta per l'aula "${aulaNome}" in data ${data} (${dettagliOrario}) è stata RIFIUTATA.`;

    const corpoAr = approvata
      ? `تم قبول طلبك لحجز القاعة "${aulaNome}" بتاريخ ${data} (${dettagliOrario}).`
      : `تم رفض طلبك لحجز القاعة "${aulaNome}" بتاريخ ${data} (${dettagliOrario}).`;

    const corpo = `${corpoIt}\n\n---\n\n${corpoAr}`;

    await inviaEmailReale(utenteEmail, oggetto, corpo);
    caricaDatiGenerali();
  };

  const apriNuovaAula = () => {
    setAulaInModifica(null);
    setNomeNuovaAula('');
    setCapienzaNuovaAula('');
    setModalNuovaAula(true);
  };

  const apriModificaAula = (aula) => {
    setAulaInModifica(aula);
    setNomeNuovaAula(aula.nome);
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
          capienza: capienzaNuovaAula.trim()
        });
      } else {
        const auleSezione = aule.filter((a: any) => a.sezione === sezioneSelezionata);
        await addDoc(collection(db, 'aule'), {
          nome: nomeNuovaAula.trim(),
          capienza: capienzaNuovaAula.trim(),
          sezione: sezioneSelezionata,
          ordine: auleSezione.length
        });
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
      await deleteDoc(doc(db, 'aule', id));
      caricaDatiGenerali();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('eliminareAulaConferma', lang))) await esegui();
    } else {
      Alert.alert(t('conferma', lang), t('eliminareAulaConferma', lang), [{ text: t('annulla', lang) }, { text: t('elimina', lang), onPress: esegui }]);
    }
  };

  const cambiaRuoloUtente = async (uid, attualeRuolo) => {
    await updateDoc(doc(db, 'users', uid), { role: attualeRuolo === 'gestore' ? 'utente' : 'gestore' });
    caricaDatiGenerali();
  };

  const aggiungiUtenteManuale = async () => {
    if (!nuovoUtenteNome.trim() || !nuovoUtenteEmail.trim()) {
      mostraAlert(t('attenzione', lang), t('inserisciNomeEmail', lang));
      return;
    }
    await addDoc(collection(db, 'users'), {
      nome: nuovoUtenteNome.trim(),
      email: nuovoUtenteEmail.trim().toLowerCase(),
      role: 'utente'
    });
    setNuovoUtenteNome('');
    setNuovoUtenteEmail('');
    caricaDatiGenerali();
  };

  const eliminaUtente = async (id, targetEmail) => {
    if (targetEmail === user.email) {
      mostraAlert(t('attenzione', lang), t('nonPuoiEliminareTuoAccount', lang));
      return;
    }
    const esegui = async () => {
      await deleteDoc(doc(db, 'users', id));
      caricaDatiGenerali();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('eliminareUtenteConferma', lang))) await esegui();
    } else {
      Alert.alert(t('conferma', lang), t('eliminareUtenteConferma', lang), [{ text: t('annulla', lang) }, { text: t('elimina', lang), onPress: esegui }]);
    }
  };

  const aggiungiDominio = async () => {
    if (!nuovoDominio.trim()) return;
    await addDoc(collection(db, 'allowed_domains'), { domain: nuovoDominio.trim().toLowerCase().replace('@', '') });
    setNuovoDominio('');
    caricaDatiGenerali();
  };

  const rimuoviDominio = async (id) => {
    await deleteDoc(doc(db, 'allowed_domains', id));
    caricaDatiGenerali();
  };

  const aggiungiSezione = async () => {
    if (!nuovaSezioneNome.trim()) return;
    await addDoc(collection(db, 'sezioni'), {
      nome: nuovaSezioneNome.trim(),
      ordine: sezioniLista.length
    });
    setNuovaSezioneNome('');
    caricaDatiGenerali();
  };

  const apriModificaSezione = (sez) => {
    setSezioneInModifica(sez);
    setNomeSezioneInModifica(sez.nome);
    setModalModificaSezione(true);
  };

  const salvaSezioneModificata = async () => {
    if (!nomeSezioneInModifica.trim() || !sezioneInModifica) return;
    try {
      await updateDoc(doc(db, 'sezioni', sezioneInModifica.id), {
        nome: nomeSezioneInModifica.trim()
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

  const spostaSezione = async (index: number, direzione: 'su' | 'giu') => {
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

  const spostaAula = async (aulaId: string, direzione: 'su' | 'giu') => {
    const auleSezione = aule.filter((a: any) => a.sezione === sezioneSelezionata).sort((a: any, b: any) => (a.ordine ?? 0) - (b.ordine ?? 0));
    const index = auleSezione.findIndex((a: any) => a.id === aulaId);
    const targetIndex = direzione === 'su' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= auleSezione.length) return;

    const nuovaSottoLista = [...auleSezione];
    const temp = nuovaSottoLista[index];
    nuovaSottoLista[index] = nuovaSottoLista[targetIndex];
    nuovaSottoLista[targetIndex] = temp;

    const auleAggiornate = aule.map((a: any) => {
      const foundInSub = nuovaSottoLista.find((sub: any) => sub.id === a.id);
      if (foundInSub) {
        return { ...a, ordine: nuovaSottoLista.indexOf(foundInSub) };
      }
      return a;
    }).sort((a: any, b: any) => (a.ordine ?? 0) - (b.ordine ?? 0));

    setAule(auleAggiornate);

    try {
      for (let i = 0; i < nuovaSottoLista.length; i++) {
        await updateDoc(doc(db, 'aule', nuovaSottoLista[i].id), { ordine: i });
      }
    } catch (e) {
      console.error('Errore aggiornamento ordine aule:', e);
    }
  };

  if (!user) {
    return (
      <SafeAreaView style={[styles.container, isRTL && { direction: 'rtl' }]}>
        <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
        <View style={styles.authBox}>
          <View style={{ position: 'absolute', top: 20, ...(isRTL ? { left: 20 } : { right: 20 }), flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setIsDarkMode(!isDarkMode)}>
              <Text style={styles.langTextHeader}>{isDarkMode ? '☀️' : '🌙'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setLang(lang === 'it' ? 'ar' : 'it')}>
              <Text style={styles.langTextHeader}>{lang === 'it' ? 'العربية' : 'Italiano'}</Text>
            </TouchableOpacity>
          </View>
          <AppLogo style={{ width: 260, height: 90, alignSelf: 'center' }} />
          <Text style={styles.appName}>{t('appName', lang)}</Text>
          {blockedMessage ? <Text style={styles.blockedText}>{blockedMessage}</Text> : null}
          {isRegistering && <TextInput style={styles.input} placeholder={t('nomeCognome', lang)} placeholderTextColor={colors.placeholder} value={nome} onChangeText={setNome} />}
          <TextInput style={styles.input} placeholder={t('email', lang)} placeholderTextColor={colors.placeholder} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
          <TextInput style={styles.input} placeholder={t('password', lang)} placeholderTextColor={colors.placeholder} secureTextEntry value={password} onChangeText={setPassword} />
          <TouchableOpacity style={styles.primaryButton} onPress={handleAuth} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.buttonText}>{isRegistering ? t('registrati', lang) : t('accedi', lang)}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsRegistering(!isRegistering)}>
            <Text style={styles.switchAuthText}>{isRegistering ? t('haiAccountAccedi', lang) : t('registrati', lang)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (user && emailNonVerificata) {
    return (
      <SafeAreaView style={[styles.container, isRTL && { direction: 'rtl' }]}>
        <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
        <View style={styles.authBox}>
          <View style={{ position: 'absolute', top: 20, ...(isRTL ? { left: 20 } : { right: 20 }), flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setIsDarkMode(!isDarkMode)}>
              <Text style={styles.langTextHeader}>{isDarkMode ? '☀️' : '🌙'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setLang(lang === 'it' ? 'ar' : 'it')}>
              <Text style={styles.langTextHeader}>{lang === 'it' ? 'العربية' : 'Italiano'}</Text>
            </TouchableOpacity>
          </View>
          <AppLogo style={{ width: 260, height: 90, alignSelf: 'center' }} />
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
      </SafeAreaView>
    );
  }

  const maxCalendarDate = new Date();
  maxCalendarDate.setMonth(maxCalendarDate.getMonth() + MESI_MASSIMI_PRENOTAZIONE);

  const isGestore = userRole === 'gestore';
  const oggiStr = new Date().toISOString().split('T')[0];

  const AccessoNegato = () => (
    <View style={styles.bodyContent}>
      <Text style={styles.blockedText}>{t('accessoRiservato', lang)}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, isRTL && { direction: 'rtl' }]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      
      {/* Intestazione Principale con Pulsante Tema, Lingua e Logout */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ alignItems: 'flex-start' }}>
            <AppLogo style={{ width: 140, height: 45 }} />
            <Text style={styles.appNameSmall}>{t('appName', lang)}</Text>
          </View>
          <View>
            <Text style={styles.headerTitle}>{userName}</Text>
            <Text style={styles.headerSubtitle}>{t('ruolo', lang)}: <Text style={styles.roleGold}>{userRole === 'gestore' ? (lang === 'ar' ? 'مدير' : 'GESTORE') : (lang === 'ar' ? 'مستخدم' : 'UTENTE')}</Text></Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity style={styles.langBtnHeader} onPress={() => setIsDarkMode(!isDarkMode)}>
            <Text style={styles.langTextHeader}>{isDarkMode ? '☀️' : '🌙'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.langBtnHeader} onPress={() => setLang(lang === 'it' ? 'ar' : 'it')}>
            <Text style={styles.langTextHeader}>{lang === 'it' ? 'العربية' : 'Italiano'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.logoutText}>{t('esci', lang)}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => { setVistaAttiva('home'); setSezioneSelezionata(null); }}>
          <Text style={[styles.navItem, vistaAttiva === 'home' && styles.navActive]}>{t('navHome', lang)}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setVistaAttiva('calendario')}>
          <Text style={[styles.navItem, vistaAttiva === 'calendario' && styles.navActive]}>{t('navCalendario', lang)}</Text>
        </TouchableOpacity>
        {isGestore && (
          <>
            <TouchableOpacity onPress={() => setVistaAttiva('gestione')}>
              <Text style={[styles.navItem, vistaAttiva === 'gestione' && styles.navActive]}>{t('navGestione', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setVistaAttiva('panoramica')}>
              <Text style={[styles.navItem, vistaAttiva === 'panoramica' && styles.navActive]}>{t('navPanoramica', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setVistaAttiva('utenti')}>
              <Text style={[styles.navItem, vistaAttiva === 'utenti' && styles.navActive]}>{t('navUtenti', lang)}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={{ flex: 1 }}>
        {vistaAttiva === 'home' && !sezioneSelezionata && (
          <ScrollView contentContainerStyle={styles.bodyContent}>
            <View style={styles.cardGrid}>
              {sezioniLista.map((sez: any, idx: number) => (
                <View key={sez.id} style={styles.cleanCardRow}>
                  <TouchableOpacity style={styles.cleanCard} onPress={() => { setSezioneSelezionata(sez.nome); setVistaAttiva('aule'); }}>
                    <Text style={styles.cleanCardText}>{sez.nome}</Text>
                  </TouchableOpacity>
                  {isGestore && (
                    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                      <TouchableOpacity style={styles.smallMoveBtn} onPress={() => spostaSezione(idx, 'su')} disabled={idx === 0}>
                        <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>▲</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallMoveBtn} onPress={() => spostaSezione(idx, 'giu')} disabled={idx === sezioniLista.length - 1}>
                        <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>▼</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallEditBtn} onPress={() => apriModificaSezione(sez)}>
                        <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('modifica', lang)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallDeleteBtn} onPress={() => eliminaSezione(sez.id)}>
                        <Text style={styles.btnText}>{t('elimina', lang)}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
            </View>
            {isGestore && (
              <View style={styles.formRow}>
                <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder={t('nomeNuovaSezione', lang)} placeholderTextColor={colors.placeholder} value={nuovaSezioneNome} onChangeText={setNuovaSezioneNome} />
                <TouchableOpacity style={styles.addButton} onPress={aggiungiSezione}>
                  <Text style={styles.addButtonText}>{t('aggiungiSezione', lang)}</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        )}

        {vistaAttiva === 'aule' && sezioneSelezionata && (
          <ScrollView contentContainerStyle={styles.bodyContent}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionHeaderTitle}>{sezioneSelezionata}</Text>
              {isGestore && (
                <TouchableOpacity style={styles.addButton} onPress={apriNuovaAula}>
                  <Text style={styles.addButtonText}>{t('aggiungiAula', lang)}</Text>
                </TouchableOpacity>
              )}
            </View>
            {aule.filter((a: any) => a.sezione === sezioneSelezionata).sort((a: any, b: any) => (a.ordine ?? 0) - (b.ordine ?? 0)).map((aula: any, idx: number, arr: any[]) => (
              <View key={aula.id} style={styles.aulaCard}>
                <View>
                  <Text style={styles.aulaTitle}>{aula.nome}</Text>
                  <Text style={styles.aulaDesc}>{t('capienza', lang)}: {aula.capienza}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  {isGestore && (
                    <>
                      <TouchableOpacity style={styles.smallMoveBtn} onPress={() => spostaAula(aula.id, 'su')} disabled={idx === 0}>
                        <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>▲</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallMoveBtn} onPress={() => spostaAula(aula.id, 'giu')} disabled={idx === arr.length - 1}>
                        <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>▼</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallEditBtn} onPress={() => apriModificaAula(aula)}>
                        <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('modifica', lang)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallDeleteBtn} onPress={() => eliminaAula(aula.id)}>
                        <Text style={styles.btnText}>{t('elimina', lang)}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  <TouchableOpacity style={styles.primaryButtonSmall} onPress={() => setAulaInPrenotazione(aula)}>
                    <Text style={styles.buttonTextSmall}>{t('prenota', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {vistaAttiva === 'calendario' && (() => {
          const prenotazioniValide = prenotazioni.filter((p: any) => p.stato !== 'Rifiutata');
          const passate = prenotazioniValide.filter((p: any) => p.data < oggiStr).sort((a: any, b: any) => b.data.localeCompare(a.data));
          const attive = prenotazioniValide.filter((p: any) => p.data >= oggiStr).sort((a: any, b: any) => b.data.localeCompare(a.data));

          const mesiAttivi = Array.from(new Set(attive.map((p: any) => p.data.substring(0, 7)))).sort();
          const meseCorrenteStr = oggiStr.substring(0, 7);
          const selezioneAttiva = calendarioMeseSelezionato !== null 
            ? calendarioMeseSelezionato 
            : (mesiAttivi.includes(meseCorrenteStr) ? meseCorrenteStr : (mesiAttivi[0] || 'passate'));

          const prenotazioniVisualizzate = selezioneAttiva === 'passate' 
            ? passate 
            : attive.filter((p: any) => p.data.substring(0, 7) === selezioneAttiva);

          return (
            <ScrollView contentContainerStyle={styles.bodyContent}>
              <Text style={styles.sectionHeaderTitle}>{t('calendarioPubblico', lang)}</Text>
              
              <View style={styles.tabsRow}>
                {mesiAttivi.map((ym: any) => (
                  <TouchableOpacity 
                    key={ym} 
                    style={[styles.tabButton, selezioneAttiva === ym && styles.tabButtonActive]} 
                    onPress={() => setCalendarioMeseSelezionato(ym)}
                  >
                    <Text style={[styles.tabButtonText, selezioneAttiva === ym && styles.tabButtonTextActive]}>
                      {formattaMeseAnno(ym, lang)}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity 
                  style={[styles.tabButton, selezioneAttiva === 'passate' && styles.tabButtonActive]} 
                  onPress={() => setCalendarioMeseSelezionato('passate')}
                >
                  <Text style={[styles.tabButtonText, selezioneAttiva === 'passate' && styles.tabButtonTextActive]}>
                    {t('prenotazioniPassate', lang, passate.length)}
                  </Text>
                </TouchableOpacity>
              </View>

              {prenotazioniVisualizzate.length === 0 && (
                <Text style={styles.infoText}>{t('nessunaPrenotazione', lang)}</Text>
              )}

              {prenotazioniVisualizzate.map((p: any) => {
                const isMia = p.utenteEmail === user?.email;
                return (
                  <View key={p.id} style={styles.calRow}>
                    <Text style={styles.calRowText} numberOfLines={1} ellipsizeMode="tail">
                      <Text style={styles.calRowAula}>{p.aulaNome}</Text>
                      {'  '}({p.sezione}) · {p.data} · {p.fasce.join(', ')} —{' '}
                      <Text style={isMia ? styles.calRowMia : styles.calRowOccupata}>
                        {isMia ? t('tua', lang, p.stato === 'In attesa' ? t('inAttesa', lang) : p.stato === 'Approvata' ? t('approvata', lang) : p.stato === 'Rifiutata' ? t('rifiutata', lang) : p.stato) : t('occupata', lang)}
                      </Text>
                    </Text>
                    {isMia && (
                      <TouchableOpacity style={styles.calDeleteBtn} onPress={() => eliminaPrenotazione(p.id)}>
                        <Text style={[styles.calDeleteBtnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          );
        })()}

        {vistaAttiva === 'gestione' && (isGestore ? (() => {
          const prenotazioniStatoFiltrate = prenotazioni.filter((p: any) =>
            filtroStatoGestione === 'Tutte' ? true : p.stato === filtroStatoGestione
          );
          const passate = prenotazioniStatoFiltrate.filter((p: any) => p.data < oggiStr).sort((a: any, b: any) => b.data.localeCompare(a.data));
          const attive = prenotazioniStatoFiltrate.filter((p: any) => p.data >= oggiStr).sort((a: any, b: any) => b.data.localeCompare(a.data));

          const mesiAttivi = Array.from(new Set(attive.map((p: any) => p.data.substring(0, 7)))).sort();
          const meseCorrenteStr = oggiStr.substring(0, 7);
          const selezioneAttiva = gestioneMeseSelezionato !== null 
            ? gestioneMeseSelezionato 
            : (mesiAttivi.includes(meseCorrenteStr) ? meseCorrenteStr : (mesiAttivi[0] || 'passate'));

          const prenotazioniVisualizzate = selezioneAttiva === 'passate' 
            ? passate 
            : attive.filter((p: any) => p.data.substring(0, 7) === selezioneAttiva);

          return (
            <ScrollView contentContainerStyle={styles.bodyContent}>
              <Text style={styles.sectionHeaderTitle}>{t('navGestione', lang)}</Text>
              
              <View style={styles.tabsRow}>
                {[t('inAttesa', lang), t('approvata', lang), t('rifiutata', lang), t('tutte', lang)].map((stato, idx) => {
                  const valOriginale = ['In attesa', 'Approvata', 'Rifiutata', 'Tutte'][idx];
                  return (
                    <TouchableOpacity key={valOriginale} style={[styles.tabButton, filtroStatoGestione === valOriginale && styles.tabButtonActive]} onPress={() => setFiltroStatoGestione(valOriginale)}>
                      <Text style={[styles.tabButtonText, filtroStatoGestione === valOriginale && styles.tabButtonTextActive]}>{stato}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.tabsRow}>
                {mesiAttivi.map((ym: any) => (
                  <TouchableOpacity 
                    key={ym} 
                    style={[styles.tabButton, selezioneAttiva === ym && styles.tabButtonActive]} 
                    onPress={() => setGestioneMeseSelezionato(ym)}
                  >
                    <Text style={[styles.tabButtonText, selezioneAttiva === ym && styles.tabButtonTextActive]}>
                      {formattaMeseAnno(ym, lang)}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity 
                  style={[styles.tabButton, selezioneAttiva === 'passate' && styles.tabButtonActive]} 
                  onPress={() => setGestioneMeseSelezionato('passate')}
                >
                  <Text style={[styles.tabButtonText, selezioneAttiva === 'passate' && styles.tabButtonTextActive]}>
                    {t('prenotazioniPassate', lang, passate.length)}
                  </Text>
                </TouchableOpacity>
              </View>

              {prenotazioniVisualizzate.length === 0 && (
                <Text style={styles.infoText}>{t('nessunaPrenotazione', lang)}</Text>
              )}

              <View style={styles.gestioneGrid}>
                {prenotazioniVisualizzate.map((p: any) => (
                  <View key={p.id} style={styles.gestoreCard}>
                    <Text style={styles.aulaTitle}>{p.aulaNome} - {p.sezione}</Text>
                    <Text style={styles.infoText}>{t('utente', lang)}: {p.utenteNome} ({p.utenteEmail})</Text>
                    <Text style={styles.infoText}>{t('data', lang)}: {p.data} | {t('ore', lang)}: {p.fasce.join(', ')}</Text>
                    <Text style={styles.infoText}>{t('motivo', lang)}: {p.motivo}</Text>
                    {p.classe ? <Text style={styles.infoText}>{t('classe', lang)}: {p.classe}</Text> : null}
                    {p.partecipanti && p.partecipanti.length > 0 && (
                      <Text style={styles.infoText}>{t('partecipanti', lang)}: {p.partecipanti.join(', ')}</Text>
                    )}
                    <Text style={[styles.infoText, { fontWeight: 'bold', color: p.stato === 'Approvata' ? colors.success : p.stato === 'Rifiutata' ? colors.danger : colors.primary }]}>
                      {t('stato', lang)}: {p.stato === 'In attesa' ? t('inAttesa', lang) : p.stato === 'Approvata' ? t('approvata', lang) : p.stato === 'Rifiutata' ? t('rifiutata', lang) : p.stato}
                    </Text>
                    <View style={styles.actionRow}>
                      {p.stato === 'In attesa' && (
                        <>
                          <TouchableOpacity style={styles.btnApprove} onPress={() => cambiaStatoPrenotazione(p.id, 'Approvata', p.utenteEmail, p.aulaNome, p.data, p.fasce)}><Text style={styles.btnText}>{t('approva', lang)}</Text></TouchableOpacity>
                          <TouchableOpacity style={styles.btnReject} onPress={() => cambiaStatoPrenotazione(p.id, 'Rifiutata', p.utenteEmail, p.aulaNome, p.data, p.fasce)}><Text style={styles.btnText}>{t('rifiuta', lang)}</Text></TouchableOpacity>
                        </>
                      )}
                      <TouchableOpacity style={styles.btnDelete} onPress={() => eliminaPrenotazione(p.id)}><Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('elimina', lang)}</Text></TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          );
        })() : <AccessoNegato />)}

        {vistaAttiva === 'panoramica' && (isGestore ? (() => {
          const passate = prenotazioni.filter((p: any) => p.data < oggiStr).sort((a: any, b: any) => b.data.localeCompare(a.data));
          const attive = prenotazioni.filter((p: any) => p.data >= oggiStr).sort((a: any, b: any) => b.data.localeCompare(a.data));

          const mesiAttivi = Array.from(new Set(attive.map((p: any) => p.data.substring(0, 7)))).sort();
          const meseCorrenteStr = oggiStr.substring(0, 7);
          const selezioneAttiva = panoramicaMeseSelezionato !== null 
            ? panoramicaMeseSelezionato 
            : (mesiAttivi.includes(meseCorrenteStr) ? meseCorrenteStr : (mesiAttivi[0] || 'passate'));

          const baseFiltrate = selezioneAttiva === 'passate' 
            ? passate 
            : attive.filter((p: any) => p.data.substring(0, 7) === selezioneAttiva);

          const prenotazioniFiltrate = baseFiltrate.filter((p: any) => {
            const matchUtente = filtroUtente.trim() === '' || p.utenteNome.toLowerCase().includes(filtroUtente.trim().toLowerCase());
            const matchAula = filtroAula.trim() === '' || p.aulaNome.toLowerCase().includes(filtroAula.trim().toLowerCase());
            const matchData = filtroData.trim() === '' || p.data.includes(filtroData.trim());
            return matchUtente && matchAula && matchData;
          }).sort((a: any, b: any) => b.data.localeCompare(a.data));

          return (
            <ScrollView contentContainerStyle={styles.bodyContent}>
              <Text style={[styles.sectionHeaderTitle, { marginBottom: 14 }]}>{t('navPanoramica', lang)}</Text>

              <View style={styles.tabsRow}>
                {mesiAttivi.map((ym: any) => (
                  <TouchableOpacity 
                    key={ym} 
                    style={[styles.tabButton, selezioneAttiva === ym && styles.tabButtonActive]} 
                    onPress={() => setPanoramicaMeseSelezionato(ym)}
                  >
                    <Text style={[styles.tabButtonText, selezioneAttiva === ym && styles.tabButtonTextActive]}>
                      {formattaMeseAnno(ym, lang)}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity 
                  style={[styles.tabButton, selezioneAttiva === 'passate' && styles.tabButtonActive]} 
                  onPress={() => setPanoramicaMeseSelezionato('passate')}
                >
                  <Text style={[styles.tabButtonText, selezioneAttiva === 'passate' && styles.tabButtonTextActive]}>
                    {t('prenotazioniPassate', lang, passate.length)}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.filterRow}>
                <TextInput style={styles.filterInput} placeholder={t('filtraPerUtente', lang)} placeholderTextColor={colors.placeholder} value={filtroUtente} onChangeText={setFiltroUtente} />
                <TextInput style={styles.filterInput} placeholder={t('filtraPerAula', lang)} placeholderTextColor={colors.placeholder} value={filtroAula} onChangeText={setFiltroAula} />
                <TextInput style={styles.filterInput} placeholder={t('filtraPerData', lang)} placeholderTextColor={colors.placeholder} value={filtroData} onChangeText={setFiltroData} />
              </View>
              <ScrollView horizontal style={{ marginTop: 4 }}>
                <View style={styles.excelTable}>
                  <View style={styles.excelRowHeader}>
                    <Text style={[styles.excelCellHeader, { width: 100 }]}>{t('data', lang)}</Text>
                    <Text style={[styles.excelCellHeader, { width: 120 }]}>{t('aula', lang)}</Text>
                    <Text style={[styles.excelCellHeader, { width: 100 }]}>{t('utente', lang)}</Text>
                    <Text style={[styles.excelCellHeader, { width: 150 }]}>{t('orario', lang)}</Text>
                    <Text style={[styles.excelCellHeader, { width: 90 }]}>{t('stato', lang)}</Text>
                    <Text style={[styles.excelCellHeader, { width: 80 }]}>{t('azioni', lang)}</Text>
                  </View>
                  {prenotazioniFiltrate.map((p: any, index: number) => (
                    <View key={p.id} style={[styles.excelRow, index % 2 === 0 ? styles.excelRowEven : styles.excelRowOdd]}>
                      <Text style={[styles.excelCell, { width: 100 }]}>{p.data}</Text>
                      <Text style={[styles.excelCell, { width: 120 }]}>{p.aulaNome}</Text>
                      <Text style={[styles.excelCell, { width: 100 }]}>{p.utenteNome}</Text>
                      <Text style={[styles.excelCell, { width: 150 }]}>{p.fasce.join(', ')}</Text>
                      <Text style={[styles.excelCell, { width: 90, fontWeight: 'bold', color: p.stato === 'Approvata' ? colors.success : p.stato === 'Rifiutata' ? colors.danger : colors.primary }]}>
                        {p.stato === 'In attesa' ? t('inAttesa', lang) : p.stato === 'Approvata' ? t('approvata', lang) : p.stato === 'Rifiutata' ? t('rifiutata', lang) : p.stato}
                      </Text>
                      <TouchableOpacity style={[styles.excelDeleteBtn, { width: 80 }]} onPress={() => eliminaPrenotazione(p.id)}>
                        <Text style={styles.excelDeleteText}>{t('elimina', lang)}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </ScrollView>
          );
        })() : <AccessoNegato />)}

        {vistaAttiva === 'utenti' && (isGestore ? (
          <ScrollView contentContainerStyle={styles.bodyContent}>
            <Text style={[styles.sectionHeaderTitle, { marginBottom: 14 }]}>{t('utentiEDomini', lang)}</Text>
            <View style={styles.tabsRow}>
              <TouchableOpacity style={[styles.tabButton, utentiSubTab === 'lista' && styles.tabButtonActive]} onPress={() => setUtentiSubTab('lista')}>
                <Text style={[styles.tabButtonText, utentiSubTab === 'lista' && styles.tabButtonTextActive]}>{t('listaAggiuntaUtenti', lang)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.tabButton, utentiSubTab === 'domini' && styles.tabButtonActive]} onPress={() => setUtentiSubTab('domini')}>
                <Text style={[styles.tabButtonText, utentiSubTab === 'domini' && styles.tabButtonTextActive]}>{t('permessiDomini', lang)}</Text>
              </TouchableOpacity>
            </View>

            {utentiSubTab === 'lista' && (
              <>
                <View style={styles.formRow}>
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder={t('nome', lang)} placeholderTextColor={colors.placeholder} value={nuovoUtenteNome} onChangeText={setNuovoUtenteNome} />
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder={t('email', lang)} placeholderTextColor={colors.placeholder} autoCapitalize="none" keyboardType="email-address" value={nuovoUtenteEmail} onChangeText={setNuovoUtenteEmail} />
                  <TouchableOpacity style={styles.addButton} onPress={aggiungiUtenteManuale}>
                    <Text style={styles.addButtonText}>{t('aggiungiUtente', lang)}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.infoTextSmall, { marginBottom: 12 }]}>{t('notaUtenteManuale', lang)}</Text>
                {utentiLista.map((u: any) => (
                  <View key={u.id} style={styles.rowBetween}>
                    <View>
                      <Text style={styles.infoText}>{u.nome}</Text>
                      <Text style={styles.infoTextSmall}>{u.email}</Text>
                      <Text style={u.emailVerified ? styles.verifiedBadge : styles.notVerifiedBadge}>
                        {u.emailVerified ? t('emailVerificata', lang) : t('emailNonVerificataBadge', lang)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Text style={styles.roleGold}>{(u.role === 'gestore' ? (lang === 'ar' ? 'مدير' : 'GESTORE') : (lang === 'ar' ? 'مستخدم' : 'UTENTE'))}</Text>
                      <TouchableOpacity style={styles.smallEditBtn} onPress={() => cambiaRuoloUtente(u.id, u.role)}>
                        <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('cambiaRuolo', lang)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallDeleteBtn} onPress={() => eliminaUtente(u.id, u.email)}>
                        <Text style={styles.btnText}>{t('elimina', lang)}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </>
            )}

            {utentiSubTab === 'domini' && (
              <>
                <View style={styles.formRow}>
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="es. bearzi.it" placeholderTextColor={colors.placeholder} autoCapitalize="none" value={nuovoDominio} onChangeText={setNuovoDominio} />
                  <TouchableOpacity style={styles.addButton} onPress={aggiungiDominio}>
                    <Text style={styles.addButtonText}>{t('aggiungiDominio', lang)}</Text>
                  </TouchableOpacity>
                </View>
                {dominiLista.length === 0 && (
                  <Text style={styles.infoText}>{t('nessunDominio', lang)}</Text>
                )}
                {dominiLista.map((d: any) => (
                  <View key={d.id} style={styles.rowBetween}>
                    <Text style={styles.infoText}>@{d.domain}</Text>
                    <TouchableOpacity style={styles.smallDeleteBtn} onPress={() => rimuoviDominio(d.id)}>
                      <Text style={styles.btnText}>{t('rimuovi', lang)}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        ) : <AccessoNegato />)}
      </View>

      <Modal visible={aulaInPrenotazione !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{t('prenota', lang)} {aulaInPrenotazione?.nome}</Text>
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

              <Text style={styles.label}>{t('fasceOrarie', lang)}</Text>
              <View style={styles.fasceGrid}>
                {FASCE_ORARIE.map(fascia => {
                  const occupata = prenotazioni.some((p: any) => p.aulaId === aulaInPrenotazione?.id && p.data === dataPrenotazione && p.stato !== 'Rifiutata' && p.fasce.includes(fascia));
                  const selezionata = fasceSelezionate.includes(fascia);
                  return (
                    <TouchableOpacity key={fascia} disabled={occupata} style={[styles.fasciaChip, selezionata && styles.fasciaSelected, occupata && styles.fasciaOccupata]} onPress={() => toggleFascia(fascia)}>
                      <Text style={[styles.fasciaText, selezionata && styles.fasciaTextSelected]}>{fascia}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>{t('motivoUso', lang)}</Text>
              <TextInput style={styles.input} placeholder={t('motivoObbligatorio', lang)} placeholderTextColor={colors.placeholder} value={motivo} onChangeText={setMotivo} />

              {sezioneSelezionata === 'CFP' && (
                <>
                  <Text style={styles.label}>{t('nomeClasse', lang)}</Text>
                  <TextInput style={styles.input} placeholder={t('classeObbligatoriaCFP', lang)} placeholderTextColor={colors.placeholder} value={classe} onChangeText={setClasse} />
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

      {/* Modal Modifica Sezione */}
      <Modal visible={modalModificaSezione} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{t('modifica', lang)} Sezione</Text>
              <TouchableOpacity onPress={() => setModalModificaSezione(false)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Nome Sezione:</Text>
              <TextInput style={styles.input} placeholder="es. CFP" placeholderTextColor={colors.placeholder} value={nomeSezioneInModifica} onChangeText={setNomeSezioneInModifica} />
            </ScrollView>
            <View style={styles.modalFooterFixed}>
              <TouchableOpacity style={styles.primaryButton} onPress={salvaSezioneModificata}>
                <Text style={styles.buttonText}>{t('salvaModifiche', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Nuova/Modifica Aula */}
      <Modal visible={modalNuovaAula} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{aulaInModifica ? t('modificaAula', lang) : t('nuovaAula', lang)} — {sezioneSelezionata}</Text>
              <TouchableOpacity onPress={() => setModalNuovaAula(false)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>{t('nomeAula', lang)}:</Text>
              <TextInput style={styles.input} placeholder={t('nomeAula', lang)} placeholderTextColor={colors.placeholder} value={nomeNuovaAula} onChangeText={setNomeNuovaAula} />
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
    </SafeAreaView>
  );
}

// Generatore Dinamico Stili in base ai Colori del Tema
// Ombra leggera riutilizzabile per dare profondità a card e bottoni senza esagerare
const softShadow = (colors, opacity = 0.08, radius = 8, y = 2) => ({
  shadowColor: colors.shadow,
  shadowOffset: { width: 0, height: y },
  shadowOpacity: opacity,
  shadowRadius: radius,
  elevation: Math.max(1, Math.round(radius / 3))
});

const getDynamicStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  authBox: { flex: 1, justifyContent: 'center', padding: 24, maxWidth: 400, alignSelf: 'center', width: '100%' },
  input: { backgroundColor: colors.surface, color: colors.textMain, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 12, fontSize: 15 },
  primaryButton: { backgroundColor: colors.primary, padding: 15, borderRadius: 12, alignItems: 'center', ...softShadow(colors, 0.18, 6, 3) },
  buttonText: { color: colors.primaryText, fontWeight: '700', fontSize: 16 },
  switchAuthText: { color: colors.textMuted, textAlign: 'center', marginTop: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border, ...softShadow(colors, 0.05, 6, 2) },
  headerTitle: { color: colors.textMain, fontSize: 18, fontWeight: '700' },
  headerSubtitle: { color: colors.textMuted, fontSize: 14 },
  roleGold: { color: colors.primary, fontWeight: '700' },
  logoutBtn: { backgroundColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  logoutText: { color: colors.textMain, fontSize: 14 },
  langBtnHeader: { backgroundColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.moveBtn },
  langTextHeader: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  navBar: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border, paddingHorizontal: 12, flexWrap: 'wrap' },
  navItem: { color: colors.textMuted, paddingVertical: 13, paddingHorizontal: 12, fontSize: 15 },
  navActive: { color: colors.primary, fontWeight: '700', borderBottomWidth: 2, borderColor: colors.primary },
  cardGrid: { gap: 10, marginBottom: 18 },
  cleanCardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cleanCard: { flex: 1, backgroundColor: colors.surface, paddingVertical: 18, paddingHorizontal: 20, borderRadius: 14, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', ...softShadow(colors) },
  cleanCardText: { color: colors.textMain, fontSize: 16, fontWeight: '700' },
  bodyContent: { padding: 16, maxWidth: 820, width: '100%', alignSelf: 'center' },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  sectionHeaderTitle: { color: colors.textMain, fontSize: 19, fontWeight: '700' },
  aulaCard: { backgroundColor: colors.surface, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, ...softShadow(colors, 0.05, 6, 2) },
  aulaTitle: { color: colors.textMain, fontSize: 15, fontWeight: '700' },
  aulaDesc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  primaryButtonSmall: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  buttonTextSmall: { color: colors.primaryText, fontWeight: '700', fontSize: 14 },
  gestioneGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gestoreCard: { backgroundColor: colors.surface, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, width: '31%', minWidth: 240, ...softShadow(colors) },
  infoText: { color: colors.textSub, fontSize: 13, marginTop: 2 },
  infoTextSmall: { color: colors.textMuted, fontSize: 11 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  btnApprove: { backgroundColor: colors.success, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', alignSelf: 'flex-start' },
  btnReject: { backgroundColor: colors.danger, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', alignSelf: 'flex-start' },
  btnDelete: { backgroundColor: colors.moveBtn, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', alignSelf: 'flex-start' },
  btnText: { color: '#F8FAFC', fontWeight: '700', fontSize: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, padding: 10, borderRadius: 10, marginBottom: 6, flexWrap: 'wrap', gap: 8 },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
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
    ...softShadow(colors, 0.22, 16, 6)
  },
  modalHeaderFixed: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { color: colors.textMain, fontSize: 18, fontWeight: '700', flex: 1, paddingRight: 8 },
  closeText: { color: colors.textMain, fontSize: 18 },
  modalBodyScrollable: { flexGrow: 0, flexShrink: 1 },
  modalFooterFixed: { paddingTop: 14, borderTopWidth: 1, borderColor: colors.border, marginTop: 10 },
  label: { color: colors.textMain, fontSize: 14, marginBottom: 8, marginTop: 4 },
  datePickerButton: { backgroundColor: colors.surface, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  datePickerButtonText: { color: colors.primary, fontSize: 15 },
  fasceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  fasciaChip: {
    backgroundColor: colors.surface,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start'
  },
  fasciaSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  fasciaOccupata: { backgroundColor: colors.border, opacity: 0.5 },
  fasciaText: { color: colors.textMain, fontSize: 13, textAlign: 'center' },
  fasciaTextSelected: { color: colors.primaryText, fontWeight: '700' },
  blockedText: { color: colors.danger, textAlign: 'center', marginBottom: 12, fontSize: 15 },
  excelTable: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' },
  excelRowHeader: { flexDirection: 'row', backgroundColor: colors.border, borderBottomWidth: 1, borderColor: colors.moveBtn },
  excelCellHeader: { color: colors.textMain, fontWeight: '700', padding: 10, fontSize: 14, textAlign: 'center' },
  excelRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.surface },
  excelRowEven: { backgroundColor: colors.bg },
  excelRowOdd: { backgroundColor: colors.altRow },
  excelCell: { color: colors.textSub, padding: 10, fontSize: 14, textAlign: 'center' },
  excelDeleteBtn: { backgroundColor: colors.danger, padding: 7, borderRadius: 8, alignItems: 'center', margin: 4 },
  excelDeleteText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  addButton: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10 },
  addButtonText: { color: colors.primaryText, fontWeight: '700', fontSize: 14 },
  smallMoveBtn: { backgroundColor: colors.moveBtn, paddingHorizontal: 9, paddingVertical: 9, borderRadius: 10 },
  smallEditBtn: { backgroundColor: colors.border, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10 },
  smallDeleteBtn: { backgroundColor: colors.danger, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10 },
  tabsRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  tabButton: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabButtonText: { color: colors.textMuted, fontSize: 14 },
  tabButtonTextActive: { color: colors.primaryText, fontWeight: '700' },
  formRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' },
  dynamicFieldRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 },
  removeFieldBtn: { backgroundColor: colors.danger, width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  addFieldBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', padding: 11, borderRadius: 10, alignItems: 'center', marginBottom: 12 },
  addFieldBtnText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  filterInput: { backgroundColor: colors.surface, color: colors.textMain, padding: 11, borderRadius: 10, borderWidth: 1, borderColor: colors.border, fontSize: 13, minWidth: 160, flex: 1 },
  logoImage: {},
  appName: { color: colors.primary, fontSize: 17, fontWeight: '700', textAlign: 'center', marginTop: 6, marginBottom: 20, letterSpacing: 0.5 },
  appNameSmall: { color: colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  verifyTitle: { color: colors.textMain, fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  verifyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  verifiedBadge: { color: colors.success, fontSize: 12, fontWeight: '700', marginTop: 2 },
  notVerifiedBadge: { color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: 2 },
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
    marginBottom: 7
  },
  calRowText: { color: colors.textSub, fontSize: 13, flex: 1, paddingRight: 8 },
  calRowAula: { color: colors.textMain, fontWeight: '700' },
  calRowMia: { color: colors.primary, fontWeight: '700' },
  calRowOccupata: { color: colors.textMuted, fontWeight: '700' },
  calDeleteBtn: { backgroundColor: colors.moveBtn, width: 27, height: 27, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  calDeleteBtnText: { color: '#F8FAFC', fontSize: 12, fontWeight: '700' }
});