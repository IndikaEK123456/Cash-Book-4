
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  DeviceType, 
  PaymentMethod, 
  CashBookState, 
  OutPartyEntry, 
  MainEntry,
  HistoryRecord
} from './types';
import * as syncService from './services/syncService';

// --- UI Constants ---
const CURRENCY_SYMBOL = 'Rs.';

const Label = ({ children, className = "" }: { children?: React.ReactNode, className?: string }) => (
  <span className={`text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1.5 block ${className}`}>
    {children}
  </span>
);

const SectionContainer = ({ title, children, isLaptop }: { title: string, children?: React.ReactNode, isLaptop: boolean }) => (
  <div className="bg-white rounded-[2rem] shadow-2xl shadow-slate-200 border border-slate-100 overflow-hidden flex flex-col h-full">
    <div className="bg-slate-900 px-8 py-5 flex justify-between items-center border-b border-slate-800">
      <h2 className="text-[11px] font-black text-white uppercase tracking-[0.4em]">{title}</h2>
      {!isLaptop && (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
          <span className="text-blue-400 text-[9px] font-black uppercase tracking-widest">LIVE VIEWER</span>
        </div>
      )}
    </div>
    <div className="p-6 md:p-8 flex-1 flex flex-col">
      {children}
    </div>
  </div>
);

