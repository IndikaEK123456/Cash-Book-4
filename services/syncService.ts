
import { CashBookState } from '../types';

/**
 * SHIVAS LIVE CLOUD RELAY (JSONBLOB)
 * This service allows Laptop and Mobile to share a single source of truth.
 */

// Stable ID for Shivas Beach Cabanas
const BLOB_ID = '1344265780516626432'; 
const CLOUD_URL = `https://jsonblob.com/api/jsonBlob/${BLOB_ID}`;

const STORAGE_KEY = 'shivas_local_cache';
const HISTORY_KEY = 'shivas_history';

export const saveState = async (state: CashBookState): Promise<boolean> => {
  if (!state) return false;
  
  // Save locally first
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  try {
    const response = await fetch(CLOUD_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    return response.ok;
  } catch (e) {
    console.error("Cloud Push Failed:", e);
    return false;
  }
};

export const getState = async (): Promise<CashBookState | null> => {
  try {
    const response = await fetch(CLOUD_URL, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (response.ok) {
      const data = await response.json();
      if (data && (data.outPartyEntries || data.mainEntries)) {
        return data as CashBookState;
      }
    }
  } catch (e) {
    console.warn("Cloud Sync Unavailable");
  }

  const local = localStorage.getItem(STORAGE_KEY);
  if (!local) return null;
  try {
    return JSON.parse(local);
  } catch (e) {
    return null;
  }
};

export const saveToHistory = (record: { date: string; data: CashBookState }) => {
  const history = getHistory();
  history.unshift(record);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
};

export const getHistory = (): { date: string; data: CashBookState }[] => {
  const data = localStorage.getItem(HISTORY_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
};
