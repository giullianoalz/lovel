import React from 'react';
import { DollarSign, Users, AlertTriangle, Wallet, Receipt } from 'lucide-react';
import ErrorBanner from '../Layout/ErrorBanner';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pretty = (iso) => (iso
  ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  : null);

const initials = (name) => (name || '?')
  .split(' ')
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase();

/**
 * Who is owed what, right now.
 *
 * The other three views on this screen are periods — August, this week, the
 * next four weeks — and a period is a cost, not a debt. It can never reach
 * zero, however much has actually been paid out, because nothing in it knows
 * about payments.
 *
 * This one is the account: everything earned since the beginning, minus
 * everything handed over, per person. It is the view you open on payday, and
 * the row you click is somebody's full statement.
 */
const PayrollBalances = ({ data, loading, error, onRetry, onOpen }) => {
  if (loading) {
    return (
      <div className="payroll-overview-state">
        <div className="app-loader">
          <div className="app-spinner" />
          <span className="app-loader-text">Working out who is owed what…</span>
        </div>
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />;

  const rows = data?.rows || [];
  const totals = data?.totals;
  const salariedRows = rows.filter((r) => r.salaried);

  return (
    <>
      <div className="po-stat-row">
        <div className="po-stat po-stat-primary">
          <span className="po-stat-label"><DollarSign size={14} /> Outstanding</span>
          <strong className="po-stat-value">{money(totals.owed)}</strong>
          <span className="po-stat-sub">
            owed to {totals.owedPeople} {totals.owedPeople === 1 ? 'person' : 'people'} as of {pretty(data.asOf)}
          </span>
        </div>
        <div className="po-stat">
          <span className="po-stat-label"><Wallet size={14} /> Earned all time</span>
          <strong className="po-stat-value">{money(totals.earned)}</strong>
          <span className="po-stat-sub">every hour the calendar has ever priced</span>
        </div>
        <div className="po-stat">
          <span className="po-stat-label"><Receipt size={14} /> Paid all time</span>
          <strong className="po-stat-value">{money(totals.paid)}</strong>
          <span className="po-stat-sub">recorded by hand, on the statements</span>
        </div>
      </div>

      {/* Salary accrues month by month, and doing that for the whole roster here
          would mean walking every month of every salaried person's history to
          fill one column. So it is left out and said out loud, rather than
          shown as a confident number that is missing a wage. */}
      {salariedRows.length > 0 && (
        <div className="po-warning po-warning-soft">
          <AlertTriangle size={16} />
          <span>
            <strong>{salariedRows.length} {salariedRows.length === 1 ? 'person is' : 'people are'}</strong>{' '}
            on a salary, and these balances count hourly work only. Open their statement for the
            figure that includes the wage.
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="po-empty">Nobody has earned or been paid anything yet.</p>
      ) : (
        <div className="po-table-wrap">
          <table className="po-table">
            <thead>
              <tr>
                <th>Person</th>
                <th className="num">Hours</th>
                <th className="num">Earned</th>
                <th className="num">Paid</th>
                <th className="num">Last paid</th>
                <th className="num">Balance</th>
                <th aria-label="Open statement" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.teacher.id} className={row.unratedHours > 0 ? 'po-row-flagged' : ''}>
                  <td>
                    <div className="po-teacher">
                      <div className="po-avatar">{initials(row.teacher.fullName)}</div>
                      <div>
                        <span className="po-name">{row.teacher.fullName}</span>
                        {row.salaried && <span className="po-flag po-flag-quiet">Salaried</span>}
                        {row.unratedHours > 0 && (
                          <span className="po-flag">{row.unratedHours} h unpriced</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="num">{row.totalHours}</td>
                  <td className="num">{money(row.earned)}</td>
                  <td className="num">
                    {row.paid ? money(row.paid) : <span className="po-unset">never</span>}
                    {row.paymentCount > 1 && (
                      <span className="po-sub">{row.paymentCount} payments</span>
                    )}
                  </td>
                  <td className="num">
                    {row.lastPaidAt ? pretty(row.lastPaidAt) : <span className="po-unset">–</span>}
                  </td>
                  {/* The column the screen exists for. Zero is the good state,
                      so it is greyed rather than shouted; a negative one means
                      somebody was paid ahead and has to be readable as such. */}
                  <td className="num">
                    <strong className={row.balance > 0 ? 'po-earned' : 'po-unset'}>
                      {money(row.balance)}
                    </strong>
                    {row.balance < 0 && <span className="po-sub">paid ahead</span>}
                  </td>
                  <td>
                    <button className="po-edit-btn" onClick={() => onOpen(row.teacher)}>
                      <Receipt size={13} /> Statement
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><Users size={14} /> {totals.people} on the roster</td>
                <td className="num" />
                <td className="num">{money(totals.earned)}</td>
                <td className="num">{money(totals.paid)}</td>
                <td className="num" />
                <td className="num">{money(totals.owed)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="po-footnote">
        Earnings are priced from the calendar every time this loads and are never stored, so
        correcting a session corrects what it paid. Payments are recorded by hand on each person's
        statement — they are the only thing here that brings a balance down.
      </p>
    </>
  );
};

export default PayrollBalances;