// --- App Root ---
export default function App() {
  const [device, setDevice] = useState<DeviceType>(DeviceType.LAPTOP);
  const [state, setState] = useState<CashBookState>({
    currentDate: new Date().toLocaleDateString('en-GB'),
    outPartyEntries: [],
    mainEntries: [],
    exchangeRates: { usd: 310, eur: 366 },
    openingBalance: 0
  });
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const stateRef = useRef(state); // For polling comparison

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 1. Core Device Setup & Cloud Sync Loop
  useEffect(() => {
    const setup = () => {
      const hash = window.location.hash.toLowerCase();
      const isMob = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      if (hash.includes('android')) setDevice(DeviceType.ANDROID);
      else if (hash.includes('iphone')) setDevice(DeviceType.IPHONE);
      else if (isMob) setDevice(DeviceType.ANDROID);
      else setDevice(DeviceType.LAPTOP);
    };

    setup();
    window.addEventListener('hashchange', setup);

    // LIVE RECONNECT ENGINE (Rule 3)
    const runSync = async () => {
      const cloudState = await syncService.getState();
      if (cloudState && JSON.stringify(cloudState) !== JSON.stringify(stateRef.current)) {
        setState(cloudState);
      }
    };

    runSync(); // Immediate sync on open
    const pollInterval = setInterval(runSync, 2000); // 2-second cloud heartbeat

    // Rates (Rule 12)
    const fetchRates = async () => {
      try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await res.json();
        const lkr = data.rates.LKR;
        const eurLkr = lkr / data.rates.EUR;
        setState(prev => ({
          ...prev,
          exchangeRates: { usd: Math.ceil(lkr), eur: Math.ceil(eurLkr) }
        }));
      } catch (e) {}
    };
    fetchRates();
    setHistory(syncService.getHistory());

    return () => {
      window.removeEventListener('hashchange', setup);
      clearInterval(pollInterval);
    };
  }, []);

  const isLaptop = device === DeviceType.LAPTOP;

  const pushState = useCallback((newState: CashBookState) => {
    setState(newState);
    if (isLaptop) {
      syncService.saveState(newState);
    }
  }, [isLaptop]);

  // --- Financial Rules (7, 13, 14, 15, 16) ---
  const calc = useMemo(() => {
    const op = state.outPartyEntries.reduce((acc, curr) => {
      if (curr.method === PaymentMethod.CASH) acc.cash += curr.amount;
      if (curr.method === PaymentMethod.CARD) acc.card += curr.amount;
      if (curr.method === PaymentMethod.PAYPAL) acc.paypal += curr.amount;
      return acc;
    }, { cash: 0, card: 0, paypal: 0 });

    const mainIn = state.mainEntries.reduce((sum, e) => sum + e.cashIn, 0);
    const mainOut = state.mainEntries.reduce((sum, e) => sum + e.cashOut, 0);
    
    // Main Payment method totals
    const mCard = state.mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((sum, e) => sum + e.cashIn, 0);
    const mPaypal = state.mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((sum, e) => sum + e.cashIn, 0);

    // Combined Card/PayPal (Rule 14)
    const totalCard = mCard + op.card;
    const totalPaypal = mPaypal + op.paypal;

    // Final Cash In (Rule 13)
    const finalIn = mainIn + op.cash + op.card + op.paypal;

    // Final Cash Out (Rule 15: includes card/paypal totals)
    const finalOut = mainOut + totalCard + totalPaypal;

    // Balance (Rule 16)
    const balance = finalIn - finalOut;

    return { op, totalCard, totalPaypal, finalIn, finalOut, balance };
  }, [state.outPartyEntries, state.mainEntries]);

  // --- Handlers ---
  const addOP = () => {
    if (!isLaptop) return;
    const next = { id: crypto.randomUUID(), index: state.outPartyEntries.length + 1, amount: 0, method: PaymentMethod.CASH };
    pushState({ ...state, outPartyEntries: [...state.outPartyEntries, next] });
  };

  const editOP = (id: string, field: keyof OutPartyEntry, val: any) => {
    if (!isLaptop) return;
    const next = state.outPartyEntries.map(e => e.id === id ? { ...e, [field]: val } : e);
    pushState({ ...state, outPartyEntries: next });
  };

  const delOP = (id: string) => {
    if (!isLaptop) return;
    const next = state.outPartyEntries.filter(e => e.id !== id).map((e, i) => ({ ...e, index: i + 1 }));
    pushState({ ...state, outPartyEntries: next });
  };

  const addM = () => {
    if (!isLaptop) return;
    const next = { id: crypto.randomUUID(), roomNo: '', description: '', method: PaymentMethod.CASH, cashIn: 0, cashOut: 0 };
    pushState({ ...state, mainEntries: [...state.mainEntries, next] });
  };

  const editM = (id: string, field: keyof MainEntry, val: any) => {
    if (!isLaptop) return;
    const next = state.mainEntries.map(e => e.id === id ? { ...e, [field]: val } : e);
    pushState({ ...state, mainEntries: next });
  };

  const delM = (id: string) => {
    if (!isLaptop) return;
    pushState({ ...state, mainEntries: state.mainEntries.filter(e => e.id !== id) });
  };

  const runDayEnd = () => {
    if (!isLaptop || !confirm("DAY END: Wipe board and move to next date?")) return;
    syncService.saveToHistory({ date: state.currentDate, data: state });
    const d = new Date(); d.setDate(d.getDate() + 1);
    pushState({
      currentDate: d.toLocaleDateString('en-GB'),
      outPartyEntries: [],
      mainEntries: [],
      exchangeRates: state.exchangeRates,
      openingBalance: calc.balance
    });
    setHistory(syncService.getHistory());
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      
      {/* Top Header (Rule 9, 12) */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-4 shadow-sm backdrop-blur-md bg-white/95">
        <div className="max-w-[1700px] mx-auto flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="w-14 h-14 bg-black rounded-2xl flex items-center justify-center text-white shadow-xl shadow-slate-200 ring-4 ring-slate-100">
              <span className="font-black text-xl tracking-tighter">SB</span>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-black uppercase">Shivas Beach Cabanas</h1>
              <p className="text-[11px] font-black text-slate-400 mt-0.5 uppercase tracking-[0.4em]">{state.currentDate}</p>
            </div>
          </div>

          <div className="flex items-center gap-10">
            <div className="flex gap-10">
              <div className="text-right">
                <Label>USD / LKR</Label>
                <div className="text-xl font-black text-black leading-none">Rs. {state.exchangeRates.usd}</div>
              </div>
              <div className="text-right border-l border-slate-200 pl-10">
                <Label>EUR / LKR</Label>
                <div className="text-xl font-black text-black leading-none">Rs. {state.exchangeRates.eur}</div>
              </div>
            </div>
            
            <div className="flex gap-3">
              <button onClick={() => setShowHistory(true)} className="px-5 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-black">Records</button>
              {isLaptop && (
                <button onClick={runDayEnd} className="px-5 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-red-200">Day End</button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1700px] w-full mx-auto p-4 md:p-10 space-y-10">
        
        {/* Highlighted Balance Totals (Rule 17) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-blue-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-blue-200 ring-8 ring-blue-50 relative overflow-hidden">
            <Label className="text-blue-100">Total Cash In</Label>
            <div className="text-5xl font-black tracking-tight z-10 relative">Rs. {calc.finalIn.toLocaleString()}</div>
            <div className="absolute -bottom-10 -right-10 opacity-10"><svg className="w-48 h-48" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg></div>
          </div>
          <div className="bg-red-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-red-200 ring-8 ring-red-50 relative overflow-hidden">
            <Label className="text-red-100">Total Cash Out</Label>
            <div className="text-5xl font-black tracking-tight z-10 relative">Rs. {calc.finalOut.toLocaleString()}</div>
            <div className="absolute -bottom-10 -right-10 opacity-10 rotate-45"><svg className="w-48 h-48" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg></div>
          </div>
          <div className="bg-emerald-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-emerald-200 ring-8 ring-emerald-50 relative overflow-hidden">
            <Label className="text-emerald-100 font-bold">Current Final Balance</Label>
            <div className="text-5xl font-black tracking-tight z-10 relative">Rs. {calc.balance.toLocaleString()}</div>
            <div className="absolute -bottom-10 -right-10 opacity-10"><svg className="w-48 h-48" fill="currentColor" viewBox="0 0 24 24"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg></div>
          </div>
        </div>

        {/* Card & PayPal Summaries (Rule 14) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-amber-50 border-2 border-amber-200 p-8 rounded-[2rem] flex justify-between items-center shadow-inner">
             <span className="text-amber-900 font-black uppercase text-xs tracking-[0.2em]">Grand Card Total</span>
             <span className="text-amber-600 font-black text-4xl">Rs. {calc.totalCard.toLocaleString()}</span>
          </div>
          <div className="bg-purple-50 border-2 border-purple-200 p-8 rounded-[2rem] flex justify-between items-center shadow-inner">
             <span className="text-purple-900 font-black uppercase text-xs tracking-[0.2em]">Grand PayPal Total</span>
             <span className="text-purple-600 font-black text-4xl">Rs. {calc.totalPaypal.toLocaleString()}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
          
          {/* Out Party List (Rule 5, 6, 8, 18) */}
          <div className="xl:col-span-4">
            <SectionContainer title="Out Party Section" isLaptop={isLaptop}>
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 no-scrollbar">
                {state.outPartyEntries.map((entry) => (
                  <div key={entry.id} className="group bg-slate-50 border-2 border-slate-100 rounded-2xl p-5 flex items-center gap-5 hover:border-blue-400 transition-all">
                    <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center text-xs font-black shadow-lg">
                      {entry.index}
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-400">Rs.</span>
                        <input 
                          type="number"
                          readOnly={!isLaptop}
                          value={entry.amount || ''}
                          onChange={(e) => editOP(entry.id, 'amount', parseFloat(e.target.value) || 0)}
                          className="bg-transparent text-xl font-black text-black w-full outline-none"
                          placeholder="0"
                        />
                      </div>
                      <select 
                        disabled={!isLaptop}
                        value={entry.method}
                        onChange={(e) => editOP(entry.id, 'method', e.target.value as PaymentMethod)}
                        className={`bg-white border border-slate-200 rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest outline-none transition-colors ${
                          entry.method === PaymentMethod.CASH ? 'text-blue-600' : 
                          entry.method === PaymentMethod.CARD ? 'text-amber-600' : 'text-purple-600'
                        }`}
                      >
                        {Object.values(PaymentMethod).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    {isLaptop && (
                      <button onClick={() => delOP(entry.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {isLaptop && (
                <button onClick={addOP} className="w-full mt-6 py-4 border-2 border-dashed border-slate-300 rounded-2xl text-slate-400 font-black text-[10px] uppercase tracking-[0.4em] hover:bg-white hover:border-blue-500 hover:text-blue-500 transition-all flex items-center justify-center gap-3">
                   Add Out Party Entry
                </button>
              )}

              <div className="mt-8 pt-8 border-t border-slate-100 space-y-4">
                <div className="flex justify-between items-center">
                   <Label className="mb-0">OP Cash Total</Label>
                   <span className="text-blue-600 font-black text-lg">Rs. {calc.op.cash.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                   <Label className="mb-0">OP Card Total</Label>
                   <span className="text-amber-600 font-black text-lg">Rs. {calc.op.card.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                   <Label className="mb-0">OP PayPal Total</Label>
                   <span className="text-purple-700 font-black text-lg">Rs. {calc.op.paypal.toLocaleString()}</span>
                </div>
              </div>
            </SectionContainer>
          </div>

          {/* Main Section (Rule 10, 18, 19) */}
          <div className="xl:col-span-8">
            <SectionContainer title="Main Section Entry Dashboard" isLaptop={isLaptop}>
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-left border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-slate-400 font-black text-[9px] uppercase tracking-[0.2em]">
                      <th className="px-4 py-2">Room</th>
                      <th className="px-4 py-2 min-w-[300px]">Description</th>
                      <th className="px-4 py-2 text-center">Method</th>
                      <th className="px-4 py-2 text-right">Cash In</th>
                      <th className="px-4 py-2 text-right">Cash Out</th>
                      {isLaptop && <th className="px-4 py-2 w-10"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {state.mainEntries.map((entry) => (
                      <tr key={entry.id} className="group bg-slate-50/80 rounded-2xl">
                        <td className="px-4 py-4 first:rounded-l-2xl">
                          <input 
                            type="text"
                            readOnly={!isLaptop}
                            value={entry.roomNo}
                            onChange={(e) => editM(entry.id, 'roomNo', e.target.value)}
                            placeholder="Rm #"
                            className="bg-transparent font-black text-black w-full outline-none"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input 
                            type="text"
                            readOnly={!isLaptop}
                            value={entry.description}
                            onChange={(e) => editM(entry.id, 'description', e.target.value)}
                            placeholder="Wider description field..."
                            className="bg-transparent font-bold text-slate-800 w-full outline-none italic placeholder:text-slate-300"
                          />
                        </td>
                        <td className="px-4 py-4 text-center">
                          <select 
                            disabled={!isLaptop}
                            value={entry.method}
                            onChange={(e) => editM(entry.id, 'method', e.target.value as PaymentMethod)}
                            className={`bg-transparent font-black text-[9px] uppercase tracking-widest outline-none ${
                              entry.method === PaymentMethod.CASH ? 'text-blue-600' : 
                              entry.method === PaymentMethod.CARD ? 'text-amber-600' : 'text-purple-600'
                            }`}
                          >
                            {Object.values(PaymentMethod).map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <input 
                            type="number"
                            readOnly={!isLaptop}
                            value={entry.cashIn || ''}
                            onChange={(e) => editM(entry.id, 'cashIn', parseFloat(e.target.value) || 0)}
                            className="bg-transparent text-right font-black text-blue-700 w-full outline-none"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-4 text-right">
                          <input 
                            type="number"
                            readOnly={!isLaptop}
                            value={entry.cashOut || ''}
                            onChange={(e) => editM(entry.id, 'cashOut', parseFloat(e.target.value) || 0)}
                            className="bg-transparent text-right font-black text-red-600 w-full outline-none"
                            placeholder="0"
                          />
                        </td>
                        {isLaptop && (
                          <td className="px-4 py-4 last:rounded-r-2xl text-center">
                            <button onClick={() => delM(entry.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {isLaptop && (
                <button onClick={addM} className="w-full mt-6 py-6 bg-black text-white rounded-[2rem] font-black text-[10px] uppercase tracking-[0.4em] shadow-2xl shadow-slate-300 hover:scale-[1.01] transition-all flex items-center justify-center gap-4">
                  Add New Entry to Main Log
                </button>
              )}
            </SectionContainer>
          </div>
        </div>
      </main>

      <footer className="bg-slate-900 px-8 py-5 text-slate-500">
        <div className="max-w-[1700px] mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full animate-pulse shadow-lg ${isLaptop ? 'bg-emerald-500' : 'bg-blue-400'}`}></div>
            <span className="text-[10px] font-black uppercase tracking-[0.4em]">Cloud Relay: {device.toUpperCase()} MODE ACTIVE</span>
          </div>
          <div className="text-[9px] font-black uppercase tracking-widest italic opacity-40">Shivas Beach Cabanas Financial System v5.0</div>
        </div>
      </footer>

      {/* Record Archive Modal */}
      {showHistory && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-6xl rounded-[3rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="bg-slate-100 p-8 md:p-10 flex justify-between items-center border-b border-slate-200">
              <h3 className="text-2xl font-black text-black uppercase tracking-widest">Financial Records History</h3>
              <button onClick={() => setShowHistory(false)} className="p-4 hover:bg-white rounded-full transition-all text-slate-400 hover:text-black">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 md:p-12 space-y-6 scrollbar-thin">
              {history.length === 0 ? (
                <div className="py-24 text-center text-slate-300 font-black italic uppercase tracking-widest opacity-50">No archived records found.</div>
              ) : (
                history.map((record, i) => (
                  <div key={i} className="p-8 bg-slate-50 rounded-[2.5rem] border-2 border-slate-100 hover:border-blue-400 transition-all">
                    <div className="flex flex-wrap justify-between items-end gap-10">
                      <div>
                        <Label>Archive Date</Label>
                        <div className="text-3xl font-black text-black">{record.date}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-12">
                        <div>
                          <Label>Closing Balance</Label>
                          <div className="font-black text-emerald-700 text-3xl">Rs. {record.data.openingBalance.toLocaleString()}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
