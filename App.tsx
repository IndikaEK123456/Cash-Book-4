
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  DeviceType, 
  PaymentMethod, 
  CashBookState, 
  OutPartyEntry, 
  MainEntry,
  HistoryRecord
} from './types';
import { COLORS, CURRENCY_SYMBOL } from './constants';
import * as syncService from './services/syncService';

// --- Reusable UI Elements ---

const Label = ({ children, className = "" }: { children?: React.ReactNode, className?: string }) => (
  <span className={`text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1 block ${className}`}>
    {children}
  </span>
);

// Changed children to optional to fix "Property 'children' is missing" errors
const SectionContainer = ({ title, children }: { title: string, children?: React.ReactNode }) => (
  <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden flex flex-col h-full">
    <div className="bg-slate-900 px-8 py-4 border-b border-slate-800">
      <h2 className="text-[11px] font-black text-white uppercase tracking-[0.4em]">{title}</h2>
    </div>
    <div className="p-8 flex-1 flex flex-col">
      {children}
    </div>
  </div>
);

// --- Main Component ---

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

  // 1. Core Device & Sync Setup
  useEffect(() => {
    const handleDeviceSetup = () => {
      const hash = window.location.hash.toLowerCase();
      const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
      
      if (hash.includes('android')) setDevice(DeviceType.ANDROID);
      else if (hash.includes('iphone')) setDevice(DeviceType.IPHONE);
      else if (isMobile) setDevice(DeviceType.ANDROID); // Security: Auto-switch to viewer on mobile UA
      else setDevice(DeviceType.LAPTOP);
    };

    handleDeviceSetup();
    window.addEventListener('hashchange', handleDeviceSetup);

    // Initial Live Reconnect
    const initial = syncService.getState();
    if (initial) setState(initial);
    setHistory(syncService.getHistory());

    // Live Listener
    syncService.onSyncUpdate((newState) => {
      setState(newState);
    });

    // Aggressive Reconnect Polling (Backup for device restart/browser close)
    const watchdog = setInterval(() => {
      const latest = syncService.getState();
      if (latest && JSON.stringify(latest) !== JSON.stringify(state)) {
        setState(latest);
      }
    }, 1000);

    // Live Rates (Simulation based on real API)
    const fetchRates = async () => {
      try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await res.json();
        const lkr = data.rates.LKR;
        const eurLkr = lkr / data.rates.EUR;
        setState(prev => ({
          ...prev,
          exchangeRates: {
            usd: Math.ceil(lkr), // Rule 12: Round up
            eur: Math.ceil(eurLkr) // Rule 12: Round up
          }
        }));
      } catch (e) { console.error("Rate fetch failed"); }
    };
    fetchRates();

    return () => {
      window.removeEventListener('hashchange', handleDeviceSetup);
      clearInterval(watchdog);
    };
  }, []);

  const isLaptop = device === DeviceType.LAPTOP;

  // Sync state to all devices
  const updateState = useCallback((newState: CashBookState) => {
    setState(newState);
    syncService.saveState(newState);
  }, []);

  // --- Calculations (Rules 7, 13, 14, 15, 16) ---

  const totals = useMemo(() => {
    // Out Party Totals
    const op = state.outPartyEntries.reduce((acc, curr) => {
      if (curr.method === PaymentMethod.CASH) acc.cash += curr.amount;
      if (curr.method === PaymentMethod.CARD) acc.card += curr.amount;
      if (curr.method === PaymentMethod.PAYPAL) acc.paypal += curr.amount;
      return acc;
    }, { cash: 0, card: 0, paypal: 0 });

    const opTotal = op.cash + op.card + op.paypal;

    // Main Section Basic Totals
    const mainCashIn = state.mainEntries.reduce((sum, e) => sum + e.cashIn, 0);
    const mainCashOut = state.mainEntries.reduce((sum, e) => sum + e.cashOut, 0);

    // Rule 14: Combine Card/Paypal from Out Party and Main Section
    const mainCard = state.mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((sum, e) => sum + e.cashIn, 0);
    const mainPaypal = state.mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((sum, e) => sum + e.cashIn, 0);
    
    const grandCardTotal = mainCard + op.card;
    const grandPaypalTotal = mainPaypal + op.paypal;

    // Rule 13: Final Cash In = Main entries + all Out Party entries
    const finalCashInTotal = mainCashIn + opTotal;

    // Rule 15: Final Cash Out = Main cash out entries + grand card total + grand paypal total
    const finalCashOutTotal = mainCashOut + grandCardTotal + grandPaypalTotal;

    // Rule 16: Final Balance
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
    updateState({ ...state, outPartyEntries: [...state.outPartyEntries, newEntry] });
  };

  const updateOutParty = (id: string, amount: number, method: PaymentMethod) => {
    if (!isLaptop) return;
    const entries = state.outPartyEntries.map(e => e.id === id ? { ...e, amount, method } : e);
    updateState({ ...state, outPartyEntries: entries });
  };

  const removeOutParty = (id: string) => {
    if (!isLaptop) return;
    const entries = state.outPartyEntries.filter(e => e.id !== id)
      .map((e, i) => ({ ...e, index: i + 1 }));
    updateState({ ...state, outPartyEntries: entries });
  };

  const addMainEntry = () => {
    if (!isLaptop) return;
    updateState({
      ...state,
      mainEntries: [...state.mainEntries, {
        id: crypto.randomUUID(),
        roomNo: '',
        description: '',
        method: PaymentMethod.CASH,
        cashIn: 0,
        cashOut: 0
      }]
    });
  };

  const updateMainEntry = (id: string, field: keyof MainEntry, value: any) => {
    if (!isLaptop) return;
    const entries = state.mainEntries.map(e => e.id === id ? { ...e, [field]: value } : e);
    updateState({ ...state, mainEntries: entries });
  };

  const removeMainEntry = (id: string) => {
    if (!isLaptop) return;
    updateState({ ...state, mainEntries: state.mainEntries.filter(e => e.id !== id) });
  };

  const handleDayEnd = () => {
    if (!isLaptop || !confirm("Run DAY END? Board will reset and today's summary will be archived.")) return;
    syncService.saveToHistory({ date: state.currentDate, data: state });
    const next = new Date();
    next.setDate(next.getDate() + 1);
    updateState({
      currentDate: next.toLocaleDateString('en-GB'),
      outPartyEntries: [],
      mainEntries: [],
      exchangeRates: state.exchangeRates,
      openingBalance: totals.finalBalance
    });
    setHistory(syncService.getHistory());
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 font-sans selection:bg-blue-100">
      
      {/* Header: Rules 9, 12 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-4 shadow-sm backdrop-blur-md bg-white/90">
        <div className="max-w-[1700px] mx-auto flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-100 ring-4 ring-blue-50">
              <span className="font-black text-xl">SB</span>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 uppercase">Shivas Beach Cabanas</h1>
              <p className="text-[11px] font-black text-slate-400 mt-1 uppercase tracking-[0.4em]">{state.currentDate}</p>
            </div>
          </div>

          <div className="flex items-center gap-10">
            <div className="flex gap-10 items-center">
              <div className="text-right">
                <Label>USD / LKR</Label>
                <div className="text-xl font-black text-slate-900">Rs. {state.exchangeRates.usd}</div>
              </div>
              <div className="text-right">
                <Label>EUR / LKR</Label>
                <div className="text-xl font-black text-slate-900">Rs. {state.exchangeRates.eur}</div>
              </div>
            </div>
            
            <div className="flex gap-3">
              <button onClick={() => setShowHistory(true)} className="px-5 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">Archive</button>
              {isLaptop && (
                <button onClick={handleDayEnd} className="px-5 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-red-100 transition-all">Day End</button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1700px] w-full mx-auto p-6 lg:p-10 space-y-10">
        
        {/* Highlight Totals: Rule 17 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-blue-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-blue-200 ring-8 ring-blue-50/50">
            <Label className="text-blue-200">Total Cash In</Label>
            <div className="text-5xl font-black tracking-tight">Rs. {totals.finalCashInTotal.toLocaleString()}</div>
          </div>
          <div className="bg-red-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-red-200 ring-8 ring-red-50/50">
            <Label className="text-red-200">Total Cash Out</Label>
            <div className="text-5xl font-black tracking-tight">Rs. {totals.finalCashOutTotal.toLocaleString()}</div>
          </div>
          <div className="bg-emerald-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-emerald-200 ring-8 ring-emerald-50/50">
            <Label className="text-emerald-100">Final Balance</Label>
            <div className="text-5xl font-black tracking-tight">Rs. {totals.finalBalance.toLocaleString()}</div>
          </div>
        </div>

        {/* Card/Paypal Subtotals: Rules 14, 15 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-amber-100 border-2 border-amber-200 p-8 rounded-[2rem] flex justify-between items-center shadow-sm">
             <span className="text-amber-900 font-black uppercase text-xs tracking-[0.2em]">Grand Card Total</span>
             <span className="text-amber-600 font-black text-4xl">Rs. {totals.grandCardTotal.toLocaleString()}</span>
          </div>
          <div className="bg-purple-100 border-2 border-purple-200 p-8 rounded-[2rem] flex justify-between items-center shadow-sm">
             <span className="text-purple-900 font-black uppercase text-xs tracking-[0.2em]">Grand PayPal Total</span>
             <span className="text-purple-600 font-black text-4xl">Rs. {totals.grandPaypalTotal.toLocaleString()}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
          
          {/* Out Party: Rules 5, 6, 8, 18, 19 */}
          <div className="xl:col-span-4">
            <SectionContainer title="Out Party List">
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-3 scrollbar-thin">
                {state.outPartyEntries.map((entry) => (
                  <div key={entry.id} className="group bg-slate-50 border-2 border-slate-100 rounded-2xl p-5 flex items-center gap-6 hover:border-blue-200 transition-all">
                    <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center text-xs font-black shadow-md">
                      {entry.index}
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-black text-slate-400">Rs.</span>
                        <input 
                          type="number"
                          readOnly={!isLaptop}
                          value={entry.amount || ''}
                          onChange={(e) => updateOutParty(entry.id, parseFloat(e.target.value) || 0, entry.method)}
                          className="bg-transparent text-xl font-black text-slate-900 w-full outline-none"
                          placeholder="0"
                        />
                      </div>
                      <select 
                        disabled={!isLaptop}
                        value={entry.method}
                        onChange={(e) => updateOutParty(entry.id, entry.amount, e.target.value as PaymentMethod)}
                        className={`bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-widest outline-none ${
                          entry.method === PaymentMethod.CASH ? 'text-blue-600' : 
                          entry.method === PaymentMethod.CARD ? 'text-amber-600' : 'text-purple-600'
                        }`}
                      >
                        {Object.values(PaymentMethod).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    {isLaptop && (
                      <button onClick={() => removeOutParty(entry.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {isLaptop && (
                <button onClick={addOutParty} className="w-full mt-6 py-5 border-2 border-dashed border-slate-300 rounded-2xl text-slate-400 font-black text-[10px] uppercase tracking-[0.3em] hover:bg-blue-50 hover:border-blue-500 hover:text-blue-500 transition-all flex items-center justify-center gap-3">
                   Add New Out Party
                </button>
              )}

              <div className="mt-8 pt-8 border-t border-slate-100 space-y-4">
                <div className="flex justify-between font-black items-center">
                   <Label>OP Cash Total</Label>
                   <span className="text-blue-700 text-lg">Rs. {totals.op.cash.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-black items-center">
                   <Label>OP Card Total</Label>
                   <span className="text-amber-600 text-lg">Rs. {totals.op.card.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-black items-center">
                   <Label>OP PayPal Total</Label>
                   <span className="text-purple-700 text-lg">Rs. {totals.op.paypal.toLocaleString()}</span>
                </div>
              </div>
            </SectionContainer>
          </div>

          {/* Main Section: Rules 10, 18, 19 */}
          <div className="xl:col-span-8">
            <SectionContainer title="Main Section Dashboard">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-slate-400 font-black text-[10px] uppercase tracking-[0.2em]">
                      <th className="px-4 py-2">Room</th>
                      <th className="px-4 py-2 min-w-[350px]">Description</th>
                      <th className="px-4 py-2 text-center">Payment</th>
                      <th className="px-4 py-2 text-right">Cash In</th>
                      <th className="px-4 py-2 text-right">Cash Out</th>
                      {isLaptop && <th className="px-4 py-2 w-10"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {state.mainEntries.map((entry) => (
                      <tr key={entry.id} className="group bg-slate-50/80 rounded-2xl border-2 border-transparent hover:border-blue-100 transition-all">
                        <td className="px-4 py-5 first:rounded-l-2xl">
                          <input 
                            type="text"
                            readOnly={!isLaptop}
                            value={entry.roomNo}
                            onChange={(e) => updateMainEntry(entry.id, 'roomNo', e.target.value)}
                            placeholder="Rm #"
                            className="bg-transparent font-black text-slate-900 w-full outline-none"
                          />
                        </td>
                        <td className="px-4 py-5">
                          <input 
                            type="text"
                            readOnly={!isLaptop}
                            value={entry.description}
                            onChange={(e) => updateMainEntry(entry.id, 'description', e.target.value)}
                            placeholder="Detailed description..."
                            className="bg-transparent font-bold text-slate-800 w-full outline-none italic placeholder:text-slate-300"
                          />
                        </td>
                        <td className="px-4 py-5 text-center">
                          <select 
                            disabled={!isLaptop}
                            value={entry.method}
                            onChange={(e) => updateMainEntry(entry.id, 'method', e.target.value as PaymentMethod)}
                            className={`bg-transparent font-black text-[10px] uppercase tracking-widest outline-none ${
                              entry.method === PaymentMethod.CASH ? 'text-blue-600' : 
                              entry.method === PaymentMethod.CARD ? 'text-amber-600' : 'text-purple-600'
                            }`}
                          >
                            {Object.values(PaymentMethod).map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-5 text-right">
                          <input 
                            type="number"
                            readOnly={!isLaptop}
                            value={entry.cashIn || ''}
                            onChange={(e) => updateMainEntry(entry.id, 'cashIn', parseFloat(e.target.value) || 0)}
                            className="bg-transparent text-right font-black text-blue-700 w-full outline-none"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-5 text-right">
                          <input 
                            type="number"
                            readOnly={!isLaptop}
                            value={entry.cashOut || ''}
                            onChange={(e) => updateMainEntry(entry.id, 'cashOut', parseFloat(e.target.value) || 0)}
                            className="bg-transparent text-right font-black text-red-600 w-full outline-none"
                            placeholder="0"
                          />
                        </td>
                        {isLaptop && (
                          <td className="px-4 py-5 last:rounded-r-2xl text-center">
                            <button onClick={() => removeMainEntry(entry.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
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
                <button onClick={addMainEntry} className="w-full mt-6 py-6 bg-slate-900 text-white rounded-[2rem] font-black text-[10px] uppercase tracking-[0.4em] shadow-2xl shadow-slate-200 hover:bg-slate-800 transition-all flex items-center justify-center gap-4">
                  Add New Main Entry
                </button>
              )}
            </SectionContainer>
          </div>
        </div>
      </main>

      {/* Footer: Live Indicator & Permissions */}
      <footer className="bg-slate-900 px-8 py-6 text-slate-500">
        <div className="max-w-[1700px] mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full animate-pulse shadow-lg ${isLaptop ? 'bg-emerald-500' : 'bg-blue-400'}`}></div>
            <span className="text-[10px] font-black uppercase tracking-[0.4em]">Live Connection: {device.toUpperCase()} MODE ACTIVE</span>
          </div>
          <div className="text-[9px] font-black uppercase tracking-widest italic opacity-40">Shivas Beach Cabanas Financial System v4.0.0</div>
        </div>
      </footer>

      {/* History Archive */}
      {showHistory && (
        <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-xl flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-5xl rounded-[3rem] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="bg-slate-100 p-10 flex justify-between items-center border-b border-slate-200">
              <h3 className="text-2xl font-black text-slate-900 uppercase tracking-widest">Financial Archives</h3>
              <button onClick={() => setShowHistory(false)} className="p-4 hover:bg-white rounded-full transition-all text-slate-400 hover:text-slate-900">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-12 space-y-6">
              {history.length === 0 ? (
                <div className="py-24 text-center text-slate-300 font-black italic uppercase tracking-widest opacity-50">No data found.</div>
              ) : (
                history.map((record, i) => (
                  <div key={i} className="p-10 bg-slate-50 rounded-[3rem] border-2 border-slate-100 hover:border-blue-400 transition-all">
                    <div className="flex flex-wrap justify-between items-end gap-10">
                      <div>
                        <Label>Archive Date</Label>
                        <div className="text-3xl font-black text-slate-900">{record.date}</div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-2 gap-12">
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
