import React, { useState } from 'react';
import { Wallet, ChevronLeft, ChevronRight, AlertTriangle, Pencil, Users, Clock, DollarSign, Tags, CalendarOff } from 'lucide-react';
import PayCategoriesPanel from './PayCategoriesPanel';
import ClosuresPanel from './ClosuresPanel';
import AbsencesPanel from './AbsencesPanel';
import { database } from '../../lib/database';
import { useAsyncData } from '../../lib/useAsyncData';
import ErrorBanner from '../Layout/ErrorBanner';
import TeacherProfileModal from '../Students/TeacherProfileModal';
import './PayrollOverview.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The Monday of the week containing `date`, at UTC midnight. Mirrors the server. */
const mondayOf = (date) => {
  const d = new Date(date);
  const day = d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
};

const isoDate = (d) => d.toISOString().slice(0, 10);

/** "11 – 17 Aug 2026", or spanning two months, "28 Jul – 3 Aug 2026". */
const weekLabel = (monday) => {
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const opts = { timeZone: 'UTC', day: 'numeric', month: 'short' };
  const from = monday.toLocaleDateString('en-US', opts);
  const to = sunday.toLocaleDateString('en-US', opts);
  return `${from} – ${to}, ${sunday.getUTCFullYear()}`;
};

/**
 * Where a rate came from, in the few words that fit under it.
 *
 * The rate cascade has several steps, and "$50.00/hr" alone doesn't tell an
 * admin whether that is this person's own deal or the category default every
 * teacher gets — which is exactly the difference they need before paying.
 */
