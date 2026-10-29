import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.data', 'lib'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

describe('Audit de sécurité statique, règles Firebase "appcorrection" et responsive UI', () => {
  it('relie .firebaserc au projet Firebase "appcorrection"', () => {
    const firebaserc = JSON.parse(fs.readFileSync(path.join(root, '.firebaserc'), 'utf8'));
    expect(firebaserc.projects.default).toBe('appcorrection');
  });

  it('applique le refus par défaut et l’isolation propriétaire dans firestore.rules et storage.rules', () => {
    const fsRules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
    const stRules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');

    expect(fsRules).toContain('allow read, write: if false;');
    expect(fsRules).toContain('request.auth.uid == teacherId');
    expect(fsRules).toContain('match /examSecrets/{examId}');
    expect(fsRules).toContain('match /auditLogs/{logId}');

    expect(stRules).toContain('allow read, write: if false;');
    expect(stRules).toContain('confidential_correction');
    expect(stRules).toContain("request.resource.contentType == 'application/pdf'");
  });

  it('ne contient aucun secret privé, clé API d’e-mail ou clé de compte de service dans le code', () => {
    const files = collectFiles(path.join(root, 'src'));
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/BEGIN PRIVATE KEY/);
      expect(content).not.toMatch(/re_[a-zA-Z0-9]{20,}/); // Clé secrète Resend
      expect(content).not.toMatch(/firebase-adminsdk/);
    }
  });

  it('dispose d’une interface responsive ordinateur/tablette/smartphone (ExamWorkspace & TeacherLayout)', () => {
    const workspace = fs.readFileSync(
      path.join(root, 'src/pages/ExamWorkspace.tsx'),
      'utf8'
    );
    const layout = fs.readFileSync(
      path.join(root, 'src/components/TeacherLayout.tsx'),
      'utf8'
    );

    expect(workspace).toContain('lg:grid-cols-2');
    expect(workspace).toContain('lg:hidden');
    expect(layout).toContain('lg:w-64');
  });
});
