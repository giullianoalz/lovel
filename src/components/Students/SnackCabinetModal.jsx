import React, { useState, useEffect, useRef } from 'react';
import { X, ShoppingBag, Settings, Plus, Trash2, Camera } from 'lucide-react';
import { database } from '../../lib/database';
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

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewSnackForm({ ...newSnackForm, image: reader.result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveSnack = async () => {
    if(!newSnackForm.name || !newSnackForm.cost) return;
    await database.addSnack(newSnackForm);
    setNewSnackForm({ name: '', cost: '', image: '' });
    setIsAddingSnack(false);
    reloadCabinet();
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
            <p>Loading cabinet...</p>
          ) : (
            <div className="cabinet-grid">
              {snackCabinet.map(snack => (
                <div key={snack.id} className="snack-item" onClick={() => !isManagingCabinet && handlePurchase(snack)}>
                  <img src={snack.image} alt={snack.name} className="snack-img" />
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
