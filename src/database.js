import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const DB_NAME = 'azuba_finance_local';
const DB_VERSION = 1;
const STORE = 'transactions';
let sqliteDbPromise;

function openIndexedDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Local database is not supported by this device/browser.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('accountType', 'accountType', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local database.'));
    request.onblocked = () => reject(new Error('Please close other tabs/windows using Finance Manager and try again.'));
  });
}

async function openSQLiteDatabase() {
  if (!sqliteDbPromise) {
    sqliteDbPromise = (async () => {
      const sqlite = new SQLiteConnection(CapacitorSQLite);
      try { await sqlite.checkConnectionsConsistency(); } catch { /* Continue by checking/creating the connection. */ }
      const connection = await sqlite.isConnection(DB_NAME, false);
      const db = connection.result ? await sqlite.retrieveConnection(DB_NAME, false) : await sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
      await db.open();
      await db.execute(`CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY NOT NULL,
        amount INTEGER NOT NULL CHECK(amount > 0),
        type TEXT NOT NULL CHECK(type IN ('Income','Expense')),
        accountType TEXT NOT NULL CHECK(accountType IN ('Cash','Online')),
        category TEXT NOT NULL,
        reason TEXT NOT NULL,
        date TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      ); CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date); CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type); CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(accountType);`);
      return db;
    })().catch(error => { sqliteDbPromise = null; throw error; });
  }
  return sqliteDbPromise;
}

export async function initializeDatabase() {
  if (Capacitor.isNativePlatform()) await openSQLiteDatabase();
  else { const db = await openIndexedDatabase(); db.close(); }
  return true;
}

function fromSqlRow(row) {
  return { id: String(row.id), amount: Number(row.amount), type: row.type, accountType: row.accountType, category: row.category, reason: row.reason, date: row.date, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function getTransactions() {
  if (Capacitor.isNativePlatform()) {
    const db = await openSQLiteDatabase();
    const result = await db.query('SELECT id, amount, type, accountType, category, reason, date, createdAt, updatedAt FROM transactions ORDER BY date DESC');
    return (result.values || []).map(fromSqlRow);
  }
  const db = await openIndexedDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => new Date(b.date) - new Date(a.date)));
      req.onerror = () => reject(req.error || new Error('Could not load transactions.'));
    });
  } finally { db.close(); }
}

export async function saveTransaction(record) {
  if (Capacitor.isNativePlatform()) {
    const db = await openSQLiteDatabase();
    await db.run('INSERT OR REPLACE INTO transactions (id, amount, type, accountType, category, reason, date, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [record.id, record.amount, record.type, record.accountType, record.category, record.reason, record.date, record.createdAt, record.updatedAt]);
    return;
  }
  const db = await openIndexedDatabase();
  try { await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(record); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('Could not save transaction.')); tx.onabort = () => reject(tx.error || new Error('Save was cancelled.')); }); }
  finally { db.close(); }
}

export async function deleteTransaction(id) {
  if (Capacitor.isNativePlatform()) { const db = await openSQLiteDatabase(); await db.run('DELETE FROM transactions WHERE id = ?', [id]); return; }
  const db = await openIndexedDatabase();
  try { await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('Could not delete transaction.')); tx.onabort = () => reject(tx.error || new Error('Delete was cancelled.')); }); }
  finally { db.close(); }
}

export async function replaceTransactions(records) {
  if (Capacitor.isNativePlatform()) {
    const db = await openSQLiteDatabase();
    const statements = [{ statement: 'DELETE FROM transactions', values: [] }, ...records.map(r => ({ statement: 'INSERT INTO transactions (id, amount, type, accountType, category, reason, date, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', values: [r.id, r.amount, r.type, r.accountType, r.category, r.reason, r.date, r.createdAt, r.updatedAt] }))];
    await db.executeSet(statements, true);
    return;
  }
  const db = await openIndexedDatabase();
  try { await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE); store.clear(); records.forEach(record => store.put(record)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('Restore failed.')); tx.onabort = () => reject(tx.error || new Error('Restore was rolled back.')); }); }
  finally { db.close(); }
}
