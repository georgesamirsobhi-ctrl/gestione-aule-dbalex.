import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system';
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
import { useEffect, useState } from 'react';
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
import { auth, db, firebaseConfig } from '../config/firebaseConfig';

// Foto di sfondo della schermata di accesso (cortile della scuola). Il file
// va aggiunto in assets/sfondo-login.jpg — funziona sia su web che su Android
// perché passa dallo stesso meccanismo require() usato per il logo.
const SFONDO_LOGIN = require('../../assets/sfondo-login.jpg');
// Sfondo dedicato alla schermata di accesso SOLO per l'app Android nativa:
// è un'illustrazione quadrata (non una foto panoramica), quindi va mostrata
// per intero (resizeMode "contain") invece che ritagliata come sulla versione
// web, altrimenti risulterebbe ingigantita e tagliata male sugli schermi stretti.
const SFONDO_LOGIN_MOBILE = require('../../assets/sfondo-login-mobile.png');
// Logo (solo cerchio, senza scritta) leggermente inclinato, usato come
// filigrana a bassissima opacità dietro le altre schermate dell'app.
const LOGO_WATERMARK = require('../../assets/logo-watermark.png');

const SEZIONI_INIZIALI = ['Scuola Base', 'Scuola Media', 'Scuola Professionale', 'Comuni'];
const FASCE_ORARIE = [
  '08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00',
  '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00',
  '18:00-19:00', '19:00-20:00', '20:00-21:00', '21:00-22:00'
];
const MESI_MASSIMI_PRENOTAZIONE = 2;
// Limite esteso SOLO per il campo "Fino al:" quando si attiva la ripetizione
// settimanale — la prenotazione del primo giorno resta invece soggetta al
// limite normale (MESI_MASSIMI_PRENOTAZIONE), come tutte le prenotazioni singole.
const MESI_MASSIMI_RIPETIZIONE = 12;

const ANDROID_STATUSBAR_HEIGHT = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;

// Font unico per web e Android: senza questa impostazione RN usa il font di
// sistema di ciascuna piattaforma (Roboto su Android, sans-serif del browser
// sul web), con rese leggermente diverse. Qui forziamo uno stack coerente.
const FONT_FAMILY = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  android: 'sans-serif',
  default: 'System'
});

// --- Notifiche push + in-app (sostituiscono l'email per approvazione/rifiuto) ---
// Determina come si comporta una notifica push quando arriva ad app aperta:
// qui la mostriamo comunque come banner/suono, così l'utente la vede subito.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true
  })
});

// Registra il dispositivo per le notifiche push Expo e restituisce il token
// da salvare sul documento utente. Su emulatore o senza permesso concesso
// restituisce null: in quel caso la notifica resterà comunque visibile nel
// Centro Notifiche in-app, solo senza il banner push.
const registraPushTokenDispositivo = async () => {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX
      });
    }
    if (!Device.isDevice) return null;
    const { status: statoEsistente } = await Notifications.getPermissionsAsync();
    let statoFinale = statoEsistente;
    if (statoEsistente !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      statoFinale = status;
    }
    if (statoFinale !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return tokenData.data;
  } catch (e) {
    console.warn('Impossibile registrare il push token:', e);
    return null;
  }
};

// Invia la notifica push vera e propria tramite il servizio Expo (gratuito,
// nessuna chiave richiesta). Se il destinatario non ha un token valido (non
// ha mai aperto l'app su un dispositivo reale, o ha negato il permesso), la
// richiesta viene semplicemente saltata: la notifica resta comunque salvata
// nel suo Centro Notifiche in-app.
const inviaNotificaPush = async (pushToken, titolo, corpo, datiExtra) => {
  if (!pushToken) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: pushToken,
        title: titolo,
        body: corpo,
        data: datiExtra || {},
        sound: 'default'
      })
    });
  } catch (e) {
    console.warn('Errore invio notifica push:', e);
  }
};

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

// Formatta un timestamp ISO in "GG/MM/AAAA HH:MM", usato nello storico
// tempistiche delle segnalazioni e nel Diario di Lavoro.
const formattaDataOra = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const gg = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const aaaa = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${gg}/${mm}/${aaaa} ${hh}:${min}`;
};

// Etichetta del ruolo utente, condivisa tra header e lista utenti,
// così Utente/Gestore/Manutentore sono scritti in modo coerente ovunque.
const etichettaRuolo = (ruolo, currentLang) => {
  if (ruolo === 'gestore') return currentLang === 'ar' ? 'مدير' : 'GESTORE';
  if (ruolo === 'manutentore') return currentLang === 'ar' ? 'الصيانة / تقنية المعلومات' : 'MANUTENTORE / IT';
  return currentLang === 'ar' ? 'مستخدم' : 'UTENTE';
};

// Traduzione in arabo delle sezioni create di default alla prima apertura
// dell'app (SEZIONI_INIZIALI). Le sezioni personalizzate aggiunte in seguito
// dal gestore restano invece mostrate con il nome esatto inserito, perché
// non c'è modo di tradurre automaticamente un testo libero.
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

// Etichetta del tipo di guasto, condivisa tra la lista manutenzione, il modulo
// di segnalazione e l'esportazione Excel.
const etichettaTipoGuasto = (tipo, currentLang) =>
  tipo === 'elettrico' ? t('elettrico', currentLang)
  : tipo === 'informatico' ? t('informatico', currentLang)
  : tipo === 'strutturale' ? t('strutturale', currentLang)
  : t('altroTipoGuasto', currentLang);

// Nomi dei giorni della settimana, usati per mostrare all'utente "ogni Martedì"
// quando sceglie di ripetere una prenotazione.
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

// Genera l'elenco di date (AAAA-MM-GG), una a settimana, dalla data di inizio
// fino alla data di fine inclusa — usata per le prenotazioni ricorrenti.
const generaDateRipetizione = (dataInizioObj, dataFineStr) => {
  const risultato = [];
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
confermaEliminaUtenteMessaggio: (nome) => `Vuoi rimuovere ${nome} dalla lista? Verrà tolto solo dall'app: il suo account di accesso Firebase resterà attivo finché non lo elimini manualmente da Firebase Console > Authentication.`,
utenteRimossoDallaLista: "Utente rimosso dalla lista. Ricorda: l'account di accesso resta attivo su Firebase Auth finché non lo elimini manualmente dalla Console.",
notaEliminaUtenteLista: "Eliminando un utente da qui lo rimuovi solo da questa lista (Firestore): il suo account di accesso su Firebase Authentication resta comunque attivo. Per eliminarlo del tutto, vai su Firebase Console > Authentication e rimuovilo manualmente da lì.",
toccaRigaUtente: 'Tocca un utente per cambiare ruolo o eliminarlo',
colonnaStatoEmail: 'Stato',
scaricaAppAndroidTitolo: 'Preferisci l\'app? Scaricala per Android',
scaricaAppAndroidPulsante: '📱 Scarica app Android (.apk)',
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
      rimuovi: '✕',
      dataMaxMesi: (mesi) => `Data (max ${mesi} mesi da oggi):`,
      fasceOrarie: 'Fasce Orarie (selezione multipla):',
      motivoUso: "Motivo dell'uso:",
      motivoObbligatorio: 'Motivo (obbligatorio)',
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
      bloccatoDalGestore: 'Bloccato dal Gestore',
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
      nonPuoiRimuovereUltimoGestore: 'Non puoi togliere il ruolo di gestore: è l\'ultimo rimasto. Assegna il ruolo di gestore a un altro utente prima di cambiare questo.',
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
      notifichePushAttive: 'Notifiche push attive',
notifichePushSpiegazione: 'Se disattivate, le notifiche resteranno comunque visibili nel Centro Notifiche in-app, ma non riceverai più il banner/suono sul telefono.',
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
      colDataRisoluzione: 'Data/ora risoluzione'
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
confermaEliminaUtenteMessaggio: (nome) => `هل تريد إزالة ${nome} من القائمة؟ سيتم إزالته فقط من التطبيق: يبقى حساب الدخول الخاص به نشطاً على Firebase حتى تحذفه يدوياً من Firebase Console > Authentication.`,
utenteRimossoDallaLista: 'تمت إزالة المستخدم من القائمة. تذكير: يبقى حساب الدخول نشطاً على Firebase Auth حتى تحذفه يدوياً من الكونسول.',
notaEliminaUtenteLista: 'حذف مستخدم من هنا يزيله فقط من هذه القائمة (Firestore): يبقى حساب الدخول الخاص به على Firebase Authentication نشطاً. لحذفه نهائياً، اذهب إلى Firebase Console > Authentication واحذفه يدوياً من هناك.',
toccaRigaUtente: 'اضغط على مستخدم لتغيير دوره أو حذفه',
colonnaStatoEmail: 'الحالة',
scaricaAppAndroidTitolo: 'تفضل التطبيق؟ حمّله لنظام أندرويد',
scaricaAppAndroidPulsante: '📱 تحميل تطبيق أندرويد (.apk)',
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
      rimuovi: '✕',
      dataMaxMesi: (mesi) => `التاريخ (الحد الأقصى ${mesi} أشهر من اليوم):`,
      fasceOrarie: 'الفترات الزمنية (تحديد متعدد):',
      motivoUso: 'سبب الاستخدام:',
      motivoObbligatorio: 'السبب (إلزامي)',
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
     notifichePushAttive: 'الإشعارات الفورية مفعّلة',
notifichePushSpiegazione: 'عند التعطيل، ستبقى الإشعارات مرئية في مركز الإشعارات داخل التطبيق، لكن لن تصلك الإشعارات المنبثقة أو الصوت على الهاتف.',
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
      colDataRisoluzione: 'تاريخ/وقت الحل'
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

const getThemeColors = (isDark) => ({
  // Palette "Blu Ardesia" (tema scuro) e "Perla Neutra" (tema chiaro): toni
  // più morbidi e neutri rispetto agli originali, pensati per far risaltare
  // meglio il rosso/bianco del logo-watermark mantenendo un look elegante.
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
  // Opacità della filigrana del logo (contentWatermark): il rosso/bianco del
  // logo si "spengono" di più sul blu scuro del tema dark, quindi lì serve
  // un'opacità un po' più alta rispetto al tema chiaro per restare visibile.
  watermarkOpacity: isDark ? 0.14 : 0.10
});

