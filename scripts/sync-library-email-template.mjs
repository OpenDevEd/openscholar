#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv.find((arg, index) => index >= 2 && arg !== '--check');
const check = process.argv.includes('--check');
const paths = ['lib/emails/library-template.ts', 'lib/escape-html.ts'];
const lockPath = resolve(root, 'lib/emails/source-lock.json');
const hash = content => createHash('sha256').update(content).digest('hex');
if (!source) {
  if (!check) throw new Error('Pass the new-el checkout path to sync the shared email template.');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  for (const path of paths) {
    if (hash(await readFile(resolve(root, path), 'utf8')) !== lock.files[path]) throw new Error(path + ' changed without synchronizing its source.');
  }
} else {
  const lock = {repository: 'https://github.com/OpenDevEd/new-el', files: {}};
  for (const path of paths) {
    const content = '// Generated from OpenDevEd/new-el src/' + path + '.\n// Regenerate with: node scripts/sync-library-email-template.mjs <new-el checkout>\n' + await readFile(resolve(source, 'src', path), 'utf8');
    const destination = resolve(root, path);
    lock.files[path] = hash(content);
    if (check) {
      if (await readFile(destination, 'utf8') !== content) throw new Error(path + ' differs from its shared source');
    } else {
      await mkdir(dirname(destination), {recursive: true});
      await writeFile(destination, content);
    }
  }
  if (!check) await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
}
