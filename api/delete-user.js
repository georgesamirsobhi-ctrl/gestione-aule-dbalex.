// Funzione serverless (Vercel) per eliminare DEFINITIVAMENTE un utente:
// cancella sia l'account Firebase Authentication sia la scheda su Firestore.
//
// Gira solo lato server: qui (e solo qui) è al sicuro usare l'Admin SDK.
// Le credenziali NON vanno mai scritte in questo file: arrivano dalle
// variabili d'ambiente del progetto Vercel (vedi istruzioni di deploy).
//
// Chiamata dal sito con:
//   POST /api/delete-user
//   Header:  Authorization: Bearer <idToken dell'utente che chiede la cancellazione>
//   Body:    { "targetUid": "<uid dell'utente da eliminare>" }

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Su Vercel gli "a capo" della chiave privata arrivano spesso come
      // sequenze letterali "\n": qui vengono rimessi a posto.
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

// Stessa logica permessi già usata nel sito (index.tsx), duplicata qui
// perché questa funzione gira in un ambiente separato dal client.
const RUOLI_TIPO_SEGRETERIA = ['segreteria', 'presideIpi', 'vicePresideIpi', 'presideAbm', 'oratorio'];
const puoGestireUtenti = (ruolo) => ruolo === 'gestore' || RUOLI_TIPO_SEGRETERIA.includes(ruolo);

function setCors(res) {
  // Il sito su Firebase Hosting chiama questa funzione da un dominio diverso
  // da quello di Vercel: senza questi header il browser bloccherebbe la richiesta.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Metodo non consentito' });
    return;
  }

  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      res.status(401).json({ error: 'Token mancante' });
      return;
    }

    // Verifica che il token sia valido e recente: dimostra chi sta chiamando.
    const decoded = await admin.auth().verifyIdToken(idToken);
    const callerUid = decoded.uid;

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const targetUid = body.targetUid;
    if (!targetUid || typeof targetUid !== 'string') {
      res.status(400).json({ error: 'targetUid mancante' });
      return;
    }
    if (targetUid === callerUid) {
      res.status(400).json({ error: 'Non puoi eliminare il tuo stesso account.' });
      return;
    }

    const db = admin.firestore();

    // Chi chiama ha davvero il permesso di gestire gli utenti?
    const callerSnap = await db.collection('users').doc(callerUid).get();
    if (!callerSnap.exists) {
      res.status(403).json({ error: 'Utente non autorizzato' });
      return;
    }
    const caller = callerSnap.data() || {};
    const permessi = caller.permessiSovrascritti || {};
    const autorizzato =
      permessi.puoGestireUtenti !== undefined
        ? !!permessi.puoGestireUtenti
        : puoGestireUtenti(caller.role);
    if (!autorizzato) {
      res.status(403).json({ error: 'Non hai i permessi per eliminare utenti.' });
      return;
    }

    // Cancella prima la scheda Firestore (se fallisce non blocchiamo la
    // cancellazione dell'account, che è la parte irreversibile e importante).
    await db.collection('users').doc(targetUid).delete().catch(() => {});

    try {
      await admin.auth().deleteUser(targetUid);
    } catch (e) {
      if (e && e.code === 'auth/user-not-found') {
        // L'account Authentication non esisteva già più: va bene comunque,
        // l'obiettivo (nessun accesso residuo) è già raggiunto.
      } else {
        throw e;
      }
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('delete-user error:', e);
    res.status(500).json({ error: (e && e.message) || 'Errore interno' });
  }
};
