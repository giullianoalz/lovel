import React, { useState, useEffect, useRef } from 'react';
import { X, ShoppingBag, Settings, Plus, Trash2, Camera } from 'lucide-react';
import { database } from '../../lib/database';
import ProtectedImage from '../Layout/ProtectedImage';
import { useToast } from '../Layout/ToastProvider';
import './StudentProfileModal.css'; // Reusing the same CSS for now

const SnackCabinetModal = ({
  onClose,
  mode = 'purchase', // 'purchase' or 'manage'
  student = null,
  onUpdate = () => {}
}) => {
  const toast = useToast();
  const [snackCabinet, setSnackCabinet] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  
  // Cabinet Management State
  const [isManagingCabinet] = useState(mode === 'manage');
  const [isAddingSnack, setIsAddingSnack] = useState(false);
  const [newSnackForm, setNewSnackForm] = useState({ name: '', cost: '', image: '' });
  const fileInputRef = useRef(null);

  const reloadCabinet = async () => {
    setLoading(true);
    const snacks = await database.getSnackCabinet();
    setSnackCabinet(snacks);
    setLoading(false);
  };

  useEffect(() => {
    reloadCabinet();
  }, []);

  const handleDeleteSnack = async (snackId) => {
    if(window.confirm('Are you sure you want to delete this snack?')) {
      await database.deleteSnack(snackId);
      reloadCabinet();
    }
  };

  // A photo straight off the phone camera is 5-7 MB, and every one of those
  // went into the database verbatim until the cabinet weighed more than the
  // rest of the school put together. The picture is a thumbnail in a grid —
  // 1024px at JPEG 0.82 is roughly 80 KB and looks identical at that size.
  const shrinkImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onloadend = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image we can read.'));
      img.onload = () => {
        const MAX = 1024;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        // Always JPEG: a phone HEIC or PNG screenshot would otherwise keep its
        // original, much larger encoding on the way back out.
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const image = await shrinkImage(file);
      setNewSnackForm(prev => ({ ...prev, image }));
    } catch (err) {
      toast.error(err.message || 'Could not use that photo.');
    }
  };

  const handleSaveSnack = async () => {
    if(!newSnackForm.name || !newSnackForm.cost) return;
    try {
      // The photo goes to Drive on the way in, so this can fail for reasons the
      // name and cost never could. Saying so beats a form that just sits there.
      await database.addSnack(newSnackForm);
      setNewSnackForm({ name: '', cost: '', image: '' });
      setIsAddingSnack(false);
      reloadCabinet();
    } catch (err) {
      toast.error(err.userMessage || err.response?.data?.message || 'Could not save the snack.');
    }
  };

  const handlePurchase = async (snack) => {
    if (mode !== 'purchase' || purchasing || !student) return;
    setPurchasing(true);

    try {
      const result = await database.purchaseSnack(student.id, snack.id);
      if (result && result.success) {
        if (result.newBalance === 0) {
          toast.info('Snack card is empty — the parent was asked to approve a reload.');
        }
        onUpdate(result, snack);
        onClose();
      }
    } catch (err) {
      toast.error(err.userMessage || err.response?.data?.message || 'Could not complete the purchase.');
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <div className="cabinet-overlay" onClick={onClose}>
      <div className="cabinet-popup" onClick={e => e.stopPropagation()}>
        <header className="cabinet-header">
          <h3 className="cabinet-header-title">
            <ShoppingBag size={20} /> Snack Cabinet {mode === 'manage' && '- Admin'}
          </h3>
          <div className="cabinet-header-actions">
            <button className="icon-btn" onClick={onClose}><X size={20} /></button>
          </div>
        </header>

        <div className="cabinet-content">
          {isAddingSnack ? (
            <div className="add-snack-form">
              <h4 className="add-snack-form-title">Add New Snack</h4>

              <div
                className="image-upload-area"
                onClick={() => fileInputRef.current?.click()}
              >
                {newSnackForm.image ? (
                  <img src={newSnackForm.image} alt="Preview" className="uploaded-image-preview" />
                ) : (
                  <>
                    <Camera size={32} color="#94a3b8" />
                    <span className="add-snack-upload-hint">Tap to take photo or attach</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="add-snack-file-input"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                />
              </div>

              <div className="form-group form-group-spaced">
                <label>Snack Name</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. Granola Bar"
                  value={newSnackForm.name}
                  onChange={e => setNewSnackForm({...newSnackForm, name: e.target.value})}
                />
              </div>
              <div className="form-group form-group-spaced-lg">
                <label>Cost (Punches)</label>
                <input
                  type="number"
                  className="form-control"
                  placeholder="e.g. 2"
                  value={newSnackForm.cost}
                  onChange={e => setNewSnackForm({...newSnackForm, cost: e.target.value})}
                />
              </div>
              <div className="add-snack-form-actions">
                <button className="action-btn outline" onClick={() => setIsAddingSnack(false)}>Cancel</button>
                <button className="action-btn primary" onClick={handleSaveSnack}>Save Snack</button>
              </div>
            </div>
          ) : loading ? (
            <p className="app-inline-loader"><span className="app-spinner-sm" />Loading cabinet…</p>
          ) : (
            <div className="cabinet-grid">
              {snackCabinet.map(snack => (
                <div key={snack.id} className="snack-item" onClick={() => !isManagingCabinet && handlePurchase(snack)}>
                  {snack.imagePath ? (
                    <ProtectedImage apiPath={snack.imagePath} alt={snack.name} className="snack-img" />
                  ) : (
                    <img src={snack.image} alt={snack.name} className="snack-img" />
                  )}
                  <div className="snack-info">
                    <span className="snack-name">{snack.name}</span>
                    <span className="snack-cost">{snack.costPunches} Punches</span>
                  </div>
                  {isManagingCabinet ? (
                    <button
                      className="action-btn small outline danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSnack(snack.id);
                      }}
                    >
                      <Trash2 size={14} className="snack-delete-icon" /> Delete
                    </button>
                  ) : (
                    <button className="action-btn primary small outline" disabled={purchasing}>
                      Select
                    </button>
                  )}
                </div>
              ))}

              {isManagingCabinet && (
                <div className="add-snack-card" onClick={() => setIsAddingSnack(true)}>
                  <div className="add-snack-icon">
                    <Plus size={24} color="#3b82f6" />
                  </div>
                  <span className="add-snack-card-label">Add New Snack</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SnackCabinetModal;
