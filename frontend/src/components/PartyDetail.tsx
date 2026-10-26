/**
 * One detail view for a farmer or a supplier.
 *
 * This replaces four separate things that each showed part of the picture: the
 * farmer-products modal, the supplier-catalogue modal, and the two standalone
 * payment pages. Clicking a name anywhere in the app lands here, and everything
 * about that party - balance, invoices, payments, what they trade, and taking
 * or making a payment - happens without leaving it.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { LoadingState, ErrorBanner, EmptyState } from './StatusBits';
import { IconPrint, IconReceive, IconPayOut } from './icons';
import { ApiError } from '../api/client';
import * as api from '../api/resources';
import { formatMoney, todayIsoDate, describeBalance } from '../lib/format';
import { printReport } from './PrintReport';
import { EditButton } from './EditButton';
import { DeleteButton } from './DeleteButton';
import type { Account } from '../api/types';
import { getBusiness } from '../lib/printBrand';

export type PartyKind = 'FARMER' | 'SUPPLIER';
export interface PartyRef {
  id: number;
  kind: PartyKind;
  name: string;
}

type Tab = 'account' | 'invoices' | 'payments' | 'products';

export function PartyDetail({ party, onClose }: { party: PartyRef; onClose: () => void }) {
  const isFarmer = party.kind === 'FARMER';
  const [tab, setTab] = useState<Tab>('account');
  const [paying, setPaying] = useState(false);

  // All time by default: the question at the counter is "what is the position
  // with this person", not "what happened in October".
  const RANGE = { from: '2000-01-01', to: '2099-12-31' };

  const { data, isLoading, error } = useQuery({
    queryKey: ['party-statement', party.kind, party.id],
    // Both endpoints return the same shape apart from the party-specific keys,
    // which the view reads defensively below.
    queryFn: (): Promise<any> =>
      isFarmer ? api.getFarmerStatement(party.id, RANGE) : api.getSupplierStatement(party.id, RANGE),
    staleTime: 0,
  });

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const { data: catalogue } = useQuery({
    queryKey: ['party-products', party.kind, party.id],
    queryFn: (): Promise<any> => (isFarmer ? api.getFarmerProducts(party.id) : api.getSupplierCatalogue(party.id)),
    enabled: tab === 'products',
  });

  const stmt = data as any;
  const summary = stmt?.summary;
  const invoices: any[] = (isFarmer ? stmt?.sales : stmt?.purchases) ?? [];
  const payments: any[] = stmt?.payments ?? [];
  const entries: any[] = stmt?.entries ?? [];
  const profile = isFarmer ? stmt?.farmer : stmt?.supplier;
  const owed = Number(summary?.closingBalance ?? 0);

  function printStatement() {
    if (!stmt) return;
    printReport({
      title: 'Account Statement',
      subtitle: isFarmer ? 'Customer account' : 'Supplier account',
      dateRange: 'All time',
      business: getBusiness(),
      party: {
        label: isFarmer ? 'Statement for' : 'Supplier',
        name: profile?.name ?? party.name,
        phone: profile?.phone ?? undefined,
        village: isFarmer ? profile?.village ?? undefined : profile?.address ?? undefined,
      },
      summary: [
        { label: 'Opening balance', value: `Rs ${summary.openingBalance}` },
        { label: isFarmer ? 'Charged' : 'Billed to us', value: `Rs ${summary.charged ?? summary.billed}` },
        { label: 'Paid', value: `Rs ${summary.paid}` },
        { label: 'Closing balance', value: `Rs ${summary.closingBalance}`, highlight: true },
      ],
      sections: [
        {
          heading: 'Running account',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'description', label: 'Details' },
            { key: 'debit', label: isFarmer ? 'Charged' : 'Billed', money: true },
            { key: 'credit', label: 'Paid', money: true },
            { key: 'balance', label: 'Balance', money: true },
          ],
          rows: entries.map((e) => ({ ...e, date: String(e.date).slice(0, 10) })),
          emptyLabel: 'No account movement.',
        },
        {
          heading: isFarmer ? 'Invoices' : 'Purchase invoices',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'invoiceNumber', label: 'Ref', muted: true },
            { key: 'items', label: 'Items', align: 'center' },
            { key: 'total', label: 'Total', money: true },
            { key: 'amountPaid', label: 'Paid', money: true },
            { key: 'balance', label: 'Balance', money: true },
            { key: 'status', label: 'Status', align: 'center' },
          ],
          rows: invoices,
          emptyLabel: 'No invoices.',
        },
        ...(stmt.lines?.length
          ? [
              {
                heading: 'Items supplied',
                columns: [
                  { key: 'date', label: 'Date' },
                  { key: 'invoiceNumber', label: 'Ref', muted: true },
                  { key: 'product', label: 'Product' },
                  { key: 'quantity', label: 'Qty', align: 'right' as const },
                  { key: 'unitCost', label: 'Rate', money: true },
                  { key: 'lineTotal', label: 'Amount', money: true },
                ],
                rows: stmt.lines,
                emptyLabel: 'No line items.',
              },
            ]
          : []),
        {
          heading: isFarmer ? 'Payments received' : 'Payments made',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'amount', label: 'Amount', money: true },
            { key: 'method', label: 'Method' },
            { key: 'account', label: isFarmer ? 'Into' : 'From' },
            { key: 'notes', label: 'Note' },
          ],
          rows: payments,
          emptyLabel: 'No payments.',
        },
      ],
      note: `Closing balance of Rs ${summary.closingBalance} ${
        isFarmer ? 'is payable to' : 'is owed by'
      } ${getBusiness().name || 'the shop'}.`,
      signatures: true,
    });
  }

  return (
    <Modal title={party.name} onClose={onClose}>
      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load this account." />}

      {stmt && (
        <>
          <div className="party-head">
            <div className="party-meta">
              {profile?.phone && <span>{profile.phone}</span>}
              {isFarmer && profile?.village && <span>{profile.village}</span>}
              {!isFarmer && profile?.address && <span>{profile.address}</span>}
            </div>
            <div className="btn-row">
              <button className="btn secondary small" onClick={printStatement}>
                <IconPrint size={14} /> Print statement
              </button>
              {owed > 0 && (
                <button className="btn small" onClick={() => setPaying(true)}>
                  {isFarmer ? <IconReceive size={14} /> : <IconPayOut size={14} />}
                  {isFarmer ? 'Receive payment' : 'Pay supplier'}
                </button>
              )}
            </div>
          </div>

          <div className="stat-grid">
            <div className="stat-card">
              <div className="label">Opening</div>
              <div className="value">{formatMoney(summary.openingBalance)}</div>
            </div>
            <div className="stat-card">
              <div className="label">{isFarmer ? 'Charged' : 'Billed to us'}</div>
              <div className="value">{formatMoney(summary.charged ?? summary.billed)}</div>
              <div className="hint">{summary.invoiceCount} invoice(s)</div>
            </div>
            <div className="stat-card">
              <div className="label">Paid</div>
              <div className="value">{formatMoney(summary.paid)}</div>
              <div className="hint">{summary.paymentCount} payment(s)</div>
            </div>
            <div className="stat-card accent">
              <div className="label">Balance</div>
              <div className="value">{describeBalance(summary.closingBalance, isFarmer ? 'receivable' : 'payable').text}</div>
            </div>
          </div>

          <div className="segmented" style={{ marginBottom: 14 }}>
            {(
              [
                ['account', 'Running account'],
                ['invoices', isFarmer ? 'Invoices' : 'Purchases'],
                ['payments', 'Payments'],
                ['products', isFarmer ? 'What they buy' : 'What we buy'],
              ] as Array<[Tab, string]>
            ).map(([id, label]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'account' && (
            <Table
              rows={entries.map((e) => ({ ...e, date: String(e.date).slice(0, 10) }))}
              cols={[
                ['date', 'Date'],
                ['description', 'Details'],
                ['debit', isFarmer ? 'Charged' : 'Billed', 'money'],
                ['credit', 'Paid', 'money'],
                ['balance', 'Balance', 'money'],
              ]}
              empty="No account movement yet."
            />
          )}

          {tab === 'invoices' && (
            <Table
              rows={invoices}
              cols={[
                ['date', 'Date'],
                ['invoiceNumber', 'Ref', 'muted'],
                ['items', 'Items'],
                ['total', 'Total', 'money'],
                ['amountPaid', 'Paid', 'money'],
                ['balance', 'Balance', 'money'],
                ['status', 'Status'],
              ]}
              empty="No invoices yet."
            />
          )}

          {tab === 'payments' && (
            <Table
              rows={payments}
              cols={[
                ['date', 'Date'],
                ['amount', 'Amount', 'money'],
                ['method', 'Method'],
                ['account', isFarmer ? 'Into' : 'From'],
                ['notes', 'Note'],
              ]}
              empty="No payments recorded yet."
              actions={(row) => <PaymentActions party={party} row={row} accounts={accounts ?? []} />}
            />
          )}

          {tab === 'products' && (
            <Table
              rows={(catalogue?.rows ?? []) as any[]}
              cols={
                isFarmer
                  ? [
                      ['name', 'Product'],
                      ['totalQuantity', 'Qty'],
                      ['lastPrice', 'Last paid', 'money'],
                      ['currentPrice', 'Price now', 'money'],
                      ['totalValue', 'Total spent', 'money'],
                      ['lastBought', 'Last bought', 'muted'],
                    ]
                  : [
                      ['name', 'Product'],
                      ['totalQuantity', 'Qty'],
                      ['lastCost', 'You pay', 'money'],
                      ['sellingPrice', 'You sell', 'money'],
                      ['profit', 'Profit', 'money'],
                      ['lastOrdered', 'Last order', 'muted'],
                    ]
              }
              empty={isFarmer ? 'Nothing bought yet.' : 'Nothing purchased from them yet.'}
            />
          )}
        </>
      )}

      {paying && stmt && (
        <PartyPaymentForm
          party={party}
          owed={owed}
          onClose={() => setPaying(false)}
        />
      )}
    </Modal>
  );
}

/* ---------- compact table ---------- */

