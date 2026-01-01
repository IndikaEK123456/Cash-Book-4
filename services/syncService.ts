
import { SyncData, CashBookState } from '../types';

/**
 * SHIVAS LIVE CLOUD RELAY
 * This service enables true cross-device synchronization using a shared Cloud ID.
 * Laptop pushes state to the cloud, Mobiles poll the cloud for updates.
 */

// Unique ID for Shivas Beach Cabanas to prevent data clashing with other apps
const APP_CLOUD_ID = 'shivas_beach_cabanas_v5_live_relay';
const STORAGE_KEY = 'shivas_cashbook_local_backup';
const HISTORY_KEY = 'shivas_cashbook_history';

/**
 * We use a public, zero-config key-value store (kvstore.io or similar logic) 
 * to act as the central brain.
 */
const CLOUD_API_URL = `https://kvstore.io/api/v1/shivas_beach/${APP_CLOUD_ID}`;

export const saveState = async (state: CashBookState) => {
  const data: SyncData = {
    state,
    updatedAt: Date.now(),
  };

  // 1. Save locally for instant UI feedback and offline backup
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  // 2. Push to Cloud Relay (only for Laptop)
  try {
    await fetch(CLOUD_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.error("Cloud Push Failed - Check Internet Connection", e);
  }
};

export const getState = async (): Promise<CashBookState | null> => {
  // 1. Try fetching from Cloud Relay first (True Live Connection)
  try {
    const response = await fetch(CLOUD_API_URL);
    if (response.ok) {
      const data: SyncData = await response.json();
      // Update local storage so we have it if cloud goes down
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return data.state;
    }
  } catch (e) {
    console.warn("Cloud Fetch Failed - Using Local Cache", e);
  }

  // 2. Fallback to local cache if offline
  const local = localStorage.getItem(STORAGE_KEY);
  if (!local) return null;
  try {
    return JSON.parse(local).state;
  } catch (e) {
    return null;
  }
};

/**
 * Reconnect & Sync Listener
 * Triggers a callback whenever state changes (handled in App.tsx via polling)
 */
export const onSyncUpdate = (callback: (state: CashBookState) => void) => {
  // We use the Polling mechanism in App.tsx for true cross-device 'Live' feel
};

export const saveToHistory = (record: { date: string; data: CashBookState }) => {
  const history = getHistory();
  history.unshift(record);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
};

export const getHistory = (): { date: string; data: CashBookState }[] => {
  const data = localStorage.getItem(HISTORY_KEY);
  return data ? JSON.parse(data) : [];
};
