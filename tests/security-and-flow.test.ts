import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/index';

describe('Scénarios complets E2E & Sécurité obligatoire (Section 18)', () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>['app'];

  let teacherAToken = '';
  let teacherBToken = '';
  let examId = '';
  let examCode = '';
  let accessCode = '';
  let studentSessionId = '';
  let studentSessionToken = '';
  let submissionId = '';

  const validPdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
    'utf8'
  );

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eduexam-e2e-'));
    const created = createApp(tempDir);
    app = created.app;
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('1. Création, vérification e-mail et connexion de deux comptes professeurs isolés', async () => {
    const regA = await request(app).post('/api/auth/register').send({
      firstName: 'Karim',
      lastName: 'Mansouri',
      email: 'karim.mansouri@lycee.edu',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      acceptedTerms: true,
    });
    expect(regA.status).toBe(201);
    expect(regA.body.token).toBeTruthy();
    expect(regA.body.teacher.passwordHash).toBeUndefined();
    teacherAToken = regA.body.token;

    // Vérification de l'e-mail du professeur A
    const verifA = await request(app)
      .post('/api/auth/verify-email')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .send({ code: regA.body.verificationCodePreview });
    expect(verifA.status).toBe(200);
    expect(verifA.body.teacher.emailVerified).toBe(true);

    // Connexion professeur A avec ses identifiants
    const loginA = await request(app).post('/api/auth/login').send({
      email: 'karim.mansouri@lycee.edu',
      password: 'Password123!',
    });
    expect(loginA.status).toBe(200);
    teacherAToken = loginA.body.token;

    // Création d'un second professeur B pour vérifier l'isolation stricte
    const regB = await request(app).post('/api/auth/register').send({
      firstName: 'Claire',
      lastName: 'Martin',
      email: 'claire.martin@college.edu',
      password: 'Password456!',
      confirmPassword: 'Password456!',
      acceptedTerms: true,
    });
    expect(regB.status).toBe(201);
    teacherBToken = regB.body.token;
  });

  it('2 & 3. Création d’un examen et importation sécurisée du sujet PDF et de la correction PDF', async () => {
    const createRes = await request(app)
      .post('/api/exams')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .send({
        title: 'Devoir Surveillé Physique & Algorithmique',
        subject: 'Physique-Chimie',
        level: 'lycee',
        className: 'Terminale S2',
        description: 'Durée 45 minutes. Calculatrice autorisée.',
        durationMinutes: 45,
        startAt: new Date(Date.now() - 60_000).toISOString(),
        endAt: new Date(Date.now() + 3600_000).toISOString(),
        maxScore: 20,
        maxAttempts: 1,
        allowSubjectDownload: true,
        showScoreToStudent: true,
        showExpectedAnswersToStudent: false,
        editorQuestions: [
          {
            id: 'q1',
            number: 1,
            exerciseTitle: 'Mécanique',
            prompt: 'Unité légale de l’énergie dans le Système International ?',
            type: 'mcq_single',
            maxPoints: 8,
            gradingMode: 'mode_a_auto',
            options: [
              { id: 'joule', label: 'Joule (J)' },
              { id: 'watt', label: 'Watt (W)' },
            ],
            rubric: {
              questionId: 'q1',
              expectedAnswer: 'Joule (J)',
              acceptedAlternatives: [],
              correctOptionIds: ['joule'],
              criteria: [],
            },
          },
          {
            id: 'q2',
            number: 2,
            exerciseTitle: 'Cinématique',
            prompt: 'Calculez la vitesse v = d / t pour d = 100 m et t = 10 s.',
            type: 'numeric',
            maxPoints: 12,
            gradingMode: 'mode_a_auto',
            unit: 'm/s',
            requireUnit: true,
            rubric: {
              questionId: 'q2',
              expectedAnswer: '10 m/s',
              acceptedAlternatives: [],
              numericValue: 10,
              numericTolerance: 0.1,
              expectedUnit: 'm/s',
              criteria: [],
            },
          },
        ],
      });

    expect(createRes.status).toBe(201);
    examId = createRes.body.exam.id;
    examCode = createRes.body.exam.examCode;

    // Rejet d'un faux fichier qui n'est pas un vrai PDF (%PDF-)
    const fakeUpload = await request(app)
      .post(`/api/exams/${examId}/upload-pdf`)
      .set('Authorization', `Bearer ${teacherAToken}`)
      .field('kind', 'subject')
      .attach('file', Buffer.from('not-a-pdf-content'), {
        filename: 'malicious.pdf',
        contentType: 'application/pdf',
      });
    expect(fakeUpload.status).toBe(400);

    // Import valide du sujet PDF privé
    const subUpload = await request(app)
      .post(`/api/exams/${examId}/upload-pdf`)
      .set('Authorization', `Bearer ${teacherAToken}`)
      .field('kind', 'subject')
      .attach('file', validPdfBuffer, {
        filename: 'Sujet_Officiel.pdf',
        contentType: 'application/pdf',
      });
    expect(subUpload.status).toBe(200);

    // Import valide de la correction PDF confidentielle
    const corrUpload = await request(app)
      .post(`/api/exams/${examId}/upload-pdf`)
      .set('Authorization', `Bearer ${teacherAToken}`)
      .field('kind', 'correction')
      .attach('file', validPdfBuffer, {
        filename: 'Corrige_Confidentiel.pdf',
        contentType: 'application/pdf',
      });
    expect(corrUpload.status).toBe(200);
  });

  it('4 & 15. Isolation inter-professeurs : le professeur B ne peut jamais accéder aux examens ni aux PDF du professeur A', async () => {
    const forbiddenExam = await request(app)
      .get(`/api/exams/${examId}`)
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(forbiddenExam.status).toBe(403);

    const forbiddenPdf = await request(app)
      .get(`/api/exams/${examId}/teacher-pdf/correction`)
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(forbiddenPdf.status).toBe(403);
  });

  it('4 & 5. Publication, génération du code d’accès, refus d’un code erroné et accès élève valide', async () => {
    // Tant que l'examen est en brouillon, aucun élève ne peut y accéder
    const draftAttempt = await request(app).post('/api/student/access').send({
      firstName: 'Sami',
      lastName: 'Trabelsi',
      className: 'Terminale S2',
      examCode,
      accessCode: 'XXXX-XXXX-XXXX',
    });
    expect(draftAttempt.status).toBe(403);

    // Publication et génération du code CSPRNG
    const pubRes = await request(app)
      .post(`/api/exams/${examId}/publish`)
      .set('Authorization', `Bearer ${teacherAToken}`)
      .send({ regenerateCode: true });
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.accessCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    accessCode = pubRes.body.accessCode;

    // Refus d'accès avec un code d'accès incorrect
    const wrongCode = await request(app).post('/api/student/access').send({
      firstName: 'Sami',
      lastName: 'Trabelsi',
      className: 'Terminale S2',
      examCode,
      accessCode: 'AAAA-BBBB-CCCC',
    });
    expect(wrongCode.status).toBe(403);

    // Accès valide avec le bon code d'examen
    const validAccess = await request(app).post('/api/student/access').send({
      firstName: 'Sami',
      lastName: 'Trabelsi',
      className: 'Terminale S2',
      examCode,
      accessCode,
    });
    expect(validAccess.status).toBe(200);
    expect(validAccess.body.sessionId).toBeTruthy();
    expect(validAccess.body.sessionToken).toBeTruthy();
    // Vérification de confidentialité : aucune information secrète professeur ni réponse attendue transmise !
    expect(validAccess.body.teacherId).toBeUndefined();
    expect(validAccess.body.rubrics).toBeUndefined();

    studentSessionId = validAccess.body.sessionId;
    studentSessionToken = validAccess.body.sessionToken;
  });

  it('7 & 16. Téléchargement autorisé du sujet PDF via jeton temporaire et impossibilité totale d’accéder au corrigé confidentiel', async () => {
    const tokenRes = await request(app)
      .post(`/api/student/sessions/${studentSessionId}/subject-token`)
      .set('Authorization', `Bearer ${studentSessionToken}`)
      .send({});
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.viewUrl).toContain('/api/student/subject-pdf?token=');

    const downloadRes = await request(app).get(tokenRes.body.downloadUrl);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers['content-type']).toContain('application/pdf');

    // Tentative élève d'accéder au corrigé confidentiel -> 401 / 403 strict !
    const studentTryCorrection1 = await request(app).get('/api/student/correction-pdf');
    expect(studentTryCorrection1.status).toBe(403);

    const studentTryCorrection2 = await request(app)
      .get(`/api/exams/${examId}/teacher-pdf/correction`)
      .set('Authorization', `Bearer ${studentSessionToken}`);
    expect(studentTryCorrection2.status).toBe(401);
  });

  it('8, 9, 11, 13 & 17. Démarrage chrono serveur, sauvegarde/restauration, soumission, notation, e-mail et résistance aux doubles soumissions', async () => {
    const startRes = await request(app)
      .post(`/api/student/sessions/${studentSessionId}/start`)
      .set('Authorization', `Bearer ${studentSessionToken}`)
      .send({});
    expect(startRes.status).toBe(200);
    expect(startRes.body.status).toBe('in_progress');
    expect(startRes.body.questions).toHaveLength(2);
    // Aucune réponse attendue présente dans les questions envoyées à l'élève
    expect((startRes.body.questions[0] as any).rubric).toBeUndefined();

    const firstDeadline = startRes.body.deadlineAt;

    // Recharger / rappeler /start ne prolonge jamais la deadline serveur !
    const reloadStart = await request(app)
      .post(`/api/student/sessions/${studentSessionId}/start`)
      .set('Authorization', `Bearer ${studentSessionToken}`)
      .send({});
    expect(reloadStart.body.deadlineAt).toBe(firstDeadline);

    // Sauvegarde automatique des réponses
    const saveRes = await request(app)
      .post(`/api/student/sessions/${studentSessionId}/autosave`)
      .set('Authorization', `Bearer ${studentSessionToken}`)
      .send({
        clientRevision: 0,
        answers: {
          q1: { selectedOptionIds: ['joule'] },
          q2: { numericInput: '10', unitInput: 'm/s' },
        },
      });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.revision).toBe(1);

    // Restauration de la session après coupure simulée
    const restored = await request(app)
      .get(`/api/student/sessions/${studentSessionId}`)
      .set('Authorization', `Bearer ${studentSessionToken}`);
    expect(restored.status).toBe(200);
    expect(restored.body.savedAnswers.q1.selectedOptionIds).toEqual(['joule']);

    // Soumission finale avant expiration
    const submitRes = await request(app)
      .post(`/api/student/sessions/${studentSessionId}/submit`)
      .set('Authorization', `Bearer ${studentSessionToken}`)
      .send({
        answers: {
          q1: { selectedOptionIds: ['joule'] },
          q2: { numericInput: '10', unitInput: 'm/s' },
        },
        autoSubmitted: false,
      });
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.receipt.normalizedScoreOn20).toBe(20);
    expect(submitRes.body.receipt.appreciation).toBe('Excellent');
    // Réponse attendue masquée à l'élève tant que showExpectedAnswersToStudent === false
    expect(submitRes.body.receipt.questionGrades.q1.expectedAnswerDisplay).toBeUndefined();
    submissionId = submitRes.body.receipt.submissionId;

    // Résistance aux doubles soumissions : un 2e appel renvoie le même reçu sans dupliquer la copie
    const doubleSubmit = await request(app)
      .post(`/api/student/sessions/${studentSessionId}/submit`)
      .set('Authorization', `Bearer ${studentSessionToken}`)
      .send({});
    expect(doubleSubmit.status).toBe(200);
    expect(doubleSubmit.body.alreadySubmitted).toBe(true);
    expect(doubleSubmit.body.receipt.submissionId).toBe(submissionId);

    // Blocage d'une nouvelle tentative car maxAttempts = 1
    const secondAttempt = await request(app).post('/api/student/access').send({
      firstName: 'Sami',
      lastName: 'Trabelsi',
      className: 'Terminale S2',
      examCode,
      accessCode,
    });
    expect(secondAttempt.status).toBe(403);
  });

  it('14 & 15. Consultation par le professeur A, journalisation e-mail, audit obligatoire après validation et refus professeur B', async () => {
    // Professeur B ne voit aucune copie du professeur A
    const listB = await request(app)
      .get('/api/submissions')
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(listB.status).toBe(200);
    expect(listB.body.submissions).toHaveLength(0);

    const forbiddenSubB = await request(app)
      .get(`/api/submissions/${submissionId}`)
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(forbiddenSubB.status).toBe(403);

    // Professeur A consulte la copie et vérifie le journal de notification e-mail
    const detailA = await request(app)
      .get(`/api/submissions/${submissionId}`)
      .set('Authorization', `Bearer ${teacherAToken}`);
    expect(detailA.status).toBe(200);
    expect(detailA.body.submission.emailNotification.attempts).toBe(1);

    // Validation officielle de la note par le professeur A
    const valRes = await request(app)
      .put(`/api/submissions/${submissionId}/grade`)
      .set('Authorization', `Bearer ${teacherAToken}`)
      .send({
        questionGrades: detailA.body.submission.questionGrades,
        generalComment: 'Copie exemplaire.',
        validateNow: true,
      });
    expect(valRes.status).toBe(200);
    expect(valRes.body.submission.gradingStatus).toBe('validated');

    // Toute modification ultérieure d'une note déjà validée SANS motif d'audit est rejetée (400)
    const modifyWithoutReason = await request(app)
      .put(`/api/submissions/${submissionId}/grade`)
      .set('Authorization', `Bearer ${teacherAToken}`)
      .send({
        questionGrades: {
          ...detailA.body.submission.questionGrades,
          q2: {
            ...detailA.body.submission.questionGrades.q2,
            pointsObtained: 10,
          },
        },
        validateNow: true,
        auditReason: '',
      });
    expect(modifyWithoutReason.status).toBe(400);

    // Modification AVEC motif d'audit est acceptée et tracée dans auditTrail
    const modifyWithReason = await request(app)
      .put(`/api/submissions/${submissionId}/grade`)
      .set('Authorization', `Bearer ${teacherAToken}`)
      .send({
        questionGrades: {
          ...detailA.body.submission.questionGrades,
          q2: {
            ...detailA.body.submission.questionGrades.q2,
            pointsObtained: 10,
          },
        },
        validateNow: true,
        auditReason: 'Ajustement suite à harmonisation du barème sur les chiffres significatifs',
      });
    expect(modifyWithReason.status).toBe(200);
    expect(modifyWithReason.body.submission.normalizedScoreOn20).toBe(18);
    expect(
      modifyWithReason.body.submission.auditTrail.some(
        (a: any) => a.action === 'grade_modified_after_validation'
      )
    ).toBe(true);
  });

  it('6 & 10. Expiration de l’examen et soumission automatique à expiration du chronomètre', async () => {
    // Création d'un examen déjà expiré -> refus d'accès élève
    const expCreate = await request(app)
      .post('/api/exams')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .send({
        title: 'Examen Expiré',
        subject: 'Histoire-Géographie',
        className: '3ème B',
        durationMinutes: 30,
        startAt: new Date(Date.now() - 7200_000).toISOString(),
        endAt: new Date(Date.now() - 3600_000).toISOString(),
      });
    const expId = expCreate.body.exam.id;
    const expPub = await request(app)
      .post(`/api/exams/${expId}/publish`)
      .set('Authorization', `Bearer ${teacherAToken}`)
      .send({ regenerateCode: true });

    const expiredAccess = await request(app).post('/api/student/access').send({
      firstName: 'Ines',
      lastName: 'Gharbi',
      className: '3ème B',
      examCode: expPub.body.examCode,
      accessCode: expPub.body.accessCode,
    });
    expect(expiredAccess.status).toBe(403);

    // Soumission automatique marquée autoSubmitted = true sur un examen actif
    const activeCreate = await request(app)
      .post('/api/exams')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .send({
        title: 'Quiz Rapide Français',
        subject: 'Français',
        className: '4ème A',
        durationMinutes: 10,
        startAt: new Date(Date.now() - 60_000).toISOString(),
        endAt: new Date(Date.now() + 600_000).toISOString(),
      });
    const actPub = await request(app)
      .post(`/api/exams/${activeCreate.body.exam.id}/publish`)
      .set('Authorization', `Bearer ${teacherAToken}`)
      .send({ regenerateCode: true });

    const stuAcc = await request(app).post('/api/student/access').send({
      firstName: 'Nadia',
      lastName: 'Kallel',
      className: '4ème A',
      examCode: actPub.body.examCode,
      accessCode: actPub.body.accessCode,
    });
    await request(app)
      .post(`/api/student/sessions/${stuAcc.body.sessionId}/start`)
      .set('Authorization', `Bearer ${stuAcc.body.sessionToken}`)
      .send({});

    const autoSub = await request(app)
      .post(`/api/student/sessions/${stuAcc.body.sessionId}/submit`)
      .set('Authorization', `Bearer ${stuAcc.body.sessionToken}`)
      .send({
        answers: { free_response: { text: 'Analyse littéraire sauvegardée avant expiration.' } },
        autoSubmitted: true,
      });
    expect(autoSub.status).toBe(201);
    expect(autoSub.body.receipt.autoSubmitted).toBe(true);
  });
});
