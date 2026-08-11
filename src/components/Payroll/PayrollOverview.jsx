import React, { useState } from 'react';
import { Wallet, ChevronLeft, ChevronRight, AlertTriangle, Pencil, Users, Clock, DollarSign, Tags } from 'lucide-react';
import PayCategoriesPanel from './PayCategoriesPanel';
import { database } from '../../lib/database';
import { useAsyncData } from '../../lib/useAsyncData';
import ErrorBanner from '../Layout/ErrorBanner';
import TeacherProfileModal from '../Students/TeacherProfileModal';
import './PayrollOverview.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Mirrors UNCONFIRMED_REASON_LABELS on the server — why a past class could not
// be paid, worded for the person who has to go and fix it.
const UNCONFIRMED_REASONS = {
  no_attendance: 'marked complete, but no register was saved',
  not_completed: 'never marked complete',
};

/**
 * The whole roster's pay for one month.
 *
 * The per-teacher modal answers "what did she earn". This answers the question
 * an admin actually has once a month — what do we owe everyone, and is anything
 * wrong before the money leaves. So unpriced hours are called out at the top and
 * again on the row, rather than being left to explain a total that looks low.
 */
const PayrollOverview = () => {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [selectedTeacher, setSelectedTeacher] = useState(null);
  const [showCategories, setShowCategories] = useState(false);

  const { data, loading, error, retry } = useAsyncData(
    () => database.fetchPayrollSummary(month, year),
    [month, year]
  );

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const rows = data?.rows || [];
  const totals = data?.totals;

  // Only the kinds of work that actually happened this month get a column.
  // Listing every category defined would give August a "Summer camp" column of
  // zeros and push the money off the side of the screen.
  const columns = (data?.categories || []).filter(
    (c) => (totals?.hoursByCategory?.[c.key] || 0) > 0
  );
  // Hours booked to a category that no longer exists, or to none at all — they
  // still cost money, so they get the last column rather than vanishing.
  const hasUncategorised = (totals?.hoursByCategory?.__none__ || 0) > 0;

  // Rates are edited in the modal, and every total on this page is derived from
  // them — so closing it re-reads the month rather than showing stale money.
  const closeModal = () => {
    setSelectedTeacher(null);
    retry();
  };

  return (
    <div className="payroll-overview">
      <div className="payroll-overview-header">
        <Wallet size={28} />
        <div>
          <h1>Payroll</h1>
          <p>What everyone earned this month, and what the academy owes.</p>
        </div>
        {/* The rates live behind this: set "front desk = $20" once, and every
            hour scheduled as front desk prices itself. */}
        <button className="po-categories-btn" onClick={() => setShowCategories(true)}>
          <Tags size={15} /> Pay categories
        </button>
      </div>

      <div className="month-navigator">
        <button onClick={prevMonth} className="month-nav-btn" aria-label="Previous month"><ChevronLeft size={18} /></button>
        <h3 className="month-label">{MONTH_NAMES[month - 1]} {year}</h3>
        <button onClick={nextMonth} className="month-nav-btn" aria-label="Next month"><ChevronRight size={18} /></button>
      </div>

      {loading ? (
        <div className="payroll-overview-state">
          <div className="app-loader"><div className="app-spinner" /><span className="app-loader-text">Adding up the month…</span></div>
        </div>
      ) : error ? (
        <ErrorBanner message={error} onRetry={retry} />
      ) : (
        <>
          <div className="po-stat-row">
            <div className="po-stat po-stat-primary">
              <span className="po-stat-label"><DollarSign size={14} /> Total payroll</span>
              <strong className="po-stat-value">{money(totals.totalEarnings)}</strong>
              <span className="po-stat-sub">
                {money(totals.hourlyEarnings)} hourly
                {totals.baseSalary > 0 && <> + {money(totals.baseSalary)} salary</>}
              </span>
            </div>
            <div className="po-stat">
              <span className="po-stat-label"><Users size={14} /> Staff paid</span>
              <strong className="po-stat-value">{totals.paidTeachers}</strong>
              <span className="po-stat-sub">of {totals.teachers} on the roster</span>
            </div>
            <div className="po-stat">
              <span className="po-stat-label"><Clock size={14} /> Hours worked</span>
              <strong className="po-stat-value">{totals.totalHours}</strong>
              <span className="po-stat-sub">
                {totals.sessionCount} session{totals.sessionCount === 1 ? '' : 's'}
                {totals.shiftCount > 0 && <>, {totals.shiftCount} shift{totals.shiftCount === 1 ? '' : 's'}</>}
              </span>
            </div>
          </div>

          {totals.unratedHours > 0 && (
            <div className="po-warning">
              <AlertTriangle size={16} />
              <span>
                <strong>{totals.unratedHours} h</strong> were worked with no rate set, so they are
                counted as $0. The total above is short until those rates exist — the rows
                below are marked.
              </span>
            </div>
          )}

          {totals.unconfirmedCount > 0 && (
            <div className="po-warning">
              <AlertTriangle size={16} />
              <span>
                <strong>{totals.unconfirmedCount} past class{totals.unconfirmedCount === 1 ? '' : 'es'}</strong>
                {' '}({totals.unconfirmedHours} h) {totals.unconfirmedCount === 1 ? 'was' : 'were'} never
                closed out — not marked complete, or complete with no register saved. Payroll can't
                pay an hour nobody confirmed, so the total above excludes them. Close them on the
                calendar and they will price themselves.
              </span>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="po-empty">Nobody worked a paid hour in {MONTH_NAMES[month - 1]}.</p>
          ) : (
            <div className="po-table-wrap">
              <table className="po-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    {columns.map(c => (
                      <th className="num" key={c.key}>
                        <span className="po-cat-dot" style={c.color ? { background: c.color } : undefined} />
                        {c.label}
                      </th>
                    ))}
                    {hasUncategorised && <th className="num">Uncategorised</th>}
                    <th className="num">Hours</th>
                    <th className="num">Entries</th>
                    <th className="num">Rate</th>
                    <th className="num">Base</th>
                    <th className="num">Earned</th>
                    <th aria-label="Edit" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.teacher.id} className={row.unratedHours > 0 || row.unconfirmedCount > 0 ? 'po-row-flagged' : ''}>
                      <td>
                        <div className="po-teacher">
                          <span className="po-avatar">{row.teacher.fullName?.[0] || '?'}</span>
                          <div>
                            <span className="po-name">{row.teacher.fullName}</span>
                            {row.teacher.status !== 'ACTIVE' && (
                              <span className="po-status-tag">{row.teacher.status?.toLowerCase()}</span>
                            )}
                            {row.unratedHours > 0 && (
                              <span className="po-flag" title={`${row.unratedHours} h with no rate set`}>
                                <AlertTriangle size={11} /> {row.unratedHours} h unpriced
                              </span>
                            )}
                            {row.unconfirmedCount > 0 && (
                              <span
                                className="po-flag"
                                title={row.unconfirmedSessions
                                  .map((s) => `${new Date(s.date).toLocaleDateString()} · ${s.title} · ${s.hours} h · ${UNCONFIRMED_REASONS[s.reason]}`)
                                  .join('\n')}
                              >
                                <AlertTriangle size={11} /> {row.unconfirmedHours} h not closed out
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      {columns.map(c => (
                        <td className="num" key={c.key}>
                          {row.hoursByCategory[c.key] || <span className="po-unset">—</span>}
                        </td>
                      ))}
                      {hasUncategorised && (
                        <td className="num">{row.hoursByCategory.__none__ || <span className="po-unset">—</span>}</td>
                      )}
                      <td className="num">{row.totalHours}</td>
                      <td className="num">
                        {row.sessionCount + row.shiftCount}
                        {row.shiftCount > 0 && (
                          <span className="po-sub">{row.sessionCount} class, {row.shiftCount} shift</span>
                        )}
                      </td>
                      <td className="num">
                        {/* The base hourly rate. Per-category overrides live in
                            the modal — cramming both in here reads as a second
                            rate rather than a replacement for the first. */}
                        {row.hourlyRate != null
                          ? <>
                              {money(row.hourlyRate)}/hr
                              {/* Worth saying on the row: it's the difference
                                  between "this is the fallback" and "this is
                                  the only rate that will ever apply". */}
                              {row.flatRateOnly && <span className="po-sub">flat — all work</span>}
                            </>
                          : <span className="po-unset">not set</span>}
                      </td>
                      <td className="num">
                        {/* Three states, not two. A dash means nobody has said
                            what this person earns; $0.00 means somebody said
                            zero — the owners draw no salary, and that is a
                            decision worth being able to read off the screen. */}
                        {row.salaryAmount == null
                          ? <span className="po-unset">—</span>
                          : row.baseSalary > 0
                            ? <>
                                {money(row.baseSalary)}
                                {/* Every column on this screen is one month, so
                                    the month's share is the figure. The yearly
                                    number rides underneath because that is what
                                    the contract says and what people quote. */}
                                {row.salaryPeriod === 'ANNUAL' && (
                                  <span className="po-sub">{money(row.salaryAmount)}/yr</span>
                                )}
                              </>
                            : <>
                                {money(0)}
                                <span className="po-sub">no salary</span>
                              </>}
                      </td>
                      <td className="num po-earned">{money(row.totalEarnings)}</td>
                      <td className="num">
                        <button
                          className="po-edit-btn"
                          onClick={() => setSelectedTeacher(row.teacher)}
                          title={`Open payroll for ${row.teacher.fullName}`}
                        >
                          <Pencil size={13} /> Rates
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    {columns.map(c => (
                      <td className="num" key={c.key}>{totals.hoursByCategory[c.key] || 0}</td>
                    ))}
                    {hasUncategorised && <td className="num">{totals.hoursByCategory.__none__ || 0}</td>}
                    <td className="num">{totals.totalHours}</td>
                    <td className="num">{totals.sessionCount + (totals.shiftCount || 0)}</td>
                    <td className="num" />
                    <td className="num">{money(totals.baseSalary)}</td>
                    <td className="num po-earned">{money(totals.totalEarnings)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="po-footnote">
            Class sessions are paid once they're marked complete with at least one student
            present; shifts once they're marked worked. Pay is per hour, at the rate for that
            kind of work — set on the calendar entry, so the same person can be at the desk at
            10 and teaching at 1 on two different rates.
          </p>
        </>
      )}

      {selectedTeacher && (
        <TeacherProfileModal
          teacher={{
            id: selectedTeacher.id,
            name: selectedTeacher.fullName,
            email: selectedTeacher.email,
            phone: selectedTeacher.phone || '—',
            // The modal is shared with the Directory, which hands it "Active",
            // not the raw enum — matched here so the badge doesn't shout.
            status: selectedTeacher.status
              ? selectedTeacher.status.charAt(0) + selectedTeacher.status.slice(1).toLowerCase()
              : selectedTeacher.status,
            role: selectedTeacher.role,
            secondaryRoles: selectedTeacher.secondaryRoles,
          }}
          onClose={closeModal}
        />
      )}

      {showCategories && (
        <PayCategoriesPanel
          onClose={() => { setShowCategories(false); retry(); }}
        />
      )}
    </div>
  );
};

export default PayrollOverview;
