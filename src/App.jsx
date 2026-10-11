import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { deleteTransaction, getTransactions, replaceTransactions, saveTransaction } from './database';
import { amountToInput, amountToPaise, dateToISO, stats } from './financeUtils';
import './App.css';

const CATEGORIES = ['Food', 'Travel', 'Shopping', 'Salary', 'Digital', 'Apps', 'Housing', 'Transportation', 'Entertainment', 'Social', 'Medical', 'Bonus', 'Benefits', 'Red Packet', 'Side Job', 'Other'];
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const formatINR = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(value) || 0) / 100);
const displayDate = (iso) => { const d = new Date(`${dateToISO(iso)}T12:00:00`); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };
const initialFilters = { date: 'This Month', type: 'All', account: 'All', cats: [], search: '', start: '', end: '' };

function App() {
  const [transactions, setTransactions] = useState([]);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [filters, setFilters] = useState(initialFilters);
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('Expense');
  const [account, setAccount] = useState('Cash');
  const [category, setCategory] = useState('Food');
  const [reason, setReason] = useState('');
  const [entryDate, setEntryDate] = useState(todayISO());
  const [editId, setEditId] = useState(null);
  const [formError, setFormError] = useState('');
  const importRef = useRef(null);
  const amountRef = useRef(null);

  const refresh = useCallback(async () => {
    const rows = await getTransactions();
    setTransactions(rows);
  }, []);

  useEffect(() => {
    let mounted = true;
    getTransactions().then(rows => { if (mounted) setTransactions(rows); }).catch(error => {
      if (mounted) setNotice({ type: 'error', message: `Local database error: ${error.message}` });
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const currentMonthData = useMemo(() => {
    const now = new Date();
    return transactions.filter(t => { const d = new Date(`${dateToISO(t.date)}T12:00:00`); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  }, [transactions]);

  const filteredData = useMemo(() => {
    const today = todayISO();
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const start7 = dateToISO(sevenDaysAgo);
    return transactions.filter(t => {
      const date = dateToISO(t.date);
      let dateOk = true;
      if (filters.date === 'Today') dateOk = date === today;
      else if (filters.date === 'Last 7 Days') dateOk = date >= start7 && date <= today;
      else if (filters.date === 'This Month') dateOk = date.slice(0, 7) === today.slice(0, 7);
      else if (filters.date === 'Custom') dateOk = (!filters.start || date >= filters.start) && (!filters.end || date <= filters.end);
      const typeOk = filters.type === 'All' || t.type === filters.type;
      const accountOk = filters.account === 'All' || t.accountType === filters.account;
      const categoryOk = filters.cats.length === 0 || filters.cats.includes(t.category);
      const query = filters.search.trim().toLowerCase();
      const searchOk = !query || `${t.reason} ${t.category} ${t.accountType} ${t.type}`.toLowerCase().includes(query);
      return dateOk && typeOk && accountOk && categoryOk && searchOk;
    });
  }, [transactions, filters]);

  const allStats = useMemo(() => stats(transactions), [transactions]);
  const monthStats = useMemo(() => stats(currentMonthData), [currentMonthData]);
  const historyStats = useMemo(() => stats(filteredData), [filteredData]);
  const cashStats = useMemo(() => stats(transactions.filter(t => t.accountType === 'Cash')), [transactions]);
  const onlineStats = useMemo(() => stats(transactions.filter(t => t.accountType === 'Online')), [transactions]);

  const chartData = useMemo(() => {
    const groups = new Map();
    [...filteredData].sort((a, b) => dateToISO(a.date).localeCompare(dateToISO(b.date))).forEach(t => {
      const day = dateToISO(t.date);
      const label = new Date(`${day}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      if (!groups.has(day)) groups.set(day, { date: day, name: label, Income: 0, Expense: 0 });
      groups.get(day)[t.type] += t.amount / 100;
    });
    return [...groups.values()];
  }, [filteredData]);

  const openNew = () => {
    setEditId(null); setAmount(''); setType('Expense'); setAccount('Cash'); setCategory('Food'); setReason(''); setEntryDate(todayISO()); setFormError(''); setIsModalOpen(true);
    window.setTimeout(() => amountRef.current?.focus(), 100);
  };
  const openEdit = (t) => {
    setEditId(t.id); setAmount(amountToInput(t.amount)); setType(t.type); setAccount(t.accountType || 'Cash'); setCategory(t.category || 'Other'); setReason(t.reason || ''); setEntryDate(dateToISO(t.date)); setFormError(''); setIsModalOpen(true);
  };
  const closeModal = () => { if (!saving) { setIsModalOpen(false); setFormError(''); } };

  const handleSave = async (event) => {
    event.preventDefault();
    setFormError('');
    const trimmedReason = reason.trim();
    if (!trimmedReason) { setFormError('Please enter a description.'); return; }
    if (!entryDate || Number.isNaN(new Date(`${entryDate}T12:00:00`).getTime())) { setFormError('Please select a valid transaction date.'); return; }
    let paise;
    try { paise = amountToPaise(amount); } catch (error) { setFormError(error.message); return; }
    setSaving(true);
    try {
      const previous = editId ? transactions.find(t => t.id === editId) : null;
      const record = { id: editId || (globalThis.crypto?.randomUUID?.() ?? `tx-${Date.now()}-${Math.random().toString(16).slice(2)}`), amount: paise, type, accountType: account, category, reason: trimmedReason, date: new Date(`${entryDate}T12:00:00`).toISOString(), createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      await saveTransaction(record);
      await refresh();
      setIsModalOpen(false); setEditId(null); setAmount(''); setReason('');
      setNotice({ type: 'success', message: editId ? 'Transaction updated.' : 'Transaction saved on this device.' });
    } catch (error) { setFormError(`Could not save transaction: ${error.message}`); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this transaction permanently from this device?')) return;
    try { await deleteTransaction(id); await refresh(); setNotice({ type: 'success', message: 'Transaction deleted.' }); }
    catch (error) { setNotice({ type: 'error', message: `Delete failed: ${error.message}` }); }
  };

  const exportBackup = () => {
    const backup = { app: 'Azuba Finance Manager', formatVersion: 1, exportedAt: new Date().toISOString(), currency: 'INR', amountUnit: 'paise', transactions };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `azuba-finance-backup-${todayISO()}.json`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    setNotice({ type: 'success', message: 'Backup exported. Keep the file somewhere safe.' });
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Backup file is too large (maximum 10 MB).');
      const data = JSON.parse(await file.text());
      if (!data || data.formatVersion !== 1 || !Array.isArray(data.transactions)) throw new Error('This is not a supported Finance Manager backup.');
      const ids = new Set();
      const records = data.transactions.map((t, index) => {
        if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id)) throw new Error(`Invalid or duplicate transaction ID at record ${index + 1}.`);
        ids.add(t.id);
        if (!Number.isSafeInteger(t.amount) || t.amount <= 0) throw new Error(`Invalid amount in record ${index + 1}.`);
        if (!['Income', 'Expense'].includes(t.type) || !['Cash', 'Online'].includes(t.accountType) || typeof t.reason !== 'string' || !t.reason.trim() || typeof t.category !== 'string') throw new Error(`Invalid transaction details in record ${index + 1}.`);
        const d = new Date(t.date);
        if (Number.isNaN(d.getTime())) throw new Error(`Invalid date in record ${index + 1}.`);
        return { id: t.id, amount: t.amount, type: t.type, accountType: t.accountType, category: t.category, reason: t.reason.trim(), date: d.toISOString(), createdAt: t.createdAt || d.toISOString(), updatedAt: t.updatedAt || d.toISOString() };
      });
      const confirmed = window.confirm(`Backup valid: ${records.length} transactions.\n\nRestore replaces ALL current transactions on this device. Export a backup of current data first if needed. Continue?`);
      if (!confirmed) return;
      await replaceTransactions(records); await refresh();
      setNotice({ type: 'success', message: `Restored ${records.length} transactions successfully.` });
    } catch (error) { setNotice({ type: 'error', message: `Restore cancelled: ${error.message}` }); }
  };

  if (loading) return <div className="loading-screen"><div className="loading-mark">₹</div><h2>Azuba Finance</h2><p>Opening your local finance data…</p></div>;

  return <div className="app-container">
    <header className="header"><div className="brand-lockup"><span className="brand-icon">₹</span><div><strong>Azuba Finance</strong><small>{activeTab}</small></div></div><button className="header-action" onClick={exportBackup} aria-label="Export backup" title="Export backup">⇧</button></header>
    <main className="main-content" key={activeTab}>
      {activeTab === 'Dashboard' && <>
        <section className="master-card"><p>Total Balance</p><h2>{formatINR(allStats.balance)}</h2><div className="master-sub"><span>↑ In: {formatINR(allStats.income)}</span><span>↓ Out: {formatINR(allStats.expenses)}</span></div></section>
        <div className="dashboard-summary"><div className="card"><span className="account-symbol cash">₹</span><h3>Cash Balance</h3><p className={cashStats.balance < 0 ? 'text-red' : 'text-black'}>{formatINR(cashStats.balance)}</p></div><div className="card"><span className="account-symbol online">↗</span><h3>Online Balance</h3><p className={onlineStats.balance < 0 ? 'text-red' : 'text-blue'}>{formatINR(onlineStats.balance)}</p></div></div>
        <div className="section-heading"><div><h3>Monthly summary</h3><p>{new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</p></div><span className="period-pill">This month</span></div>
        <div className="dashboard-summary"><div className="card summary-card income-card"><h3>Income</h3><p className="text-green">+{formatINR(monthStats.income)}</p></div><div className="card summary-card expense-card"><h3>Expenses</h3><p className="text-red">−{formatINR(monthStats.expenses)}</p></div></div>
        <div className="section-heading"><div><h3>Recent transactions</h3><p>Latest activity on this device</p></div><button className="text-button" onClick={() => setActiveTab('History')}>See all</button></div>
        {transactions.slice(0, 8).length === 0 ? <EmptyState title="Your money story starts here" text="Add your first income or expense to see your balance." action={openNew} /> : transactions.slice(0, 8).map(t => <TransactionCard key={t.id} t={t} onEdit={openEdit} onDelete={handleDelete} />)}
      </>}

      {activeTab === 'History' && <>
        <div className="page-intro"><p className="eyebrow">YOUR RECORDS</p><h2>Transaction history</h2><p>Search, filter and review your money activity.</p></div>
        <section className="filter-panel">
          <input className="form-control search-input" type="search" placeholder="Search description or category…" value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} />
          <div className="filter-row"><select className="form-control" value={filters.date} onChange={e => setFilters({ ...filters, date: e.target.value })}><option>Today</option><option>Last 7 Days</option><option>This Month</option><option>All Time</option><option>Custom</option></select><select className="form-control" value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })}><option value="All">All types</option><option>Income</option><option>Expense</option></select></div>
          <div className="filter-row"><select className="form-control" value={filters.account} onChange={e => setFilters({ ...filters, account: e.target.value })}><option value="All">All accounts</option><option>Cash</option><option>Online</option></select><button className="clear-filter" onClick={() => setFilters(initialFilters)}>Reset filters</button></div>
          {filters.date === 'Custom' && <div className="filter-row"><label className="date-field"><span>From</span><input className="form-control" type="date" value={filters.start} max={filters.end || undefined} onChange={e => setFilters({ ...filters, start: e.target.value })} /></label><label className="date-field"><span>To (inclusive)</span><input className="form-control" type="date" value={filters.end} min={filters.start || undefined} onChange={e => setFilters({ ...filters, end: e.target.value })} /></label></div>}
          <details className="category-filter"><summary>Categories {filters.cats.length ? `(${filters.cats.length} selected)` : '(all)'}</summary><div className="category-options">{CATEGORIES.map(c => <label key={c}><input type="checkbox" checked={filters.cats.includes(c)} onChange={e => setFilters({ ...filters, cats: e.target.checked ? [...filters.cats, c] : filters.cats.filter(x => x !== c) })} />{c}</label>)}</div></details>
        </section>
        <section className="filtered-total"><div><span>Filtered balance</span><strong className={historyStats.balance < 0 ? 'text-red' : ''}>{formatINR(historyStats.balance)}</strong></div><div className="filtered-pair"><span>In <b className="text-green">{formatINR(historyStats.income)}</b></span><span>Out <b className="text-red">{formatINR(historyStats.expenses)}</b></span></div><small>{filteredData.length} {filteredData.length === 1 ? 'transaction' : 'transactions'}</small></section>
        {filteredData.length === 0 ? <EmptyState title="No transactions found" text="Try changing the filters or add a new record." action={openNew} /> : filteredData.map(t => <TransactionCard key={t.id} t={t} onEdit={openEdit} onDelete={handleDelete} />)}
      </>}

      {activeTab === 'Overview' && <>
        <div className="page-intro"><p className="eyebrow">AT A GLANCE</p><h2>Your money overview</h2><p>Charts reflect the filters you select in History.</p></div>
        <div className="overview-stats"><div><span>Total income</span><strong className="text-green">{formatINR(historyStats.income)}</strong></div><div><span>Total expenses</span><strong className="text-red">{formatINR(historyStats.expenses)}</strong></div></div>
        <section className="chart-card"><div className="chart-title"><div><h3>Daily cashflow</h3><p>Income vs expenses</p></div><span className="chart-dot green-dot" /></div>{chartData.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 10, right: 8, left: -18, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f4" /><XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} /><YAxis fontSize={10} tickLine={false} axisLine={false} /><Tooltip formatter={v => formatINR(Number(v) * 100)} /><Line type="monotone" dataKey="Income" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 5 }} /><Line type="monotone" dataKey="Expense" stroke="#ef4444" strokeWidth={3} dot={false} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div> : <p className="chart-empty">Add transactions to see your cashflow chart.</p>}</section>
        <section className="chart-card"><div className="chart-title"><div><h3>Expense distribution</h3><p>Daily spending trend</p></div><span className="chart-dot red-dot" /></div>{chartData.some(d => d.Expense > 0) ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 10, right: 8, left: -18, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f4" /><XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} /><YAxis fontSize={10} tickLine={false} axisLine={false} /><Tooltip formatter={v => formatINR(Number(v) * 100)} /><Bar dataKey="Expense" fill="#ef4444" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div> : <p className="chart-empty">Expense entries will appear here.</p>}</section>
        <section className="data-tools"><div><h3>Data & backup</h3><p>Your records stay on this device. Keep an external backup to protect against app data loss.</p></div><button className="secondary-btn" onClick={exportBackup}>Export JSON backup</button><button className="secondary-btn" onClick={() => importRef.current?.click()}>Restore from backup</button><input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={handleImportFile} /></section>
      </>}
    </main>

    <button className="floating-btn" onClick={openNew} aria-label="Add transaction">+</button>
    <nav className="bottom-nav" aria-label="Main navigation">{[['Dashboard','▦'],['History','↻'],['Overview','◔']].map(([label, icon]) => <button key={label} className={`nav-item ${activeTab === label ? 'active' : ''}`} onClick={() => setActiveTab(label)}><span>{icon}</span>{label}</button>)}</nav>

    {isModalOpen && <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) closeModal(); }}><section className="modal-content" role="dialog" aria-modal="true" aria-labelledby="entry-title"><div className="modal-handle" /><div className="modal-heading"><div><p className="eyebrow">TRANSACTION</p><h2 id="entry-title">{editId ? 'Edit entry' : 'New entry'}</h2></div><button className="close-modal" onClick={closeModal} aria-label="Close">×</button></div>
      <form onSubmit={handleSave} noValidate><div className="segmented"><button type="button" className={type === 'Expense' ? 'selected expense-selected' : ''} onClick={() => setType('Expense')}>− Expense</button><button type="button" className={type === 'Income' ? 'selected income-selected' : ''} onClick={() => setType('Income')}>＋ Income</button></div>
        <label className="field-label" htmlFor="amount">Amount</label><div className="amount-input-wrap"><span>₹</span><input ref={amountRef} id="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div className="form-group-row"><label className="field-label field-half">Account<select className="form-control" value={account} onChange={e => setAccount(e.target.value)}><option>Cash</option><option>Online</option></select></label><label className="field-label field-half">Category<select className="form-control" value={category} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label></div>
        <label className="field-label" htmlFor="reason">Description</label><input id="reason" className="form-control" type="text" maxLength={120} placeholder="What was this for?" value={reason} onChange={e => setReason(e.target.value)} />
        <label className="field-label" htmlFor="entry-date">Transaction date</label><input id="entry-date" className="form-control" type="date" value={entryDate} max={todayISO()} onChange={e => setEntryDate(e.target.value)} />
        {formError && <p className="form-error" role="alert">{formError}</p>}<button className="submit-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : editId ? 'Update transaction' : 'Save transaction'}</button><button type="button" className="cancel-btn" onClick={closeModal} disabled={saving}>Cancel</button>
      </form></section></div>}
    {notice && <div className={`toast ${notice.type}`} role="status"><span>{notice.type === 'error' ? '!' : '✓'}</span>{notice.message}<button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}
    <footer className="privacy-note"><span>●</span> Stored locally on this device · No account required</footer>
  </div>;
}

function TransactionCard({ t, onEdit, onDelete }) {
  return <article className="transaction-card"><div className={`transaction-icon ${t.type === 'Income' ? 'transaction-income' : 'transaction-expense'}`}>{t.type === 'Income' ? '↙' : '↗'}</div><div className="transaction-info"><strong>{t.reason}</strong><small>{t.category} · {t.accountType} · {displayDate(t.date)}</small></div><div className="transaction-right"><strong className={t.type === 'Income' ? 'text-green' : 'text-red'}>{t.type === 'Income' ? '+' : '−'}{formatINR(t.amount)}</strong><div className="transaction-actions"><button onClick={() => onEdit(t)} aria-label={`Edit ${t.reason}`} title="Edit">✎</button><button onClick={() => onDelete(t.id)} aria-label={`Delete ${t.reason}`} title="Delete">⌫</button></div></div></article>;
}
function EmptyState({ title, text, action }) { return <div className="empty-state"><span className="empty-icon">₹</span><h3>{title}</h3><p>{text}</p><button onClick={action}>＋ Add transaction</button></div>; }
export default App;
