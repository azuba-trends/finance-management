import test from 'node:test';
import assert from 'node:assert/strict';
import { amountToInput, amountToPaise, dateToISO, isWithinInclusiveDateRange, stats } from '../src/financeUtils.js';

test('money conversion stores rupees as integer paise', () => {
  assert.equal(amountToPaise('100'), 10000);
  assert.equal(amountToPaise('100.50'), 10050);
  assert.equal(amountToInput(10050), '100.50');
});

test('money validation rejects empty, zero, negative and excessive precision', () => {
  for (const value of ['', '0', '-10', '12.345', 'abc']) assert.throws(() => amountToPaise(value));
});

test('stats calculate income, expenses and balance in minor units', () => {
  assert.deepEqual(stats([{ type: 'Income', amount: 10000 }, { type: 'Expense', amount: 2500 }, { type: 'Income', amount: 500 }]), { income: 10500, expenses: 2500, balance: 8000 });
});

test('date conversion and custom end date are inclusive', () => {
  assert.match(dateToISO('2026-10-11T12:00:00'), /^2026-10-11$/);
  assert.equal(isWithinInclusiveDateRange('2026-10-11T12:00:00', '2026-10-01', '2026-10-11'), true);
  assert.equal(isWithinInclusiveDateRange('2026-10-12T12:00:00', '2026-10-01', '2026-10-11'), false);
});
