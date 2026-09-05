import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: "AIzaSyBTjvQ8OqyTcMOM1hyhxWmav7M8rj1AR7g",
  authDomain: "gestione-aule-f9286.firebaseapp.com",
  projectId: "gestione-aule-f9286",
  storageBucket: "gestione-aule-f9286.firebasestorage.app",
  messagingSenderId: "276495707416",
  appId: "1:276495707416:web:301f6072f1c4347bbf426d"
};

// MODIFICATO: evita di reinizializzare l'app Firebase più volte durante il
// Fast Refresh di Expo (in dev mode il modulo viene ricaricato spesso, e
// initializeApp() chiamata due volte sulla stessa config genera conflitti).
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// MODIFICATO: su web, di default Firebase Auth usa IndexedDB come persistenza,
// che è proprio il modulo che genera l'errore "Database is closing/hidden"
// quando il Fast Refresh ricarica il modulo mentre una connessione IndexedDB
// precedente si sta ancora chiudendo. browserLocalPersistence usa invece
// localStorage, che è sincrono e non soffre di questa race condition.
//
// MODIFICATO (Android/iOS): prima qui si usava getAuth(app) anche su nativo,
// che di default tiene la sessione SOLO in memoria RAM. Risultato: appena
// l'app veniva chiusa dal task switcher (o il processo terminato dal
// sistema), la sessione si perdeva e al riapertura tornava alla schermata
// di login anche se l'utente non aveva mai premuto "Esci". Con
// initializeAuth + getReactNativePersistence(AsyncStorage), la sessione
// viene salvata sul dispositivo e ripristinata automaticamente: l'utente
// resta loggato tra un'apertura e l'altra dell'app, esattamente come le
// altre app che usano il login persistente.
let auth;
if (Platform.OS === 'web') {
  try {
    auth = initializeAuth(app, { persistence: browserLocalPersistence });
  } catch (e) {
    // initializeAuth() può essere chiamata una sola volta per app: se il
    // modulo viene ricaricato (Fast Refresh) e l'auth esiste già, riusiamo
    // semplicemente l'istanza già creata invece di far crashare l'app.
    auth = getAuth(app);
  }
} else {
  try {
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch (e) {
    // Stesso discorso del ramo web: initializeAuth() non può essere
    // richiamata due volte sulla stessa app (succede col Fast Refresh in
    // sviluppo), quindi in quel caso riusiamo l'istanza già inizializzata.
    auth = getAuth(app);
  }
}

export { auth };
export const db = getFirestore(app);
export { firebaseConfig };
