import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronDown, ChevronUp, Plus, Trash2, Check, User, Users, BookOpen, CreditCard } from 'lucide-react';
import './AddStudentModal.css';

const TUTORS = [
  { id: 't1', name: 'Tara Sanford' },
  { id: 't2', name: 'Erica Hoffman' },
  { id: 't3', name: 'Daniel Diaz' },
  { id: 't4', name: 'David Brown' },
  { id: 't5', name: 'Elena Rodriguez' }
];

const CATEGORIES = ['Zoom Lesson', 'In Person Tutoring', 'Group POD', 'Test Prep', 'Portfolio Evaluation'];

const GROUP_TAGS = [
  { id: 'gt1', label: 'Fall 2025', color: '#a78bfa' },
  { id: 'gt2', label: 'Fall Online 2025', color: '#fbbf24' },
  { id: 'gt3', label: 'Homeschool Families', color: '#94a3b8' },
  { id: 'gt4', label: 'Love Camp', color: '#94a3b8' },
  { id: 'gt5', label: 'Love Learning FL LLC', color: '#60a5fa' },
  { id: 'gt6', label: 'Spring 2025 In Person Class', color: '#34d399' },
  { id: 'gt7', label: 'Spring 2026', color: '#f87171' },
  { id: 'gt8', label: 'EMA', color: '#818cf8' }
];

const INITIAL_STUDENT = {
  studentType: 'Child',
  status: 'Active',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  gender: '',
  birthday: '',
  school: '',
  allergies: '',
  subjects: '',
  skillLevel: '',
  groupTags: [],
  note: '',
  studentSince: new Date().toISOString().split('T')[0]
};

const INITIAL_FAMILY = {
  familyType: 'new',
  existingFamilyId: '',
  parentFirstName: '',
  parentLastName: '',
  parentEmail: '',
  parentPhone: '',
  address: '',
  note: '',
  sendEmailReminders: false
};

const INITIAL_BILLING_PROFILE = {
  tutorId: '',
  category: '',
  duration: 60,
  billingMode: 'hourly',
  price: ''
};

