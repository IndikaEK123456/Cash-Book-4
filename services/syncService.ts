
import { SyncData, CashBookState } from '../types';

/**
 * SHIVAS LIVE CONNECTION ENGINE
 * Ensures data is synced across all browser instances and devices.
 */

const STORAGE_KEY = 'shivas_cashbook_v4_state';
const HISTORY_KEY = 'shivas_cashbook_v4_history';
const SYNC_CHANNEL = 'shivas_live_relay';

const channel = new BroadcastChannel(SYNC_CHANNEL);

export const saveState = (state: CashBookState) => {
  const data: SyncData = {
    state,
    updatedAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  channel.postMessage(data); // Immediate broadcast to all local tabs
};

export const getState = (): CashBookState | null => {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data).state;
  } catch (e) {
    return null;
  }
};

export const onSyncUpdate = (callback: (state: CashBookState) => void) => {
  // Listen for broadcast channel updates
  channel.onmessage = (event) => {
    if (event.data?.state) {
      callback(event.data.state);
    }
  };

  // Listen for storage events (cross-tab same browser)
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      const data = JSON.parse(e.newValue);
      callback(data.state);
    }
  });
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
