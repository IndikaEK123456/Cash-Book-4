
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  DeviceType, 
  PaymentMethod, 
  CashBookState, 
  OutPartyEntry, 
  MainEntry,
  HistoryRecord
} from './types';
import * as syncService from './services/syncService';

// --- Constants ---
const CURRENCY_SYMBOL = 'Rs.';

// --- UI Components ---
const Label = ({ children, className = "" }: { children?: React.ReactNode, className?: string }) => (
  <span className={`text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1 block ${className}`}>
    {children}
  </span>
);

const SectionContainer = ({ title, children, isLaptop }: { title: string, children?: React.ReactNode, isLaptop: boolean }) => (
  <div className="bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden flex flex-col h-full transition-all hover:shadow-blue-100/30">
    <div className="bg-slate-900 px-8 py-5 flex justify-between items-center">
      <h2 className="text-[11px] font-black text-white uppercase tracking-[0.4em]">{title}</h2>
      {!isLaptop && <span className="bg-blue-500/20 text-blue-400 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">Viewer Only</span>}
    </div>
    <div className="p-6 md:p-8 flex-1 flex flex-col">
      {children}
    </div>
  </div>
);

// --- Main Application ---
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

  // 1. Device Detection & Auto-Sync
  useEffect(() => {
    const detectDevice = () => {
      const hash = window.location.hash.toLowerCase();
      const isMobileUA = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      
      if (hash.includes('android')) setDevice(DeviceType.ANDROID);
      else if (hash.includes('iphone')) setDevice(DeviceType.IPHONE);
      else if (isMobileUA) setDevice(DeviceType.ANDROID);
      else setDevice(DeviceType.LAPTOP);
    };

    detectDevice();
    window.addEventListener('hashchange', detectDevice);

    // Initial State Fetch (Reconnect)
    const saved = syncService.getState();
    if (saved) setState(saved);
    setHistory(syncService.getHistory());

    // Live Listeners for tab-to-tab or simulated device-to-device sync
    syncService.onSyncUpdate((newState) => {
      setState(newState);
    });

    // Watchdog timer for aggressive auto-reconnect/sync (Rule 3)
    const watchdog = setInterval(() => {
      const remote = syncService.getState();
      if (remote && JSON.stringify(remote) !== JSON.stringify(state)) {
        setState(remote);
      }
    }, 2000);

    // Fetch live rates (Rule 12)
    const fetchRates = async () => {
      try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await res.json();
        const lkr = data.rates.LKR;
        const eurLkr = lkr / data.rates.EUR;
        setState(prev => ({
          ...prev,
          exchangeRates: {
            usd: Math.ceil(lkr),
            eur: Math.ceil(eurLkr)
          }
        }));
      } catch (e) {
        console.warn("Rates fetch failed, using defaults");
      }
    };
    fetchRates();

    return () => {
      window.removeEventListener('hashchange', detectDevice);
      clearInterval(watchdog);
    };
  }, []);

  const isLaptop = device === DeviceType.LAPTOP;

  // Global update with sync broadcast
  const updateGlobalState = useCallback((newState: CashBookState) => {
    setState(newState);
    syncService.saveState(newState);
  }, []);

  // --- Financial Calculation Engine (Rules 7, 13, 14, 15, 16) ---
  const calc = useMemo(() => {
    // Out Party Sub-totals
    const op = state.outPartyEntries.reduce((acc, curr) => {
      if (curr.method === PaymentMethod.CASH) acc.cash += curr.amount;
      if (curr.method === PaymentMethod.CARD) acc.card += curr.amount;
      if (curr.method === PaymentMethod.PAYPAL) acc.paypal += curr.amount;
      return acc;
    }, { cash: 0, card: 0, paypal: 0 });

    const opTotal = op.cash + op.card + op.paypal;

    // Main Section Sub-totals
    const mainCashIn = state.mainEntries.reduce((sum, e) => sum + e.cashIn, 0);
    const mainCashOut = state.mainEntries.reduce((sum, e) => sum + e.cashOut, 0);
    
    // Main Section specific Payment Method totals
    const mainCard = state.mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((sum, e) => sum + e.cashIn, 0);
    const mainPaypal = state.mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((sum, e) => sum + e.cashIn, 0);

    // Combined Totals (Rule 14)
    const grandCardTotal = mainCard + op.card;
    const grandPaypalTotal = mainPaypal + op.paypal;

    // Final Cash In (Rule 13: includes all out party entries)
    const finalCashInTotal = mainCashIn + opTotal;

    // Final Cash Out (Rule 15: all card/paypal totals added to cash out)
    const finalCashOutTotal = mainCashOut + grandCardTotal + grandPaypalTotal;

    // Final Balance (Rule 16)
    const finalBalance = finalCashInTotal - finalCashOutTotal;

    return { op, grandCardTotal, grandPaypalTotal, finalCashInTotal, finalCashOutTotal, finalBalance };
  }, [state.outPartyEntries, state.mainEntries]);

  // --- Handlers ---
  const addOutParty = () => {
    if (!isLaptop) return;
    const newEntry: OutPartyEntry = {
      id: crypto.randomUUID(),
      index: state.outPartyEntries.length + 1,
      amount: 0,
      method: PaymentMethod.CASH
    };
    updateGlobalState({ ...state, outPartyEntries: [...state.outPartyEntries, newEntry] });
  };

  const editOutParty = (id: string, amount: number, method: PaymentMethod) => {
    if (!isLaptop) return;
    const entries = state.outPartyEntries.map(e => e.id === id ? { ...e, amount, method } : e);
    updateGlobalState({ ...state, outPartyEntries: entries });
  };

  const delOutParty = (id: string) => {
    if (!isLaptop) return;
    const entries = state.outPartyEntries.filter(e => e.id !== id).map((e, i) => ({ ...e, index: i + 1 }));
    updateGlobalState({ ...state, outPartyEntries: entries });
  };

  const addMain = () => {
    if (!isLaptop) return;
    const newEntry: MainEntry = {
      id: crypto.randomUUID(),
      roomNo: '',
      description: '',
      method: PaymentMethod.CASH,
      cashIn: 0,
      cashOut: 0
    };
    updateGlobalState({ ...state, mainEntries: [...state.mainEntries, newEntry] });
  };

  const editMain = (id: string, field: keyof MainEntry, value: any) => {
    if (!isLaptop) return;
    const entries = state.mainEntries.map(e => e.id === id ? { ...e, [field]: value } : e);
    updateGlobalState({ ...state, mainEntries: entries });
  };

  const delMain = (id: string) => {
    if (!isLaptop) return;
    updateGlobalState({ ...state, mainEntries: state.mainEntries.filter(e => e.id !== id) });
  };

  const handleDayEnd = () => {
    if (!isLaptop || !confirm("Run DAY END? Board will reset and state will be archived.")) return;
    syncService.saveToHistory({ date: state.currentDate, data: state });
    const next = new Date();
    next.setDate(next.getDate() + 1);
    updateGlobalState({
      currentDate: next.toLocaleDateString('en-GB'),
      outPartyEntries: [],
      mainEntries: [],
      exchangeRates: state.exchangeRates,
      openingBalance: calc.finalBalance
    });
    setHistory(syncService.getHistory());
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans selection:bg-blue-200">
      
      {/* Header (Rules 9, 12) */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-4 shadow-sm backdrop-blur-md bg-white/95">
        <div className="max-w-[1700px] mx-auto flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-slate-200 ring-4 ring-slate-100">
              <span className="font-black text-xl tracking-tighter">SB</span>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 uppercase">Shivas Beach Cabanas</h1>
              <p className="text-[11px] font-black text-slate-400 mt-0.5 uppercase tracking-[0.4em]">{state.currentDate}</p>
            </div>
          </div>

          <div className="flex items-center gap-10">
            <div className="hidden lg:flex gap-10">
              <div className="text-right">
                <Label>USD Rate</Label>
                <div className="text-xl font-black text-slate-900 leading-none">Rs. {state.exchangeRates.usd}</div>
              </div>
              <div className="text-right border-l border-slate-200 pl-10">
                <Label>EUR Rate</Label>
                <div className="text-xl font-black text-slate-900 leading-none">Rs. {state.exchangeRates.eur}</div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <button onClick={() => setShowHistory(true)} className="px-5 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all text-slate-700">Past Records</button>
              {isLaptop && (
                <button onClick={handleDayEnd} className="px-5 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-red-200 transition-all">Day End</button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1700px] w-full mx-auto p-4 md:p-10 space-y-10">
        
        {/* Main Highlight Totals (Rule 17) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-blue-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-blue-200 ring-8 ring-blue-50 relative overflow-hidden">
            <Label className="text-blue-200">Total Cash In</Label>
            <div className="text-5xl font-black tracking-tight z-10 relative">Rs. {calc.finalCashInTotal.toLocaleString()}</div>
            <div className="absolute -bottom-8 -right-8 opacity-10"><svg className="w-48 h-48" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg></div>
          </div>
          <div className="bg-red-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-red-200 ring-8 ring-red-50 relative overflow-hidden">
            <Label className="text-red-200">Total Cash Out</Label>
            <div className="text-5xl font-black tracking-tight z-10 relative">Rs. {calc.finalCashOutTotal.toLocaleString()}</div>
            <div className="absolute -bottom-8 -right-8 opacity-10 rotate-45"><svg className="w-48 h-48" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg></div>
          </div>
          <div className="bg-emerald-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-emerald-200 ring-8 ring-emerald-50 relative overflow-hidden">
            <Label className="text-emerald-100">Final Balance</Label>
            <div className="text-5xl font-black tracking-tight z-10 relative">Rs. {calc.finalBalance.toLocaleString()}</div>
            <div className="absolute -bottom-8 -right-8 opacity-10"><svg className="w-48 h-48" fill="currentColor" viewBox="0 0 24 24"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg></div>
          </div>
        </div>

        {/* Sub-totals Display (Rule 14) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-amber-100/50 border-2 border-amber-200 p-8 rounded-[2rem] flex justify-between items-center shadow-inner">
             <span className="text-amber-900 font-black uppercase text-xs tracking-[0.2em]">Grand Card Total</span>
             <span className="text-amber-600 font-black text-4xl">Rs. {calc.grandCardTotal.toLocaleString()}</span>
          </div>
          <div className="bg-purple-100/50 border-2 border-purple-200 p-8 rounded-[2rem] flex justify-between items-center shadow-inner">
             <span className="text-purple-900 font-black uppercase text-xs tracking-[0.2em]">Grand PayPal Total</span>
             <span className="text-purple-600 font-black text-4xl">Rs. {calc.grandPaypalTotal.toLocaleString()}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
          
          {/* Out Party Section (Rule 5, 6, 8, 18, 19) */}
          <div className="xl:col-span-4 flex flex-col gap-6">
            <SectionContainer title="Out Party Section" isLaptop={isLaptop}>
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-3 scrollbar-thin">
                {state.outPartyEntries.map((entry) => (
                  <div key={entry.id} className="group bg-slate-50 border-2 border-slate-100 rounded-2xl p-5 flex items-center gap-5 hover:border-blue-300 transition-all">
                    <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center text-xs font-black shadow-lg">
                      {entry.index}
                    </div>
                    <div className="flex-1 grid grid-cols-1 gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-400">Rs.</span>
                        <input 
                          type="number"
                          readOnly={!isLaptop}
                          value={entry.amount || ''}
                          onChange={(e) => editOutParty(entry.id, parseFloat(e.target.value) || 0, entry.method)}
                          className="bg-transparent text-xl font-black text-black w-full outline-none focus:text-blue-600"
                          placeholder="0"
                        />
                      </div>
                      <select 
                        disabled={!isLaptop}
                        value={entry.method}
                        onChange={(e) => editOutParty(entry.id, entry.amount, e.target.value as PaymentMethod)}
                        className={`bg-white border border-slate-200 rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest outline-none transition-colors ${
                          entry.method === PaymentMethod.CASH ? 'text-blue-600' : 
                          entry.method === PaymentMethod.CARD ? 'text-amber-600' : 'text-purple-600'
                        }`}
                      >
                        {Object.values(PaymentMethod).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    {isLaptop && (
                      <button onClick={() => delOutParty(entry.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {isLaptop && (
                <button onClick={addOutParty} className="w-full mt-6 py-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 font-black text-[10px] uppercase tracking-[0.3em] hover:bg-slate-50 hover:border-blue-500 hover:text-blue-500 transition-all flex items-center justify-center gap-3">
                   Add New Entry
                </button>
              )}

              <div className="mt-8 pt-8 border-t border-slate-100 space-y-4">
                <div className="flex justify-between font-black items-center">
                   <Label className="mb-0">Out Party Cash</Label>
                   <span className="text-blue-700 text-lg">Rs. {calc.op.cash.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-black items-center">
                   <Label className="mb-0">Out Party Card</Label>
                   <span className="text-amber-600 text-lg">Rs. {calc.op.card.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-black items-center">
                   <Label className="mb-0">Out Party PayPal</Label>
                   <span className="text-purple-700 text-lg">Rs. {calc.op.paypal.toLocaleString()}</span>
                </div>
              </div>
            </SectionContainer>
          </div>

          {/* Main Section (Rule 10, 18, 19) */}
          <div className="xl:col-span-8">
            <SectionContainer title="Main Section Entry Log" isLaptop={isLaptop}>
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
                            onChange={(e) => editMain(entry.id, 'roomNo', e.target.value)}
                            placeholder="Rm #"
                            className="bg-transparent font-black text-black w-full outline-none"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input 
                            type="text"
                            readOnly={!isLaptop}
                            value={entry.description}
                            onChange={(e) => editMain(entry.id, 'description', e.target.value)}
                            placeholder="Wider description field..."
                            className="bg-transparent font-bold text-slate-800 w-full outline-none italic placeholder:text-slate-300"
                          />
                        </td>
                        <td className="px-4 py-4 text-center">
                          <select 
                            disabled={!isLaptop}
                            value={entry.method}
                            onChange={(e) => editMain(entry.id, 'method', e.target.value as PaymentMethod)}
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
                            onChange={(e) => editMain(entry.id, 'cashIn', parseFloat(e.target.value) || 0)}
                            className="bg-transparent text-right font-black text-blue-700 w-full outline-none"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-4 text-right">
                          <input 
                            type="number"
                            readOnly={!isLaptop}
                            value={entry.cashOut || ''}
                            onChange={(e) => editMain(entry.id, 'cashOut', parseFloat(e.target.value) || 0)}
                            className="bg-transparent text-right font-black text-red-600 w-full outline-none"
                            placeholder="0"
                          />
                        </td>
                        {isLaptop && (
                          <td className="px-4 py-4 last:rounded-r-2xl text-center">
                            <button onClick={() => delMain(entry.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
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
                <button onClick={addMain} className="w-full mt-6 py-6 bg-slate-900 text-white rounded-[2rem] font-black text-[10px] uppercase tracking-[0.4em] shadow-2xl shadow-slate-300 hover:scale-[1.01] transition-all flex items-center justify-center gap-4">
                  Add New Main Section Entry
                </button>
              )}
            </SectionContainer>
          </div>
        </div>
      </main>

      {/* Footer (Rule 3) */}
      <footer className="bg-slate-900 px-8 py-5 text-slate-500">
        <div className="max-w-[1700px] mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full animate-pulse shadow-lg ${isLaptop ? 'bg-emerald-500' : 'bg-blue-400'}`}></div>
            <span className="text-[10px] font-black uppercase tracking-[0.4em]">Live Connection Active • {device.toUpperCase()} MODE</span>
          </div>
          <div className="text-[9px] font-black uppercase tracking-widest italic opacity-40">Shivas Beach Cabanas Management System v4.1</div>
        </div>
      </footer>

      {/* History Archive Modal */}
      {showHistory && (
        <div className="fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-2xl flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-6xl rounded-[3rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="bg-slate-100 p-8 md:p-10 flex justify-between items-center border-b border-slate-200">
              <h3 className="text-2xl font-black text-slate-900 uppercase tracking-widest">Financial Archives</h3>
              <button onClick={() => setShowHistory(false)} className="p-4 hover:bg-white rounded-full transition-all text-slate-400 hover:text-slate-900">
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
                        <div className="text-3xl font-black text-slate-900">{record.date}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-12">
                        <div>
                          <Label>Final Balance</Label>
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
