import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { TeacherProfile } from '../types';
import { getActiveBackendMode, getFirebaseServices } from '../services/firebase';
import {
  fetchCurrentTeacher,
  loginTeacher,
  logoutTeacher,
  registerTeacher,
  RegisterTeacherInput,
  verifyTeacherEmailCode,
} from '../services/auth';

interface AuthContextValue {
  teacher: TeacherProfile | null;
  loading: boolean;
  verificationCodePreview?: string;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterTeacherInput) => Promise<void>;
  logout: () => Promise<void>;
  verifyEmail: (code?: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [teacher, setTeacher] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [verificationCodePreview, setVerificationCodePreview] = useState<string | undefined>();

  const refreshProfile = useCallback(async () => {
    try {
      const res = await fetchCurrentTeacher();
      if (res) {
        setTeacher(res.teacher);
        setVerificationCodePreview(res.verificationCodePreview);
      } else {
        setTeacher(null);
      }
    } catch {
      setTeacher(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (getActiveBackendMode() === 'firebase') {
      const { auth } = getFirebaseServices();
      const unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) {
          setTeacher(null);
          setLoading(false);
          return;
        }
        await refreshProfile();
      });
      return () => unsub();
    } else {
      refreshProfile();
    }
  }, [refreshProfile]);

  const login = async (email: string, password: string) => {
    const res = await loginTeacher(email, password);
    setTeacher(res.teacher);
    setVerificationCodePreview(res.verificationCodePreview);
  };

  const register = async (input: RegisterTeacherInput) => {
    const res = await registerTeacher(input);
    setTeacher(res.teacher);
    setVerificationCodePreview(res.verificationCodePreview);
  };

  const logout = async () => {
    await logoutTeacher();
    setTeacher(null);
    setVerificationCodePreview(undefined);
  };

  const verifyEmail = async (code?: string) => {
    const updated = await verifyTeacherEmailCode(code);
    setTeacher(updated);
    setVerificationCodePreview(undefined);
  };

  return (
    <AuthContext.Provider
      value={{
        teacher,
        loading,
        verificationCodePreview,
        login,
        register,
        logout,
        verifyEmail,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
