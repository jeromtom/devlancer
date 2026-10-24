import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

fs.mkdirSync(config.dataDir, { recursive: true })
export const db = new Database(path.join(config.dataDir, 'devlancer.db'))
db.pragma('journal_mode = WAL')

db.exec(`
create table if not exists chats (
  jid text primary key, name text, kind text default 'unknown', speed_mode integer default 0
);
create table if not exists leads (
  id integer primary key, chat_jid text, src_msg_id text, src_msg_json text, poster_jid text, poster_name text,
  title text, summary text, budget text, deadline text, category text, fit real,
  pitch text, status text default 'new', created_at integer
);
create table if not exists projects (
  id integer primary key, chat_jid text, lead_id integer, slug text unique, name text,
  client_name text, client_jid text, client_email text, repo_url text, preview_url text,
  spec text, autopilot integer default 0, status text default 'active', created_at integer
);
create table if not exists messages (
  id integer primary key, source text, ext_id text unique, chat_jid text, sender text, sender_name text,
  from_me integer, text text, ts integer, project_id integer, intent text, scores_json text
);
create table if not exists tasks (
  id integer primary key, project_id integer, source_msg_id text, kind text, request text, in_scope integer,
  route text, devin_session_id text, devin_url text, pr_url text, preview_url text, status text, created_at integer
);
create table if not exists documents (
  id integer primary key, project_id integer, lead_id integer, kind text, number text unique,
  data_json text, pdf_path text, status text default 'draft', sent_via text, created_at integer
);
create table if not exists invoices (
  id integer primary key, document_id integer, project_id integer, amount real, due_date text,
  paid_amount real default 0, status text default 'draft'
);
create table if not exists payments (
  id integer primary key, invoice_id integer, source text, amount real, ref text, ts integer
);
create table if not exists approvals (
  id integer primary key, kind text, payload_json text, status text default 'pending',
  self_msg_id text, created_at integer
);
create table if not exists settings (key text primary key, value text);
`)

export function getSetting(key: string, fallback = ''): string {
  const row = db.prepare('select value from settings where key = ?').get(key) as { value: string } | undefined
  return row?.value ?? fallback
}

export function setSetting(key: string, value: string) {
  db.prepare('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, value)
}

export const now = () => Date.now()

export function nextNumber(prefix: 'PR' | 'CO' | 'INV'): string {
  const key = `seq_${prefix}`
  const n = Number(getSetting(key, '0')) + 1
  setSetting(key, String(n))
  return `${prefix}-${new Date().getFullYear()}-${String(n).padStart(3, '0')}`
}

export type Chat = { jid: string; name: string; kind: 'unknown' | 'marketplace' | 'client' | 'ignore'; speed_mode: number }
export type Lead = {
  id: number; chat_jid: string; src_msg_id: string; src_msg_json: string; poster_jid: string; poster_name: string
  title: string; summary: string; budget: string; deadline: string; category: string; fit: number
  pitch: string; status: string; created_at: number
}
export type Project = {
  id: number; chat_jid: string; lead_id: number | null; slug: string; name: string; client_name: string
  client_jid: string; client_email: string; repo_url: string; preview_url: string; spec: string
  autopilot: number; status: string; created_at: number
}
export type Task = {
  id: number; project_id: number; source_msg_id: string; kind: string; request: string; in_scope: number
  route: string; devin_session_id: string; devin_url: string; pr_url: string; preview_url: string; status: string; created_at: number
}
