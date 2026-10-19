import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import type { User } from '../api/types';

export function UsersPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['users'], queryFn: api.listUsers });

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('EMPLOYEE');
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => api.createUser({ name, username, password, role }),
    onSuccess: () => {
      setName('');
      setUsername('');
      setPassword('');
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
        <h1>Users</h1>
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
                  <td>{u.isActive === false ? 'Inactive' : 'Active'}</td>
                  <td>
                    <button
                      className="btn secondary small"
                      onClick={() => toggleActive.mutate({ id: u.id, isActive: u.isActive === false })}
                    >
                      {u.isActive === false ? 'Reactivate' : 'Deactivate'}
                    </button>
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
