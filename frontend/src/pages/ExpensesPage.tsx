import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatMoney, formatDate, todayIsoDate } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import type { Account, Expense } from '../api/types';
import { DeleteButton } from '../components/DeleteButton';
import { EditButton } from '../components/EditButton';
import { useAuth } from '../auth/AuthContext';
import { AccountBalanceNote } from '../components/AccountBalanceNote';
import { FilterBar, usePaged, textMatches, withinRange, type DateRange } from '../components/LedgerFilters';

/**
 * Every expense is booked against a person - the owner, or a named employee -
 * so a cost can always be traced back to who it was spent on.
 *
 * An employee's *personal* spending can be marked "deduct from salary". It is
 * still a real expense the day it happens (the shop's money left), and at the
 * end of the month it comes off that employee's pay on the Salaries page.
 */
export function ExpensesPage() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const isOwner = me?.role === 'OWNER';
  // Only the owner can list staff; an employee books against themselves anyway.
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: api.listUsers, enabled: isOwner });
  const { data: categories } = useQuery({ queryKey: ['expense-categories'], queryFn: api.listExpenseCategories });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const { data: expenses, isLoading, error } = useQuery({ queryKey: ['expenses'], queryFn: () => api.listExpenses() });

  const [search, setSearch] = useState('');
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [filterCategory, setFilterCategory] = useState('');

  const filtered = useMemo(() => {
    const all = (expenses ?? []) as Expense[];
    return all.filter((e) => {
      if (filterCategory && String(e.categoryId) !== filterCategory) return false;
      if (!withinRange(e.expenseDate, range)) return false;
      if (!search.trim()) return true;
      return textMatches(
        `${e.category?.name ?? ''} ${e.account?.name ?? ''} ${e.description ?? ''} ${e.forUser?.name ?? ''}`,
        search,
      );
    });
  }, [expenses, search, range, filterCategory]);

  const { page, pager } = usePaged(filtered);
  const filteredTotal = filtered.reduce((sum, e) => sum + Number(e.amount), 0);

  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayIsoDate());
  const [forUserId, setForUserId] = useState<number | ''>('');
  const [deductFromSalary, setDeductFromSalary] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const createCategory = useMutation({
    mutationFn: () => api.createExpenseCategory(newCategoryName),
    onSuccess: (cat) => {
      setNewCategoryName('');
      setCategoryId(cat.id);
      qc.invalidateQueries({ queryKey: ['expense-categories'] });
    },
  });

  const selectedUser = (users ?? []).find((u) => u.id === forUserId);
  const selectedIsEmployee = selectedUser?.role === 'EMPLOYEE';

  const mutation = useMutation({
    mutationFn: () =>
      api.createExpense({
        categoryId,
        accountId,
        amount: Number(amount),
        expenseDate: expenseDate || todayIsoDate(),
        description: description || undefined,
        forUserId: forUserId || undefined,
        deductFromSalary,
      }),
    onSuccess: () => {
      setAmount('');
      setDescription('');
      setDeductFromSalary(false);
      setExpenseDate(todayIsoDate());
      for (const k of ['expenses', 'dashboard', 'accounts', 'payroll']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Could not record expense'),
  });

  return (
    <div>
      <div className="page-header">
        <h1>Expenses</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Record an expense</h3>
        {formError && <ErrorBanner message={formError} />}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            if (!categoryId || !accountId) return setFormError('Choose a category and account.');
            mutation.mutate();
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label>Date</label>
              <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} required />
            </div>
            <div className="field">
              <label>Category</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')} required>
                <option value="">Select category…</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Amount</label>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="field">
              <label>Paid from account</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')} required>
                <option value="">Select account…</option>
                {(accounts ?? []).map((a: Account) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <AccountBalanceNote
                account={(accounts ?? []).find((a: Account) => a.id === accountId)}
                amount={Number(amount || 0)}
                direction="out"
              />
            </div>
            <div className="field">
              <label htmlFor="exp-for">Spent on</label>
              <select
                id="exp-for"
                value={forUserId}
                disabled={!isOwner}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : '';
                  setForUserId(v);
                  const picked = (users ?? []).find((u) => u.id === v);
                  if (picked?.role !== 'EMPLOYEE') setDeductFromSalary(false);
                }}
              >
                <option value="">{me?.name ?? 'Me'} (you)</option>
                {(users ?? [])
                  .filter((u) => u.id !== me?.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role === 'OWNER' ? 'Owner' : 'Employee'})
                    </option>
                  ))}
              </select>
              <span className="hint">
                {isOwner ? 'Who the money was spent on.' : 'Recorded against your name.'}
              </span>
            </div>
            <div className="field">
              <label>Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          {selectedIsEmployee && (
            <label className="check-row" style={{ marginTop: 10 }}>
              <input
                type="checkbox"
                checked={deductFromSalary}
                onChange={(e) => setDeductFromSalary(e.target.checked)}
              />
              <span>
                Deduct from their salary
                <span className="hint" style={{ display: 'block' }}>
                  Personal spending, not a shop cost they incurred for you. It comes off their pay at
                  the end of the month.
                </span>
              </span>
            </label>
          )}
          <button type="submit" className="btn" disabled={mutation.isPending} style={{ marginTop: 8 }}>
            {mutation.isPending ? 'Saving…' : 'Record expense'}
          </button>
        </form>

        <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>New expense category</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="e.g. Transport" />
              <button
                type="button"
                className="btn secondary small"
                disabled={!newCategoryName || createCategory.isPending}
                onClick={() => createCategory.mutate()}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </div>

      <h3>Recent expenses</h3>
      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load expenses." />}
      {expenses && expenses.length === 0 && <EmptyState label="No expenses recorded yet." />}

      {expenses && expenses.length > 0 && (
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Category, account, note or person…"
          range={range}
          onRange={setRange}
          resultCount={filtered.length}
          totalCount={expenses.length}
        >
          <label className="field inline">
            <span>Category</span>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">Any</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </FilterBar>
      )}

      {/* The total for what is on screen, not for the page - the reason the
          filtering is done in the browser rather than with a LIMIT. */}
      {expenses && expenses.length > 0 && filtered.length > 0 && (
        <p className="muted-3" style={{ fontSize: 12.5, marginTop: -4, marginBottom: 10 }}>
          {filtered.length === expenses.length ? 'All expenses' : 'Matching expenses'} come to{' '}
          <strong>{formatMoney(filteredTotal)}</strong>.
        </p>
      )}

      {expenses && expenses.length > 0 && filtered.length === 0 && (
        <EmptyState label="No expense matches those filters." />
      )}

      {expenses && filtered.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Account</th>
                <th>Spent on</th>
                <th className="text-right">Amount</th>
                <th>Description</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {page.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.expenseDate)}</td>
                  <td>{e.category?.name}</td>
                  <td>{e.account?.name}</td>
                  <td>
                    {e.forUser ? e.forUser.name : 'The shop'}
                    {e.deductFromSalary && (
                      <div className="cell-muted" style={{ fontSize: 11.5 }}>
                        {e.settledBySalaryPaymentId ? 'recovered from salary' : 'deducts from salary'}
                      </div>
                    )}
                  </td>
                  <td className="text-right">{formatMoney(e.amount)}</td>
                  <td>{e.description ?? '-'}</td>
                  <td>
                    <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                    <EditButton
                      title={`${e.category?.name ?? 'expense'} - ${formatMoney(e.amount)}`}
                      fields={[
                        { key: 'expenseDate', label: 'Date', type: 'date', required: true },
                        { key: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true },
                        {
                          key: 'categoryId',
                          label: 'Category',
                          type: 'select',
                          required: true,
                          options: (categories ?? []).map((c) => ({ value: c.id, label: c.name })),
                        },
                        {
                          key: 'accountId',
                          label: 'Paid from',
                          type: 'select',
                          required: true,
                          options: (accounts ?? []).map((a) => ({ value: a.id, label: a.name })),
                          hint: 'Changing this moves the money between accounts.',
                        },
                        { key: 'description', label: 'Note' },
                        {
                          key: 'forUserId',
                          label: 'Spent on',
                          type: 'select',
                          options: [
                            { value: '', label: 'The shop' },
                            ...(users ?? []).map((u) => ({ value: u.id, label: u.name })),
                          ],
                        },
                        {
                          key: 'deductFromSalary',
                          label: 'Deduct from salary',
                          type: 'select',
                          options: [
                            { value: 'no', label: 'No - a shop cost' },
                            { value: 'yes', label: 'Yes - their own spending' },
                          ],
                        },
                      ]}
                      initial={{
                        expenseDate: String(e.expenseDate).slice(0, 10),
                        amount: String(e.amount),
                        categoryId: String(e.categoryId),
                        accountId: String(e.accountId),
                        description: e.description ?? '',
                        forUserId: e.forUserId ? String(e.forUserId) : '',
                        deductFromSalary: e.deductFromSalary ? 'yes' : 'no',
                      }}
                      onSave={(v) =>
                        api.adminUpdateExpense(e.id, {
                          expenseDate: v.expenseDate,
                          amount: Number(v.amount),
                          categoryId: Number(v.categoryId),
                          accountId: Number(v.accountId),
                          description: v.description,
                          forUserId: v.forUserId ? Number(v.forUserId) : undefined,
                          deductFromSalary: v.deductFromSalary === 'yes',
                        })
                      }
                      invalidate={['expenses', 'accounts', 'payroll']}
                    />
                    <DeleteButton
                      resource="expenses"
                      id={e.id}
                      label={`${e.category?.name ?? 'Expense'} - ${formatMoney(e.amount)}`}
                      description="The money is also put back into the account it was paid from."
                      invalidate={['expenses', 'accounts', 'payroll']}
                    />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pager}
    </div>
  );
}
