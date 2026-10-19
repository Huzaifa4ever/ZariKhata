import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatMoney, formatDate, todayIsoDate } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import type { Account, Expense } from '../api/types';
import { DeleteButton } from '../components/DeleteButton';
import { EditButton } from '../components/EditButton';

export function ExpensesPage() {
  const qc = useQueryClient();
  const { data: categories } = useQuery({ queryKey: ['expense-categories'], queryFn: api.listExpenseCategories });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const { data: expenses, isLoading, error } = useQuery({ queryKey: ['expenses'], queryFn: () => api.listExpenses() });

  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayIsoDate());
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

  const mutation = useMutation({
    mutationFn: () =>
      api.createExpense({
        categoryId,
        accountId,
        amount: Number(amount),
        expenseDate: expenseDate || todayIsoDate(),
        description: description || undefined,
      }),
    onSuccess: () => {
      setAmount('');
      setDescription('');
      setExpenseDate(todayIsoDate());
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
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
            </div>
            <div className="field">
              <label>Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
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
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Account</th>
                <th className="text-right">Amount</th>
                <th>Description</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(expenses as Expense[]).map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.expenseDate)}</td>
                  <td>{e.category?.name}</td>
                  <td>{e.account?.name}</td>
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
                      ]}
                      initial={{
                        expenseDate: String(e.expenseDate).slice(0, 10),
                        amount: String(e.amount),
                        categoryId: String(e.categoryId),
                        accountId: String(e.accountId),
                        description: e.description ?? '',
                      }}
                      onSave={(v) =>
                        api.adminUpdateExpense(e.id, {
                          expenseDate: v.expenseDate,
                          amount: Number(v.amount),
                          categoryId: Number(v.categoryId),
                          accountId: Number(v.accountId),
                          description: v.description,
                        })
                      }
                      invalidate={['expenses', 'accounts']}
                    />
                    <DeleteButton
                      resource="expenses"
                      id={e.id}
                      label={`${e.category?.name ?? 'Expense'} - ${formatMoney(e.amount)}`}
                      description="The money is also put back into the account it was paid from."
                      invalidate={['expenses', 'accounts']}
                    />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
