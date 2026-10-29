import { initializeApp, FirebaseApp, getApps } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { getFunctions, Functions } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const env = import.meta.env;
const CUSTOM_FIREBASE_STORAGE_KEY = 'eduexam_custom_firebase_config_v1';
const PRODUCTION_VERCEL_FALLBACK_API = 'https://appcorrection.vercel.app';

export interface FirebasePublicWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export function loadSavedFirebaseWebConfig(): Partial<FirebasePublicWebConfig> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CUSTOM_FIREBASE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.apiKey && parsed.appId) {
      return parsed as Partial<FirebasePublicWebConfig>;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseFirebaseConfigSnippet(input: string): FirebasePublicWebConfig {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Veuillez coller le bloc firebaseConfig depuis votre console Firebase.');
  }

  const extractField = (key: string): string => {
    const regex = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`, 'i');
    const match = trimmed.match(regex);
    return match ? match[1].trim() : '';
  };

  const apiKey = extractField('apiKey');
  const appId = extractField('appId');
  const projectId = extractField('projectId') || 'appcorrection';
  const authDomain = extractField('authDomain') || `${projectId}.firebaseapp.com`;
  const storageBucket = extractField('storageBucket') || `${projectId}.firebasestorage.app`;
  const messagingSenderId = extractField('messagingSenderId') || '';

  if (!apiKey || apiKey.length < 15 || !appId) {
    throw new Error(
      'Impossible de détecter apiKey et appId dans le texte collé. Copiez le bloc const firebaseConfig = { ... } depuis Console Firebase > Paramètres du projet > Général.'
    );
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  };
}

export function saveCustomFirebaseWebConfig(config: FirebasePublicWebConfig): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CUSTOM_FIREBASE_STORAGE_KEY, JSON.stringify(config));
}

export function clearCustomFirebaseWebConfig(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CUSTOM_FIREBASE_STORAGE_KEY);
}

export function getEffectiveFirebaseConfig(): FirebasePublicWebConfig {
  const saved = loadSavedFirebaseWebConfig();
  return {
    apiKey: saved?.apiKey || env.VITE_FIREBASE_API_KEY || '',
    authDomain:
      saved?.authDomain || env.VITE_FIREBASE_AUTH_DOMAIN || 'appcorrection.firebaseapp.com',
    projectId: saved?.projectId || env.VITE_FIREBASE_PROJECT_ID || 'appcorrection',
    storageBucket:
      saved?.storageBucket ||
      env.VITE_FIREBASE_STORAGE_BUCKET ||
      'appcorrection.firebasestorage.app',
    messagingSenderId:
      saved?.messagingSenderId || env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: saved?.appId || env.VITE_FIREBASE_APP_ID || '',
  };
}

export const FIREBASE_CONFIG = getEffectiveFirebaseConfig();

export const FIREBASE_CONSOLE_PROJECT_URL =
  'https://console.firebase.google.com/project/appcorrection/settings/general';

export const FIREBASE_FUNCTIONS_REGION = env.VITE_FIREBASE_FUNCTIONS_REGION || 'europe-west1';

export function isFirebaseConfigured(): boolean {
  const cfg = getEffectiveFirebaseConfig();
  return Boolean(
    cfg.apiKey && cfg.apiKey.trim().length > 10 && cfg.projectId && cfg.appId
  );
}

export type ActiveBackendMode = 'firebase' | 'api';

export function getActiveBackendMode(): ActiveBackendMode {
  const requested = (env.VITE_BACKEND_MODE || 'auto').toLowerCase();
  if (requested === 'api') {
    return 'api';
  }
  return isFirebaseConfigured() ? 'firebase' : 'api';
}

export function getApiBaseUrl(): string {
  const custom = (env.VITE_API_BASE_URL || '').trim();
  if (custom) {
    return custom.replace(/\/$/, '');
  }
  // Si ouvert depuis l'hébergement statique GitHub Pages (*.github.io),
  // routage transparent vers l'API cloud Vercel prête à l'emploi.
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io')) {
    return PRODUCTION_VERCEL_FALLBACK_API;
  }
  return '';
}

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firebaseDb: Firestore | null = null;
let firebaseStorage: FirebaseStorage | null = null;
let firebaseFunctions: Functions | null = null;

export function getFirebaseServices() {
  const cfg = getEffectiveFirebaseConfig();
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Les identifiants publics Firebase (apiKey, appId) du projet "appcorrection" ne sont pas encore renseignés.'
    );
  }

  if (!firebaseApp) {
    firebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp(cfg);

    const appCheckKey = (env.VITE_FIREBASE_APPCHECK_SITE_KEY || '').trim();
    if (appCheckKey && typeof window !== 'undefined') {
      try {
        initializeAppCheck(firebaseApp, {
          provider: new ReCaptchaV3Provider(appCheckKey),
          isTokenAutoRefreshEnabled: true,
        });
      } catch (err) {
        console.warn('[EduExam] Initialisation App Check ignorée :', err);
      }
    }
  }

  if (!firebaseAuth) firebaseAuth = getAuth(firebaseApp);
  if (!firebaseDb) firebaseDb = getFirestore(firebaseApp);
  if (!firebaseStorage) firebaseStorage = getStorage(firebaseApp);
  if (!firebaseFunctions) firebaseFunctions = getFunctions(firebaseApp, FIREBASE_FUNCTIONS_REGION);

  return {
    app: firebaseApp,
    auth: firebaseAuth,
    db: firebaseDb,
    storage: firebaseStorage,
    functions: firebaseFunctions,
  };
}
