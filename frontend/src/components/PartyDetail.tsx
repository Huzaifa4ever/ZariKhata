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
import { formatMoney, formatDate, todayIsoDate, describeBalance } from '../lib/format';
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
  const life: any = stmt?.lifetime;
  const entries: any[] = stmt?.entries ?? [];
  const profile = isFarmer ? stmt?.farmer : stmt?.supplier;
  const owed = Number(summary?.closingBalance ?? 0);

  /**
   * One statement a farmer can actually read.
   *
   * The old one printed the same money three times - a running ledger, then
   * an invoice table, then a payments table - with no product names anywhere
   * and columns headed METHOD / INTO carrying words like "CASH" and "Cash in
   * hand", which are this system's internal account names, not anything the
   * person holding the paper has ever heard.
   *
   * This is a single chronological story instead: each purchase, what was in
   * it, what it came to, what was paid against it, and what is left - with a
   * running balance down the right so the last number is the answer.
   */
  function printStatement() {
    if (!stmt) return;

    const howPaid = (p: any) => {
      const acct = String(p.account ?? '').toLowerCase();
      if (/bank|online|transfer|easypaisa|jazz/.test(acct)) return 'by bank transfer';
      if (/cash/.test(acct)) return 'in cash';
      return p.account ? `into ${p.account}` : '';
    };

    type Row = Record<string, unknown>;
    const rows: Row[] = [];
    let running = Number(summary.openingBalance ?? 0);

    if (running !== 0) {
      rows.push({
        _row: 'open-bal',
        date: '',
        details: 'Balance brought forward',
        qty: '',
        rate: '',
        amount: '',
        paid: '',
        balance: running.toFixed(2),
      });
    }

    // Purchases and payments, merged and read in the order they happened.
    const events = [
      ...invoices.map((i: any) => ({ when: String(i.date), kind: 'invoice' as const, data: i })),
      ...payments.map((p: any) => ({ when: String(p.date), kind: 'payment' as const, data: p })),
    ].sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.kind === 'invoice' ? -1 : 1));

    for (const ev of events) {
      if (ev.kind === 'invoice') {
        const inv = ev.data;
        running += Number(inv.total);
        const lines = inv.lines ?? [];
        rows.push({
          _row: lines.length ? 'inv' : 'inv close',
          date: formatDate(inv.date),
          details: `${isFarmer ? 'Bought' : 'Billed'} on ${inv.invoiceNumber} - ${inv.settlement ?? inv.status}`,
          qty: '',
          rate: '',
          amount: Number(inv.total).toFixed(2),
          // Deliberately blank: what has been paid against this invoice shows
          // up as its own dated payment row further down. Putting it here too
          // would have the farmer counting the same rupees twice as they read
          // down the Paid column.
          paid: '',
          balance: running.toFixed(2),
        });
        lines.forEach((l: any, idx: number) => {
          rows.push({
            _row: idx === lines.length - 1 ? 'item close' : 'item',
            date: '',
            details: l.product,
            qty: `${l.quantity} ${l.unit}`.trim(),
            rate: Number(l.unitPrice).toFixed(2),
            amount: Number(l.lineTotal).toFixed(2),
            paid: '',
            balance: '',
          });
        });
      } else {
        const pay = ev.data;
        running -= Number(pay.amount);
        rows.push({
          _row: 'pay close',
          date: formatDate(pay.date),
          details: `${isFarmer ? 'You paid' : 'We paid'} ${howPaid(pay)}`.trim(),
          qty: '',
          rate: '',
          amount: '',
          paid: Number(pay.amount).toFixed(2),
          balance: running.toFixed(2),
        });
      }
    }

    const owing = Number(life?.balance ?? summary.closingBalance ?? 0);

    printReport({
      title: 'Account Statement',
      subtitle: isFarmer ? `${profile?.name ?? party.name} - customer account` : `${profile?.name ?? party.name} - supplier account`,
      dateRange: life?.firstTrade ? `Everything since ${formatDate(life.firstTrade)}` : 'All time',
      business: getBusiness(),
      party: {
        label: isFarmer ? 'Statement for' : 'Supplier',
        name: profile?.name ?? party.name,
        phone: profile?.phone ?? undefined,
        village: isFarmer ? profile?.village ?? undefined : profile?.address ?? undefined,
      },
      summary: [
        { label: isFarmer ? 'Total bought' : 'Total billed', value: formatMoney(life?.totalInvoiced ?? summary.charged) },
        { label: 'Total paid', value: formatMoney(life?.totalPaid ?? summary.paid) },
        {
          label: owing > 0 ? (isFarmer ? 'Still to pay' : 'We still owe') : 'Settled',
          value: formatMoney(Math.abs(owing)),
          highlight: true,
        },
      ],
      sections: [
        {
          heading: '',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'details', label: 'Details' },
            { key: 'qty', label: 'Qty', align: 'right' },
            { key: 'rate', label: 'Rate', money: true },
            { key: 'amount', label: 'Amount', money: true },
            { key: 'paid', label: 'Paid', money: true },
            { key: 'balance', label: 'Balance', money: true },
          ],
          rows,
          emptyLabel: 'Nothing has been bought or paid yet.',
        },
      ],
      note: (() => {
        const stop = (t: string) => (t.endsWith('.') ? t : `${t}.`);
        if (owing > 0) {
          return isFarmer
            ? stop(`${formatMoney(owing)} is still to be paid to ${getBusiness().name || 'the shop'}`)
            : stop(`${formatMoney(owing)} is still owed to ${profile?.name ?? party.name}`);
        }
        if (owing < 0) return `${formatMoney(Math.abs(owing))} is in credit.`;
        return 'This account is fully settled. Nothing is outstanding.';
      })(),
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

          {life && (
            <div className="lifetime">
              <div className="lifetime-head">
                <span>Since {life.firstTrade ? formatDate(life.firstTrade) : 'the start'}</span>
                {life.lastTrade && <span>last dealt {formatDate(life.lastTrade)}</span>}
              </div>
              <div className="lifetime-figures">
                <div>
                  <span className="label">{isFarmer ? 'Total bought' : 'Total billed'}</span>
                  <span className="value">{formatMoney(life.totalInvoiced)}</span>
                </div>
                <div>
                  <span className="label">{isFarmer ? 'Total paid' : 'Total paid by us'}</span>
                  <span className="value">{formatMoney(life.totalPaid)}</span>
                </div>
                <div className="owing">
                  <span className="label">{isFarmer ? 'Still to clear' : 'Still to pay'}</span>
                  <span className="value">
                    {describeBalance(life.balance, isFarmer ? 'receivable' : 'payable').text}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="section-label" style={{ marginTop: 18 }}>In the selected period</div>
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

          {tab === 'invoices' && <InvoiceLines rows={invoices} isFarmer={isFarmer} />}

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


/* ---------- invoices, with what was actually bought ---------- */

/**
 * An invoice list that answers the two questions a farmer actually asks at
 * the counter: what did I buy, and did I pay for it. The old table showed a
 * bare item count, so "4 items" was all you could learn about a sale - the
 * product lines were fetched from the server and then thrown away.
 */
function InvoiceLines({ rows, isFarmer }: { rows: any[]; isFarmer: boolean }) {
  const [open, setOpen] = useState<string | null>(rows.length === 1 ? rows[0].invoiceNumber : null);
  if (rows.length === 0) return <EmptyState label={isFarmer ? 'No invoices yet.' : 'No purchases yet.'} />;

  return (
    <div className="invoice-lines">
      {rows.map((inv) => {
        const expanded = open === inv.invoiceNumber;
        const tone = inv.settlement === 'Paid in full' ? 'paid' : inv.settlement === 'Part paid' ? 'partial' : 'unpaid';
        return (
          <div className={`invoice-block${expanded ? ' open' : ''}`} key={inv.invoiceNumber}>
            <button
              type="button"
              className="invoice-summary"
              onClick={() => setOpen(expanded ? null : inv.invoiceNumber)}
              aria-expanded={expanded}
            >
              <span className="inv-date">{formatDate(inv.date)}</span>
              <span className="inv-ref">{inv.invoiceNumber}</span>
              <span className="inv-count">{inv.lines?.length ?? inv.items} item(s)</span>
              <span className="inv-total">{formatMoney(inv.total)}</span>
              <span className={`badge ${tone}`}>{inv.settlement ?? inv.status}</span>
            </button>

            {expanded && (
              <div className="invoice-detail">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">{isFarmer ? 'Price each' : 'Cost each'}</th>
                      <th className="text-right">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(inv.lines ?? []).map((l: any, i: number) => (
                      <tr key={i}>
                        <td>
                          {l.product}
                          {l.sku && <div className="cell-muted" style={{ fontSize: 11.5 }}>{l.sku}</div>}
                        </td>
                        <td className="text-right">
                          {l.quantity} {l.unit}
                        </td>
                        <td className="text-right">{formatMoney(l.unitPrice)}</td>
                        <td className="text-right">{formatMoney(l.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="invoice-foot">
                  <div className="row-between">
                    <span>Invoice total</span>
                    <span>{formatMoney(inv.total)}</span>
                  </div>
                  <div className="row-between">
                    <span>Paid against it</span>
                    <span>{formatMoney(inv.amountPaid)}</span>
                  </div>
                  <div className="row-between" style={{ fontWeight: 600 }}>
                    <span>{Number(inv.balance) > 0 ? 'Still owing on this invoice' : 'Settled'}</span>
                    <span>{formatMoney(inv.balance)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
