/**
 * Employee salaries: what each one is owed this month, what has come off it,
 * and paying it out.
 *
 * A salary payment is recorded as a Salaries expense, so it reaches the
 * accounts and Profit & Loss through the path expenses already use. There is
 * no second payroll ledger to reconcile.
 *
 * Two things come off a month's pay, and they are accounted for differently:
 * an advance is a loan (cash left, nothing was spent), while a personal
 * expense was already booked as a cost the day it happened. Both reduce the
 * cash handed over; only the advance is added back into the wage expense.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../components/Modal';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import { IconPrint, IconPayOut } from '../components/icons';
import { ApiError } from '../api/client';
import * as api from '../api/resources';
import { formatMoney, todayIsoDate } from '../lib/format';
import { printPaymentReceipt } from '../components/PrintInvoice';
import { printReport } from '../components/PrintReport';
import { getBusiness } from '../lib/printBrand';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const kToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());

export function SalariesPage() {
  const today = kToday();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [payFor, setPayFor] = useState<api.PayrollRow | null>(null);
  const [historyFor, setHistoryFor] = useState<api.PayrollRow | null>(null);
  const [advanceFor, setAdvanceFor] = useState<api.PayrollRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['payroll', year, month],
    queryFn: () => api.getPayroll({ year, month }),
    staleTime: 0,
  });

  const thisYear = Number(today.slice(0, 4));
  const rows = data?.rows ?? [];

  function printPayroll() {
    if (!data) return;
    printReport({
      title: 'Payroll',
      subtitle: `${MONTHS[month - 1]} ${year}`,
      dateRange: `${MONTHS[month - 1]} ${year}`,
      business: getBusiness(),
      summary: [
        { label: 'Total payroll', value: `Rs ${data.totals.payroll}` },
        { label: 'Paid', value: `Rs ${data.totals.paid}` },
        { label: 'Outstanding', value: `Rs ${data.totals.outstanding}`, highlight: true },
      ],
      sections: [
        {
          heading: 'Employees',
          columns: [
            { key: 'name', label: 'Employee' },
            { key: 'role', label: 'Role' },
            { key: 'monthlySalary', label: 'Salary', money: true },
            { key: 'paidAmount', label: 'Paid', money: true },
            { key: 'outstanding', label: 'Outstanding', money: true },
            { key: 'paidDate', label: 'Paid on' },
            { key: 'status', label: 'Status', align: 'center' },
          ],
          rows: rows as unknown as Array<Record<string, unknown>>,
          emptyLabel: 'No employees.',
        },
      ],
      signatures: true,
    });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Employee Salaries</h1>
          <p className="subtitle">
            {data
              ? data.totals.unpaidCount === 0
                ? `Everyone is paid for ${MONTHS[month - 1]} ${year}.`
                : `${data.totals.unpaidCount} unpaid for ${MONTHS[month - 1]} ${year}.`
              : 'Loading…'}
          </p>
        </div>
        <div className="chart-range">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Payroll month">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Payroll year">
            {[thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn secondary small" onClick={printPayroll} disabled={!data}>
            <IconPrint size={14} /> Print
          </button>
        </div>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load payroll." />}

      {data && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="label">Monthly payroll</div>
              <div className="value">{formatMoney(data.totals.payroll)}</div>
            </div>
            <div className="stat-card">
              <div className="label">Paid</div>
              <div className="value">{formatMoney(data.totals.paid)}</div>
            </div>
            <div className={`stat-card${Number(data.totals.outstanding) > 0 ? ' warn' : ' accent'}`}>
              <div className="label">Outstanding</div>
              <div className="value">{formatMoney(data.totals.outstanding)}</div>
              {data.totals.arrearsCount > 0 && (
                <div className="hint">{data.totals.arrearsCount} earlier month(s) unpaid</div>
              )}
            </div>
            <div className="stat-card">
              <div className="label">Advances taken</div>
              <div className="value">{formatMoney(data.totals.advances)}</div>
              <div className="hint">Recovered from next salary</div>
            </div>
            <div className="stat-card">
              <div className="label">Own expenses</div>
              <div className="value">{formatMoney(data.totals.deductions)}</div>
              <div className="hint">Staff spending, recovered at month end</div>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState label="No active employees." />
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="text-right">Monthly salary</th>
                    <th className="text-right">Advance</th>
                    <th className="text-right">Own expenses</th>
                    <th className="text-right">Net payable</th>
                    <th>Paid on</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.userId}>
                      <td>
                        <button className="link-cell" onClick={() => setHistoryFor(r)}>{r.name}</button>
                        <div className="cell-muted" style={{ fontSize: 11.5 }}>{r.role}</div>
                      </td>
                      <td className="text-right">{r.monthlySalary ? formatMoney(r.monthlySalary) : '-'}</td>
                      <td className="text-right">
                        {Number(r.advanceOutstanding) > 0 ? (
                          <span className="advance-tag">- {formatMoney(r.advanceOutstanding)}</span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="text-right">
                        {Number(r.expenseDeduction) > 0 ? (
                          <span className="advance-tag" title={r.deductions.map((d) => `${d.date} ${d.label} ${d.amount}`).join('\n')}>
                            - {formatMoney(r.expenseDeduction)}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="text-right" style={{ fontWeight: 600 }}>
                        {r.status === 'PAID' ? formatMoney(r.paidAmount) : formatMoney(r.netPayable)}
                      </td>
                      <td className="cell-muted">{r.paidDate || '-'}</td>
                      <td>
                        <span className={`badge ${r.status === 'PAID' ? 'paid' : 'unpaid'}`}>
                          {r.status === 'PAID' ? 'Paid' : 'Unpaid'}
                        </span>
                        {r.arrears.length > 0 && (
                          <div className="cell-muted" style={{ fontSize: 11 }}>
                            also unpaid: {r.arrears.join(', ')}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                          <button className="btn ghost small" onClick={() => setAdvanceFor(r)}>
                            Advance
                          </button>
                          {r.status === 'UNPAID' && (
                            <button className="btn small" onClick={() => setPayFor(r)}>
                              <IconPayOut size={14} /> Pay
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted-3" style={{ fontSize: 12, marginTop: 10 }}>
            Monthly salaries are set on the Users page. Paying one records a Salaries expense, so it
            shows in Accounts and Profit &amp; Loss exactly once. An expense booked against an
            employee on the Expenses page and marked "deduct from salary" comes off their pay here.
          </p>
        </>
      )}

      {payFor && (
        <PaySalaryModal row={payFor} year={year} month={month} onClose={() => setPayFor(null)} />
      )}
      {historyFor && (
        <SalaryHistoryModal row={historyFor} onClose={() => setHistoryFor(null)} />
      )}
      {advanceFor && <AdvanceModal row={advanceFor} onClose={() => setAdvanceFor(null)} />}
    </div>
  );
}

function PaySalaryModal({ row, year, month, onClose }: { row: api.PayrollRow; year: number; month: number; onClose: () => void }) {
  // Defaults to net of any advance already taken.
  const [amount, setAmount] = useState(row.netPayable || row.monthlySalary || '0');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [paidDate, setPaidDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });

  const save = useMutation({
    mutationFn: () =>
      api.paySalary({
        userId: row.userId,
        periodYear: year,
        periodMonth: month,
        amount: Number(amount),
        accountId: Number(accountId),
        paidDate,
        notes: notes || undefined,
      }),
    onSuccess: (res) => {
      onClose();
      for (const k of ['payroll', 'accounts', 'expenses', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
      printPaymentReceipt({
        partyKind: 'SUPPLIER',
        partyName: res.employee,
        amount: res.amount,
        date: res.paidDate,
        method: 'SALARY',
        account: res.account,
        balanceAfter: '0.00',
        reference: res.period,
      });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record that salary.'),
  });

  return (
    <Modal title={`Pay ${row.name} - ${MONTHS[month - 1]} ${year}`} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!accountId) return setError('Choose which account it is paid from.');
          if (Number(amount) <= 0) return setError('Enter an amount.');
          save.mutate();
        }}
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sal-amount">Amount</label>
            <input id="sal-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          </div>
          <div className="field">
            <label htmlFor="sal-account">Paid from</label>
            <select id="sal-account" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')} required>
              <option value="">Choose…</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sal-date">Paid on</label>
            <input id="sal-date" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="sal-note">Note</label>
            <input id="sal-note" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        {(Number(row.advanceOutstanding) > 0 || Number(row.expenseDeduction) > 0) && (
          <div className="callout" style={{ marginTop: 12 }}>
            <div className="row-between">
              <span>Monthly salary</span>
              <span>{formatMoney(row.monthlySalary)}</span>
            </div>
            {Number(row.advanceOutstanding) > 0 && (
              <div className="row-between">
                <span>Less advance taken</span>
                <span>- {formatMoney(row.advanceOutstanding)}</span>
              </div>
            )}
            {row.deductions.map((d, i) => (
              <div className="row-between" key={i}>
                <span>Less {d.label} ({d.date})</span>
                <span>- {formatMoney(d.amount)}</span>
              </div>
            ))}
            <div className="row-between" style={{ fontWeight: 600 }}>
              <span>Net payable</span>
              <span>{formatMoney(row.netPayable)}</span>
            </div>
            <p className="muted-3" style={{ fontSize: 12, margin: '8px 0 0' }}>
              Saving clears the advance and marks those expenses recovered.
            </p>
          </div>
        )}
        <p className="muted-3" style={{ fontSize: 12, marginTop: 10 }}>
          Recorded as a Salaries expense. A receipt prints automatically once saved.
        </p>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Pay salary'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SalaryHistoryModal({ row, onClose }: { row: api.PayrollRow; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['salary-history', row.userId],
    queryFn: () => api.getSalaryHistory(row.userId),
  });

  function printHistory() {
    if (!data) return;
    printReport({
      title: 'Salary Record',
      subtitle: data.employee.name,
      dateRange: 'All time',
      business: getBusiness(),
      party: { label: 'Employee', name: data.employee.name, phone: data.employee.role },
      summary: [
        { label: 'Monthly salary', value: `Rs ${data.employee.monthlySalary || '0.00'}` },
        { label: 'Total paid', value: `Rs ${data.totalPaid}`, highlight: true },
      ],
      sections: [
        {
          heading: 'Payments',
          columns: [
            { key: 'period', label: 'Month' },
            { key: 'paidDate', label: 'Paid on' },
            { key: 'amount', label: 'Amount', money: true },
            { key: 'account', label: 'From' },
            { key: 'notes', label: 'Note' },
          ],
          rows: data.rows,
          emptyLabel: 'No salary payments yet.',
        },
      ],
      signatures: true,
    });
  }

  return (
    <Modal title={`${row.name} - salary record`} onClose={onClose}>
      {isLoading && <LoadingState />}
      {data && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="label">Monthly salary</div>
              <div className="value">{data.employee.monthlySalary ? formatMoney(data.employee.monthlySalary) : '-'}</div>
            </div>
            <div className="stat-card accent">
              <div className="label">Total paid</div>
              <div className="value">{formatMoney(data.totalPaid)}</div>
              <div className="hint">{data.rows.length} payment(s)</div>
            </div>
          </div>

          {data.rows.length === 0 ? (
            <EmptyState label="No salary payments recorded yet." />
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr><th>Month</th><th>Paid on</th><th className="text-right">Amount</th><th>From</th><th>Note</th></tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.period}</td>
                      <td className="cell-muted">{r.paidDate}</td>
                      <td className="text-right">{formatMoney(r.amount)}</td>
                      <td>{r.account}</td>
                      <td>{r.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn secondary" onClick={printHistory}>
              <IconPrint size={15} /> Print record
            </button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/**
 * Cash handed over before payday. Not an expense - it is money the shop will
 * get back by paying that much less salary, so it only moves the account and
 * clears automatically when the salary is paid.
 */
