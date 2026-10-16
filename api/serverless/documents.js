import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from '../durable.js';

export const SERVERLESS = process.env.OPENGYM_SERVERLESS === '1';
let documents = {};
const key = file => path.basename(file);
const missing = file => Object.assign(new Error(`Missing document: ${key(file)}`), { code: 'ENOENT' });

// The Vercel entry point installs the transaction's snapshot before dispatching a
// request. Upstream can still read and write synchronously inside that transaction.
export function useDocuments(value) { documents = value; }
export function readDocument(file) {
  if (!SERVERLESS) return fs.readFileSync(file, 'utf8');
  if (!Object.hasOwn(documents, key(file))) throw missing(file);
  return documents[key(file)];
}
export function writeDocument(file, text, mode) {
  if (!SERVERLESS) return atomicWrite(file, text, mode);
  documents[key(file)] = text;
}
export function appendDocument(file, text) {
  if (!SERVERLESS) return fs.appendFileSync(file, text);
  documents[key(file)] = (documents[key(file)] || '') + text;
}
export function removeDocument(file) {
  if (!SERVERLESS) return fs.unlinkSync(file);
  delete documents[key(file)];
}
