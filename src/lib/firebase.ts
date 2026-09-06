import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  config.apiKey &&
    config.authDomain &&
    config.projectId &&
    config.storageBucket &&
    config.messagingSenderId &&
    config.appId,
);

export function getFirebaseApp() {
  if (!isFirebaseConfigured) return null;
  return getApps().length ? getApp() : initializeApp(config);
}

export function getFirebaseAuth() {
  const app = getFirebaseApp();
  if (!app) return null;
  return getAuth(app);
}

export function getFirebaseDb() {
  const app = getFirebaseApp();
  if (!app) return null;
  return getFirestore(app);
}

export async function ensureAnonymousUser(): Promise<User | null> {
  const auth = getFirebaseAuth();
  if (!auth) return null;

  const result = await signInAnonymously(auth);
  return result.user ?? null;
}

export function watchFirebaseRoom<T>(roomId: string, callback: (room: T) => void) {
  const db = getFirebaseDb();
  if (!db) {
    return () => undefined;
  }

  const ref = doc(db, 'rooms', roomId);
  return onSnapshot(ref, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data() as T);
    }
  });
}

export async function writeFirebaseRoom<T extends object>(room: T & { roomId: string }) {
  const db = getFirebaseDb();
  if (!db) return false;
  const ref = doc(db, 'rooms', room.roomId);
  await setDoc(ref, { ...room, lastActivityAt: Date.now(), updatedAt: serverTimestamp() }, { merge: true });
  return true;
}

export async function findFirebaseRoomByCode<T>(roomCode: string): Promise<T | null> {
  const db = getFirebaseDb();
  if (!db) return null;

  const rooms = await getDocs(query(collection(db, 'rooms'), where('roomCode', '==', roomCode)));
  const match = rooms.docs[0];
  return match ? (match.data() as T) : null;
}

export async function updateFirebaseRoom(roomId: string, patch: Record<string, unknown>) {
  const db = getFirebaseDb();
  if (!db) return false;
  const ref = doc(db, 'rooms', roomId);
  await updateDoc(ref, { ...patch, lastActivityAt: Date.now(), updatedAt: serverTimestamp() });
  return true;
}

export function subscribeToAuth(callback: (user: User | null) => void) {
  const auth = getFirebaseAuth();
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
}