const RATE_SOURCE_TEXT = {
  event: 'set on the entry',
  flat: 'flat rate',
  teacher: 'their own rate',
  category: 'category rate',
  base: 'their base rate',
  salaried: 'covered by salary',
  unset: 'no rate set',
  frozen: 'rate at the time',
  mixed: 'mixed sources',
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
  // Pay is settled weekly, but rates and unclosed hours are reviewed over a
  // month, so the screen does both rather than forcing one to stand in for
  // the other.
  const [view, setView] = useState('month');
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  // How far ahead the forecast looks. Weeks rather than months because the
  // question it answers — what has the academy committed to — starts today,
  // not on the 1st.
  const [weeksAhead, setWeeksAhead] = useState(4);
  const [selectedTeacher, setSelectedTeacher] = useState(null);
  const [showCategories, setShowCategories] = useState(false);
  const [showClosures, setShowClosures] = useState(false);
  const [reviewingAbsences, setReviewingAbsences] = useState(false);

  const isWeek = view === 'week';
  // The forward-looking view: the same roster, the same rates, priced off the
  // hours that are booked but have not happened yet.
  const isUpcoming = view === 'upcoming';
  const weekStartIso = isoDate(weekStart);

  const { data, loading, error, retry } = useAsyncData(
    () => (isUpcoming
      ? database.fetchProjectedPayroll({ weeks: weeksAhead })
      : isWeek
        ? database.fetchWeeklyPayrollSummary(weekStartIso)
        : database.fetchPayrollSummary(month, year)),
    [view, weekStartIso, month, year, weeksAhead]
  );

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const shiftWeek = (weeks) => setWeekStart((current) => {
    const next = new Date(current);
    next.setUTCDate(current.getUTCDate() + weeks * 7);
    return next;
  });

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
          <p>
            {isUpcoming
              ? 'What the calendar already commits the academy to paying, per person.'
              : isWeek
                ? 'What everyone earned this week, and what goes out on payday.'
                : 'What everyone earned this month, and what the academy owes.'}
          </p>
        </div>
        {/* The rates live behind this: set "front desk = $20" once, and every
            hour scheduled as front desk prices itself. */}
        <div className="po-header-actions">
          {/* The days nobody comes in. Pay accrues from the calendar, so
              without these a holiday pays every teacher on it. */}
          <button className="po-categories-btn" onClick={() => setShowClosures(true)}>
            <CalendarOff size={15} /> Closed days
          </button>
          <button className="po-categories-btn" onClick={() => setShowCategories(true)}>
            <Tags size={15} /> Pay categories
          </button>
        </div>
      </div>

      <div className="po-period-bar">
        <div className="po-view-toggle" role="tablist" aria-label="Payroll period">
          <button
            role="tab"
            aria-selected={!isWeek}
            className={!isWeek ? 'is-active' : ''}
            onClick={() => setView('month')}
          >
            Monthly
          </button>
          <button
            role="tab"
            aria-selected={isWeek}
            className={isWeek ? 'is-active' : ''}
            onClick={() => setView('week')}
          >
            Weekly
          </button>
          <button
            role="tab"
            aria-selected={isUpcoming}
            className={isUpcoming ? 'is-active' : ''}
            onClick={() => setView('upcoming')}
          >
            Upcoming
          </button>
        </div>

        {isUpcoming ? (
          <div className="po-weeks-ahead">
            <label htmlFor="po-weeks">Looking ahead</label>
            <select
              id="po-weeks"
              value={weeksAhead}
              onChange={(e) => setWeeksAhead(Number(e.target.value))}
            >
              {[1, 2, 4, 8, 12, 26, 52].map((w) => (
                <option key={w} value={w}>
                  {w === 1 ? '1 week' : w === 52 ? '52 weeks (a year)' : `${w} weeks`}
                </option>
              ))}
            </select>
            {data && (
              <span className="po-range-label">
                {new Date(data.startDate).toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short' })}
                {' – '}
                {new Date(data.endDate).toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
        ) : isWeek ? (
          <div className="month-navigator">
            <button onClick={() => shiftWeek(-1)} className="month-nav-btn" aria-label="Previous week"><ChevronLeft size={18} /></button>
            <h3 className="month-label">{weekLabel(weekStart)}</h3>
            <button onClick={() => shiftWeek(1)} className="month-nav-btn" aria-label="Next week"><ChevronRight size={18} /></button>
          </div>
        ) : (
          <div className="month-navigator">
            <button onClick={prevMonth} className="month-nav-btn" aria-label="Previous month"><ChevronLeft size={18} /></button>
            <h3 className="month-label">{MONTH_NAMES[month - 1]} {year}</h3>
            <button onClick={nextMonth} className="month-nav-btn" aria-label="Next month"><ChevronRight size={18} /></button>
          </div>
        )}

        {isWeek && weekStartIso !== isoDate(mondayOf(new Date())) && (
          <button className="po-this-week" onClick={() => setWeekStart(mondayOf(new Date()))}>
            This week
          </button>
        )}
      </div>

      {loading ? (
        <div className="payroll-overview-state">
          <div className="app-loader"><div className="app-spinner" /><span className="app-loader-text">{isUpcoming ? 'Pricing the calendar ahead…' : `Adding up the ${isWeek ? 'week' : 'month'}…`}</span></div>
        </div>
      ) : error ? (
        <ErrorBanner message={error} onRetry={retry} />
      ) : (
        <>
          <div className="po-stat-row">
            <div className="po-stat po-stat-primary">
              <span className="po-stat-label">
                <DollarSign size={14} /> {isUpcoming ? 'Committed payroll' : 'Total payroll'}
              </span>
              <strong className="po-stat-value">{money(totals.totalEarnings)}</strong>
              <span className="po-stat-sub">
                {money(totals.hourlyEarnings)} hourly
                {totals.baseSalary > 0 && <> + {money(totals.baseSalary)} salary</>}
                {/* A salary is a monthly figure and this column is a week, so
                    it is left out rather than counted four times a month. */}
                {data?.includesSalary === false && <> · hourly only, salaries run monthly</>}
              </span>
            </div>
            {/* A window that starts today is part payslip and part forecast.
                Showing one total would dress a timetable that can still change
                up as money already owed, so the two halves stay apart. */}
            {isUpcoming && (
              <div className="po-stat">
                <span className="po-stat-label"><Clock size={14} /> Still to come</span>
                <strong className="po-stat-value">{money(totals.upcomingAmount)}</strong>
                <span className="po-stat-sub">
                  {totals.upcomingHours} h booked
                  {totals.earnedAmount > 0 && <> · {money(totals.earnedAmount)} already earned</>}
                </span>
              </div>
            )}
            <div className="po-stat">
              <span className="po-stat-label"><Users size={14} /> {isUpcoming ? 'Staff booked' : 'Staff paid'}</span>
              <strong className="po-stat-value">{totals.paidTeachers}</strong>
              <span className="po-stat-sub">of {totals.teachers} on the roster</span>
            </div>
            <div className="po-stat">
              <span className="po-stat-label"><Clock size={14} /> {isUpcoming ? 'Hours scheduled' : 'Hours worked'}</span>
              <strong className="po-stat-value">{totals.totalHours}</strong>
              <span className="po-stat-sub">
                {totals.sessionCount} session{totals.sessionCount === 1 ? '' : 's'}
                {totals.shiftCount > 0 && <>, {totals.shiftCount} shift{totals.shiftCount === 1 ? '' : 's'}</>}
              </span>
            </div>
          </div>

          {/* The one warning on this screen that means somebody is probably
              being overpaid, so it goes first and it is the only red one. A
              salary and an hourly rate are alternatives — anybody collecting
              both is collecting for the same hour twice. */}
          {totals.salariedHourlyAmount > 0 && (
            <div className="po-warning po-warning-danger">
              <AlertTriangle size={16} />
              <span>
                <strong>{money(totals.salariedHourlyAmount)}</strong> is being paid by the hour to{' '}
                {totals.salariedHourlyPeople === 1 ? 'somebody who is' : `${totals.salariedHourlyPeople} people who are`}{' '}
                on a salary that already covers those hours. Hours keep the rate they were worked
                at, so this is what you would expect if the salary started after the work — and a
                double payment if it did not. Check the marked rows before paying.
              </span>
            </div>
          )}

          {/* Different from the unpriced-hours warning below, and easy to
              confuse with it: these hours ARE priced and the money is real. The
              gap is that nobody set a rate for these people, so the category
              default is answering on their behalf — every teacher without a
              personal rate quietly bills at whatever "In-person class" charges.
              It looks identical to a deliberate arrangement until you go
              looking, which is why it gets its own line. */}
          {totals.unconfirmedRates > 0 && (
            <div className="po-warning po-warning-soft">
              <AlertTriangle size={16} />
              <span>
                <strong>{totals.unconfirmedRates} {totals.unconfirmedRates === 1 ? 'person is' : 'people are'}</strong>{' '}
                being paid the category's rate because nobody has set one for them. That pays —
                it just isn't a number anyone agreed about them. Open <em>Rates</em> on the
                marked rows to confirm or change it.
              </span>
            </div>
          )}

          {/* Hours where somebody is covering a class that already has a
              teacher being paid for the same hour. Not a fault — it is the
              policy — but it is the only cost here that grows without a new
              entry appearing on the calendar, so it is worth stating rather
              than leaving folded into a total. */}
          {totals.coTeachingHours > 0 && (
            <div className="po-warning po-warning-soft">
              <Users size={16} />
              <span>
                <strong>{totals.coTeachingHours} h</strong> ({money(totals.coTeachingAmount)}) {isUpcoming ? 'are booked' : 'were worked'} as
                co-teacher, paid in full on top of the teacher whose class it is. Both people are
                paid for the same hour.
              </span>
            </div>
          )}

          {totals.unratedHours > 0 && (
            <div className="po-warning">
              <AlertTriangle size={16} />
              {/* Worth more here than on the earned screens: an unpriced hour
                  that has not happened yet can still be priced before anybody
                  is underpaid for it. */}
              <span>
                <strong>{totals.unratedHours} h</strong> {isUpcoming ? 'are scheduled' : 'were worked'} with
                no rate set, so they are counted as $0. The total above is short until those
                rates exist — the rows below are marked.
              </span>
            </div>
          )}

          {/* Everything on the calendar is paid the moment its hour ends, so
              the only hours missing from the total are the ones somebody
              struck off by hand. That is worth showing before the money goes
              out — an absence is money off a payslip that the person it
              belongs to never saw being taken. */}
          {totals.absenceCount > 0 && (
            <div className="po-warning po-warning-actionable">
              <AlertTriangle size={16} />
              <div className="po-warning-body">
                <span>
                  <strong>{totals.absenceCount} entr{totals.absenceCount === 1 ? 'y' : 'ies'}</strong>
                  {' '}({totals.absenceHours} h) {totals.absenceCount === 1 ? 'is' : 'are'} not being paid,
                  because somebody marked the person absent. Everything else on the calendar is in
                  the total above.
                </span>
                <button className="po-approve-open" onClick={() => setReviewingAbsences(true)}>
                  Review these hours
                </button>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="po-empty">
              {isUpcoming
                ? `Nothing is booked in the next ${weeksAhead === 1 ? 'week' : `${weeksAhead} weeks`}, so there is nothing to pay for yet.`
                : `Nobody worked a paid hour ${isWeek ? `in the week of ${weekLabel(weekStart)}` : `in ${MONTH_NAMES[month - 1]}`}.`}
            </p>
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
                    <th className="num">{isUpcoming ? 'Projected' : 'Earned'}</th>
                    <th aria-label="Edit" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.teacher.id} className={row.unratedHours > 0 || row.absenceCount > 0 || row.rateSetup === 'default' ? 'po-row-flagged' : ''}>
                      <td>
                        <div className="po-teacher">
                          <span className="po-avatar">{row.teacher.fullName?.[0] || '?'}</span>
                          <div>
                            <span className="po-name">{row.teacher.fullName}</span>
                            {row.teacher.status !== 'ACTIVE' && (
                              <span className="po-status-tag">{row.teacher.status?.toLowerCase()}</span>
                            )}
                            {/* Says which of the four arrangements this person
                                is on, because the money alone cannot: $0 is
                                right for a salaried manager and wrong for a
                                teacher nobody priced, and the two rows look
                                the same. */}
                            {row.rateSetup === 'default' && (
                              <span
                                className="po-flag po-flag-soft"
                                title="No rate has been set for this person — their hours are priced at the category's rate"
                              >
                                <AlertTriangle size={11} /> rate not confirmed
                              </span>
                            )}
                            {row.rateSetup === 'salaried' && (
                              row.salariedHourlyAmount > 0 ? (
                                <span
                                  className="po-flag po-flag-danger"
                                  title="This person is on a salary that covers their hours, and is also being paid by the hour for them — the hours carry a rate frozen before the salary existed"
                                >
                                  <AlertTriangle size={11} /> salaried + {money(row.salariedHourlyAmount)} hourly
                                </span>
                              ) : (
                                <span className="po-flag po-flag-quiet" title="Hours worked are covered by this person's salary">
                                  salaried
                                </span>
                              )
                            )}
                            {row.coTeachingHours > 0 && (
                              <span
                                className="po-flag po-flag-quiet"
                                title={`${row.coTeachingHours} h covering a class that is somebody else's — ${money(row.coTeachingAmount)}. The class's own teacher is paid for the same hour.`}
                              >
                                {row.coTeachingHours} h as co-teacher
                              </span>
                            )}
                            {row.unratedHours > 0 && (
                              <span className="po-flag" title={`${row.unratedHours} h with no rate set`}>
                                <AlertTriangle size={11} /> {row.unratedHours} h unpriced
                              </span>
                            )}
                            {row.absenceCount > 0 && (
                              <span
                                className="po-flag"
                                title={row.absences
                                  .map((s) => `${new Date(s.date).toLocaleDateString()} · ${s.title} · ${s.hours} h · ${s.reason || 'no reason given'}${s.markedBy ? ` · marked by ${s.markedBy}` : ''}`)
                                  .join('\n')}
                              >
                                <AlertTriangle size={11} /> {row.absenceHours} h not paid
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
                        {/* What these hours were actually paid at, not the
                            person's fallback rate. This column used to read the
                            base hourly rate alone, so anyone paid through a
                            category rate — which is most people — showed "not
                            set" beside real money, and the one column meant to
                            answer "what am I paying them" answered nothing. */}
                        {(() => {
                          const paid = row.breakdown?.filter(b => b.hours > 0) || [];
                          // Nobody worked: the fallback rate is all there is to
                          // show, and it's what the next hour would cost.
                          if (paid.length === 0) {
                            return row.hourlyRate != null
                              ? <>
                                  {money(row.hourlyRate)}/hr
                                  {row.flatRateOnly && <span className="po-sub">flat — all work</span>}
                                </>
                              : <span className="po-unset">not set</span>;
                          }
                          const rates = [...new Set(paid.map(b => (b.mixedRates ? null : b.rate)))];
                          // One rate across every hour worked — the common case,
                          // and the only one a single figure can honestly state.
                          if (rates.length === 1 && rates[0] != null) {
                            return <>
                              {money(rates[0])}/hr
                              <span className="po-sub">{RATE_SOURCE_TEXT[paid[0].source] || paid[0].source}</span>
                            </>;
                          }
                          // Two kinds of work at two prices, or a rate set on one
                          // entry. No single number is true, so it says so and
                          // points at the breakdown rather than picking one.
                          return <div className="po-stacked-rates">
                            {paid.map(b => (
                              <div key={b.category || 'none'} className="po-stacked-rate">
                                {money(b.mixedRates ? b.amount / b.hours : b.rate)}/hr
                                <span className="po-sub"> ({b.label || 'Uncategorised'})</span>
                              </div>
                            ))}
                          </div>;
                        })()}
                      </td>
                      <td className="num">
                        {/* Three states, not two. A dash means nobody has said
                            what this person earns; $0.00 means somebody said
                            zero — the owners draw no salary, and that is a
                            decision worth being able to read off the screen. */}
                        {row.salaryAmount == null
                          ? <span className="po-unset">—</span>
                          /* A week never carries a salary, so this column is
                             not a figure here. Saying "$0.00 no salary" would
                             read as "we agreed nothing" about someone on
                             $63,000 — the opposite of the truth. */
                          : data?.includesSalary === false && row.salaryAmount > 0
                            ? <span className="po-unset">
                                —
                                <span className="po-sub">paid monthly</span>
                              </span>
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
                      <td className="num po-earned">
                        {money(row.totalEarnings)}
                        {/* Which part of this person's figure is still only a
                            booking. Only shown when some of it already is: on
                            a row where every hour has passed, "0 h to come"
                            would be noise. */}
                        {isUpcoming && row.upcomingAmount > 0 && (
                          <span className="po-sub">{money(row.upcomingAmount)} to come</span>
                        )}
                      </td>
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
            Every class and shift on the calendar is paid the moment its hour ends — nothing to
            mark complete, nothing to sign off. Mark a no-show on the calendar entry to take an
            hour back off. Pay is per hour, at the rate for that kind of work, also set on the
            calendar entry — so the same person can be at the desk at 10 and teaching at 1 on
            two different rates.
            {isWeek && ' Weeks run Monday to Sunday. Salaries are not in this total — they run monthly.'}
            {/* The forecast is only as complete as the timetable behind it, and
                the honest failure mode is a total that looks reassuringly small
                because nobody has scheduled September yet. */}
            {isUpcoming && ' This is priced from the hours already on the calendar, at today’s rates: it moves when classes are added, cancelled or rescheduled, and a period nobody has scheduled yet reads as $0 rather than as nothing to pay. Salaries are left out unless the window is a whole month.'}
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

      {/* Reloading on close matters here: closing a day removes hours from
          the totals behind this modal, and leaving them showing would be a
          stale figure an admin might act on. */}
      {showClosures && (
        <ClosuresPanel
          onClose={() => { setShowClosures(false); retry(); }}
        />
      )}

      {reviewingAbsences && (
        <AbsencesPanel
          rows={rows}
          periodLabel={
            isUpcoming
              ? `the next ${weeksAhead === 1 ? 'week' : `${weeksAhead} weeks`}`
              : isWeek ? weekLabel(weekStart) : `${MONTH_NAMES[month - 1]} ${year}`
          }
          onClose={() => setReviewingAbsences(false)}
          // Restoring an hour turns unpaid hours into paid ones, so every total
          // on the page behind is now wrong until it re-reads the period.
          onDone={retry}
        />
      )}
    </div>
  );
};

export default PayrollOverview;