type Col = [string, string, ('money' | 'muted')?];

function Table({
  rows,
  cols,
  empty,
  actions,
}: {
  rows: any[];
  cols: Col[];
  empty: string;
  /** Rendered in a trailing column. Returns null when admin mode is off. */
  actions?: (row: any) => ReactNode;
}) {
  if (!rows || rows.length === 0) return <EmptyState label={empty} />;
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            {cols.map(([k, label, mode]) => (
              <th key={k} className={mode === 'money' ? 'text-right' : ''}>{label}</th>
            ))}
            {actions && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map(([k, , mode]) => {
                const v = r[k];
                return (
                  <td key={k} className={[mode === 'money' ? 'text-right' : '', mode === 'muted' ? 'cell-muted' : ''].filter(Boolean).join(' ')}>
                    {mode === 'money' && v !== '' && v != null ? formatMoney(v) : v == null || v === '' ? '-' : String(v)}
                  </td>
                );
              })}
              {actions && (
                <td>
                  <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>{actions(r)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- payment, inline ---------- */

function PartyPaymentForm({ party, owed, onClose }: { party: PartyRef; owed: number; onClose: () => void }) {
  const isFarmer = party.kind === 'FARMER';
  const [amount, setAmount] = useState(owed.toFixed(2));
  const [accountId, setAccountId] = useState<number | ''>('');
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [allowOverpay, setAllowOverpay] = useState(false);
  const qc = useQueryClient();

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const entered = Number(amount || 0);
  const over = entered > owed;

  const save = useMutation({
    mutationFn: () => {
      const method = (accounts ?? []).find((a) => a.id === accountId)?.type === 'BANK' ? 'BANK' : 'CASH';
      const body = { accountId: Number(accountId), amount: entered, method, paymentDate, notes: notes || undefined };
      return isFarmer
        ? api.createFarmerPayment({ ...body, farmerId: party.id })
        : api.createSupplierPayment({ ...body, supplierId: party.id });
    },
    onSuccess: () => {
      onClose();
      for (const k of ['party-statement', 'farmers', 'suppliers', 'sales', 'purchases', 'accounts', 'dashboard']) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record that payment.'),
  });

  return (
    <Modal title={isFarmer ? `Receive from ${party.name}` : `Pay ${party.name}`} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <p className="muted" style={{ marginTop: 0 }}>
        <strong>{formatMoney(owed)}</strong> {isFarmer ? 'outstanding' : 'owed to them'}. Applied to the oldest
        invoices first.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!accountId) return setError('Choose an account.');
          if (entered <= 0) return setError('Enter an amount.');
          if (over && !allowOverpay) return setError('That is more than outstanding - tick the box to keep the extra as credit.');
          save.mutate();
        }}
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pd-amount">Amount</label>
            <input id="pd-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          </div>
          <div className="field">
            <label htmlFor="pd-account">{isFarmer ? 'Into account' : 'Pay from'}</label>
            <select id="pd-account" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')} required>
              <option value="">Choose...</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pd-date">Date</label>
            <input id="pd-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="pd-note">Note</label>
            <input id="pd-note" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {over && (
          <label className="overpay-confirm" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={allowOverpay} onChange={(e) => setAllowOverpay(e.target.checked)} />
            Keep the extra {formatMoney(entered - owed)} as advance credit
          </label>
        )}

        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={save.isPending}>
            {save.isPending ? 'Saving...' : isFarmer ? 'Receive payment' : 'Record payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}


/* ---------- correcting a payment (admin mode, owner only) ---------- */

/**
 * A payment is money in three places at once - the party's account, the cash
 * box, and whichever invoices it settled. Both buttons here hand that to the
 * server, which unwinds all three and re-applies, so a corrected amount lands
 * where the original would have.
 */
function PaymentActions({
  party,
  row,
  accounts,
}: {
  party: PartyRef;
  row: { id?: number; amount: string; date: string; accountId?: number; method?: string; notes?: string };
  accounts: Account[];
}) {
  const isFarmer = party.kind === 'FARMER';
  // Older statement rows predate ids being sent; nothing to act on there.
  if (!row.id) return null;
  const refresh = ['party-statement', 'farmers', 'suppliers', 'accounts', 'dashboard', 'sales', 'purchases'];

  return (
    <>
      <EditButton
        title={`${formatMoney(row.amount)} on ${row.date}`}
        fields={[
          { key: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true },
          { key: 'paymentDate', label: 'Date', type: 'date', required: true },
          {
            key: 'accountId',
            label: isFarmer ? 'Received into' : 'Paid from',
            type: 'select',
            required: true,
            options: accounts.map((a) => ({ value: a.id, label: a.name })),
          },
          { key: 'notes', label: 'Note' },
        ]}
        initial={{
          amount: String(row.amount),
          paymentDate: row.date,
          accountId: String(row.accountId ?? ''),
          notes: row.notes ?? '',
        }}
        onSave={(v: Record<string, string>) => {
          const account = accounts.find((a) => a.id === Number(v.accountId));
          const body = {
            amount: Number(v.amount),
            paymentDate: v.paymentDate,
            accountId: Number(v.accountId),
            method: account?.type === 'BANK' ? 'BANK' : 'CASH',
            notes: v.notes,
          };
          return isFarmer
            ? api.adminUpdateFarmerPayment(row.id!, body)
            : api.adminUpdateSupplierPayment(row.id!, body);
        }}
        invalidate={refresh}
      />
      <DeleteButton
        resource={isFarmer ? 'farmer-payments' : 'supplier-payments'}
        id={row.id}
        label={`${formatMoney(row.amount)} on ${row.date}`}
        description="The invoices it settled go back to unpaid, and the money comes out of the account again."
        invalidate={refresh}
      />
    </>
  );
}
