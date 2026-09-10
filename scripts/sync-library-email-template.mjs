#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeGitHubRepository} from '../lib/evidence-libraries/configuration/contract-sync.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv.find((arg, index) => index >= 2 && arg !== '--check');
const check = process.argv.includes('--check');
if (!source) throw new Error('Pass the new-el checkout path: npm run check:email-template -- <new-el checkout>');
const repository = 'https://github.com/OpenDevEd/new-el';
const git = (...args) => execFileSync('git', ['-C', resolve(source), ...args], {encoding: 'utf8'});
if (normalizeGitHubRepository(git('remote', 'get-url', 'origin')) !== repository) throw new Error('The email source must be the OpenDevEd/new-el repository.');
const paths = ['lib/emails/library-template.ts', 'lib/escape-html.ts'];
const lockPath = resolve(root, 'lib/emails/source-lock.json');
const lock = check ? JSON.parse(await readFile(lockPath, 'utf8')) : {repository, commit: git('rev-parse', 'HEAD').trim()};
if (lock.repository !== repository || !/^[0-9a-f]{40}$/.test(lock.commit)) throw new Error('The email source lock requires the canonical repository and an exact commit.');
for (const path of paths) {
  const content = '// Generated from OpenDevEd/new-el src/' + path + '.\n// Regenerate with: node scripts/sync-library-email-template.mjs <new-el checkout>\n' + git('show', `${lock.commit}:src/${path}`);
  const destination = resolve(root, path);
  if (check) {
    if (await readFile(destination, 'utf8') !== content) throw new Error(path + ' differs from its shared source at ' + lock.commit);
  } else {
    await mkdir(dirname(destination), {recursive: true});
    await writeFile(destination, content);
  }
}
if (!check) await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
console.log('Shared email source ' + (check ? 'verified' : 'synchronized') + ' at ' + lock.commit);
