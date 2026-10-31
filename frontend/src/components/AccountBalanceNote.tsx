/**
 * What the chosen account holds, shown next to the amount being paid.
 *
 * This replaces a hard block. Refusing a payment because the recorded balance
 * was too low stopped the shop recording things that had actually happened -
 * the money had already left the drawer, and the only effect of the refusal
 * was that the books never found out. A shop that has just started keeping
 * accounts has a cash balance that lags reality by months.
 *
 * So this warns and gets out of the way. It is information the person at the
 * counter can act on - usually it means some takings were never entered - and
 * they are the one who knows what is really in the drawer.
 */
import { formatMoney } from '../lib/format';
import type { Account } from '../api/types';

export function AccountBalanceNote({
  account,
  amount,
  direction,
}: {
  account: Account | undefined;
  amount: number;
  /** 'out' warns on overdraw; 'in' only ever reports the balance. */
  direction: 'in' | 'out';
}) {
  if (!account) return null;

  const balance = Number(account.balance ?? 0);
  const after = direction === 'out' ? balance - amount : balance + amount;
  const willOverdraw = direction === 'out' && amount > 0 && after < 0;

  if (willOverdraw) {
    return (
      <p className="balance-note warn">
        <strong>{account.name}</strong> is recorded as holding {formatMoney(balance)}, so this
        leaves it at {formatMoney(after)}. Recording it anyway is fine - it usually means some
        money coming in was never entered. The cash book on the Accounts page will show where the
        gap is.
      </p>
    );
  }

  return (
    <p className="balance-note">
      <strong>{account.name}</strong> holds {formatMoney(balance)}
      {amount > 0 ? ` · ${formatMoney(after)} after this` : ''}
    </p>
  );
}
