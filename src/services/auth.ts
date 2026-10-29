import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { TeacherProfile } from '../types';
import { getActiveBackendMode, getApiBaseUrl, getFirebaseServices } from './firebase';

const TEACHER_TOKEN_KEY = 'eduexam_teacher_token';

export function getStoredTeacherToken(): string | null {
  return sessionStorage.getItem(TEACHER_TOKEN_KEY) || localStorage.getItem(TEACHER_TOKEN_KEY);
}

export function setStoredTeacherToken(token: string | null): void {
  if (!token) {
    sessionStorage.removeItem(TEACHER_TOKEN_KEY);
    localStorage.removeItem(TEACHER_TOKEN_KEY);
  } else {
    sessionStorage.setItem(TEACHER_TOKEN_KEY, token);
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  customToken?: string
): Promise<T> {
  const base = getApiBaseUrl();
  const token = customToken ?? getStoredTeacherToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errMsg = `Erreur serveur (${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.error) errMsg = errJson.error;
    } catch {
      // ignore parse error
    }
    throw new Error(errMsg);
  }

  return response.json() as Promise<T>;
}

export interface RegisterTeacherInput {
  firstName: string;
  lastName: string;
  email: string;
  institution?: string;
  password: string;
  confirmPassword: string;
  acceptedTerms: boolean;
}

export interface AuthSessionResult {
  teacher: TeacherProfile;
  verificationCodePreview?: string;
}

export async function registerTeacher(input: RegisterTeacherInput): Promise<AuthSessionResult> {
  if (getActiveBackendMode() === 'firebase') {
    if (input.password !== input.confirmPassword) {
      throw new Error('Le mot de passe et sa confirmation ne correspondent pas.');
    }
    if (!input.acceptedTerms) {
      throw new Error(
        'Vous devez accepter les conditions d’utilisation et la politique de confidentialité.'
      );
    }
    const { auth, db } = getFirebaseServices();
    const cred = await createUserWithEmailAndPassword(auth, input.email.trim(), input.password);
    await sendEmailVerification(cred.user);

    const nowIso = new Date().toISOString();
    const profile: TeacherProfile = {
      uid: cred.user.uid,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.trim().toLowerCase(),
      emailVerified: cred.user.emailVerified,
      institution: input.institution?.trim() || '',
      defaultSubject: '',
      retentionDays: 365,
      acceptedTerms: true,
      acceptedTermsAt: nowIso,
      createdAt: nowIso,
      role: 'teacher',
    };

    await setDoc(doc(db, 'teachers', cred.user.uid), profile);
    return { teacher: profile };
  }

  const res = await apiRequest<{
    token: string;
    teacher: TeacherProfile;
    verificationCodePreview?: string;
  }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  setStoredTeacherToken(res.token);
  return {
    teacher: res.teacher,
    verificationCodePreview: res.verificationCodePreview,
  };
}

export async function loginTeacher(email: string, password: string): Promise<AuthSessionResult> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db } = getFirebaseServices();
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    const snap = await getDoc(doc(db, 'teachers', cred.user.uid));
    let profile: TeacherProfile;
    if (snap.exists()) {
      profile = snap.data() as TeacherProfile;
      if (cred.user.emailVerified && !profile.emailVerified) {
        profile.emailVerified = true;
        await updateDoc(doc(db, 'teachers', cred.user.uid), { emailVerified: true });
      }
    } else {
      const nowIso = new Date().toISOString();
      profile = {
        uid: cred.user.uid,
        firstName: cred.user.displayName?.split(' ')[0] || 'Enseignant',
        lastName: cred.user.displayName?.split(' ').slice(1).join(' ') || '',
        email: cred.user.email || email.trim(),
        emailVerified: cred.user.emailVerified,
        retentionDays: 365,
        acceptedTerms: true,
        acceptedTermsAt: nowIso,
        createdAt: nowIso,
        role: 'teacher',
      };
      await setDoc(doc(db, 'teachers', cred.user.uid), profile);
    }
    return { teacher: profile };
  }

  const res = await apiRequest<{ token: string; teacher: TeacherProfile }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setStoredTeacherToken(res.token);
  return { teacher: res.teacher };
}

export async function logoutTeacher(): Promise<void> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth } = getFirebaseServices();
    await signOut(auth);
  }
  setStoredTeacherToken(null);
}

export async function fetchCurrentTeacher(): Promise<AuthSessionResult | null> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db } = getFirebaseServices();
    const user = auth.currentUser;
    if (!user) return null;
    await user.reload();
    const snap = await getDoc(doc(db, 'teachers', user.uid));
    if (!snap.exists()) return null;
    const profile = snap.data() as TeacherProfile;
    if (user.emailVerified && !profile.emailVerified) {
      profile.emailVerified = true;
      await updateDoc(doc(db, 'teachers', user.uid), { emailVerified: true });
    }
    return { teacher: profile };
  }

  const token = getStoredTeacherToken();
  if (!token) return null;
  try {
    return await apiRequest<AuthSessionResult>('/api/auth/me');
  } catch {
    setStoredTeacherToken(null);
    return null;
  }
}

export async function verifyTeacherEmailCode(code?: string): Promise<TeacherProfile> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db } = getFirebaseServices();
    if (!auth.currentUser) throw new Error('Non connecté.');
    await auth.currentUser.reload();
    if (!auth.currentUser.emailVerified) {
      await sendEmailVerification(auth.currentUser);
      throw new Error(
        'Un nouveau lien de confirmation vient d’être envoyé à votre boîte e-mail. Cliquez dessus puis actualisez.'
      );
    }
    await updateDoc(doc(db, 'teachers', auth.currentUser.uid), { emailVerified: true });
    const snap = await getDoc(doc(db, 'teachers', auth.currentUser.uid));
    return snap.data() as TeacherProfile;
  }

  const res = await apiRequest<{ teacher: TeacherProfile }>('/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  return res.teacher;
}

export async function confirmTeacherIdentity(password: string): Promise<boolean> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth } = getFirebaseServices();
    const user = auth.currentUser;
    if (!user || !user.email) throw new Error('Session invalide.');
    const cred = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, cred);
    return true;
  }

  await apiRequest('/api/auth/reauthenticate', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  return true;
}

export async function updateTeacherProfile(
  updates: Partial<Pick<TeacherProfile, 'firstName' | 'lastName' | 'institution' | 'defaultSubject' | 'retentionDays'>>
): Promise<TeacherProfile> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db } = getFirebaseServices();
    if (!auth.currentUser) throw new Error('Non connecté.');
    const ref = doc(db, 'teachers', auth.currentUser.uid);
    await updateDoc(ref, updates);
    const snap = await getDoc(ref);
    return snap.data() as TeacherProfile;
  }

  const res = await apiRequest<{ teacher: TeacherProfile }>('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return res.teacher;
}

export async function changeTeacherPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (getActiveBackendMode() === 'firebase') {
    await confirmTeacherIdentity(currentPassword);
    const { auth } = getFirebaseServices();
    if (!auth.currentUser) throw new Error('Non connecté.');
    await updatePassword(auth.currentUser, newPassword);
    return;
  }

  await apiRequest('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function requestPasswordReset(
  email: string
): Promise<{ message: string; resetTokenPreview?: string }> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth } = getFirebaseServices();
    await sendPasswordResetEmail(auth, email.trim());
    return {
      message:
        'Si un compte professionnel correspond à cette adresse, un e-mail de réinitialisation a été envoyé.',
    };
  }

  return apiRequest('/api/auth/reset-password-request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function confirmPasswordResetWithToken(
  resetToken: string,
  newPassword: string
): Promise<void> {
  await apiRequest('/api/auth/reset-password-confirm', {
    method: 'POST',
    body: JSON.stringify({ resetToken, newPassword }),
  });
}
