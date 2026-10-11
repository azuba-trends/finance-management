export function amountToPaise(value) {
  const text = String(value ?? '').trim();
  const n = Number(text);
  if (!text || !Number.isFinite(n) || n <= 0 || !/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error('Enter a valid amount greater than ₹0 (up to 2 decimal places).');
  }
  const paise = Math.round(n * 100);
  if (!Number.isSafeInteger(paise) || paise <= 0) throw new Error('Amount is too large or invalid.');
  return paise;
}

export function amountToInput(paise) {
  return (Number(paise || 0) / 100).toFixed(2).replace(/\.00$/, '');
}

export function stats(list) {
  const income = list.reduce((sum, t) => sum + (t.type === 'Income' ? t.amount : 0), 0);
  const expenses = list.reduce((sum, t) => sum + (t.type === 'Expense' ? t.amount : 0), 0);
  return { income, expenses, balance: income - expenses };
}

export function dateToISO(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isWithinInclusiveDateRange(date, start = '', end = '') {
  const day = dateToISO(date);
  return Boolean(day) && (!start || day >= start) && (!end || day <= end);
}
