import React, { useState } from 'react';
import { X, UploadCloud, FileText, ArrowRight, CheckCircle, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../Layout/ToastProvider';
import './ImportStudentsModal.css';

/* Target fields we import into. studentName is required. */
const FIELDS = [
  { key: 'studentName', label: 'Student Name', required: true, hints: ['student name', 'student', 'child', 'nombre', 'name', 'first name'] },
  { key: 'studentEmail', label: 'Student Email', hints: ['student email', 'email'] },
  { key: 'age', label: 'Age', hints: ['age', 'edad'] },
  { key: 'allergies', label: 'Allergies', hints: ['allerg', 'alerg'] },
  { key: 'status', label: 'Status (Active/Inactive)', hints: ['status', 'estado', 'active'] },
  { key: 'parentName', label: 'Parent/Guardian Name', hints: ['parent name', 'parent', 'guardian', 'padre', 'madre', 'contact'] },
  { key: 'parentEmail', label: 'Parent Email', hints: ['parent email', 'guardian email', 'email'] },
  { key: 'parentPhone', label: 'Parent Phone', hints: ['phone', 'mobile', 'cell', 'telefono', 'tel'] },
  { key: 'familyName', label: 'Family Name', hints: ['family', 'familia', 'household', 'account'] },
  { key: 'tags', label: 'Tags/Groups', hints: ['tag', 'group', 'grupo', 'term', 'program'] },
];

/* Minimal RFC-4180-ish CSV parser: handles quoted fields, commas, and newlines inside quotes. */
const parseCSV = (text) => {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
};

const guessMapping = (headers) => {
  const mapping = {};
  const used = new Set();
  for (const field of FIELDS) {
    const idx = headers.findIndex((h, i) => {
      if (used.has(i)) return false;
      const hl = h.toLowerCase();
      return field.hints.some(hint => hl.includes(hint));
    });
    if (idx !== -1) { mapping[field.key] = idx; used.add(idx); }
    else mapping[field.key] = -1;
  }
  return mapping;
};

const ImportStudentsModal = ({ onClose, onImported }) => {
  const toast = useToast();
  const [step, setStep] = useState(1); // 1 upload, 2 map, 3 result
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result);
      if (parsed.length < 2) { toast.error('El CSV no tiene filas de datos.'); return; }
      const hdrs = parsed[0].map(h => h.trim());
      setHeaders(hdrs);
      setDataRows(parsed.slice(1));
      setMapping(guessMapping(hdrs));
      setStep(2);
    };
    reader.readAsText(file);
  };

  const buildRows = () =>
    dataRows.map(cols => {
      const obj = {};
      for (const field of FIELDS) {
        const idx = mapping[field.key];
        obj[field.key] = idx >= 0 ? (cols[idx] || '').trim() : '';
      }
      return obj;
    }).filter(r => r.studentName);

  const handleImport = async () => {
    if (mapping.studentName === undefined || mapping.studentName < 0) {
      toast.error('You must map at least the "Student Name" field.');
      return;
    }
    const rows = buildRows();
    if (rows.length === 0) { toast.error('No hay filas con nombre de estudiante.'); return; }
    setImporting(true);
    try {
      const res = await api.post('/import/students', { rows });
      setResult(res.data);
      setStep(3);
      onImported?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import error.');
    } finally {
      setImporting(false);
    }
  };

  const preview = buildRows().slice(0, 5);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="import-modal" onClick={e => e.stopPropagation()}>
        <div className="import-header">
          <h2><UploadCloud size={22} /> Import from TutorBird (CSV)</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        {step === 1 && (
          <div className="import-body">
            <div className="import-dropzone">
              <FileText size={40} />
              <p>Upload the CSV file exported from TutorBird (families / students).</p>
              <label className="import-file-btn">
                Select CSV
                <input type="file" accept=".csv,.txt" hidden onChange={handleFile} />
              </label>
              <span className="import-hint">The first row must be the column headers.</span>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="import-body">
            <p className="import-sub">
              We detected <strong>{dataRows.length}</strong> rows. Map each field to the corresponding column in your CSV.
              Unmapped fields will be left empty.
            </p>
            <div className="import-map-grid">
              {FIELDS.map(field => (
                <div key={field.key} className="import-map-row">
                  <label>{field.label}{field.required && <span className="req"> *</span>}</label>
                  <select
                    value={mapping[field.key]}
                    onChange={e => setMapping(m => ({ ...m, [field.key]: parseInt(e.target.value) }))}
                  >
                    <option value={-1}>— (unmapped) —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {preview.length > 0 && (
              <div className="import-preview">
                <h4>Preview ({preview.length} of {dataRows.length})</h4>
                <div className="import-preview-scroll">
                  <table>
                    <thead>
                      <tr><th>Student</th><th>Age</th><th>Parent</th><th>Family</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i}>
                          <td>{r.studentName || '—'}</td>
                          <td>{r.age || '—'}</td>
                          <td>{r.parentName || '—'}</td>
                          <td>{r.familyName || '(auto)'}</td>
                          <td>{r.status || 'Active'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="import-actions">
              <button className="btn-text" onClick={() => setStep(1)}>Back</button>
              <button className="btn-primary" onClick={handleImport} disabled={importing}>
                {importing ? 'Importing...' : <>Import {buildRows().length} students <ArrowRight size={16} /></>}
              </button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="import-body">
            <div className="import-result">
              <CheckCircle size={48} color="#16a34a" />
              <h3>Import Complete</h3>
              <ul className="import-summary">
                <li><strong>{result.studentsCreated}</strong> students created</li>
                <li><strong>{result.studentsUpdated}</strong> students updated</li>
                <li><strong>{result.familiesCreated}</strong> new families</li>
                <li><strong>{result.parentsCreated}</strong> new parents</li>
              </ul>
              {result.errors?.length > 0 && (
                <div className="import-errors">
                  <p><AlertTriangle size={16} /> {result.errors.length} rows with errors:</p>
                  <ul>
                    {result.errors.slice(0, 8).map((e, i) => (
                      <li key={i}>Row {e.row}{e.student ? ` (${e.student})` : ''}: {e.message}</li>
                    ))}
                  </ul>
                  {result.errors.length > 8 && <span>...and {result.errors.length - 8} more</span>}
                </div>
              )}
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportStudentsModal;
