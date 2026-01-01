
import { SyncData, CashBookState } from '../types';

/**
 * SHIVAS CLOUD RELAY SERVICE
 * Uses a public, CORS-enabled JSON store for true cross-device synchronization.
 */

const PANTRY_ID = '9416809c-3430-4e33-9115-46f059f1f008'; // Shared unique pantry ID
const BASKET_NAME = 'shivas_beach_sync';
const CLOUD_URL = `https://getpantry.cloud/apiv1/pantry/${PANTRY_ID}/basket/${BASKET_NAME}`;

const STORAGE_KEY = 'shivas_local_cache';
const HISTORY_KEY = 'shivas_history';

export const saveState = async (state: CashBookState) => {
  if (!state) return;
  
  const data: SyncData = {
    state,
    updatedAt: Date.now(),
  };

  // 1. Update Local Cache
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  // 2. Push to Cloud (Laptop only sends)
  try {
    await fetch(CLOUD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data.state), // Pantry stores the object directly
    });
  } catch (e) {
    console.error("Cloud Push Failed:", e);
  }
};

export const getState = async (): Promise<CashBookState | null> => {
  try {
    const response = await fetch(CLOUD_URL);
    if (response.ok) {
      const cloudState: any = await response.json();
      // Basic validation to ensure it looks like our state
      if (cloudState && (cloudState.outPartyEntries || cloudState.mainEntries)) {
        return cloudState as CashBookState;
      }
    }
  } catch (e) {
    console.warn("Cloud Sync Unavailable - Checking Local Cache");
  }

  const local = localStorage.getItem(STORAGE_KEY);
  if (!local) return null;
  try {
    const parsed = JSON.parse(local);
    return parsed.state || null;
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
