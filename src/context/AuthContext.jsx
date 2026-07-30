import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import api, { setSignupInFlight, isSignupInFlight } from '../lib/api';

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
      // Creating the Firebase account fires this listener before the academy
      // profile exists. Letting it run would race signUpFamily's own sync and
      // could resolve after it, blanking a user we had just loaded.
      if (isSignupInFlight()) return;

      setLoading(true);
      if (firebaseUser) {
        try {
          // If we logged in through Firebase, we sync using the real token (attached by Axios interceptor)
          await syncProfile();
        } catch (error) {
          // A Firebase account with no matching row is someone the academy
          // hasn't set up (or hasn't invited yet). We deliberately don't create
          // the row here — that's what let a signup pick its own role.
          console.error('[AuthContext] No academy profile for this Firebase account:', error);
          setUser(null);
          setRole(null);
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

  /**
   * A family registers itself: create the Firebase account, hand the profile to
   * the API, then load it.
   *
   * The payload carries no role and no email — the server takes the address from
   * the verified token and decides the roles itself. Sending them would be
   * pointless at best and the whole privilege-escalation hole at worst.
   */
  const signUpFamily = async ({ email, password, parent, children, scholarship, notes }) => {
    setLoading(true);
    localStorage.removeItem('devUserEmail');
    setIsDevBypass(false);
    setSignupInFlight(true);

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);

      try {
        await api.post('/auth/signup', { parent, children, scholarship, notes });
      } catch (error) {
        // Our side refused (duplicate email, validation, server down) but
        // Firebase already holds the account. Leaving it behind would meet the
        // family with "email already in use" on every retry, with no way out.
        try {
          await credential.user.delete();
        } catch (cleanupError) {
          console.error('[AuthContext] Could not roll back the Firebase account:', cleanupError);
        }
        throw error;
      }

      // Best-effort: the portal nags them until it's done, and nothing is
      // gated on it, so a mail failure must not fail the signup.
      sendEmailVerification(credential.user).catch((error) =>
        console.error('[AuthContext] Verification email failed:', error)
      );

      setSignupInFlight(false);
      return await syncProfile();
    } finally {
      setSignupInFlight(false);
      setLoading(false);
    }
  };

  // Emails a password-reset link. Same mechanism as the staff invite, so a
  // parent who never opened their invite can also just do this themselves.
  // Firebase errors are swallowed on purpose: the caller shows the same message
  // either way, so this can't be used to discover which emails have accounts.
  const requestPasswordReset = async (email) => {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      console.error('[AuthContext] Password reset request failed:', error);
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

  // An account can wear more than one hat — a teacher who also enrols her own
  // children, say — because sign-in is tied 1:1 to a Firebase email and she
  // can't hold two accounts. `role` stays the primary one (it decides where
  // she lands); `roles` is what anything gating on capability should read.
  const roles = user ? [user.role, ...(user.secondaryRoles || [])].filter(Boolean) : [];
  const hasRole = (...wanted) => wanted.flat().some(r => roles.includes(r));

  const value = {
    user,
    role,
    roles,
    hasRole,
    loading,
    isDevBypass,
    loginWithEmail,
    loginAsSeededUser,
    signUpFamily,
    requestPasswordReset,
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