export default function App() {
  const [lang, setLang] = useState('it');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const isRTL = lang === 'ar';

  // Dimensioni finestra/schermo, usate per scalare il logo-watermark in modo
  // proporzionale: su un telefono stretto in verticale la stessa dimensione
  // fissa usata su desktop coprirebbe quasi tutto lo schermo.
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const watermarkSize = Math.min(560, Math.max(220, winWidth * 0.68));
  const watermarkOffset = -(watermarkSize * (160 / 560));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mostraPassword, setMostraPassword] = useState(false);
  const [nome, setNome] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);

  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState('utente');
  const [userName, setUserName] = useState('');
  const [notifichePushAttive, setNotifichePushAttive] = useState(true);

  // MODIFICATO: "initializing" resta true finché non sappiamo ancora se
  // esiste già una sessione Firebase salvata sul dispositivo (vedi
  // onAuthStateChanged più sotto). Prima di questa modifica l'app non
  // controllava mai la sessione salvata all'avvio, quindi ogni volta che
  // veniva chiusa dal task switcher e riaperta tornava sempre al login
  // anche se l'utente non aveva mai fatto logout.
  const [initializing, setInitializing] = useState(true);

  // --- Sblocco con impronta digitale (opzionale, attivabile in Impostazioni) ---
  // "biometricoAttivo" è la preferenza salvata sul dispositivo (non sull'account,
  // dato che l'impronta è legata al singolo telefono). "biometricoDisponibile"
  // dice se il dispositivo ha un sensore configurato. "appBloccata" è vero
  // quando bisogna mostrare la schermata di sblocco invece del contenuto.
  const [biometricoAttivo, setBiometricoAttivo] = useState(false);
  const [biometricoDisponibile, setBiometricoDisponibile] = useState(false);
  const [appBloccata, setAppBloccata] = useState(false);
  const [filtroMeseGestioneDropdownAperto, setFiltroMeseGestioneDropdownAperto] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState('');
  const [emailNonVerificata, setEmailNonVerificata] = useState(false);

  // --- Centro Notifiche (in-app + push), al posto dell'email di approvazione/rifiuto ---
  const [notificheLista, setNotificheLista] = useState([]);
  const [modalNotifiche, setModalNotifiche] = useState(false);

  const [sezioneSelezionata, setSezioneSelezionata] = useState(null);
  const [vistaAttiva, setVistaAttiva] = useState('home');

  const [aule, setAule] = useState([]);
  const [prenotazioni, setPrenotazioni] = useState([]);
  const [dominiLista, setDominiLista] = useState([]);
  const [utentiLista, setUtentiLista] = useState([]);
  const [sezioniLista, setSezioniLista] = useState([]);
  const [nuovaSezioneNome, setNuovaSezioneNome] = useState('');
  const [nuovaSezioneNomeAr, setNuovaSezioneNomeAr] = useState('');
  const [modalNuovaSezione, setModalNuovaSezione] = useState(false);
  const [modalitaModificaSezioni, setModalitaModificaSezioni] = useState(false);
  // Stessa logica del toggle "Modifica" della home, ma per le aule (sotto voci)
  // dentro ciascuna delle quattro sezioni: raccoglie qui i pulsanti di
  // modifica/sposta/blocca/elimina invece di mostrarli sempre.
  const [modalitaModificaAule, setModalitaModificaAule] = useState(false);

  const [sezioneInModifica, setSezioneInModifica] = useState(null);
  const [nomeSezioneInModifica, setNomeSezioneInModifica] = useState('');
  const [nomeSezioneInModificaAr, setNomeSezioneInModificaAr] = useState('');
  const [modalModificaSezione, setModalModificaSezione] = useState(false);

  const [filtroUtente, setFiltroUtente] = useState('');
  const [filtroAula, setFiltroAula] = useState('');
  const [filtroData, setFiltroData] = useState('');

  const [cercaUtenteQuery, setCercaUtenteQuery] = useState('');

  // ( RESET ), in Impostazioni: il gestore sceglie prima COSA resettare
  // (Prenotazioni o Segnalazioni Manutenzione), poi il periodo.
  const [resetTipoSelezionato, setResetTipoSelezionato] = useState('prenotazioni');
  const [esportazioneInCorso, setEsportazioneInCorso] = useState(false);

  const [resetModalita, setResetModalita] = useState('mensile');
  const [resetMeseSelezionato, setResetMeseSelezionato] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [resetAnnoSelezionato, setResetAnnoSelezionato] = useState(String(new Date().getFullYear()));
  const [resetMeseDropdownAperto, setResetMeseDropdownAperto] = useState(false);

  // ( BLOCCA ), in Impostazioni: blocca/sblocca in blocco gli utenti
  // registrati in un dato mese o anno (createdAt). Stesso schema del reset.
  const [bloccaModalita, setBloccaModalita] = useState('mensile');
  const [bloccaMeseSelezionato, setBloccaMeseSelezionato] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [bloccaAnnoSelezionato, setBloccaAnnoSelezionato] = useState(String(new Date().getFullYear()));
  const [bloccaMeseDropdownAperto, setBloccaMeseDropdownAperto] = useState(false);
  const [bloccaCercaQuery, setBloccaCercaQuery] = useState('');

  // Reset Segnalazioni Manutenzione (solo Gestore): stesso schema del reset
  // prenotazioni, ma applicato alle segnalazioni "Risolto" archiviate.
  const [archivioManutenzioneModalita, setArchivioManutenzioneModalita] = useState('mensile');
  const [archivioManutenzioneMeseSelezionato, setArchivioManutenzioneMeseSelezionato] = useState(new Date().toISOString().slice(0, 7));
  const [archivioManutenzioneAnnoSelezionato, setArchivioManutenzioneAnnoSelezionato] = useState(String(new Date().getFullYear()));
  const [archivioManutenzioneMeseDropdownAperto, setArchivioManutenzioneMeseDropdownAperto] = useState(false);

  const [calendarioMeseSelezionato, setCalendarioMeseSelezionato] = useState(null);
  const [giornoCalendarioSelezionato, setGiornoCalendarioSelezionato] = useState(null);
  const [gestioneMeseSelezionato, setGestioneMeseSelezionato] = useState(null);
  const [giornoGestioneSelezionato, setGiornoGestioneSelezionato] = useState(null);
  const [gestioneVistaSpeciali, setGestioneVistaSpeciali] = useState(false);

  // Scheda di dettaglio della prenotazione, aperta cliccando una riga della
  // tabella in Gestione Prenotazioni (stesso pattern della scheda dettaglio
  // usata in Manutenzione).
  const [prenotazioneDettaglio, setPrenotazioneDettaglio] = useState(null);

  // --- Stato per la nuova sezione Manutenzione ---
  const [manutenzioneLista, setManutenzioneLista] = useState([]);
  const [modalNuovaSegnalazione, setModalNuovaSegnalazione] = useState(false);
  const [aulaManutenzioneSelezionata, setAulaManutenzioneSelezionata] = useState(null);
  const [aulaManutenzioneDropdownAperto, setAulaManutenzioneDropdownAperto] = useState(false);
  const [tipoGuastoSelezionato, setTipoGuastoSelezionato] = useState(null);
  const [descrizioneGuasto, setDescrizioneGuasto] = useState('');
  const [filtroStatoManutenzione, setFiltroStatoManutenzione] = useState('Tutte');
  const [filtroStatoManutenzioneDropdownAperto, setFiltroStatoManutenzioneDropdownAperto] = useState(false);
  const [segnalazioneDettaglio, setSegnalazioneDettaglio] = useState(null);
  const [nuovaVoceDiario, setNuovaVoceDiario] = useState('');
  // Ruolo utente scelto dal gestore in un piccolo menu (Utente / Gestore / Manutentore)
  const [utenteRuoloModalTarget, setUtenteRuoloModalTarget] = useState(null);
  // Scheda di dettaglio utente, aperta cliccando una riga della tabella
  // Lista/Aggiunta Utenti: mostra ruolo/stato completi e i pulsanti azione
  // (Cambia Ruolo, Elimina), così la tabella resta compatta su mobile.
  const [utenteDettaglioTarget, setUtenteDettaglioTarget] = useState(null);
  const [filtroMeseCalendarioDropdownAperto, setFiltroMeseCalendarioDropdownAperto] = useState(false);

  const [aulaInPrenotazione, setAulaInPrenotazione] = useState(null);
  const [dataPrenotazioneObj, setDataPrenotazioneObj] = useState(new Date());
  const [dataPrenotazione, setDataPrenotazione] = useState(new Date().toISOString().split('T')[0]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [ripeti, setRipeti] = useState(false);
  const [dataFineRipetizione, setDataFineRipetizione] = useState('');
  const [dataFineRipetizioneObj, setDataFineRipetizioneObj] = useState(new Date());
  const [showDatePickerFine, setShowDatePickerFine] = useState(false);
  const [fasceSelezionate, setFasceSelezionate] = useState([]);
  const [motivo, setMotivo] = useState('');
  const [classe, setClasse] = useState('');
  // Per le prenotazioni Scuola Professionale: chiede se chi prenota è uno studente IPI. Valori
  // possibili: null (nessuna scelta ancora fatta), 'si', 'no'. Solo con 'si'
  // compare il campo classe obbligatorio.
  const [studenteIPI, setStudenteIPI] = useState(null);
  const [partecipanti, setPartecipanti] = useState(['']);

  const [modalNuovaAula, setModalNuovaAula] = useState(false);
  const [aulaInModifica, setAulaInModifica] = useState(null);
  const [nomeNuovaAula, setNomeNuovaAula] = useState('');
  const [nomeNuovaAulaAr, setNomeNuovaAulaAr] = useState('');
  const [capienzaNuovaAula, setCapienzaNuovaAula] = useState('');

  const [modalBloccoAula, setModalBloccoAula] = useState(false);
  const [aulaDaBloccare, setAulaDaBloccare] = useState(null);
  const [dataInizioBlocco, setDataInizioBlocco] = useState('');
  const [dataInizioBloccoObj, setDataInizioBloccoObj] = useState(new Date());
  const [showDatePickerBloccoInizio, setShowDatePickerBloccoInizio] = useState(false);
  const [dataFineBlocco, setDataFineBlocco] = useState('');
  const [dataFineBloccoObj, setDataFineBloccoObj] = useState(new Date());
  const [showDatePickerBloccoFine, setShowDatePickerBloccoFine] = useState(false);
  const [motivoBlocco, setMotivoBlocco] = useState('');

  // Impostazioni: schermata a menu (voci toccabili) con sotto-viste dedicate;
  // 'menu' | 'preferenze' | 'notifiche' | 'utenti' | 'domini' | 'reset' | 'esporta'.
  const [impostazioniVista, setImpostazioniVista] = useState('menu');
  const [esportaTipoSelezionato, setEsportaTipoSelezionato] = useState('prenotazioni');
  const [modalAggiungiUtente, setModalAggiungiUtente] = useState(false);
  const [nuovoUtenteNome, setNuovoUtenteNome] = useState('');
  const [nuovoUtenteEmail, setNuovoUtenteEmail] = useState('');
  const [nuovoUtentePassword, setNuovoUtentePassword] = useState('');
  const [nuovoUtenteRuolo, setNuovoUtenteRuolo] = useState('utente');
  const [nuovoDominio, setNuovoDominio] = useState('');

  const colors = getThemeColors(isDarkMode);
  const styles = getDynamicStyles(colors, isRTL);

  // Traduzione del nome sezione: usa prima il nome arabo personalizzato
  // impostato dal gestore per quella specifica sezione (sez.nomeAr), poi la
  // traduzione statica delle 4 sezioni di default, infine il nome originale.
  const risolviNomeSezione = (nome, currentLangArg) => {
    if (currentLangArg === 'ar') {
      const sez = sezioniLista.find((s) => s.nome === nome);
      if (sez && sez.nomeAr && sez.nomeAr.trim()) return sez.nomeAr.trim();
    }
    return etichettaSezione(nome, currentLangArg);
  };

  // Traduzione del nome aula: usa il nome arabo personalizzato impostato dal
  // gestore per quella specifica aula (aula.nomeAr), altrimenti il nome
  // originale. A differenza delle sezioni non esistono aule "di default" da
  // tradurre automaticamente, quindi senza nomeAr resta il nome italiano.
  const risolviNomeAula = (nome, currentLangArg) => {
    if (currentLangArg === 'ar') {
      const aulaTrovata = aule.find((a) => a.nome === nome);
      if (aulaTrovata && aulaTrovata.nomeAr && aulaTrovata.nomeAr.trim()) return aulaTrovata.nomeAr.trim();
    }
    return nome;
  };
  
  const webDateInputStyle = {
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
      // true per gli account creati dal Gestore (vedi aggiungiUtenteManuale):
      // per questi non richiediamo la verifica email nativa di Firebase, dato
      // che il link di reset password già inviato prova il possesso della casella.
      let bypassVerificaEmail = false;
      if (isRegistering) {
        const res = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPassword);
        firebaseUser = res.user;
        await sendEmailVerification(firebaseUser);
        await setDoc(doc(db, 'users', firebaseUser.uid), { nome: nome.trim(), email: cleanEmail, role: 'utente', emailVerified: false, createdAt: new Date().toISOString() });
        setUserName(nome.trim());
        setUserRole('utente');
      } else {
        const res = await signInWithEmailAndPassword(auth, cleanEmail, cleanPassword);
        firebaseUser = res.user;
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const datiUtente = userDoc.data();
          if (datiUtente.bloccato === true) {
            await signOut(auth);
            setLoading(false);
            setBlockedMessage(t('accountBloccatoMessaggio', lang));
            return;
          }
          setUserRole(datiUtente.role || 'utente');
          setUserName(datiUtente.nome || cleanEmail);
          setNotifichePushAttive(datiUtente.notifichePush !== false);
          bypassVerificaEmail = datiUtente.creatoDaGestore === true;
          if (bypassVerificaEmail && datiUtente.primoAccessoEffettuato === false) {
            try { await updateDoc(doc(db, 'users', firebaseUser.uid), { primoAccessoEffettuato: true }); } catch (e) {}
          }
        } else {
          await setDoc(doc(db, 'users', firebaseUser.uid), { nome: cleanEmail, email: cleanEmail, role: 'utente', emailVerified: firebaseUser.emailVerified, createdAt: new Date().toISOString() });
          setUserName(cleanEmail);
          setUserRole('utente');
        }
      }

      setUser(firebaseUser);

      if (!firebaseUser.emailVerified && !bypassVerificaEmail) {
        setEmailNonVerificata(true);
      } else {
        setEmailNonVerificata(false);
        if (!bypassVerificaEmail) {
          try { await updateDoc(doc(db, 'users', firebaseUser.uid), { emailVerified: true }); } catch (e) {}
        }
        caricaDatiGenerali();
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
          { nome: 'Officina Meccanica', capienza: '20', sezione: 'Scuola Professionale', ordine: 0 },
          { nome: 'Lab Elettrico', capienza: '18', sezione: 'Scuola Professionale', ordine: 1 },
          { nome: 'Sala Consiliare', capienza: '50', sezione: 'Comuni', ordine: 0 },
          { nome: 'Sala Polifunzionale', capienza: '80', sezione: 'Comuni', ordine: 1 }
        ];
        for (const a of auleIniziali) { await addDoc(collection(db, 'aule'), a); }
        snapAule = await getDocs(collection(db, 'aule'));
      }
      setAule(snapAule.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)));

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
      setSezioniLista(snapSezioni.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)));

      const snapManutenzione = await getDocs(collection(db, 'manutenzione'));
      setManutenzioneLista(snapManutenzione.docs.map(d => ({ id: d.id, ...d.data() })));

      if (user) {
        const snapNotifiche = await getDocs(collection(db, 'notifiche'));
        const mieNotifiche = snapNotifiche.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(n => n.utenteId === user.uid)
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setNotificheLista(mieNotifiche);
      }
    } catch (e) {
      console.log('Errore caricamento dati:', e);
    }
  };

  // MODIFICATO: prima non c'era nessun controllo della sessione salvata
  // all'avvio — "user" restava sempre null finché non si faceva login a
  // mano, quindi l'app mostrava sempre la schermata di accesso anche se
  // Firebase aveva già una sessione valida su disco (vedi firebaseConfig).
  // Questo effetto gira una sola volta all'avvio e ogni volta che Firebase
  // rileva un cambio di sessione (login/logout): se trova una sessione
  // valida, ricarica il profilo da Firestore e imposta "user" da solo,
  // senza che l'utente debba reinserire email e password.
  useEffect(() => {
    const nonSottoscritto = onAuthStateChanged(auth, async (firebaseUser) => {
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
          setUserRole(datiUtente.role || 'utente');
          setUserName(datiUtente.nome || firebaseUser.email);
          setNotifichePushAttive(datiUtente.notifichePush !== false);
          const bypassVerificaEmail = datiUtente.creatoDaGestore === true;
          setEmailNonVerificata(!firebaseUser.emailVerified && !bypassVerificaEmail);
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

  // --- Sblocco con impronta: verifica hardware disponibile + preferenza salvata ---
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

  // Quando la sessione salvata viene ripristinata (o al primo avvio, se
  // l'utente risultava già loggato) e lo sblocco con impronta è attivo,
  // blocca subito l'accesso finché non viene fornita l'impronta.
  useEffect(() => {
    if (!initializing && user && !emailNonVerificata && biometricoAttivo) {
      setAppBloccata(true);
    }
  }, [initializing, user, emailNonVerificata, biometricoAttivo]);

  // Ri-blocca l'app ogni volta che torna in primo piano dopo essere stata
  // messa in background (task switcher) — non solo alla primissima apertura.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let statoPrecedente = AppState.currentState;
    const sub = AppState.addEventListener('change', (nuovoStato) => {
      if (statoPrecedente.match(/inactive|background/) && nuovoStato === 'active') {
        if (user && !emailNonVerificata && biometricoAttivo) {
          setAppBloccata(true);
        }
      }
      statoPrecedente = nuovoStato;
    });
    return () => sub.remove();
  }, [user, emailNonVerificata, biometricoAttivo]);

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
    if (user && !emailNonVerificata) caricaDatiGenerali();
  }, [user, vistaAttiva, emailNonVerificata]);

  // Al login registra il dispositivo per le notifiche push e salva il token
  // sul documento utente, così chi approva/rifiuta una prenotazione può
  // raggiungerlo. Se il permesso viene negato l'app continua a funzionare
  // normalmente: la notifica resterà comunque nel Centro Notifiche.
  useEffect(() => {
    if (!user || emailNonVerificata) return;
    (async () => {
      const token = await registraPushTokenDispositivo();
      if (token) {
        try { await updateDoc(doc(db, 'users', user.uid), { pushToken: token }); } catch (e) {}
      }
    })();
  }, [user, emailNonVerificata]);

  // Crea la notifica in-app (salvata su Firestore, visibile nel Centro
  // Notifiche con stato letta/non letta) per il destinatario indicato.
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

 // Attiva/disattiva il banner push per l'utente corrente. Le notifiche
  // restano comunque visibili nel Centro Notifiche in-app: qui silenziamo
  // solo l'invio del push tramite Expo. Il Manutentore non ha accesso a
  // questa opzione (gestita a livello di interfaccia, non qui).
  const toggleNotifichePush = async () => {
    const nuovoValore = !notifichePushAttive;
    setNotifichePushAttive(nuovoValore);
    try {
      await updateDoc(doc(db, 'users', user.uid), { notifichePush: nuovoValore });
    } catch (e) {
      console.error('Errore aggiornamento preferenza notifiche:', e);
      setNotifichePushAttive(!nuovoValore);
    }
  };

  // Segna come letta UNA notifica (tap sulla riga nel Centro Notifiche).
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

  // Elimina una singola notifica dal Centro Notifiche, sia dal database
  // Firestore sia dalla lista locale. Chiede conferma prima di procedere,
  // usando window.confirm sul web e Alert.alert su Android/iOS.
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

  // Elimina in un colpo solo tutte le prenotazioni che condividono lo stesso
  // gruppoRipetizione (create insieme con "Ripeti ogni settimana"), evitando
  // di doverle cancellare una per una quando sono decine/centinaia.
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

    // Un id comune per collegare tra loro le richieste generate dalla stessa
    // ripetizione settimanale (utile in futuro per azioni "in blocco").
    const gruppoRipetizione = ripeti ? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;

    // Se la ripetizione va oltre il limite normale delle prenotazioni singole,
    // l'intera serie viene marcata come "Prenotazioni Speciali": segue comunque
    // il normale iter di approvazione, ma resta riconoscibile per il gestore.
    const richiedeAutorizzazioneSpeciale = ripeti && dataFineRipetizione > limiteNormaleStr;

    let conflittoPersonale = false;
    let saltate = 0;

    try {
      for (const dataSingola of dateDaPrenotare) {
        // Se quella specifica data/fascia è già occupata da un ALTRO utente
        // per la stessa aula, saltiamo solo quell'occorrenza (non blocchiamo
        // l'intera serie) e lo segnaliamo nel riepilogo finale.
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
          partecipanti: partecipanti.map(p => p.trim()).filter(p => p !== ''),
          utenteNome: userName,
          utenteEmail: user.email,
          stato: 'In attesa',
          ...(gruppoRipetizione ? { gruppoRipetizione } : {}),
          ...(richiedeAutorizzazioneSpeciale ? { richiedeAutorizzazioneSpeciale: true } : {})
        });
      }
      // Notifica tutti i Gestori della nuova richiesta di prenotazione
      const gestoriDaNotificare = utentiLista.filter((u) => u.role === 'gestore');
      if (gestoriDaNotificare.length > 0) {
        const titoloIt = t('notificaNuovaRichiestaTitolo', 'it', aulaInPrenotazione.nome);
        const corpoIt = t('notificaNuovaRichiestaCorpo', 'it', userName, aulaInPrenotazione.nome, dataPrenotazione);
        const titoloAr = t('notificaNuovaRichiestaTitolo', 'ar', aulaInPrenotazione.nome);
        const corpoAr = t('notificaNuovaRichiestaCorpo', 'ar', userName, aulaInPrenotazione.nome, dataPrenotazione);
        const titoloGestore = `${titoloIt} / ${titoloAr}`;
        const corpoGestore = `${corpoIt}\n${corpoAr}`;

        for (const gestore of gestoriDaNotificare) {
          await creaNotificaInApp(gestore.id, titoloGestore, corpoGestore, {
            tipo: 'nuova_richiesta',
            aulaNome: aulaInPrenotazione.nome,
            data: dataPrenotazione
          });
         if (gestore.notifichePush !== false) {
            await inviaNotificaPush(gestore.pushToken, titoloGestore, corpoGestore, {});
          }
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

    const titoloIt = approvata ? t('notificaApprovataTitolo', 'it', aulaNome) : t('notificaRifiutataTitolo', 'it', aulaNome);
    const corpoIt = approvata ? t('notificaApprovataCorpo', 'it', aulaNome, data, dettagliOrario) : t('notificaRifiutataCorpo', 'it', aulaNome, data, dettagliOrario);
    const titoloAr = approvata ? t('notificaApprovataTitolo', 'ar', aulaNome) : t('notificaRifiutataTitolo', 'ar', aulaNome);
    const corpoAr = approvata ? t('notificaApprovataCorpo', 'ar', aulaNome, data, dettagliOrario) : t('notificaRifiutataCorpo', 'ar', aulaNome, data, dettagliOrario);

    const titolo = `${titoloIt} / ${titoloAr}`;
    const corpo = `${corpoIt}\n${corpoAr}`;

    // Il destinatario è identificato tramite la sua email (come già avveniva
    // per la vecchia email): lo cerchiamo in utentiLista per recuperare uid
    // (per il Centro Notifiche) e pushToken (per il push).
    const destinatario = utentiLista.find((u) => u.email === utenteEmail);

    if (destinatario) {
      await creaNotificaInApp(destinatario.id, titolo, corpo, {
        tipo: approvata ? 'approvazione' : 'rifiuto',
        prenotazioneId: id,
        aulaNome,
        data,
        fasce: fasce || []
      });
     if (destinatario.notifichePush !== false) {
        await inviaNotificaPush(destinatario.pushToken, titolo, corpo, { prenotazioneId: id });
      }
    } else {
      console.warn('Destinatario notifica non trovato in utentiLista per email:', utenteEmail);
    }

    caricaDatiGenerali();
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
      } else {
        const auleSezione = aule.filter((a) => a.sezione === sezioneSelezionata);
        await addDoc(collection(db, 'aule'), {
          nome: nomeNuovaAula.trim(),
          nomeAr: nomeNuovaAulaAr.trim(),
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

  // --- Blocco Aula (Gestore): rende un'aula non prenotabile per un periodo
  // esteso (es. un anno intero), senza il limite dei mesi previsto per le
  // prenotazioni normali. Tecnicamente crea, un giorno alla volta, delle
  // prenotazioni già "Approvata" su TUTTE le fasce orarie: così riusa
  // automaticamente tutta la logica già esistente che mostra un'aula come
  // occupata (calendario pubblico, selezione fasce, ecc.) senza bisogno di
  // una collection o di una logica separata.
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

    // Un giorno alla volta, dalla data di inizio alla data di fine incluse.
    const giorni = [];
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

  // Sostituisce il vecchio toggle a 2 stati: ora imposta direttamente il ruolo
  // scelto dal gestore (Utente / Gestore / Manutentore) tramite un piccolo menu.
  // Protezione: non si può togliere il ruolo gestore all'ultimo gestore
  // rimasto, altrimenti nessuno potrebbe più accedere a Impostazioni,
  // Blocca, Reset, Esporta, ecc. (questo controllo vive solo lato app: chi
  // scrive direttamente su Firestore lo può comunque bypassare).
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
    await updateDoc(doc(db, 'users', uid), { role: nuovoRuolo });
    setUtenteRuoloModalTarget(null);
    caricaDatiGenerali();
  };

  // --- Funzioni per la sezione Manutenzione ---
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
        // Storico tempistiche: fondamentale per monitorare il tempo di lavoro del manutentore.
        tsSegnalazione: oraSegnalazione,
        tsPresaInCarico: null,
        tsRisoluzione: null,
        // Diario di Lavoro: voci private, leggibili solo da Gestore e Manutentore.
        diario: []
      });
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
    const aggiornamento = { stato: nuovoStato };
    const ora = new Date().toISOString();
    // Storico tempistiche: la presa in carico si registra solo la prima volta,
    // la risoluzione viene aggiornata ogni volta che il ticket torna "Risolto".
    if (nuovoStato === 'In lavorazione' && !segnalazioneCorrente?.tsPresaInCarico) {
      aggiornamento.tsPresaInCarico = ora;
    }
    if (nuovoStato === 'Risolto') {
      aggiornamento.tsRisoluzione = ora;
    }
    await updateDoc(doc(db, 'manutenzione', id), aggiornamento);
    setSegnalazioneDettaglio((prev) => (prev && prev.id === id) ? { ...prev, ...aggiornamento } : prev);
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

  // --- Esportazione Excel dettagliata (Impostazioni > Area Reset > Esporta) ---
  // Riusa lo stesso tipo (Prenotazioni/Manutenzione) e lo stesso periodo
  // (mensile/annuale) già selezionati nel pannello di reset, così l'utente
  // può esportare i dati prima di eventualmente cancellarli.
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
    // A differenza del reset (che elimina solo le segnalazioni "Risolto"),
    // l'esportazione include TUTTE le segnalazioni del periodo, qualunque
    // sia il loro stato, per avere un archivio completo e verificabile.
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
            .map((v) => `${v.autore} (${formattaDataOra(v.timestamp)}): ${v.testo}`)
            .join(' | ');
          return {
            [t('aula', lang)]: s.aulaNome || '',
            Sezione: risolviNomeSezione(s.sezione, lang) || '',
            [t('colTipoGuasto', lang)]: etichettaTipoGuasto(s.tipoGuasto, lang),
            [t('colDescrizioneGuasto', lang)]: s.descrizione || '',
            [t('colSegnalatoDa', lang)]: s.utenteNome || '',
            [t('email', lang)]: s.utenteEmail || '',
            [t('stato', lang)]: s.stato || '',
            [t('colDataSegnalazione', lang)]: formattaDataOra(s.tsSegnalazione) || s.data || '',
            [t('colDataPresaInCarico', lang)]: s.tsPresaInCarico ? formattaDataOra(s.tsPresaInCarico) : t('nonAncora', lang),
            [t('colDataRisoluzione', lang)]: s.tsRisoluzione ? formattaDataOra(s.tsRisoluzione) : t('nonAncora', lang),
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

  // Eliminazione in blocco dell'Archivio Manutenzione (solo Gestore): rimuove
  // tutte le segnalazioni "Risolto" del mese o dell'anno scelto, cioè quelle
  // già visibili nel tab Archivio.
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

  // Diario di Lavoro: voci aggiunte esclusivamente dal Manutentore/IT, leggibili
  // solo da Gestore e Manutentore. Si attiva dal momento della presa in carico.
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

 // Genera una password casuale (12 caratteri, lettere maiuscole/minuscole,
  // numeri e simboli) da proporre nel campo password della modale di invito.
  // L'utente la cambierà comunque cliccando il link di reset ricevuto via email.
  const generaPasswordCasuale = () => {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 12; i++) {
      pwd += charset[Math.floor(Math.random() * charset.length)];
    }
    setNuovoUtentePassword(pwd);
  };

  // Crea un account vero (email + password) da parte del Gestore, bypassando
  // il controllo domini consentiti (quel controllo vale solo per l'auto-
  // registrazione in handleAuth). Usiamo un'app Firebase secondaria e
  // temporanea: creare l'utente con l'app principale sostituirebbe
  // automaticamente la sessione del Gestore con quella del nuovo account.
  //
  // Niente più sendEmailVerification: al posto della verifica email inviamo
  // un'email di reset password (sendPasswordResetEmail). Cliccare quel link
  // e impostare una password è di per sé una prova di possesso della
  // casella email, quindi marchiamo subito emailVerified: true (via il
  // flag creatoDaGestore) invece di tenere l'utente bloccato al login in
  // attesa di una verifica separata che qui non esiste più.
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

    try {
      const res = await createUserWithEmailAndPassword(authSecondaria, emailPulita, nuovoUtentePassword.trim());
      await setDoc(doc(db, 'users', res.user.uid), {
        nome: nuovoUtenteNome.trim(),
        email: emailPulita,
        role: nuovoUtenteRuolo,
        emailVerified: true,
        creatoDaGestore: true,
        primoAccessoEffettuato: false,
        createdAt: new Date().toISOString()
      });
      try {
        await sendPasswordResetEmail(authSecondaria, emailPulita);
      } catch (mailErr) {
        console.warn('Utente creato ma invio email di invito fallito:', mailErr);
      }
      setNuovoUtenteNome('');
      setNuovoUtenteEmail('');
      setNuovoUtentePassword('');
      setNuovoUtenteRuolo('utente');
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

  // Rinvia l'email di invito (reset password) a un utente già creato dal
  // Gestore, ad esempio se non l'ha ricevuta o l'ha persa.
  const rinviaInvitoUtente = async (targetEmail) => {
    try {
      await sendPasswordResetEmail(auth, targetEmail);
      mostraAlert('', t('invitoRinviato', lang));
    } catch (e) {
      mostraAlert(t('errore', lang), e.message);
    }
  };

  // NOTA: non è possibile eliminare davvero un account Firebase Auth dal
  // client (servirebbe l'Admin SDK lato server). Questa funzione rimuove
  // solo il documento Firestore (users/{id}), cioè fa sparire l'utente
  // dalla lista e dall'app: l'account di login resta comunque attivo su
  // Firebase Authentication finché non viene eliminato manualmente dalla
  // Console (Authentication > Users). Per bloccare davvero l'accesso senza
  // eliminare nulla, si può usare la sezione "Blocca" più sotto.
  const eliminaUtenteDallaLista = (u) => {
    const esegui = async () => {
      try {
        await deleteDoc(doc(db, 'users', u.id));
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
    setNuovoDominio('');
    caricaDatiGenerali();
  };

  const rimuoviDominio = async (id) => {
    await deleteDoc(doc(db, 'allowed_domains', id));
    caricaDatiGenerali();
  };

  const eseguiResetPrenotazioni = async () => {
    const effettuaReset = async () => {
      try {
        let prenotazioniDaEliminare = [];
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

  // ( BLOCCA ), in Impostazioni: blocca/sblocca in blocco tutti gli utenti
  // il cui campo createdAt (data di registrazione) rientra nel mese o
  // nell'anno selezionato. Un utente bloccato non può più accedere
  // all'app: il controllo avviene in handleAuth (vedi datiUtente.bloccato).
  // NOTA: gli utenti registrati prima dell'introduzione del campo createdAt
  // non hanno questo dato e quindi non compariranno in nessun periodo.
  const eseguiBloccoUtenti = async (vuoleBloccare) => {
    const effettua = async () => {
      try {
        const utentiTarget = utentiLista.filter((u) => {
          if (!u.createdAt) return false;
          if (u.email === user.email) return false; // non bloccare mai se stessi
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

  // Blocca/sblocca UN SOLO utente, sia dal suggerimento di ricerca (nome/email)
  // sia dal pulsante individuale nella lista "tipo excel" per periodo.
  const eseguiBloccoSingolo = async (utenteTarget, vuoleBloccare) => {
    if (utenteTarget.email === user.email) return; // non bloccare mai se stessi

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

  // Finché non sappiamo ancora se esiste una sessione salvata (vedi
  // onAuthStateChanged), mostriamo solo un indicatore di caricamento invece
  // di far vedere per un istante la schermata di login prima di eventualmente
  // saltarla per l'utente già autenticato.
  if (initializing) {
    return (
      <SafeAreaView style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  // Schermata di sblocco con impronta: appare sopra il resto dell'app quando
  // la funzione è attiva, sia al primo avvio con sessione già salvata sia
  // ogni volta che l'app torna in primo piano dopo essere stata in background.
  if (user && !emailNonVerificata && appBloccata) {
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
                  onPress={() => Linking.openURL('https://github.com/georgesamirsobhi-ctrl/gestione-aule-dbalex./releases/download/v1.0.0/application-46bc2bf2-a990-48d0-8dcb-51b876c7336a.apk')}
                >
                  <Text style={styles.androidDownloadBannerTitle}>{t('scaricaAppAndroidTitolo', lang)}</Text>
                  <Text style={styles.androidDownloadBannerButton}>{t('scaricaAppAndroidPulsante', lang)}</Text>
                </TouchableOpacity>
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

  const maxCalendarDate = new Date();
  maxCalendarDate.setMonth(maxCalendarDate.getMonth() + MESI_MASSIMI_PRENOTAZIONE);
  const maxCalendarDateRipetizione = new Date();
  maxCalendarDateRipetizione.setMonth(maxCalendarDateRipetizione.getMonth() + MESI_MASSIMI_RIPETIZIONE);
  const limiteNormaleStr = maxCalendarDate.toISOString().split('T')[0];

  const isGestore = userRole === 'gestore';
  const isManutentore = userRole === 'manutentore';
  const canGestireManutenzione = isGestore || isManutentore;
  const oggiStr = new Date().toISOString().split('T')[0];

  const AccessoNegato = () => (
    <View style={styles.bodyContent}>
      <Text style={styles.blockedText}>{t('accessoRiservato', lang)}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, isRTL && { direction: 'rtl' }]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      
      <View style={[styles.header, isRTL && { flexDirection: 'row-reverse' }]}>
        <View style={[styles.headerSideGroup, { justifyContent: isRTL ? 'flex-end' : 'flex-start' }]}>
          <View style={{ alignItems: isRTL ? 'flex-end' : 'flex-start' }}>
           <Text
              style={[styles.headerTitleCentered, { textAlign: isRTL ? 'right' : 'left' }]}
              numberOfLines={1}
              ellipsizeMode="tail"
              maxFontSizeMultiplier={1.2}
            >{userName}</Text>
            <Text
              style={[styles.headerSubtitleCentered, { textAlign: isRTL ? 'right' : 'left' }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >{t('ruolo', lang)}: <Text style={styles.roleGold}>{etichettaRuolo(userRole, lang)}</Text></Text>
          </View>
        </View>
        <View style={styles.headerCenterGroup}>
          <AppLogo style={{ width: Platform.OS === 'web' ? 210 : 130, height: Platform.OS === 'web' ? 73 : 46 }} />
          <Text style={styles.appNameSmall}>{t('appName', lang)}</Text>
        </View>
        <View style={[styles.headerSideGroup, { justifyContent: isRTL ? 'flex-start' : 'flex-end' }]}>
          <View style={[styles.headerIconsRow, isRTL ? styles.headerIconsRowRTL : styles.headerIconsRowLTR]}>
            <TouchableOpacity style={styles.langBtnHeader} onPress={() => setModalNotifiche(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.langTextHeader}>🔔</Text>
              {notificheNonLette > 0 && (
                <View style={styles.notificaBadge}>
                  <Text style={styles.notificaBadgeText}>{notificheNonLette > 9 ? '9+' : notificheNonLette}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.logoutText}>{t('esci', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>


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
                  onPress={() => !n.letta && segnaNotificaComeLetta(n.id)}
                >
                  <View style={styles.diarioVoceHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                      {!n.letta && <View style={styles.diarioPallino} />}
                      <Text style={[styles.diarioAutore, n.letta && styles.diarioAutoreLetta]}>{n.titolo}</Text>
                    </View>
                    <Text style={styles.diarioTimestamp}>{formattaDataOra(n.createdAt)}</Text>
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

      {Platform.OS !== 'android' && (
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => { setVistaAttiva('home'); setSezioneSelezionata(null); setModalitaModificaAule(false); }}>
            <Text style={[styles.navItem, vistaAttiva === 'home' && styles.navActive]}>{t('navHome', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setVistaAttiva('calendario')}>
            <Text style={[styles.navItem, vistaAttiva === 'calendario' && styles.navActive]}>{t('navCalendario', lang)}</Text>
          </TouchableOpacity>
          {isGestore && (
            <TouchableOpacity onPress={() => setVistaAttiva('gestione')}>
              <Text style={[styles.navItem, vistaAttiva === 'gestione' && styles.navActive]}>{t('navGestione', lang)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setVistaAttiva('manutenzione')}>
            <Text style={[styles.navItem, vistaAttiva === 'manutenzione' && styles.navActive]}>{t('navManutenzione', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setVistaAttiva('impostazioni')}>
            <Text style={[styles.navItem, vistaAttiva === 'impostazioni' && styles.navActive]}>{t('navImpostazioni', lang)}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ flex: 1 }}>
        <Image
          source={LOGO_WATERMARK}
          style={[styles.contentWatermark, { width: watermarkSize, height: watermarkSize, right: watermarkOffset, bottom: watermarkOffset }]}
          pointerEvents="none"
          resizeMode="contain"
        />
        {vistaAttiva === 'home' && !sezioneSelezionata && (
          <ScrollView contentContainerStyle={styles.bodyContent}>
            {isGestore && (
              <View style={{ flexDirection: 'row', justifyContent: isRTL ? 'flex-start' : 'flex-end', marginBottom: 12 }}>
                <TouchableOpacity
                  style={[
                    styles.editToggleBtn,
                    { backgroundColor: modalitaModificaSezioni ? colors.success : colors.primary }
                  ]}
                  onPress={() => setModalitaModificaSezioni(!modalitaModificaSezioni)}
                >
                  <Text style={styles.editToggleBtnText}>{modalitaModificaSezioni ? `✓ ${t('fine', lang)}` : `✎ ${t('modifica', lang)}`}</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.cardGrid}>
              {sezioniLista.map((sez, idx) => (
                <View key={sez.id} style={[styles.cleanCardRow, isRTL && { flexDirection: 'row-reverse' }]}>
                  <TouchableOpacity style={styles.cleanCard} onPress={() => { setSezioneSelezionata(sez.nome); setVistaAttiva('aule'); setModalitaModificaAule(false); }}>
                    <Text style={styles.cleanCardText}>{risolviNomeSezione(sez.nome, lang)}</Text>
                  </TouchableOpacity>
                  {isGestore && modalitaModificaSezioni && (
                    <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
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
            {isGestore && modalitaModificaSezioni && (
              <TouchableOpacity style={[styles.addButton, { alignSelf: isRTL ? 'flex-end' : 'flex-start' }]} onPress={() => setModalNuovaSezione(true)}>
                <Text style={styles.addButtonText}>{t('aggiungiSezione', lang)}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {vistaAttiva === 'aule' && sezioneSelezionata && (
          <ScrollView contentContainerStyle={styles.bodyContent}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionHeaderTitle}>{risolviNomeSezione(sezioneSelezionata, lang)}</Text>
            </View>
            {isGestore && (
              <View style={{ flexDirection: 'row', justifyContent: isRTL ? 'flex-start' : 'flex-end', marginBottom: 12 }}>
                <TouchableOpacity
                  style={[
                    styles.editToggleBtn,
                    { backgroundColor: modalitaModificaAule ? colors.success : colors.primary }
                  ]}
                  onPress={() => setModalitaModificaAule(!modalitaModificaAule)}
                >
                  <Text style={styles.editToggleBtnText}>{modalitaModificaAule ? `✓ ${t('fine', lang)}` : `✎ ${t('modifica', lang)}`}</Text>
                </TouchableOpacity>
              </View>
            )}
            {aule.filter((a) => a.sezione === sezioneSelezionata).sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)).map((aula, idx, arr) => (
              <View key={aula.id} style={styles.aulaCard}>
                <View>
                  <Text style={styles.aulaTitle}>{risolviNomeAula(aula.nome, lang)}</Text>
                  <Text style={styles.aulaDesc}>{t('capienza', lang)}: {aula.capienza}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {isGestore && modalitaModificaAule && (
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
                      <TouchableOpacity style={styles.smallMoveBtn} onPress={() => apriBloccaAula(aula)}>
                        <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('bloccaAula', lang)}</Text>
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
            {isGestore && modalitaModificaAule && (
              <TouchableOpacity style={[styles.addButton, { alignSelf: isRTL ? 'flex-end' : 'flex-start', marginTop: 4 }]} onPress={apriNuovaAula}>
                <Text style={styles.addButtonText}>{t('aggiungiAula', lang)}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {vistaAttiva === 'calendario' && (() => {
          const prenotazioniValide = prenotazioni.filter((p) => p.stato !== 'Rifiutata');

          const meseCorrenteStr = oggiStr.substring(0, 7);
          const mesiDisponibili = [];
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
                      <Text style={[styles.dayButtonText, passato && styles.dayButtonTextPast]}>{giorno}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Modal visible={giornoCalendarioSelezionato !== null} animationType="slide" transparent onRequestClose={() => setGiornoCalendarioSelezionato(null)}>
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContentFixed}>
                    <View style={styles.modalHeaderFixed}>
                      <Text style={styles.modalTitle}>{giornoCalendarioSelezionato}</Text>
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
                              {'  '}({risolviNomeSezione(p.sezione, lang)}) · {p.fasce.join(', ')} —{' '}
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

        {vistaAttiva === 'manutenzione' && (() => {
          const auleOrdinate = [...aule].sort((a, b) => (a.sezione || '').localeCompare(b.sezione || '') || (a.nome || '').localeCompare(b.nome || ''));
          const meseCorrenteYYYYMM = new Date().toISOString().slice(0, 7);

          // Un utente normale vede solo le proprie segnalazioni; Gestore e
          // Manutentore/IT vedono tutte quelle relative all'aula/sezione.
          const segnalazioniPropriaVisibilita = manutenzioneLista.filter((s) =>
            canGestireManutenzione || s.utenteEmail === user.email
          );

          // I ticket Da risolvere / In lavorazione restano sempre visibili; quelli
          // Risolti solo nel mese corrente. La pulizia periodica delle segnalazioni
          // risolte nei mesi precedenti si fa da Impostazioni > ( RESET ).
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
          const puoScrivereDiario = s && isManutentore && !!s.tsPresaInCarico;

          return (
            <ScrollView contentContainerStyle={styles.bodyContent}>
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
                <View style={styles.tableCard}>
                  <View style={styles.tableHeaderRow}>
                    <Text style={[styles.tableHeaderCell, styles.tableColAula]}>{t('colAula', lang)}</Text>
                    <Text style={[styles.tableHeaderCell, styles.tableColUtente]}>{t('colSegnalatoDa', lang)}</Text>
                    <Text style={[styles.tableHeaderCell, styles.tableColTipo]}>{t('colTipoGuasto', lang)}</Text>
                    <Text style={[styles.tableHeaderCell, styles.tableColStato]}>{t('colStato', lang)}</Text>
                    <Text style={[styles.tableHeaderCell, styles.tableColData]}>{t('colData', lang)}</Text>
                  </View>
                  {segnalazioniFiltrate.map((riga, idx) => {
                    // Solo Gestore e Manutentore/IT possono aprire la scheda di
                    // dettaglio: per l'utente normale la riga è solo informativa.
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
                        <Text style={[styles.tableCell, styles.tableColData]}>{riga.data}</Text>
                      </RigaTabella>
                    );
                  })}
                </View>
              )}

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
                              <Text style={styles.storicoValore}>{formattaDataOra(s.tsSegnalazione) || s.data}</Text>
                            </View>
                            <View style={styles.storicoRiga}>
                              <Text style={styles.storicoLabel}>{t('presoInCaricoIl', lang)}</Text>
                              <Text style={styles.storicoValore}>{s.tsPresaInCarico ? formattaDataOra(s.tsPresaInCarico) : t('nonAncora', lang)}</Text>
                            </View>
                            <View style={styles.storicoRiga}>
                              <Text style={styles.storicoLabel}>{t('risoltoIl', lang)}</Text>
                              <Text style={styles.storicoValore}>{s.tsRisoluzione ? formattaDataOra(s.tsRisoluzione) : t('nonAncora', lang)}</Text>
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
                                    <Text style={styles.diarioTimestamp}>{formattaDataOra(voce.timestamp)}</Text>
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

        {vistaAttiva === 'gestione' && (isGestore ? (() => {
          // Elenco completo delle prenotazioni che richiedono autorizzazione
          // speciale, indipendentemente dal mese o dallo stato: permette al
          // gestore di controllarle tutte da un unico punto d'accesso.
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
                <>
                  {/* --- Vista "Prenotazioni Speciali": elenco completo, ★ --- */}
                  <TouchableOpacity style={styles.backLinkRow} onPress={() => setGestioneVistaSpeciali(false)}>
                    <Text style={styles.backLinkText}>{isRTL ? `${t('torna', lang)} ›` : `‹ ${t('torna', lang)}`}</Text>
                  </TouchableOpacity>
                  <Text style={[styles.label, { marginBottom: 12 }]}>{t('prenotazioniSpeciali', lang)}</Text>

                  {prenotazioniSpecialiTutte.length === 0 && (
                    <Text style={styles.infoText}>{t('nessunaPrenotazione', lang)}</Text>
                  )}

                  {prenotazioniSpecialiTutte.length > 0 && (
                    <View style={styles.tableCard}>
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
                            <Text style={[styles.tableCell, styles.tableColTipo]} numberOfLines={1}>{p.fasce.join(', ')}</Text>
                            <View style={styles.tableColStato}>
                              <View style={[styles.statoBadge, { backgroundColor: coloreStatoPrenotazione }]}>
                                <Text style={styles.statoBadgeText}>{etichettaStatoPrenotazione}</Text>
                              </View>
                            </View>
                            <Text style={[styles.tableCell, styles.tableColData]}>{p.data}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </>
              ) : (
                <>
                  {/* --- Vista principale: pulsante Speciali + calendario a mesi --- */}
                  <TouchableOpacity style={styles.specialiButton} onPress={() => setGestioneVistaSpeciali(true)}>
                    <Text style={styles.specialiButtonText}>★ {t('speciali', lang)}</Text>
                    <View style={styles.specialiButtonBadge}>
                      <Text style={styles.specialiButtonBadgeText}>{prenotazioniSpecialiTutte.length}</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Tab dei mesi: ScrollView orizzontale con altezza fissa (necessaria
                      su Android, dove altrimenti una ScrollView orizzontale annidata
                      dentro una verticale può collassare a zero altezza). */}
                  <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setFiltroMeseGestioneDropdownAperto(true)}>
                    <Text style={styles.dropdownTriggerText}>{formattaMeseAnno(selezioneAttiva, lang)}</Text>
                    <Text style={styles.dropdownArrow}>▼</Text>
                  </TouchableOpacity>

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
                          <Text style={[styles.dayButtonText, pendente && styles.dayButtonTextPending]}>{giorno}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Dettaglio del giorno selezionato nel calendario: elenco delle
                  prenotazioni di quel giorno; toccandone una si apre la scheda
                  completa con i pulsanti Approva/Rifiuta/Elimina qui sotto. */}
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
                              {'  '}· {p.utenteNome} · {p.fasce.join(', ')}
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

              {/* Scheda di dettaglio della prenotazione, aperta cliccando una riga
                  della tabella "Speciali" o una voce nell'elenco del giorno: mostra
                  tutti i dettagli e i pulsanti Approva/Rifiuta/Elimina. */}
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
                          <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>{t('data', lang)}: {prenotazioneDettaglio.data} | {t('ore', lang)}: {prenotazioneDettaglio.fasce.join(', ')}</Text>
                          {prenotazioneDettaglio.motivo ? <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>{t('motivo', lang)}: {prenotazioneDettaglio.motivo}</Text> : null}
                          {prenotazioneDettaglio.studenteIPI ? (
                            <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>
                              {prenotazioneDettaglio.studenteIPI === 'si' ? t('sonoStudenteIPI', lang) : t('nonSonoStudenteIPI', lang)}
                            </Text>
                          ) : null}
                          {prenotazioneDettaglio.classe ? <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>{t('classe', lang)}: {prenotazioneDettaglio.classe}</Text> : null}
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

        {/* Sezione Impostazioni: menu a voci toccabili, ognuna apre la propria vista con un pulsante Indietro */}
        {vistaAttiva === 'impostazioni' && (isGestore ? (() => {
          const utentiFiltrati = utentiLista.filter((u) => {
            const query = cercaUtenteQuery.trim().toLowerCase();
            if (!query) return true;
            const nomeMatch = u.nome && u.nome.toLowerCase().includes(query);
            const emailMatch = u.email && u.email.toLowerCase().includes(query);
            return nomeMatch || emailMatch;
          });

          return (
            <ScrollView contentContainerStyle={styles.bodyContent}>
              <Text style={[styles.sectionHeaderTitle, { marginBottom: 14 }]}>{t('navImpostazioni', lang)}</Text>

              {impostazioniVista !== 'menu' && (
                <TouchableOpacity style={styles.backLinkRow} onPress={() => setImpostazioniVista('menu')}>
                  <Text style={styles.backLinkText}>{isRTL ? `${t('torna', lang)} ›` : `‹ ${t('torna', lang)}`}</Text>
                </TouchableOpacity>
              )}

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

                    <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('utenti')}>
                      <View style={styles.settingsMenuItemLeft}>
                        <Text style={styles.settingsMenuItemIcon}>👥</Text>
                        <Text style={styles.settingsMenuItemLabel}>{t('listaAggiuntaUtenti', lang)}</Text>
                      </View>
                      <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('domini')}>
                      <View style={styles.settingsMenuItemLeft}>
                        <Text style={styles.settingsMenuItemIcon}>🌐</Text>
                        <Text style={styles.settingsMenuItemLabel}>{t('permessiDomini', lang)}</Text>
                      </View>
                      <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('reset')}>
                      <View style={styles.settingsMenuItemLeft}>
                        <Text style={styles.settingsMenuItemIcon}>🗑️</Text>
                        <Text style={styles.settingsMenuItemLabel}>{t('areaResetGestore', lang)}</Text>
                      </View>
                      <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('blocca')}>
                      <View style={styles.settingsMenuItemLeft}>
                        <Text style={styles.settingsMenuItemIcon}>🚫</Text>
                        <Text style={styles.settingsMenuItemLabel}>{t('areaBloccaGestore', lang)}</Text>
                      </View>
                      <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.settingsMenuItem} onPress={() => setImpostazioniVista('esporta')}>
                      <View style={styles.settingsMenuItemLeft}>
                        <Text style={styles.settingsMenuItemIcon}>📤</Text>
                        <Text style={styles.settingsMenuItemLabel}>{t('areaEsportaGestore', lang)}</Text>
                      </View>
                      <Text style={styles.settingsMenuItemChevron}>{isRTL ? '‹' : '›'}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

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

              {impostazioniVista === 'notifiche' && (
                <View style={[styles.settingsCard, styles.settingsCardNarrow]}>
                  <Text style={styles.settingsCardTitle}>{t('sezioneNotifiche', lang)}</Text>
                  <TouchableOpacity style={styles.checkboxRow} onPress={toggleNotifichePush}>
                    <View style={[styles.checkboxBox, notifichePushAttive && styles.checkboxBoxChecked]}>
                      {notifichePushAttive && <Text style={styles.checkboxCheckmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkboxLabel}>{t('notifichePushAttive', lang)}</Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>{t('notifichePushSpiegazione', lang)}</Text>
                </View>
              )}

              {impostazioniVista === 'utenti' && (
                <View style={styles.settingsCard}>
                  <Text style={styles.settingsCardTitle}>{t('listaAggiuntaUtenti', lang)}</Text>
                  {/* Campo di ricerca dinamica in tempo reale */}
                  <TextInput
                    style={[styles.input, { marginBottom: 16 }]}
                    placeholder={t('cercaUtente', lang)}
                    placeholderTextColor={colors.placeholder}
                    value={cercaUtenteQuery}
                    onChangeText={setCercaUtenteQuery}
                  />

                  <TouchableOpacity style={[styles.addButton, { alignSelf: 'flex-start', marginBottom: 16 }]} onPress={() => setModalAggiungiUtente(true)}>
                    <Text style={styles.addButtonText}>{t('aggiungiUtente', lang)}</Text>
                  </TouchableOpacity>

                  {/* Nota fissa: chiarisce cosa fa davvero il pulsante Elimina,
                      visibile sempre (non solo al momento del click). */}
                  <Text style={[styles.infoTextSmall, { marginBottom: 6 }]}>{t('notaEliminaUtenteLista', lang)}</Text>
                  <Text style={[styles.infoTextSmall, { marginBottom: 14, fontStyle: 'italic' }]}>{t('toccaRigaUtente', lang)}</Text>

                  {utentiFiltrati.length === 0 ? (
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t('nessunUtenteTrovatoBlocco', lang)}</Text>
                  ) : (
                    <View style={styles.tableCard}>
                      <View style={styles.tableHeaderRow}>
                        <Text style={[styles.tableHeaderCell, styles.utentiColNome]}>{t('nome', lang)}</Text>
                        <Text style={[styles.tableHeaderCell, styles.utentiColEmail]}>{t('email', lang)}</Text>
                        <Text style={[styles.tableHeaderCell, styles.utentiColStato]}>{t('colonnaStatoEmail', lang)}</Text>
                      </View>
                      {utentiFiltrati.map((u, idx) => (
                        <TouchableOpacity key={u.id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]} onPress={() => setUtenteDettaglioTarget(u)}>
                          <Text style={[styles.tableCell, styles.utentiColNome]} numberOfLines={1} ellipsizeMode="tail">{u.nome}{u.bloccato ? ` (${t('utenteBloccatoBadge', lang)})` : ''}</Text>
                          <Text style={[styles.tableCell, styles.utentiColEmail]} numberOfLines={1} ellipsizeMode="tail">{u.email}</Text>
                          <View style={styles.utentiColStato}>
                            <View style={[styles.statoBadge, { backgroundColor: u.primoAccessoEffettuato === false ? colors.warning : colors.success }]}>
                              <Text style={styles.statoBadgeText} numberOfLines={1} ellipsizeMode="tail">
                                {u.primoAccessoEffettuato === false ? t('invitoInAttesa', lang) : t('emailVerificata', lang)}
                              </Text>
                            </View>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {impostazioniVista === 'domini' && (
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

              {impostazioniVista === 'reset' && (
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
                    <>
                      <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaModalitaReset', lang)}</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                        <TouchableOpacity 
                          style={[styles.tabButton, resetModalita === 'mensile' && styles.tabButtonActive]} 
                          onPress={() => setResetModalita('mensile')}
                        >
                          <Text style={[styles.tabButtonText, resetModalita === 'mensile' && styles.tabButtonTextActive]}>{t('mensile', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={[styles.tabButton, resetModalita === 'annuale' && styles.tabButtonActive]} 
                          onPress={() => setResetModalita('annuale')}
                        >
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
                    <>
                      <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaModalitaReset', lang)}</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                        <TouchableOpacity
                          style={[styles.tabButton, archivioManutenzioneModalita === 'mensile' && styles.tabButtonActive]}
                          onPress={() => setArchivioManutenzioneModalita('mensile')}
                        >
                          <Text style={[styles.tabButtonText, archivioManutenzioneModalita === 'mensile' && styles.tabButtonTextActive]}>{t('mensile', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.tabButton, archivioManutenzioneModalita === 'annuale' && styles.tabButtonActive]}
                          onPress={() => setArchivioManutenzioneModalita('annuale')}
                        >
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

              {impostazioniVista === 'blocca' && (() => {
                // Suggerimenti in tempo reale mentre si digita nome o email
                // (ricerca rapida di un singolo utente, indipendente dal mese/anno).
                const queryBlocco = bloccaCercaQuery.trim().toLowerCase();
                const suggerimentiBlocco = queryBlocco.length === 0 ? [] : utentiLista
                  .filter((u) => {
                    if (u.email === user.email) return false;
                    const nomeMatch = u.nome && u.nome.toLowerCase().includes(queryBlocco);
                    const emailMatch = u.email && u.email.toLowerCase().includes(queryBlocco);
                    return nomeMatch || emailMatch;
                  })
                  .slice(0, 8);

                // Elenco completo (tipo excel) degli utenti registrati nel mese/anno scelto.
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

                  {/* Ricerca rapida di un utente per nome o email, con suggerimenti live */}
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

                  {/* Elenco tipo excel di tutti gli utenti registrati nel periodo scelto,
                      con possibilità di blocco/sblocco individuale riga per riga. */}
                  <Text style={[styles.label, { marginTop: 20, marginBottom: 10 }]}>{t('elencoUtentiPeriodo', lang)}</Text>
                  {utentiPeriodo.length === 0 ? (
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t('nessunUtentePeriodo', lang)}</Text>
                  ) : (
                    <View style={styles.excelTable}>
                      <View style={styles.excelRowHeader}>
                        <Text style={[styles.excelCellHeader, { flex: 2 }]}>{t('nome', lang)}</Text>
                        <Text style={[styles.excelCellHeader, { flex: 2 }]}>{t('email', lang)}</Text>
                        <Text style={[styles.excelCellHeader, { flex: 2 }]}>{t('colonnaRegistrazione', lang)}</Text>
                        <Text style={[styles.excelCellHeader, { flex: 1 }]}>{t('colonnaAzione', lang)}</Text>
                      </View>
                      {utentiPeriodo.map((u, idx) => (
                        <View key={u.id} style={[styles.excelRow, idx % 2 === 0 ? styles.excelRowEven : styles.excelRowOdd]}>
                          <Text style={[styles.excelCell, { flex: 2 }]}>{u.nome}{u.bloccato ? ` (${t('utenteBloccatoBadge', lang)})` : ''}</Text>
                          <Text style={[styles.excelCell, { flex: 2 }]}>{u.email}</Text>
                          <Text style={[styles.excelCell, { flex: 2 }]}>{formattaDataOra(u.createdAt)}</Text>
                          <View style={{ flex: 1, alignItems: 'center' }}>
                            {u.email !== user.email && (
                              <TouchableOpacity
                                style={[styles.excelDeleteBtn, { backgroundColor: u.bloccato ? colors.success : colors.danger }]}
                                onPress={() => eseguiBloccoSingolo(u, !u.bloccato)}
                              >
                                <Text style={styles.excelDeleteText}>{u.bloccato ? t('sbloccaSingolo', lang) : t('bloccaSingolo', lang)}</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                );
              })()}

              {impostazioniVista === 'esporta' && (
                <View style={styles.resetPanelCard}>
                  <Text style={[styles.aulaTitle, { color: colors.primary, marginBottom: 14 }]}>{t('areaEsportaGestore', lang)}</Text>

                  <Text style={[styles.label, { marginBottom: 10 }]}>{t('resetSceltaTipo', lang)}</Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                    <TouchableOpacity
                      style={[styles.tabButton, esportaTipoSelezionato === 'prenotazioni' && styles.tabButtonActive]}
                      onPress={() => setEsportaTipoSelezionato('prenotazioni')}
                    >
                      <Text style={[styles.tabButtonText, esportaTipoSelezionato === 'prenotazioni' && styles.tabButtonTextActive]}>{t('resetTipoPrenotazioni', lang)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.tabButton, esportaTipoSelezionato === 'manutenzione' && styles.tabButtonActive]}
                      onPress={() => setEsportaTipoSelezionato('manutenzione')}
                    >
                      <Text style={[styles.tabButtonText, esportaTipoSelezionato === 'manutenzione' && styles.tabButtonTextActive]}>{t('resetTipoManutenzione', lang)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.tabButton, esportaTipoSelezionato === 'utenti' && styles.tabButtonActive]}
                      onPress={() => setEsportaTipoSelezionato('utenti')}
                    >
                      <Text style={[styles.tabButtonText, esportaTipoSelezionato === 'utenti' && styles.tabButtonTextActive]}>{t('resetTipoUtenti', lang)}</Text>
                    </TouchableOpacity>
                  </View>

                  {esportaTipoSelezionato === 'prenotazioni' && (
                    <>
                      <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaModalitaReset', lang)}</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                        <TouchableOpacity 
                          style={[styles.tabButton, resetModalita === 'mensile' && styles.tabButtonActive]} 
                          onPress={() => setResetModalita('mensile')}
                        >
                          <Text style={[styles.tabButtonText, resetModalita === 'mensile' && styles.tabButtonTextActive]}>{t('mensile', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={[styles.tabButton, resetModalita === 'annuale' && styles.tabButtonActive]} 
                          onPress={() => setResetModalita('annuale')}
                        >
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

                  {esportaTipoSelezionato === 'manutenzione' && (
                    <>
                      <Text style={[styles.label, { marginBottom: 10 }]}>{t('selezionaModalitaReset', lang)}</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                        <TouchableOpacity
                          style={[styles.tabButton, archivioManutenzioneModalita === 'mensile' && styles.tabButtonActive]}
                          onPress={() => setArchivioManutenzioneModalita('mensile')}
                        >
                          <Text style={[styles.tabButtonText, archivioManutenzioneModalita === 'mensile' && styles.tabButtonTextActive]}>{t('mensile', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.tabButton, archivioManutenzioneModalita === 'annuale' && styles.tabButtonActive]}
                          onPress={() => setArchivioManutenzioneModalita('annuale')}
                        >
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

                  {esportaTipoSelezionato === 'utenti' && (
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
            </ScrollView>
          );
        })() : (
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Text style={[styles.sectionHeaderTitle, { marginBottom: 14 }]}>{t('navImpostazioni', lang)}</Text>

            {impostazioniVista !== 'menu' && (
              <TouchableOpacity style={styles.backLinkRow} onPress={() => setImpostazioniVista('menu')}>
                <Text style={styles.backLinkText}>{isRTL ? `${t('torna', lang)} ›` : `‹ ${t('torna', lang)}`}</Text>
              </TouchableOpacity>
            )}

            {impostazioniVista === 'menu' && (
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
              </View>
            )}

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

            {impostazioniVista === 'notifiche' && (
              <View style={[styles.settingsCard, styles.settingsCardNarrow]}>
                <Text style={styles.settingsCardTitle}>{t('sezioneNotifiche', lang)}</Text>
                <TouchableOpacity style={styles.checkboxRow} onPress={toggleNotifichePush}>
                  <View style={[styles.checkboxBox, notifichePushAttive && styles.checkboxBoxChecked]}>
                    {notifichePushAttive && <Text style={styles.checkboxCheckmark}>✓</Text>}
                  </View>
                  <Text style={styles.checkboxLabel}>{t('notifichePushAttive', lang)}</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>{t('notifichePushSpiegazione', lang)}</Text>
              </View>
            )}
          </ScrollView>
        ))}
      </View>

      {/* Barra di navigazione in basso, solo Android: le sezioni principali su
          mobile occupavano troppo spazio come barra orizzontale in alto (andava
          a capo su più righe). Qui restano sempre a un tap di distanza, in un
          formato compatto e familiare per chi usa app Android/iOS ogni giorno. */}
      {Platform.OS === 'android' && (
        <View style={[styles.bottomTabBar, { paddingBottom: Math.max(insets.bottom, 8) + 10 }]}>
          <TouchableOpacity style={styles.bottomTabItem} onPress={() => { setVistaAttiva('home'); setSezioneSelezionata(null); setModalitaModificaAule(false); }}>
            <Text style={[styles.bottomTabIcon, vistaAttiva === 'home' && styles.bottomTabIconActive]}>🏠</Text>
            <Text style={[styles.bottomTabLabel, vistaAttiva === 'home' && styles.bottomTabLabelActive]} numberOfLines={1}>{t('navHome', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomTabItem} onPress={() => setVistaAttiva('calendario')}>
            <Text style={[styles.bottomTabIcon, vistaAttiva === 'calendario' && styles.bottomTabIconActive]}>📅</Text>
            <Text style={[styles.bottomTabLabel, vistaAttiva === 'calendario' && styles.bottomTabLabelActive]} numberOfLines={1}>{t('navCalendario', lang)}</Text>
          </TouchableOpacity>
          {isGestore && (
            <TouchableOpacity style={styles.bottomTabItem} onPress={() => setVistaAttiva('gestione')}>
              <Text style={[styles.bottomTabIcon, vistaAttiva === 'gestione' && styles.bottomTabIconActive]}>📋</Text>
              <Text style={[styles.bottomTabLabel, vistaAttiva === 'gestione' && styles.bottomTabLabelActive]} numberOfLines={1}>{t('navGestione', lang)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.bottomTabItem} onPress={() => setVistaAttiva('manutenzione')}>
            <Text style={[styles.bottomTabIcon, vistaAttiva === 'manutenzione' && styles.bottomTabIconActive]}>🛠️</Text>
            <Text style={[styles.bottomTabLabel, vistaAttiva === 'manutenzione' && styles.bottomTabLabelActive]} numberOfLines={1}>{t('navManutenzione', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomTabItem} onPress={() => setVistaAttiva('impostazioni')}>
            <Text style={[styles.bottomTabIcon, vistaAttiva === 'impostazioni' && styles.bottomTabIconActive]}>⚙️</Text>
            <Text style={[styles.bottomTabLabel, vistaAttiva === 'impostazioni' && styles.bottomTabLabelActive]} numberOfLines={1}>{t('navImpostazioni', lang)}</Text>
          </TouchableOpacity>
        </View>
      )}

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
                  // Se la data selezionata è quella odierna, blocca le fasce il cui
                  // orario di inizio è già passato rispetto all'ora attuale, così
                  // via via che passano le ore quelle fasce diventano intoccabili.
                  const orarioInizioFascia = fascia.split('-')[0]; // es. "08:00"
                  const oraAttualeStr = new Date().toTimeString().slice(0, 5); // "HH:MM" locale
                  const passata = dataPrenotazione === oggiStr && orarioInizioFascia <= oraAttualeStr;
                  const selezionata = fasceSelezionate.includes(fascia);
                  return (
                    <TouchableOpacity key={fascia} disabled={occupata || passata} style={[styles.fasciaChip, selezionata && styles.fasciaSelected, (occupata || passata) && styles.fasciaOccupata]} onPress={() => toggleFascia(fascia)}>
                      <Text style={[styles.fasciaText, selezionata && styles.fasciaTextSelected]}>{fascia}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>{t('motivoUso', lang)}</Text>
              <TextInput style={styles.input} placeholder={t('motivoObbligatorio', lang)} placeholderTextColor={colors.placeholder} value={motivo} onChangeText={setMotivo} />

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

      <Modal visible={modalModificaSezione} animationType="slide" transparent onRequestClose={() => setModalModificaSezione(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFixed}>
            <View style={styles.modalHeaderFixed}>
              <Text style={styles.modalTitle}>{t('modifica', lang)} Sezione</Text>
              <TouchableOpacity onPress={() => setModalModificaSezione(false)}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBodyScrollable} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Nome Sezione:</Text>
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

      {/* Modal Blocca Aula (Gestore): periodo libero, non limitato ai mesi
          previsti per le prenotazioni normali. */}
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
                <input
                  type="date"
                  value={dataInizioBlocco}
                  onChange={onChangeDateBloccoInizioWeb}
                  style={webDateInputStyle}
                />
              ) : (
                <>
                  <TouchableOpacity style={styles.datePickerButton} onPress={() => setShowDatePickerBloccoInizio(true)}>
                    <Text style={styles.datePickerButtonText}>📅 {dataInizioBlocco || '—'}</Text>
                  </TouchableOpacity>
                  {showDatePickerBloccoInizio && (
                    <DateTimePicker
                      value={dataInizioBloccoObj}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'default'}
                      onChange={onChangeDateBloccoInizio}
                    />
                  )}
                </>
              )}

              <Text style={styles.label}>{t('dataFineBlocco', lang)}</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={dataFineBlocco}
                  min={dataInizioBlocco || undefined}
                  onChange={onChangeDateBloccoFineWeb}
                  style={webDateInputStyle}
                />
              ) : (
                <>
                  <TouchableOpacity style={styles.datePickerButton} onPress={() => setShowDatePickerBloccoFine(true)}>
                    <Text style={styles.datePickerButtonText}>📅 {dataFineBlocco || '—'}</Text>
                  </TouchableOpacity>
                  {showDatePickerBloccoFine && (
                    <DateTimePicker
                      value={dataFineBloccoObj}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'default'}
                      minimumDate={dataInizioBloccoObj}
                      onChange={onChangeDateBloccoFine}
                    />
                  )}
                </>
              )}

              <Text style={styles.label}>{t('motivo', lang)}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('motivoBloccoPlaceholder', lang)}
                placeholderTextColor={colors.placeholder}
                value={motivoBlocco}
                onChangeText={setMotivoBlocco}
              />
            </ScrollView>
            <View style={styles.modalFooterFixed}>
              <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.danger }]} onPress={confermaBloccoAula}>
                <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>{t('confermaBlocco', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Aggiungi Utente (Gestore): nome, email, ruolo, password generabile.
          Alla creazione viene inviata un'email di reset password (invito) al
          posto della verifica email — vedi aggiungiUtenteManuale. */}
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
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {['utente', 'gestore', 'manutentore'].map((ruolo) => (
                  <TouchableOpacity
                    key={ruolo}
                    style={[styles.monthTabChip, nuovoUtenteRuolo === ruolo && styles.monthTabChipActive]}
                    onPress={() => setNuovoUtenteRuolo(ruolo)}
                  >
                    <Text style={[styles.monthTabChipText, nuovoUtenteRuolo === ruolo && styles.monthTabChipTextActive]}>{etichettaRuolo(ruolo, lang)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>{t('password', lang)}:</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <TextInput style={[styles.input, { flex: 1 }]} placeholder={t('password', lang)} placeholderTextColor={colors.placeholder} autoCapitalize="none" value={nuovoUtentePassword} onChangeText={setNuovoUtentePassword} />
                <TouchableOpacity style={styles.smallEditBtn} onPress={generaPasswordCasuale}>
                  <Text style={[styles.btnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('generaPassword', lang)}</Text>
                </TouchableOpacity>
              </View>
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

      {/* Scheda di dettaglio utente: aperta toccando una riga della tabella
          Lista/Aggiunta Utenti. Mostra ruolo e stato completi, e i pulsanti
          Rinvia invito (se in attesa), Cambia Ruolo ed Elimina. */}
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
                  <Text style={[styles.gestioneListMeta, { marginTop: 4 }]}>{t('colonnaRuolo', lang)}: {etichettaRuolo(utenteDettaglioTarget.role, lang)}</Text>
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
                    <TouchableOpacity
                      style={styles.utentiAzioneBtn}
                      onPress={() => { setUtenteRuoloModalTarget({ id: utenteDettaglioTarget.id, role: utenteDettaglioTarget.role }); setUtenteDettaglioTarget(null); }}
                    >
                      <Text style={[styles.utentiAzioneBtnText, { color: isDarkMode ? '#F8FAFC' : '#0F172A' }]}>{t('cambiaRuolo', lang)}</Text>
                    </TouchableOpacity>
                    {utenteDettaglioTarget.email !== user.email && (
                      <TouchableOpacity
                        style={styles.utentiAzioneDeleteBtn}
                        onPress={() => { eliminaUtenteDallaLista(utenteDettaglioTarget); setUtenteDettaglioTarget(null); }}
                      >
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

      {/* Modal per scegliere il ruolo di un utente (Utente / Gestore / Manutentore) */}
      <Modal visible={utenteRuoloModalTarget !== null} animationType="fade" transparent onRequestClose={() => setUtenteRuoloModalTarget(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setUtenteRuoloModalTarget(null)}>
          <View style={styles.dropdownOptionsList}>
            <Text style={[styles.label, { textAlign: 'center', marginBottom: 8 }]}>{t('scegliRuolo', lang)}</Text>
            {['utente', 'gestore', 'manutentore'].map((ruolo) => {
              const attivo = utenteRuoloModalTarget?.role === ruolo;
              return (
                <TouchableOpacity
                  key={ruolo}
                  style={[styles.dropdownOption, attivo && styles.dropdownOptionActive]}
                  onPress={() => utenteRuoloModalTarget && impostaRuoloUtente(utenteRuoloModalTarget.id, ruolo)}
                >
                  <Text style={[styles.dropdownOptionText, attivo && styles.dropdownOptionTextActive]}>{etichettaRuolo(ruolo, lang)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const softShadow = (colors, opacity = 0.08, radius = 8, y = 2) => ({
  shadowColor: colors.shadow,
  shadowOffset: { width: 0, height: y },
  shadowOpacity: opacity,
  shadowRadius: radius,
  elevation: Math.max(1, Math.round(radius / 3))
});

const getDynamicStyles = (colors, isRTL) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingTop: ANDROID_STATUSBAR_HEIGHT },

  authBox: { flex: 1, width: '100%' },
  // Filigrana del logo (solo cerchio, inclinato) dietro alle schermate
  // interne dell'app: grande, ancorata in basso a destra e "tagliata" dal
  // bordo dello schermo, a bassissima opacità così non interferisce mai
  // con la leggibilità di testi/tabelle sopra di essa.
  contentWatermark: {
    position: 'absolute',
    opacity: colors.watermarkOpacity
  },
  // Sfondo fotografico della schermata di accesso: la foto è coperta da un
  // velo scuro semi-trasparente (opacity) così il testo e i campi restano
  // sempre leggibili sia in tema chiaro che scuro.
  authBackground: { flex: 1, width: '100%' },
  // Solo Android: niente foto a tutto schermo (diventerebbe gigante/ritagliata
  // male su schermi stretti). Il logo compare invece come filigrana trasparente
  // dietro al modulo di accesso/registrazione, sullo sfondo normale dell'app
  // (chiaro o scuro a seconda del tema), così testi e caselle restano leggibili.
  authWatermarkWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  authWatermarkFixed: { width: 220, height: 220, opacity: colors.watermarkOpacity },
  authOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,14,22,0.60)' },
  authTopBar: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 20, paddingTop: 12 },
  // paddingTop più basso su Android: senza il logo grande sopra (rimosso per
  // non coprire il watermark) il form può stare più in alto, lasciando più
  // spazio libero sotto quando si apre la tastiera. paddingBottom ridotto per
  // lo stesso motivo, così il pulsante "Accedi" resta comunque raggiungibile.
  authCenter: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: Platform.OS === 'web' ? 56 : 16, paddingBottom: Platform.OS === 'android' ? 40 : 90, maxWidth: 400, alignSelf: 'center', width: '100%' },
  forgotPasswordText: { color: colors.primary, fontSize: 13, fontWeight: '600' },

  input: { backgroundColor: colors.surface, color: colors.textMain, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 12, fontSize: Platform.OS === 'web' ? 17 : 15 },
  passwordFieldRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, marginBottom: 12, [isRTL ? 'paddingLeft' : 'paddingRight']: 44 },
  passwordToggleBtn: { position: 'absolute', [isRTL ? 'left' : 'right']: 12, top: 0, bottom: 12, justifyContent: 'center', alignItems: 'center' },
  passwordToggleIcon: { fontSize: 18 },
  primaryButton: { backgroundColor: colors.primary, padding: 15, borderRadius: 12, alignItems: 'center', ...softShadow(colors, 0.18, 6, 3) },
  buttonText: { color: colors.primaryText, fontWeight: '700', fontSize: Platform.OS === 'web' ? 17 : 16 },
  switchAuthText: { color: colors.textMuted, textAlign: 'center', marginTop: 16 },
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
    ...softShadow(colors, 0.05, 6, 2)
  },
  // Barra a 3 colonne vere (sinistra / centro / destra) invece di un blocco
  // centrale sovrapposto in posizione assoluta: così tutti e tre i gruppi
  // condividono lo stesso asse di centratura verticale e l'altezza della
  // barra si adatta sempre al contenuto più alto, senza mai tagliarlo.
  headerSideGroup: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  headerLeftGroup: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  headerCenterGroup: { alignItems: 'center', flexShrink: 0 },
  headerIconsRow: Platform.OS === 'web'
    ? { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }
    : { flexDirection: 'row', alignItems: 'center', gap: 8, rowGap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1 },
  headerIconsRowLTR: {},
  headerIconsRowRTL: { flexDirection: 'row-reverse' },
 headerTitleCentered: { color: colors.textMain, fontSize: Platform.OS === 'web' ? 15 : 13, fontWeight: '700', fontFamily: FONT_FAMILY, lineHeight: Platform.OS === 'web' ? 18 : 16 },
  headerSubtitleCentered: { color: colors.textMuted, fontSize: Platform.OS === 'web' ? 15 : 12, fontFamily: FONT_FAMILY, lineHeight: Platform.OS === 'web' ? 19 : 15, marginTop: 6 },
  headerTitle: { color: colors.textMain, fontSize: 18, fontWeight: '700', fontFamily: FONT_FAMILY, lineHeight: 22 },
  headerSubtitle: { color: colors.textMuted, fontSize: 14, fontFamily: FONT_FAMILY, lineHeight: 18 },
  roleGold: { color: colors.primary, fontWeight: '700', fontFamily: FONT_FAMILY },
  logoutBtn: { backgroundColor: colors.border, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12 },
  logoutText: { color: colors.textMain, fontSize: 16 },
  langBtnHeader: { backgroundColor: colors.border, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.moveBtn },
  notificaBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: colors.danger, borderRadius: 11, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  notificaBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 11 },
  langTextHeader: { color: colors.primary, fontSize: 17, fontWeight: '700' },
  navBar: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border, paddingHorizontal: 12, flexWrap: 'wrap' },
  navItem: { color: colors.textSub, fontWeight: '500', paddingVertical: 13, paddingHorizontal: 12, fontSize: 15 },
  navActive: { color: colors.primary, fontWeight: '700', borderBottomWidth: 2, borderColor: colors.primary },
  // Barra di navigazione in basso (solo Android): icona + etichetta breve per
  // sezione, sempre a un tap di distanza, altezza fissa indipendentemente dal
  // numero di sezioni (non va mai a capo come faceva la barra orizzontale).
  bottomTabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 8,
    // paddingBottom viene sovrascritto a runtime con l'inset reale (vedi
    // dove viene usato lo stile), così la barra resta sempre sopra la
    // barra di sistema Android, sia essa a 3 tasti, a gesture o assente.
    paddingBottom: 14,
    ...softShadow(colors, 0.08, 8, -2)
  },
  bottomTabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 4 },
  bottomTabIcon: { fontSize: 20, opacity: 0.55 },
  bottomTabIconActive: { opacity: 1 },
  bottomTabLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '500', fontFamily: FONT_FAMILY },
  bottomTabLabelActive: { color: colors.primary, fontWeight: '700' },
  cardGrid: { gap: 8, marginBottom: 18 },
  cleanCardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
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
    ...softShadow(colors)
  },
  cleanCardText: { color: colors.textMain, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  bodyContent: { padding: 16, paddingBottom: 48, maxWidth: 820, width: '100%', alignSelf: 'center' },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  sectionHeaderTitle: { color: colors.textMain, fontSize: 19, fontWeight: '700' },
  aulaCard: { backgroundColor: colors.surface, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, ...softShadow(colors, 0.05, 6, 2) },
  // Card dedicata al pannello Reset: NON riusa aulaCard perché quello stile
  // porta con sé proprietà pensate per righe orizzontali (justifyContent
  // space-between, flexWrap) che con contenuto verticale causano
  // sovrapposizioni. Questa è isolata e pensata solo per contenuto a colonna.
  resetPanelCard: { backgroundColor: colors.surface, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 8, flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', maxWidth: 640, width: '100%', ...softShadow(colors, 0.05, 6, 2) },
  settingsCard: { backgroundColor: colors.surface, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 16, maxWidth: 640, width: '100%', ...softShadow(colors, 0.05, 6, 2) },
  settingsCardNarrow: { maxWidth: 480 },
  settingsCardTitle: { color: colors.textMain, fontSize: 15, fontWeight: '700', marginBottom: 12 },
  settingsMenuSottotitolo: { color: colors.textMuted, fontSize: 13, marginBottom: 16 },
  settingsMenuList: Platform.OS === 'web'
    ? { flexDirection: 'row', flexWrap: 'wrap', gap: 12, rowGap: 12, maxWidth: 820, width: '100%', alignSelf: isRTL ? 'flex-end' : 'flex-start' }
    : { gap: 10, maxWidth: 480, width: '100%', alignSelf: isRTL ? 'flex-end' : 'flex-start' },
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
    ...softShadow(colors, 0.05, 6, 2)
  },
  settingsMenuItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, flexShrink: 1, minWidth: 0 },
  settingsMenuItemIcon: { fontSize: 20 },
  settingsMenuItemLabel: { color: colors.textMain, fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: isRTL ? 'right' : 'left' },
  settingsMenuItemChevron: { color: colors.primary, fontSize: 20, fontWeight: '700', flexShrink: 0, marginLeft: isRTL ? 0 : 8, marginRight: isRTL ? 8 : 0 },
  aulaTitle: { color: colors.textMain, fontSize: 15, fontWeight: '700' },
  aulaDesc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  primaryButtonSmall: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  buttonTextSmall: { color: colors.primaryText, fontWeight: '700', fontSize: 14 },
  gestioneGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gestoreCard: { backgroundColor: colors.surface, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, width: '31%', minWidth: 240, ...softShadow(colors) },
  infoText: { color: colors.textSub, fontSize: Platform.OS === 'web' ? 15 : 13, marginTop: 2 },
  infoTextSmall: { color: colors.textMuted, fontSize: 11 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  dropdownTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 2, borderColor: colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 16, ...softShadow(colors, 0.15, 6, 3) },
  dropdownTriggerText: { color: colors.textMain, fontSize: Platform.OS === 'web' ? 16 : 14, fontWeight: '600' },
  dropdownArrow: { color: colors.textMuted, fontSize: 12 },
  dropdownOptionsList: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 8, maxWidth: 340, width: '90%', alignSelf: 'center' },
  dropdownOption: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8 },
  dropdownOptionActive: { backgroundColor: colors.primary },
  dropdownOptionText: { color: colors.textMain, fontSize: Platform.OS === 'web' ? 17 : 15 },
  dropdownOptionTextActive: { color: colors.primaryText, fontWeight: '700' },
  gestioneListRow: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8, gap: 4, ...softShadow(colors, 0.04, 5, 2) },
  gestioneListTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  gestioneListTitle: { color: colors.textMain, fontWeight: '700', fontSize: 14, flexShrink: 1 },
  gestioneListMeta: { color: colors.textMuted, fontSize: 12 },
  btnApprove: { backgroundColor: colors.success, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', alignSelf: 'flex-start' },
  btnReject: { backgroundColor: colors.danger, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', alignSelf: 'flex-start' },
  btnDelete: { backgroundColor: colors.moveBtn, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', alignSelf: 'flex-start' },
  btnText: { color: '#F8FAFC', fontWeight: '700', fontSize: 12 },
  // --- Griglia tabellare "Manutenzione" ---
  tableCard: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 16 },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderBottomWidth: 2, borderColor: colors.primary },
  tableHeaderCell: { color: colors.textMain, fontWeight: '700', fontSize: Platform.OS === 'web' ? 14 : 12, paddingVertical: 10, paddingHorizontal: 8, textAlign: isRTL ? 'right' : 'left' },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border },
  tableRowAlt: { backgroundColor: colors.altRow },
  tableCell: { color: colors.textSub, fontSize: Platform.OS === 'web' ? 14 : 12, paddingVertical: 10, paddingHorizontal: 8, textAlign: isRTL ? 'right' : 'left' },
  tableColAula: { flex: 1.3 },
  tableColUtente: { flex: 1.1 },
  tableColTipo: { flex: 0.9 },
  tableColStato: { flex: 1 },
  tableColData: { flex: 0.9 },
  statoBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7 },
  statoBadgeText: { fontSize: 11, fontWeight: '700', color: '#F8FAFC' },
  // --- Tabella "Lista e Aggiunta Utenti" in Impostazioni: stesso stile
  // compatto della tabella di Gestione Prenotazioni/Manutenzione
  // (tableCard/tableRow, niente linee verticali, riga singola). Solo
  // Nome/Email/Stato in tabella: Ruolo e Azioni (Cambia Ruolo/Elimina)
  // sono nella scheda di dettaglio aperta toccando la riga, così l'email
  // ha più spazio per leggersi bene anche su schermi stretti. ---
  utentiColNome: { flex: 1 },
  utentiColEmail: { flex: 2.3 },
  utentiColStato: { flex: 1.1 },
  // Pulsanti azione riusati nella scheda di dettaglio utente (Cambia Ruolo / Elimina)
  utentiAzioneRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 4 },
  utentiAzioneBtn: { backgroundColor: colors.border, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10 },
  utentiAzioneBtnText: { fontSize: 14, fontWeight: '700' },
  utentiAzioneDeleteBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center'
  },
  utentiAzioneDeleteBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', lineHeight: 20 },
  // --- Modale di dettaglio segnalazione ---
  storicoBlocco: { backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 12, marginTop: 4, marginBottom: 16, gap: 6 },
  storicoRiga: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  storicoLabel: { color: colors.textMuted, fontSize: 12 },
  storicoValore: { color: colors.textMain, fontSize: 12, fontWeight: '600' },
  diarioBlocco: { marginTop: 8 },
  diarioVoce: { backgroundColor: colors.surfaceAlt, borderRadius: 8, padding: 10, marginBottom: 6, gap: 2 },
  diarioVoceNonLetta: {
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    ...softShadow(colors, 0.12, 4, 2)
  },
  diarioVoceLetta: { opacity: 0.68 },
  diarioVoceHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  diarioAutore: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  diarioAutoreLetta: { color: colors.textMuted, fontWeight: '600' },
  diarioPallino: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  diarioTimestamp: { color: colors.textMuted, fontSize: 11 },
  diarioTesto: { color: colors.textSub, fontSize: 13 },
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
  modalTitle: { color: colors.textMain, fontSize: Platform.OS === 'web' ? 21 : 18, fontWeight: '700', flex: 1, paddingRight: 8 },
  closeText: { color: colors.textMain, fontSize: Platform.OS === 'web' ? 22 : 18 },
  modalBodyScrollable: { flexGrow: 0, flexShrink: 1 },
  modalFooterFixed: { paddingTop: 14, borderTopWidth: 1, borderColor: colors.border, marginTop: 10 },
  label: { color: colors.textMain, fontSize: Platform.OS === 'web' ? 16 : 14, marginBottom: 8, marginTop: 4 },
  datePickerButton: { backgroundColor: colors.surface, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  datePickerButtonText: { color: colors.primary, fontSize: 15 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, marginTop: 2 },
  checkboxBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface
  },
  checkboxBoxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxCheckmark: { color: colors.primaryText, fontSize: 14, fontWeight: '700' },
  checkboxLabel: { color: colors.textMain, fontSize: 14, fontWeight: '600' },
  ripetizioneRiepilogo: { color: colors.textMuted, fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  avvisoSpeciale: { backgroundColor: 'rgba(220,38,38,0.12)', borderWidth: 1, borderColor: colors.danger, borderRadius: 8, padding: 10, marginTop: 8 },
  avvisoSpecialeTesto: { color: colors.danger, fontSize: 12, fontWeight: '600' },
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
  fasciaText: { color: colors.textMain, fontSize: Platform.OS === 'web' ? 15 : 13, textAlign: 'center' },
  fasciaTextSelected: { color: colors.primaryText, fontWeight: '700' },
  blockedText: { color: colors.danger, textAlign: 'center', marginBottom: 12, fontSize: 15 },
  androidDownloadBanner: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 20
  },
  androidDownloadBannerTitle: { color: colors.textMuted, fontSize: 13, marginBottom: 8, textAlign: 'center' },
  androidDownloadBannerButton: { color: colors.primary, fontSize: 15, fontWeight: '700' },
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
  editToggleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  editToggleBtnText: { color: colors.primaryText, fontWeight: '600', fontSize: 12 },
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
  dayLegendDot: { width: 10, height: 10, borderRadius: 5 },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  dayButton: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  dayButtonFree: { backgroundColor: colors.success },
  dayButtonBusy: { backgroundColor: colors.danger },
  dayButtonPast: { backgroundColor: colors.surface, opacity: 0.4 },
  dayButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  dayButtonTextPast: { color: colors.textMuted },
  dayButtonPending: { backgroundColor: colors.warning },
  dayButtonTextPending: { color: colors.warningText },
  // --- Tab dei mesi in Gestione Prenotazioni (con attenzione ad Android: la
  // ScrollView orizzontale ha un'altezza fissa, altrimenti su Android può
  // collassare a zero quando è annidata dentro una ScrollView verticale). ---
  monthTabsWrap: { height: 46, marginBottom: 16 },
  monthTabsContent: { alignItems: 'center', gap: 8, paddingRight: 8 },
  monthTabChip: { backgroundColor: colors.surfaceAlt, borderWidth: 2, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' },
  monthTabChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  monthTabChipText: { color: colors.textMain, fontSize: 13, fontWeight: '600' },
  monthTabChipTextActive: { color: colors.primaryText, fontWeight: '700' },
  // --- Pulsante "★ Speciali (N)" ---
  specialiButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceAlt, borderWidth: 2, borderColor: colors.danger, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16, alignSelf: 'flex-start' },
  specialiButtonText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  specialiButtonBadge: { backgroundColor: colors.danger, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  specialiButtonBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 11 },
  backLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, alignSelf: 'flex-start' },
  backLinkText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  appName: { color: colors.primary, fontSize: 17, fontWeight: '700', textAlign: 'center', marginTop: 6, marginBottom: 20, letterSpacing: 0.5 },
  appNameSmall: { color: colors.primary, fontSize: Platform.OS === 'web' ? 17 : 12, fontWeight: '700', letterSpacing: 0.5, fontFamily: FONT_FAMILY, marginTop: Platform.OS === 'web' ? 5 : 3, textAlign: 'center' },
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