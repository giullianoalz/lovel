import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import api from '../lib/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isDevBypass, setIsDevBypass] = useState(false);

  // Sync user profile from backend PostgreSQL using /api/auth/me
  const syncProfile = async (devEmail = null) => {
    try {
      const headers = {};
      if (devEmail) {
        headers['x-dev-user-email'] = devEmail;
      }
      
      const response = await api.get('/auth/me', { headers });
      if (response.data && response.data.user) {
        setUser(response.data.user);
        setRole(response.data.user.role);
        return response.data.user;
      }
      throw new Error('No user profile returned from server');
    } catch (error) {
      console.error('[AuthContext] Error syncing profile from backend:', error);
      setUser(null);
      setRole(null);
      throw error;
    }
  };

  useEffect(() => {
    // Check if dev bypass email exists in localStorage
    const savedDevEmail = localStorage.getItem('devUserEmail');
    
    if (savedDevEmail) {
      setIsDevBypass(true);
      syncProfile(savedDevEmail)
        .catch(() => {
          localStorage.removeItem('devUserEmail');
          setIsDevBypass(false);
        })
        .finally(() => setLoading(false));
      return;
    }

    // Otherwise, listen to Firebase Auth state
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        try {
          // If we logged in through Firebase, we sync using the real token (attached by Axios interceptor)
          await syncProfile();
        } catch (error) {
          console.error('[AuthContext] Failed to sync Firebase user to DB, trying to auto-register:', error);
          
          // Try to sync/create in DB if first time
          try {
            await api.post('/auth/sync', {
              role: 'PARENT', // Default role
              fullName: firebaseUser.displayName || 'New User',
              phone: firebaseUser.phoneNumber || ''
            });
            await syncProfile();
          } catch (syncError) {
            console.error('[AuthContext] Registration sync failed completely:', syncError);
            setUser(null);
            setRole(null);
          }
        }
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Login using standard Firebase Auth email/password
  const loginWithEmail = async (email, password) => {
    setLoading(true);
    localStorage.removeItem('devUserEmail');
    setIsDevBypass(false);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      // Wait for onAuthStateChanged to sync, or sync immediately
      await syncProfile();
      return userCredential.user;
    } catch (error) {
      setLoading(false);
      throw error;
    }
  };

  // Open parent self-registration: create the Firebase account (parent picks
  // their own password — we never see it), then sync a PARENT user row.
  const signupParent = async ({ email, password, fullName, phone }) => {
    setLoading(true);
    localStorage.removeItem('devUserEmail');
    setIsDevBypass(false);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: fullName }).catch(() => {});
      // Create the DB user as PARENT (the interceptor attaches the fresh token).
      await api.post('/auth/sync', { role: 'PARENT', fullName, phone: phone || '' });
      const profile = await syncProfile();
      return profile;
    } catch (error) {
      setLoading(false);
      throw error;
    }
  };

  // Login using Developer Bypass for quick role testing
  const loginAsSeededUser = async (email) => {
    setLoading(true);
    setIsDevBypass(true);
    localStorage.setItem('devUserEmail', email);
    
    // Sign out from Firebase if signed in to avoid conflicts
    if (auth.currentUser) {
      await signOut(auth);
    }

    try {
      const profile = await syncProfile(email);
      setLoading(false);
      return profile;
    } catch (error) {
      localStorage.removeItem('devUserEmail');
      setIsDevBypass(false);
      setLoading(false);
      throw error;
    }
  };

  // Sign out
  const logout = async () => {
    setLoading(true);
    localStorage.removeItem('devUserEmail');
    setIsDevBypass(false);
    setUser(null);
    setRole(null);
    try {
      await signOut(auth);
    } catch (error) {
      console.error('[AuthContext] Firebase signOut error:', error);
    }
    setLoading(false);
  };

  const value = {
    user,
    role,
    loading,
    isDevBypass,
    loginWithEmail,
    loginAsSeededUser,
    signupParent,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
