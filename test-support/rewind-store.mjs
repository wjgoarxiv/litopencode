import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

// Builds a small opencode.db with the tables and columns the collector reads, from plain JS rows.
export function buildStore(file, { sessions }) {
  fs.rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT, agent TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE todo (session_id TEXT, content TEXT, status TEXT, position INTEGER);
    CREATE TABLE credential (id TEXT, secret TEXT);
    INSERT INTO credential VALUES ('c1', 'SENTINEL-NEVER-READ-0123456789');
  `);
  let counter = 0;
  const next = (prefix) => `${prefix}_${++counter}`;
  for (const session of sessions) {
    db.prepare("INSERT INTO session VALUES (?,?,?,?,?,?,?,?)").run(session.id, session.parent ?? null, session.directory, session.title ?? "", "build", session.created, session.updated, null);
    let at = session.created;
    for (const message of session.messages ?? []) {
      const id = next("msg");
      at += 1000;
      db.prepare("INSERT INTO message VALUES (?,?,?,?)").run(id, session.id, at, JSON.stringify({ role: message.role }));
      for (const part of message.parts) {
        at += 10;
        db.prepare("INSERT INTO part VALUES (?,?,?,?,?)").run(next("prt"), id, session.id, at, JSON.stringify(part));
      }
    }
    (session.todos ?? []).forEach((todo, index) => db.prepare("INSERT INTO todo VALUES (?,?,?,?)").run(session.id, todo.content, todo.status, index));
  }
  db.close();
}
