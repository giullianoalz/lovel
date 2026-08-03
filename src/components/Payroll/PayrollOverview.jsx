import React, { useState } from 'react';
import { Wallet, ChevronLeft, ChevronRight, Video, MapPin, AlertTriangle, Pencil, Users, Clock, DollarSign } from 'lucide-react';
import { database } from '../../lib/database';
import { useAsyncData } from '../../lib/useAsyncData';
import ErrorBanner from '../Layout/ErrorBanner';
import TeacherProfileModal from '../Students/TeacherProfileModal';
import './PayrollOverview.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
          <p>What every teacher earned this month, and what the academy owes.</p>
        </div>
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
              <span className="po-stat-label"><Users size={14} /> Teachers paid</span>
              <strong className="po-stat-value">{totals.paidTeachers}</strong>
              <span className="po-stat-sub">of {totals.teachers} on the roster</span>
            </div>
            <div className="po-stat">
              <span className="po-stat-label"><Clock size={14} /> Hours taught</span>
              <strong className="po-stat-value">{totals.totalHours}</strong>
              <span className="po-stat-sub">across {totals.sessionCount} session{totals.sessionCount === 1 ? '' : 's'}</span>
            </div>
          </div>

          {totals.unratedHours > 0 && (
            <div className="po-warning">
              <AlertTriangle size={16} />
              <span>
                <strong>{totals.unratedHours} h</strong> were taught with no rate set, so they are
                counted as $0. The total above is short until those rates exist — the rows
                below are marked.
              </span>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="po-empty">Nobody taught a paid session in {MONTH_NAMES[month - 1]}.</p>
          ) : (
            <div className="po-table-wrap">
              <table className="po-table">
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th className="num"><Video size={13} /> Online</th>
                    <th className="num"><MapPin size={13} /> In-person</th>
                    <th className="num">Hours</th>
                    <th className="num">Sessions</th>
                    <th className="num">Rate</th>
                    <th className="num">Base</th>
                    <th className="num">Earned</th>
                    <th aria-label="Edit" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.teacher.id} className={row.unratedHours > 0 ? 'po-row-flagged' : ''}>
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
                          </div>
                        </div>
                      </td>
                      <td className="num">{row.hoursByCategory.ONLINE || 0}</td>
                      <td className="num">{row.hoursByCategory.IN_PERSON || 0}</td>
                      <td className="num">{row.totalHours}</td>
                      <td className="num">{row.sessionCount}</td>
                      <td className="num">
                        {/* The base hourly rate. Per-category overrides live in
                            the modal — cramming both in here reads as a second
                            rate rather than a replacement for the first. */}
                        {row.hourlyRate != null
                          ? `${money(row.hourlyRate)}/hr`
                          : <span className="po-unset">not set</span>}
                      </td>
                      <td className="num">
                        {row.baseSalary > 0
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
                          : <span className="po-unset">—</span>}
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
                    <td className="num">{rows.reduce((n, r) => n + (r.hoursByCategory.ONLINE || 0), 0).toFixed(2)}</td>
                    <td className="num">{rows.reduce((n, r) => n + (r.hoursByCategory.IN_PERSON || 0), 0).toFixed(2)}</td>
                    <td className="num">{totals.totalHours}</td>
                    <td className="num">{totals.sessionCount}</td>
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
            Only sessions marked complete with at least one student present are paid. Pay is
            per hour actually taught, at the rate for that kind of session.
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
          }}
          onClose={closeModal}
        />
      )}
    </div>
  );
};

export default PayrollOverview;
