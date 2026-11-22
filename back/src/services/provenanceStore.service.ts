import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

import { env } from "../config/env.js";

export type StoredMedia = {
  id: string;
  ownerKey: string;
  sha256: string;
  signature: string;
  createdAt: number;
  embedding: number[];
};

const databasePath = resolve(env.PROVENANCE_DB_PATH);
mkdirSync(dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    public_key TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS protected_media (
    id TEXT NOT NULL,
    owner_key TEXT NOT NULL REFERENCES profiles(public_key),
    sha256 TEXT NOT NULL,
    signature TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    embedding TEXT NOT NULL,
    registered_at INTEGER NOT NULL,
    PRIMARY KEY (owner_key, id)
  );
  CREATE TABLE IF NOT EXISTS analysis_reports (
    id TEXT PRIMARY KEY,
    owner_key TEXT NOT NULL REFERENCES profiles(public_key),
    source_url TEXT NOT NULL,
    report_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS request_nonces (
    owner_key TEXT NOT NULL,
    nonce TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (owner_key, nonce)
  );
`);

export function getMedia(ownerKey: string): StoredMedia[] {
  const rows = database
    .prepare(
      `SELECT id, owner_key AS ownerKey, sha256, signature, created_at AS createdAt, embedding
       FROM protected_media WHERE owner_key = ? ORDER BY registered_at DESC`,
    )
    .all(ownerKey) as Array<Omit<StoredMedia, "embedding"> & { embedding: string }>;

  return rows.map((row) => ({ ...row, embedding: JSON.parse(row.embedding) as number[] }));
}

export function findMedia(ownerKey: string, id: string): StoredMedia | undefined {
  const row = database
    .prepare(
      `SELECT id, owner_key AS ownerKey, sha256, signature, created_at AS createdAt, embedding
       FROM protected_media WHERE owner_key = ? AND id = ?`,
    )
    .get(ownerKey, id) as (Omit<StoredMedia, "embedding"> & { embedding: string }) | undefined;

  return row ? { ...row, embedding: JSON.parse(row.embedding) as number[] } : undefined;
}

export function saveMedia(media: StoredMedia): void {
  const now = Date.now();
  const transaction = database.transaction(() => {
    database
      .prepare("INSERT OR IGNORE INTO profiles (public_key, created_at) VALUES (?, ?)")
      .run(media.ownerKey, now);
    database
      .prepare(
        `INSERT INTO protected_media (id, owner_key, sha256, signature, created_at, embedding, registered_at)
         VALUES (@id, @ownerKey, @sha256, @signature, @createdAt, @embedding, @registeredAt)`,
      )
      .run({
        ...media,
        embedding: JSON.stringify(media.embedding),
        registeredAt: now,
      });
  });
  transaction();
}

export function saveReport(ownerKey: string, sourceUrl: string, report: unknown, reportId = randomUUID()): string {
  database
    .prepare(
      `INSERT INTO analysis_reports (id, owner_key, source_url, report_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(reportId, ownerKey, sourceUrl, JSON.stringify(report), Date.now());
  return reportId;
}

export function consumeRequestNonce(ownerKey: string, nonce: string, createdAt: number): boolean {
  database.prepare("DELETE FROM request_nonces WHERE created_at < ?").run(Date.now() - 10 * 60 * 1000);
  try {
    database
      .prepare("INSERT INTO request_nonces (owner_key, nonce, created_at) VALUES (?, ?, ?)")
      .run(ownerKey, nonce, createdAt);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return false;
    throw error;
  }
}
