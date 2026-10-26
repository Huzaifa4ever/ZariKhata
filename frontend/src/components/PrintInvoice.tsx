/**
 * Printing for a single invoice, in the two formats a shop actually uses:
 * an 80/58mm thermal receipt for the customer at the counter, and an A4 copy
 * for the file or the supplier.
 *
 * Both are driven from the same invoice lookup, so a sale, a purchase and the
 * receipt handed over at the till can never disagree about what was sold.
 */
import {
  esc,
  footerHtml,
  getBusiness,
  headerHtml,
  openPrintWindow,
  openReceiptWindow,
  receiptHeaderHtml,
  rs,
  todayDisplay,
  type ReceiptWidth,
} from '../lib/printBrand';
import type { InvoiceLookup } from '../api/resources';

/** 80mm/58mm roll - the customer's copy. */
export function printInvoiceReceipt(inv: InvoiceLookup, width: ReceiptWidth = '80mm') {
  const business = getBusiness();
  const rows = inv.lines
    .map(
      (l) => `<tr>
        <td colspan="2"><div class="item-name">${esc(l.product)}</div>
          <div class="small">${l.quantity} x ${rs(l.unitPrice)}</div></td>
        <td class="r">${rs(l.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  const body = [
    receiptHeaderHtml(business),
    '<div class="rule"></div>',
    `<div class="small">
       <div><span class="b">${inv.kind === 'SALE' ? 'Invoice' : 'Purchase'}:</span> ${esc(inv.invoiceNumber)}</div>
       <div><span class="b">Date:</span> ${esc(inv.date)}</div>
       <div><span class="b">${inv.kind === 'SALE' ? 'Customer' : 'Supplier'}:</span> ${esc(inv.party.name)}</div>
       ${inv.party.phone ? `<div><span class="b">Phone:</span> ${esc(inv.party.phone)}</div>` : ''}
     </div>`,
    '<div class="rule"></div>',
    `<table><thead><tr><th colspan="2">Item</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>`,
    '<div class="rule-solid"></div>',
    `<div class="tot"><span>Sub-total</span><span>${rs(inv.subtotal)}</span></div>`,
    Number(inv.discount) > 0 ? `<div class="tot"><span>Discount</span><span>- ${rs(inv.discount)}</span></div>` : '',
    '<div class="rule-solid"></div>',
    `<div class="tot grand"><span>TOTAL</span><span>Rs ${rs(inv.total)}</span></div>`,
    Number(inv.amountPaid) > 0 ? `<div class="tot"><span>Paid</span><span>${rs(inv.amountPaid)}</span></div>` : '',
    Number(inv.balance) > 0 ? `<div class="tot b"><span>Balance due</span><span>Rs ${rs(inv.balance)}</span></div>` : '',
    '<div class="rule"></div>',
    `<div class="foot c"><div class="b">Thank you</div>
       <div class="small">Goods once sold are not returnable without a receipt.</div>
       <div class="small" style="margin-top:2mm">Powered by ZariKhata</div></div>`,
  ].join('');

  openReceiptWindow(`${inv.invoiceNumber}`, width, body);
}

/** A4 - the office copy, with payment history against the invoice. */
export function printInvoiceA4(inv: InvoiceLookup) {
  const business = getBusiness();
  const isSale = inv.kind === 'SALE';

  const rows = inv.lines
    .map(
      (l, i) => `<tr>
        <td class="center">${i + 1}</td>
        <td>${esc(l.product)}<div class="muted" style="font-size:7.6pt">${esc(l.sku)}</div></td>
        <td class="right">${l.quantity}</td>
        <td class="right">${rs(l.unitPrice)}</td>
        <td class="right">${rs(l.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  const paymentRows = inv.payments.length
    ? `<h2 class="section">Payments against this invoice</h2>
       <table><thead><tr><th>Date</th><th>Method</th><th>Account</th><th class="right">Amount</th></tr></thead>
       <tbody>${inv.payments
         .map((p) => `<tr><td>${esc(p.date)}</td><td>${esc(p.method)}</td><td>${esc(p.account)}</td><td class="right">${rs(p.amount)}</td></tr>`)
         .join('')}</tbody></table>`
    : '';

  const body = [
    headerHtml({
      business,
      docType: isSale ? 'Sales Invoice' : 'Purchase Invoice',
      refs: {
        'Invoice #': inv.invoiceNumber,
        ...(inv.supplierInvoiceNumber ? { 'Their ref': inv.supplierInvoiceNumber } : {}),
      },
    }),
    `<div class="strip">
       <div class="strip-box">
         <div class="k">${isSale ? 'Billed to' : 'Supplier'}</div>
         <div class="v">${esc(inv.party.name)}</div>
         ${inv.party.village ? `<div class="m">${esc(inv.party.village)}</div>` : ''}
         ${inv.party.phone ? `<div class="m">${esc(inv.party.phone)}</div>` : ''}
       </div>
       <div class="strip-box">
         <div class="k">Date</div><div class="v">${esc(inv.date)}</div>
         ${inv.dueDate ? `<div class="m">Due ${esc(inv.dueDate)}</div>` : ''}
       </div>
       <div class="strip-box">
         <div class="k">Status</div><div class="v">${esc(inv.status)}</div>
         <div class="m">${inv.lines.length} item(s)</div>
       </div>
     </div>`,
    `<table style="margin-top:12px">
       <thead><tr>
         <th class="center" style="width:8mm">#</th><th>Item</th>
         <th class="right" style="width:20mm">Qty</th>
         <th class="right" style="width:26mm">${isSale ? 'Price' : 'Cost'}</th>
         <th class="right" style="width:30mm">Amount</th>
       </tr></thead><tbody>${rows}</tbody></table>`,
    `<div class="totals">
       <div class="row"><span>Sub-total</span><span class="n">${rs(inv.subtotal)}</span></div>
       ${Number(inv.discount) > 0 ? `<div class="row"><span>Discount</span><span class="n">- ${rs(inv.discount)}</span></div>` : ''}
       <div class="row grand"><span>Total</span><span class="n">Rs ${rs(inv.total)}</span></div>
       <div class="row"><span>Paid</span><span class="n">${rs(inv.amountPaid)}</span></div>
       <div class="row"><span><b>Balance</b></span><span class="n"><b>Rs ${rs(inv.balance)}</b></span></div>
     </div>`,
    paymentRows,
    inv.notes ? `<div class="note">${esc(inv.notes)}</div>` : '',
    `<div class="sign"><div>${isSale ? 'Customer signature' : 'Received by'}</div><div>For ${esc(business.name || 'the shop')}</div></div>`,
    footerHtml(),
  ].join('');

  openPrintWindow(`${inv.invoiceNumber}`, body);
}

/** A payment receipt - proof the money changed hands. */
export function printPaymentReceipt(opts: {
  partyKind: 'FARMER' | 'SUPPLIER';
  partyName: string;
  amount: string | number;
  date: string;
  method: string;
  account: string;
  balanceAfter: string | number;
  reference?: string;
}) {
  const business = getBusiness();
  const isReceipt = opts.partyKind === 'FARMER';

  const body = [
    headerHtml({
      business,
      docType: isReceipt ? 'Payment Receipt' : 'Payment Voucher',
      subtitle: isReceipt ? 'Money received' : 'Money paid out',
      refs: { Date: opts.date, ...(opts.reference ? { Ref: opts.reference } : {}) },
    }),
    `<div class="strip">
       <div class="strip-box">
         <div class="k">${isReceipt ? 'Received from' : 'Paid to'}</div>
         <div class="v">${esc(opts.partyName)}</div>
       </div>
       <div class="strip-box">
         <div class="k">Method</div><div class="v">${esc(opts.method)}</div>
         <div class="m">${esc(opts.account)}</div>
       </div>
     </div>`,
    `<div class="summary">
       <div class="cell hl"><div class="k">Amount ${isReceipt ? 'received' : 'paid'}</div><div class="v">Rs ${rs(opts.amount)}</div></div>
       <div class="cell"><div class="k">Balance after</div><div class="v">Rs ${rs(opts.balanceAfter)}</div></div>
     </div>`,
    `<div class="note">Printed ${esc(todayDisplay())}. Please keep this receipt as proof of ${
      isReceipt ? 'payment' : 'settlement'
    }.</div>`,
    `<div class="sign"><div>${isReceipt ? 'Payer' : 'Receiver'}</div><div>For ${esc(business.name || 'the shop')}</div></div>`,
    footerHtml(),
  ].join('');

  openPrintWindow('Payment receipt', body);
}
