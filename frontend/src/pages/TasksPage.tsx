import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatDate, todayIsoDate } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import { IconPlus, IconTasks } from '../components/icons';
import type { Task, TaskStatus, TaskPriority } from '../api/types';

const STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
};
const STATUS_CLASS: Record<TaskStatus, string> = {
  PENDING: 'unpaid',
  IN_PROGRESS: 'partial',
  COMPLETED: 'paid',
  CANCELLED: 'void',
};
const PRIORITY_LABEL: Record<TaskPriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };

type Filter = 'open' | 'all' | 'done';

export function TasksPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('open');
  const { data, isLoading, error } = useQuery({ queryKey: ['tasks'], queryFn: () => api.listTasks() });

  const [form, setForm] = useState({ title: '', description: '', dueDate: '', priority: 'MEDIUM' });
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.createTask({
        title: form.title,
        description: form.description || undefined,
        dueDate: form.dueDate || undefined,
        priority: form.priority,
      }),
    onSuccess: () => {
      setForm({ title: '', description: '', dueDate: '', priority: 'MEDIUM' });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Could not create task'),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) => api.updateTask(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const tasks = (data ?? []) as Task[];
  const visible = tasks.filter((t) =>
    filter === 'all' ? true : filter === 'done' ? t.status === 'COMPLETED' || t.status === 'CANCELLED'
      : t.status === 'PENDING' || t.status === 'IN_PROGRESS',
  );
  const openCount = tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Tasks &amp; Reminders</h1>
          <p className="subtitle">
            {openCount === 0 ? 'Nothing outstanding.' : `${openCount} still open.`}
          </p>
        </div>
        <div className="segmented">
          {(['open', 'done', 'all'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'open' ? 'Open' : f === 'done' ? 'Finished' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Add a reminder</h3>
        {formError && <ErrorBanner message={formError} />}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            create.mutate();
          }}
        >
          <div className="form-grid">
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="task-title">What needs doing</label>
              <input
                id="task-title"
                required
                placeholder="e.g. Call Ali Hassan about his balance"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="task-due">Due date</label>
              <input
                id="task-due"
                type="date"
                min={todayIsoDate()}
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="task-priority">Priority</label>
              <select
                id="task-priority"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            </div>
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="task-desc">Details (optional)</label>
            <textarea
              id="task-desc"
              rows={2}
              placeholder="Anything you'll want to remember when you pick this up again"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <button type="submit" className="btn" disabled={create.isPending} style={{ marginTop: 14 }}>
            <IconPlus size={15} />
            {create.isPending ? 'Saving…' : 'Add reminder'}
          </button>
        </form>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load tasks." />}
      {!isLoading && visible.length === 0 && (
        <EmptyState label={filter === 'open' ? 'Nothing outstanding - you are all caught up.' : 'Nothing here yet.'} />
      )}

      {visible.length > 0 && (
        <ul className="task-list">
          {visible.map((t) => {
            const done = t.status === 'COMPLETED' || t.status === 'CANCELLED';
            const overdue = !done && t.dueDate && new Date(t.dueDate) < new Date();
            return (
              <li key={t.id} className={`task-row${done ? ' done' : ''}`}>
                <button
                  className={`task-check${done ? ' checked' : ''}`}
                  aria-label={done ? 'Mark as not done' : 'Mark as done'}
                  onClick={() =>
                    updateStatus.mutate({ id: t.id, status: done ? 'PENDING' : 'COMPLETED' })
                  }
                >
                  {done && (
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3.2"
                         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </button>

                <div className="task-main">
                  <div className="task-title">{t.title}</div>
                  {t.description && <p className="task-desc">{t.description}</p>}
                  <div className="task-meta">
                    <span className={`chip prio-${t.priority.toLowerCase()}`}>{PRIORITY_LABEL[t.priority]}</span>
                    {t.dueDate && (
                      <span className={overdue ? 'task-due overdue' : 'task-due'}>
                        {overdue ? 'Overdue - ' : 'Due '}
                        {formatDate(t.dueDate)}
                      </span>
                    )}
                    <span className={`badge ${STATUS_CLASS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                  </div>
                </div>

                <select
                  className="task-status"
                  value={t.status}
                  onChange={(e) => updateStatus.mutate({ id: t.id, status: e.target.value as TaskStatus })}
                  aria-label={`Status of ${t.title}`}
                >
                  {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
      <IconTasks size={0} />
    </div>
  );
}