const AddStudentModal = ({ onClose, onSave, families = [] }) => {
  const [step, setStep] = useState(1);
  const [student, setStudent] = useState(INITIAL_STUDENT);
  const [family, setFamily] = useState(INITIAL_FAMILY);
  const [billingProfiles, setBillingProfiles] = useState([]);
  const [showStudentExtra, setShowStudentExtra] = useState(false);
  const [showFamilyExtra, setShowFamilyExtra] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const tagWrapperRef = useRef(null);

  // Close tag dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (tagWrapperRef.current && !tagWrapperRef.current.contains(e.target)) {
        setShowTagDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateStudent = (field, value) => setStudent(prev => ({ ...prev, [field]: value }));
  const updateFamily = (field, value) => setFamily(prev => ({ ...prev, [field]: value }));

  const addBillingProfile = () => {
    setBillingProfiles(prev => [...prev, { ...INITIAL_BILLING_PROFILE, id: `bp_${Date.now()}` }]);
  };

  const updateBillingProfile = (index, field, value) => {
    setBillingProfiles(prev => prev.map((bp, i) => i === index ? { ...bp, [field]: value } : bp));
  };

  const removeBillingProfile = (index) => {
    setBillingProfiles(prev => prev.filter((_, i) => i !== index));
  };

  const toggleTag = (tag) => {
    setStudent(prev => {
      const exists = prev.groupTags.find(t => t.id === tag.id);
      if (exists) return { ...prev, groupTags: prev.groupTags.filter(t => t.id !== tag.id) };
      return { ...prev, groupTags: [...prev.groupTags, tag] };
    });
  };

  const filteredTags = GROUP_TAGS.filter(t =>
    t.label.toLowerCase().includes(tagSearch.toLowerCase()) &&
    !student.groupTags.find(st => st.id === t.id)
  );

  const canProceed = () => {
    if (step === 1) {
      const studentOk = student.firstName.trim() && student.lastName.trim();
      const familyOk = family.familyType === 'existing'
        ? !!family.existingFamilyId
        : family.parentFirstName.trim() && family.parentLastName.trim();
      return studentOk && familyOk;
    }
    return true;
  };

  const handleSave = () => {
    const fullStudent = {
      id: `std_${Date.now()}`,
      name: `${student.firstName} ${student.lastName}`,
      firstName: student.firstName,
      lastName: student.lastName,
      studentType: student.studentType,
      status: student.status,
      email: student.email,
      phone: student.phone,
      gender: student.gender,
      birthday: student.birthday,
      school: student.school,
      allergies: student.allergies || 'None',
      subjects: student.subjects,
      skillLevel: student.skillLevel,
      groupTags: student.groupTags,
      note: student.note,
      studentSince: student.studentSince,
      // Family
      parentName: family.familyType === 'existing'
        ? families.find(f => f.id === family.existingFamilyId)?.contacts?.[0]?.name || ''
        : `${family.parentFirstName} ${family.parentLastName}`,
      parentEmail: family.parentEmail,
      parentPhone: family.parentPhone,
      familyId: family.familyType === 'existing' ? family.existingFamilyId : `f_${Date.now()}`,
      // Billing
      billingProfiles,
      // Defaults
      snackAuthorized: false,
      snackPunches: 0,
      snackHistory: [],
      prizePoints: 0,
      prizeHistory: [],
      materials: []
    };

    if (onSave) onSave(fullStudent);
    onClose();
  };

  const billingModeLabels = {
    none: 'No automatic charges',
    perLesson: 'Pay per lesson taken',
    monthly: 'Fixed monthly amount',
    hourly: 'Hourly rate'
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content add-student-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="asm-header">
          <h2>Add New Student</h2>
          <button className="icon-btn" onClick={onClose}><X size={22} /></button>
        </div>

        {/* Step Indicator */}
        <div className="asm-steps">
          <div className={`asm-step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
            <div className="step-circle">
              {step > 1 ? <Check size={14} /> : '1'}
            </div>
            <span>Student & Family</span>
          </div>
          <div className="step-line" />
          <div className={`asm-step ${step >= 2 ? 'active' : ''}`}>
            <div className="step-circle">2</div>
            <span>Lesson & Billing</span>
          </div>
        </div>

        {/* Body */}
        <div className="asm-body">
          {step === 1 && (
            <>
              {/* ─── STUDENT SECTION ─── */}
              <div className="asm-section">
                <div className="asm-section-title">
                  <User size={18} />
                  <span>Student Information</span>
                </div>

                <div className="asm-row">
                  <label className="asm-radio-group">
                    <span className="asm-radio-label">Type</span>
                    <div className="asm-radio-options">
                      <label><input type="radio" name="studentType" value="Child" checked={student.studentType === 'Child'} onChange={() => updateStudent('studentType', 'Child')} /> Child</label>
                      <label><input type="radio" name="studentType" value="Adult" checked={student.studentType === 'Adult'} onChange={() => updateStudent('studentType', 'Adult')} /> Adult</label>
                    </div>
                  </label>
                  <div className="asm-field">
                    <label>Status</label>
                    <select value={student.status} onChange={e => updateStudent('status', e.target.value)}>
                      <option value="Active">Active</option>
                      <option value="Trial">Trial</option>
                      <option value="Waiting">Waiting</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="asm-row">
                  <div className="asm-field">
                    <label>First Name <span className="required">*</span></label>
                    <input type="text" placeholder="e.g. Giulliano" value={student.firstName} onChange={e => updateStudent('firstName', e.target.value)} />
                  </div>
                  <div className="asm-field">
                    <label>Last Name <span className="required">*</span></label>
                    <input type="text" placeholder="e.g. Alzate" value={student.lastName} onChange={e => updateStudent('lastName', e.target.value)} />
                  </div>
                </div>

                <div className="asm-row">
                  <div className="asm-field">
                    <label>Email</label>
                    <input type="email" placeholder="student@email.com" value={student.email} onChange={e => updateStudent('email', e.target.value)} />
                    <span className="asm-hint">Optional</span>
                  </div>
                  <div className="asm-field">
                    <label>Allergies</label>
                    <input type="text" placeholder="e.g. Peanuts, Shellfish (or None)" value={student.allergies} onChange={e => updateStudent('allergies', e.target.value)} />
                  </div>
                </div>

                {/* Collapsible Extra Fields */}
                <button className="asm-toggle-extra" onClick={() => setShowStudentExtra(!showStudentExtra)}>
                  Additional Details
                  <span className="asm-hint">(Optional)</span>
                  {showStudentExtra ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {showStudentExtra && (
                  <div className="asm-extra-fields">
                    <div className="asm-row">
                      <div className="asm-field">
                        <label>Gender</label>
                        <select value={student.gender} onChange={e => updateStudent('gender', e.target.value)}>
                          <option value="">Select...</option>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div className="asm-field">
                        <label>Birthday</label>
                        <input type="date" value={student.birthday} onChange={e => updateStudent('birthday', e.target.value)} />
                      </div>
                    </div>
                    <div className="asm-row">
                      <div className="asm-field">
                        <label>School</label>
                        <input type="text" placeholder="School name" value={student.school} onChange={e => updateStudent('school', e.target.value)} />
                      </div>
                      <div className="asm-field">
                        <label>Student Since</label>
                        <input type="date" value={student.studentSince} onChange={e => updateStudent('studentSince', e.target.value)} />
                      </div>
                    </div>
                    <div className="asm-row">
                      <div className="asm-field">
                        <label>Subjects</label>
                        <input type="text" placeholder="Math, Science, English..." value={student.subjects} onChange={e => updateStudent('subjects', e.target.value)} />
                      </div>
                      <div className="asm-field">
                        <label>Skill Level</label>
                        <select value={student.skillLevel} onChange={e => updateStudent('skillLevel', e.target.value)}>
                          <option value="">Select...</option>
                          <option value="Beginner">Beginner</option>
                          <option value="Intermediate">Intermediate</option>
                          <option value="Advanced">Advanced</option>
                        </select>
                      </div>
                    </div>

                    {/* Group Tags */}
                    <div className="asm-field">
                      <label>Group Tags</label>
                      <div className="asm-tag-input-wrapper" ref={tagWrapperRef}>
                        <div className="asm-selected-tags">
                          {student.groupTags.map(tag => (
                            <span key={tag.id} className="asm-tag" style={{ borderColor: tag.color, color: tag.color }}>
                              {tag.label}
                              <button onClick={() => toggleTag(tag)}><X size={12} /></button>
                            </span>
                          ))}
                          <input
                            type="text"
                            placeholder={student.groupTags.length === 0 ? 'Search tags...' : ''}
                            value={tagSearch}
                            onChange={e => { setTagSearch(e.target.value); setShowTagDropdown(true); }}
                            onFocus={() => setShowTagDropdown(true)}
                          />
                        </div>
                        {showTagDropdown && filteredTags.length > 0 && (
                          <div className="asm-tag-dropdown">
                            {filteredTags.map(tag => (
                              <button key={tag.id} className="asm-tag-option" onClick={() => { toggleTag(tag); setTagSearch(''); }}>
                                <span className="tag-color-dot" style={{ background: tag.color }} />
                                {tag.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="asm-field">
                      <label>Internal Note</label>
                      <textarea placeholder="Visible to tutors and admins only..." value={student.note} onChange={e => updateStudent('note', e.target.value)} rows={3} />
                      <span className="asm-hint">Not visible to parents or students</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ─── FAMILY / PARENT SECTION ─── */}
              <div className="asm-section">
                <div className="asm-section-title">
                  <Users size={18} />
                  <span>Family / Guardian</span>
                </div>

                <div className="asm-radio-group" style={{ marginBottom: '16px' }}>
                  <label className="asm-radio-card">
                    <input type="radio" name="familyType" value="new" checked={family.familyType === 'new'} onChange={() => updateFamily('familyType', 'new')} />
                    <div>
                      <strong>New Family</strong>
                      <span>Create a new account in Families & Invoices</span>
                    </div>
                  </label>
                  <label className="asm-radio-card">
                    <input type="radio" name="familyType" value="existing" checked={family.familyType === 'existing'} onChange={() => updateFamily('familyType', 'existing')} />
                    <div>
                      <strong>Existing Family</strong>
                      <span>Link to a family already in the system</span>
                    </div>
                  </label>
                </div>

                {family.familyType === 'existing' ? (
                  <div className="asm-field">
                    <label>Select Family <span className="required">*</span></label>
                    <select value={family.existingFamilyId} onChange={e => updateFamily('existingFamilyId', e.target.value)}>
                      <option value="">Choose a family...</option>
                      {families.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div className="asm-row">
                      <div className="asm-field">
                        <label>Parent First Name <span className="required">*</span></label>
                        <input type="text" placeholder="e.g. Adrian" value={family.parentFirstName} onChange={e => updateFamily('parentFirstName', e.target.value)} />
                      </div>
                      <div className="asm-field">
                        <label>Parent Last Name <span className="required">*</span></label>
                        <input type="text" placeholder="e.g. Alzate" value={family.parentLastName} onChange={e => updateFamily('parentLastName', e.target.value)} />
                      </div>
                    </div>
                    <div className="asm-row">
                      <div className="asm-field">
                        <label>Email</label>
                        <input type="email" placeholder="parent@email.com" value={family.parentEmail} onChange={e => updateFamily('parentEmail', e.target.value)} />
                        <span className="asm-hint">Optional — Used for invoices & reminders</span>
                      </div>
                      <div className="asm-field">
                        <label>Mobile Phone</label>
                        <input type="tel" placeholder="(555) 123-4567" value={family.parentPhone} onChange={e => updateFamily('parentPhone', e.target.value)} />
                        <span className="asm-hint">Optional</span>
                      </div>
                    </div>

                    {/* Collapsible Extra Family Fields */}
                    <button className="asm-toggle-extra" onClick={() => setShowFamilyExtra(!showFamilyExtra)}>
                      Additional Details
                      <span className="asm-hint">(Optional)</span>
                      {showFamilyExtra ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>

                    {showFamilyExtra && (
                      <div className="asm-extra-fields">
                        <div className="asm-field">
                          <label>Address</label>
                          <textarea placeholder="Street address..." value={family.address} onChange={e => updateFamily('address', e.target.value)} rows={2} />
                        </div>
                        <div className="asm-field">
                          <label>Internal Note</label>
                          <textarea placeholder="Visible to tutors and admins only..." value={family.note} onChange={e => updateFamily('note', e.target.value)} rows={2} />
                        </div>
                        <label className="asm-checkbox">
                          <input type="checkbox" checked={family.sendEmailReminders} onChange={e => updateFamily('sendEmailReminders', e.target.checked)} />
                          <span>Send email lesson reminders to parent</span>
                        </label>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {/* ─── LESSON & BILLING PROFILES ─── */}
              <div className="asm-section">
                <div className="asm-section-title">
                  <BookOpen size={18} />
                  <span>Lesson & Billing Profiles</span>
                </div>
                <p className="asm-section-desc">Assign tutors and set up billing for this student. You can add multiple profiles if the student works with different tutors.</p>

                {billingProfiles.length === 0 && (
                  <div className="asm-empty-profiles">
                    <CreditCard size={32} />
                    <p>No billing profiles yet.</p>
                    <span>Add one to set up tutoring sessions and automatic charges.</span>
                  </div>
                )}

                {billingProfiles.map((bp, index) => (
                  <div key={bp.id} className="asm-billing-card">
                    <div className="asm-billing-card-header">
                      <span className="asm-billing-num">Profile {index + 1}</span>
                      <button className="icon-btn" onClick={() => removeBillingProfile(index)} title="Remove"><Trash2 size={16} /></button>
                    </div>

                    <div className="asm-row">
                      <div className="asm-field">
                        <label>Tutor</label>
                        <select value={bp.tutorId} onChange={e => updateBillingProfile(index, 'tutorId', e.target.value)}>
                          <option value="">Select tutor...</option>
                          {TUTORS.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="asm-field">
                        <label>Category</label>
                        <select value={bp.category} onChange={e => updateBillingProfile(index, 'category', e.target.value)}>
                          <option value="">Select category...</option>
                          {CATEGORIES.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="asm-row">
                      <div className="asm-field">
                        <label>Duration</label>
                        <div className="asm-input-suffix">
                          <input type="number" value={bp.duration} onChange={e => updateBillingProfile(index, 'duration', e.target.value)} min={15} step={15} />
                          <span>min</span>
                        </div>
                      </div>
                      <div className="asm-field">
                        <label>Price</label>
                        <div className="asm-input-suffix">
                          <input type="number" placeholder="0.00" value={bp.price} onChange={e => updateBillingProfile(index, 'price', e.target.value)} min={0} step={0.01} />
                          <span>{bp.billingMode === 'hourly' ? '/hr' : bp.billingMode === 'perLesson' ? '/lesson' : '/mo'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="asm-field">
                      <label>Billing Mode</label>
                      <div className="asm-billing-modes">
                        {Object.entries(billingModeLabels).map(([key, label]) => (
                          <label key={key} className={`asm-billing-mode ${bp.billingMode === key ? 'selected' : ''}`}>
                            <input type="radio" name={`billing-${bp.id}`} value={key} checked={bp.billingMode === key} onChange={() => updateBillingProfile(index, 'billingMode', key)} />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                <button className="asm-add-profile-btn" onClick={addBillingProfile}>
                  <Plus size={16} /> Add Billing Profile
                </button>
              </div>

              {/* ─── REVIEW SUMMARY ─── */}
              <div className="asm-section asm-review">
                <div className="asm-section-title">
                  <Check size={18} />
                  <span>Review Summary</span>
                </div>

                <div className="asm-review-grid">
                  <div className="asm-review-block">
                    <h4>Student</h4>
                    <p><strong>{student.firstName} {student.lastName}</strong></p>
                    <p>{student.studentType} · {student.status}</p>
                    {student.email && <p>{student.email}</p>}
                    {student.allergies && <p>Allergies: {student.allergies}</p>}
                    {student.groupTags.length > 0 && (
                      <div className="asm-review-tags">
                        {student.groupTags.map(t => (
                          <span key={t.id} className="asm-mini-tag" style={{ borderColor: t.color, color: t.color }}>{t.label}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="asm-review-block">
                    <h4>Family</h4>
                    {family.familyType === 'existing' ? (
                      <p>{families.find(f => f.id === family.existingFamilyId)?.name || 'Selected family'}</p>
                    ) : (
                      <>
                        <p><strong>{family.parentFirstName} {family.parentLastName}</strong></p>
                        {family.parentEmail && <p>{family.parentEmail}</p>}
                        {family.parentPhone && <p>{family.parentPhone}</p>}
                      </>
                    )}
                  </div>
                </div>

                {billingProfiles.length > 0 && (
                  <div className="asm-review-billing">
                    <h4>Billing Profiles</h4>
                    {billingProfiles.map((bp, i) => (
                      <div key={bp.id} className="asm-review-bp">
                        <span>{TUTORS.find(t => t.id === bp.tutorId)?.name || 'No tutor'}</span>
                        <span>{bp.category || 'No category'}</span>
                        <span>{bp.duration}min</span>
                        <span className="asm-review-price">${bp.price || '0'}{bp.billingMode === 'hourly' ? '/hr' : bp.billingMode === 'perLesson' ? '/lesson' : '/mo'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="asm-footer">
          <button className="action-btn outline" onClick={onClose}>Cancel</button>
          <div className="asm-footer-right">
            {step > 1 && (
              <button className="action-btn outline" onClick={() => setStep(step - 1)}>Previous</button>
            )}
            {step < 2 ? (
              <button className="action-btn primary" disabled={!canProceed()} onClick={() => setStep(step + 1)}>
                Next
              </button>
            ) : (
              <button className="action-btn primary" onClick={handleSave}>
                <Check size={16} /> Save Student
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddStudentModal;
