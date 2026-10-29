import React from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Home } from './pages/Home';
import { TeacherLogin } from './pages/TeacherLogin';
import { TeacherDashboard } from './pages/TeacherDashboard';
import { MyExams } from './pages/MyExams';
import { ExamEditor } from './pages/ExamEditor';
import { StudentAccess } from './pages/StudentAccess';
import { ExamWorkspace } from './pages/ExamWorkspace';
import { Submissions } from './pages/Submissions';
import { Results, StudentResultPage } from './pages/Results';
import { ReportsPage } from './pages/ReportsPage';
import { AccountSettings } from './pages/AccountSettings';

const RequireTeacher: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { teacher, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
          Vérification sécurisée de votre session professeur...
        </div>
      </div>
    );
  }
  if (!teacher || teacher.role !== 'teacher') {
    return <Navigate to="/professeur/connexion" replace />;
  }
  return children;
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <HashRouter>
          <Routes>
            {/* Accueil public */}
            <Route path="/" element={<Home />} />

            {/* Espace Élève (strictement séparé de l'espace Professeur) */}
            <Route path="/eleve" element={<StudentAccess />} />
            <Route path="/examen/:sessionId" element={<ExamWorkspace />} />
            <Route path="/eleve/resultat" element={<StudentResultPage />} />

            {/* Authentification Professeur */}
            <Route path="/professeur/connexion" element={<TeacherLogin />} />

            {/* Espace privé Professeur (protégé côté client ET côté serveur) */}
            <Route
              path="/professeur/tableau-de-bord"
              element={
                <RequireTeacher>
                  <TeacherDashboard />
                </RequireTeacher>
              }
            />
            <Route
              path="/professeur/examens"
              element={
                <RequireTeacher>
                  <MyExams />
                </RequireTeacher>
              }
            />
            <Route
              path="/professeur/examens/nouveau"
              element={
                <RequireTeacher>
                  <ExamEditor />
                </RequireTeacher>
              }
            />
            <Route
              path="/professeur/examens/:examId"
              element={
                <RequireTeacher>
                  <ExamEditor />
                </RequireTeacher>
              }
            />
            <Route
              path="/professeur/copies"
              element={
                <RequireTeacher>
                  <Submissions />
                </RequireTeacher>
              }
            />
            <Route
              path="/professeur/statistiques"
              element={
                <RequireTeacher>
                  <Results />
                </RequireTeacher>
              }
            />
            <Route
              path="/professeur/rapports"
              element={
                <RequireTeacher>
                  <ReportsPage />
                </RequireTeacher>
              }
            />
            <Route
              path="/professeur/parametres"
              element={
                <RequireTeacher>
                  <AccountSettings />
                </RequireTeacher>
              }
            />

            {/* Redirection par défaut */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
