import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import type { User } from '../api/types';
import { DeleteButton } from '../components/DeleteButton';
import { EditButton } from '../components/EditButton';
import { useAuth } from '../auth/AuthContext';

export function UsersPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['users'], queryFn: api.listUsers });

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('EMPLOYEE');
  const [monthlySalary, setMonthlySalary] = useState('');
  const { user: me } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      api.createUser({
        name,
        username,
        password,
        role,
        // Set here so a new employee shows on payroll immediately instead of
        // needing a second edit before they can be paid.
        monthlySalary: monthlySalary ? Number(monthlySalary) : undefined,
      }),
    onSuccess: () => {
      setName('');
      setUsername('');
      setPassword('');
      setMonthlySalary('');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Could not create user'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => api.updateUser(id, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p className="subtitle">Staff accounts, roles and agreed pay. Paying them happens on Employee Salaries.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Add a user</h3>
        {formError && <ErrorBanner message={formError} />}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            createMutation.mutate();
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label>Full name</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>Username</label>
              <input required value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <label>Password</label>
              <input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="EMPLOYEE">Employee</option>
                <option value="OWNER">Owner</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="new-salary">Monthly salary</label>
              <input
                id="new-salary"
                type="number"
                min="0"
                step="0.01"
                value={monthlySalary}
                onChange={(e) => setMonthlySalary(e.target.value)}
                placeholder="Leave blank if not salaried"
              />
              <span className="hint">Puts them on the Employee Salaries page.</span>
            </div>
          </div>
          <button type="submit" className="btn" disabled={createMutation.isPending} style={{ marginTop: 8 }}>
            {createMutation.isPending ? 'Saving…' : 'Add user'}
          </button>
        </form>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load users." />}
      {data && data.length === 0 && <EmptyState label="No users yet." />}
      {data && data.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th className="text-right">Salary</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data as User[]).map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.username}</td>
                  <td>{u.role}</td>
                  <td className="text-right">{u.monthlySalary ? `Rs ${u.monthlySalary}` : '-'}</td>
                  <td>{u.isActive === false ? 'Inactive' : 'Active'}</td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      {/* No switching yourself off: there may be no other owner
                          left to switch you back on. */}
                      {u.id === me?.id ? (
                        <span className="cell-muted" style={{ fontSize: 12 }}>This is you</span>
                      ) : (
                        <button
                          className="btn secondary small"
                          onClick={() => toggleActive.mutate({ id: u.id, isActive: u.isActive === false })}
                        >
                          {u.isActive === false ? 'Reactivate' : 'Deactivate'}
                        </button>
                      )}
                      <EditButton
                        title={u.name}
                        fields={[
                          { key: 'name', label: 'Full name', required: true },
                          { key: 'monthlySalary', label: 'Monthly salary', type: 'number', step: '0.01',
                            hint: 'Blank means not on the salary list.' },
                          ...(u.id === me?.id
                            ? []
                            : [{
                                key: 'role',
                                label: 'Role',
                                type: 'select' as const,
                                options: [
                                  { value: 'EMPLOYEE', label: 'Employee' },
                                  { value: 'OWNER', label: 'Owner' },
                                ],
                              }]),
                        ]}
                        initial={{
                          name: u.name,
                          monthlySalary: u.monthlySalary ?? '',
                          role: u.role,
                        }}
                        onSave={(v) =>
                          api.updateUser(u.id, {
                            name: v.name,
                            monthlySalary: v.monthlySalary === '' ? null : Number(v.monthlySalary),
                            ...(v.role && v.role !== u.role ? { role: v.role } : {}),
                          })
                        }
                        invalidate={['users', 'payroll']}
                      />
                      {u.id !== me?.id && (
                        <DeleteButton
                          resource="users"
                          id={u.id}
                          label={u.name}
                          description="Only possible while nothing is recorded against their name. Otherwise deactivate them so the trail stays intact."
                          invalidate={['users', 'payroll']}
                        />
                      )}
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
