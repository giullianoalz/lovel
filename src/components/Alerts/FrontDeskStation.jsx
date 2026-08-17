import React from 'react';
import { useNavigate } from 'react-router-dom';
import { DoorOpen, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import CheckInBoard from './CheckInBoard';
import './FrontDeskStation.css';

/**
 * The door on its own screen, for whoever is covering it right now.
 *
 * A teacher reaches this from their portal ("Connect to Front Desk") and gets
 * the check-in board and the two scanners — nothing else from the desk's own
 * screen, because the cancellation and snack queues are decisions, not door
 * work, and they belong to the people who already have /alerts.
 */
const FrontDeskStation = () => {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  // A guardian's number is given to admins and the desk only (students.controller,
  // parentContactLevel), and covering reception doesn't widen that — a teacher
  // standing here would only get a call button that 403s.
  const canSeeParentPhone = hasRole('ADMIN', 'RECEPTIONIST') && !hasRole('TEACHER');

  return (
    <div className="fds-container">
      <header className="fds-header">
        <div className="fds-title">
          <div className="fds-icon"><DoorOpen size={22} /></div>
          <div>
            <h1>Front Desk</h1>
            <p>
              Checking students in and out as {user?.fullName || 'staff'}. Scan the family QR on
              arrival, or tap a name on today&rsquo;s board.
            </p>
          </div>
        </div>
        <button className="fds-back" onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> Back
        </button>
      </header>

      <CheckInBoard canSeeParentPhone={canSeeParentPhone} />
    </div>
  );
};

export default FrontDeskStation;
