
export enum DeviceType {
  LAPTOP = 'laptop',
  ANDROID = 'android',
  IPHONE = 'iphone'
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  PAYPAL = 'PAY PAL'
}

export interface OutPartyEntry {
  id: string;
  index: number;
  amount: number;
  method: PaymentMethod;
}

export interface MainEntry {
  id: string;
  roomNo: string;
  description: string;
  method: PaymentMethod;
  cashIn: number;
  cashOut: number;
}

export interface CashBookState {
  currentDate: string;
  outPartyEntries: OutPartyEntry[];
  mainEntries: MainEntry[];
  exchangeRates: {
    usd: number;
    eur: number;
  };
  openingBalance: number;
}

export interface HistoryRecord {
  date: string;
  data: CashBookState;
}

export interface SyncData {
  state: CashBookState;
  updatedAt: number;
}