function AdvanceModal({ row, onClose }: { row: api.PayrollRow; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [takenDate, setTakenDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const { data: history } = useQuery({ queryKey: ['advances', row.userId], queryFn: () => api.getAdvances(row.userId) });

  const save = useMutation({
    mutationFn: () =>
      api.payAdvance({
        userId: row.userId,
        amount: Number(amount),
        accountId: Number(accountId),
        takenDate,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      setAmount('');
      setNotes('');
      for (const k of ['payroll', 'advances', 'accounts', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record that advance.'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteAdvance(id),
    onSuccess: () => {
      for (const k of ['payroll', 'advances', 'accounts', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not remove that advance.'),
  });

  return (
    <Modal title={`Advance - ${row.name}`} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <p className="muted" style={{ marginTop: 0 }}>
        Currently outstanding: <strong>{formatMoney(history?.outstanding ?? row.advanceOutstanding)}</strong>. This is
        deducted from the next salary, not booked as an expense.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!accountId) return setError('Choose which account the cash came from.');
          if (Number(amount) <= 0) return setError('Enter an amount.');
          save.mutate();
        }}
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="adv-amount">Amount</label>
            <input id="adv-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          </div>
          <div className="field">
            <label htmlFor="adv-account">Taken from</label>
            <select id="adv-account" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')} required>
              <option value="">Choose...</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="adv-date">Date</label>
            <input id="adv-date" type="date" value={takenDate} onChange={(e) => setTakenDate(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="adv-note">Reason</label>
            <input id="adv-note" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="submit" className="btn" disabled={save.isPending}>
            {save.isPending ? 'Saving...' : 'Record advance'}
          </button>
        </div>
      </form>

      {history && history.rows.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 20 }}>History</div>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr><th>Date</th><th className="text-right">Amount</th><th>From</th><th>Reason</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {history.rows.map((a) => (
                  <tr key={a.id}>
                    <td className="cell-muted">{a.date}</td>
                    <td className="text-right">{formatMoney(a.amount)}</td>
                    <td>{a.account}</td>
                    <td>{a.notes || '-'}</td>
                    <td>
                      <span className={`badge ${a.settled ? 'paid' : 'partial'}`}>
                        {a.settled ? 'Recovered' : 'Outstanding'}
                      </span>
                    </td>
                    <td>
                      {!a.settled && (
                        <button className="btn ghost small" onClick={() => remove.mutate(a.id)}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
