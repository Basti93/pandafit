import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RIDE_ID } from '../ride-format/read';

export { RIDE_ID };

export const RIDE_FILE_NAMES = ['meta.json', 'session.json', 'samples.jsonl', 'events.jsonl'] as const;
export type RideFiles = { 'meta.json': string; 'session.json': string; 'samples.jsonl': string; 'events.jsonl': string };
/** The four files as text, the FIT file as base64 (null: the receiver makes one), and the hash over the four texts. */
export type RideUpload = { v: 1; rideId: string; files: RideFiles; fit: string | null; sha256: string };

/** SHA-256 hex over the four texts in a fixed order, each followed by a NUL byte. */
export const rideHash = (files: RideFiles): string => {
  const h = createHash('sha256');
  for (const name of RIDE_FILE_NAMES) h.update(files[name]).update('\0');
  return h.digest('hex');
};

/** Reads a ride folder as the recorder wrote it. A missing events file counts as empty. */
export const readRideFiles = (dir: string): RideFiles => {
  const read = (name: string, optional: boolean): string => {
    try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch (e) { if (optional) return ''; throw e; }
  };
  return {
    'meta.json': read('meta.json', false), 'session.json': read('session.json', false),
    'samples.jsonl': read('samples.jsonl', true), 'events.jsonl': read('events.jsonl', true),
  };
};

export const readRideUpload = (ridesDir: string, rideId: string): RideUpload => {
  const files = readRideFiles(path.join(ridesDir, rideId));
  let fit: string | null = null;
  try { fit = fs.readFileSync(path.join(ridesDir, 'exports', `${rideId}.fit`)).toString('base64'); } catch { /* no FIT yet */ }
  return { v: 1, rideId, files, fit, sha256: rideHash(files) };
};
