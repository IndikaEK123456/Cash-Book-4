
import { CashBookState } from '../types';

/**
 * SHIVAS MASTER RELAY ENGINE
 * Designed for 1-second latency between Laptop and Mobile.
 */

// Unique channel for Shivas Beach Cabanas
const BLOB_ID = '1344403164629569536'; 
const CLOUD_URL = `https://jsonblob.com/api/jsonBlob/${BLOB_ID}`;

const STORAGE_KEY = 'shivas_local_cache';
const HISTORY_KEY = 'shivas_history';

export const saveState = async (state: CashBookState): Promise<boolean> => {
  if (!state) return false;
  
  // Local backup
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  try {
    const response = await fetch(CLOUD_URL, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      body: JSON.stringify({
        ...state,
        lastSyncTimestamp: Date.now() // Force a change in the data object
      }),
    });
    return response.ok;
  } catch (e) {
    console.error("Laptop Push Failed:", e);
    return false;
  }
};

export const getState = async (): Promise<CashBookState | null> => {
  try {
    // DOUBLE CACHE BUSTER: Unique ID + Timestamp to force fresh download
    const buster = `?cb=${Math.random()}&t=${Date.now()}`;
    const response = await fetch(CLOUD_URL + buster, {
      method: 'GET',
      headers: { 
        'Accept': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    if (response.ok) {
      const data = await response.json();
      if (data && (data.outPartyEntries || data.mainEntries)) {
        return data as CashBookState;
      }
    }
  } catch (e) {
    console.warn("Mobile Pull Failed");
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
