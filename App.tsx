
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

const CURRENCY = 'Rs.';

const Label = ({ children, className = "" }: { children?: React.ReactNode, className?: string }) => (
  <span className={`text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1.5 block ${className}`}>
    {children}
  </span>
);

const Section = ({ title, children, isLaptop }: { title: string, children?: React.ReactNode, isLaptop: boolean }) => (
  <div className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 flex flex-col h-full overflow-hidden">
    <div className="bg-slate-900 px-8 py-5 flex justify-between items-center">
      <h2 className="text-[11px] font-black text-white uppercase tracking-[0.4em]">{title}</h2>
      {!isLaptop && (
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></div>
          <span className="text-blue-400 text-[10px] font-black uppercase tracking-widest">LIVE VIEWING</span>
        </div>
      )}
    </div>
    <div className="p-6 md:p-10 flex-1">{children}</div>
  </div>
);

export default function App() {
  const [device, setDevice] = useState<DeviceType>(DeviceType.LAPTOP);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error'>('synced');
  const [state, setState] = useState<CashBookState>({
    currentDate: new Date().toLocaleDateString('en-GB'),
    outPartyEntries: [],
    mainEntries: [],
    exchangeRates: { usd: 310, eur: 366 },
    openingBalance: 0
  });
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  
  // High-performance refs to manage sync without re-render loops
  const stateJsonRef = useRef(JSON.stringify(state));
  const isSyncingRef = useRef(false);

  // 1. Detect Device & Start Live Bridge
  useEffect(() => {
    const initDevice = () => {
      const hash = window.location.hash.toLowerCase();
      const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      if (hash.includes('android')) setDevice(DeviceType.ANDROID);
      else if (hash.includes('iphone')) setDevice(DeviceType.IPHONE);
      else if (isMobile) setDevice(DeviceType.ANDROID);
      else setDevice(DeviceType.LAPTOP);
    };
    initDevice();
    window.addEventListener('hashchange', initDevice);

    // Initial load
    syncService.getState().then(s => {
      if (s) {
        setState(s);
        stateJsonRef.current = JSON.stringify(s);
      }
    });
    setHistory(syncService.getHistory());

    // 2. High-Frequency Polling (Rule 3)
    // We check for updates every 1 second. This ensures "instant" connection.
    const pollTimer = setInterval(async () => {
      // Don't pull while we are pushing (laptop logic)
      if (isSyncingRef.current) return;

      const cloud = await syncService.getState();
      if (cloud) {
        const cloudJson = JSON.stringify(cloud);
        if (cloudJson !== stateJsonRef.current) {
          setState(cloud);
          stateJsonRef.current = cloudJson;
          setSyncStatus('synced');
        }
      }
    }, 1000);

    // 3. Exchange Rates (Rule 12)
    const fetchRates = async () => {
      try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await res.json();
        // Rule 12: Round UP and no decimals
        const usd = Math.ceil(data.rates.LKR);
        const eur = Math.ceil(data.rates.LKR / data.rates.EUR);
        setState(prev => {
          const next = { ...prev, exchangeRates: { usd, eur } };
          stateJsonRef.current = JSON.stringify(next);
          return next;
        });
      } catch (e) {}
    };
    fetchRates();

    return () => {
      window.removeEventListener('hashchange', initDevice);
      clearInterval(pollTimer);
    };
  }, []);

  const isLaptop = device === DeviceType.LAPTOP;

  // Master Push Function
  const pushToCloud = useCallback(async (next: CashBookState) => {
    if (!isLaptop) return;
    
    setSyncStatus('syncing');
    isSyncingRef.current = true;
    
    const success = await syncService.saveState(next);
    
    setSyncStatus(success ? 'synced' : 'error');
    isSyncingRef.current = false;
  }, [isLaptop]);

  // Master update handler
  const masterUpdate = useCallback((next: CashBookState) => {
    setState(next);
    stateJsonRef.current = JSON.stringify(next);
    pushToCloud(next);
  }, [pushToCloud]);

  // --- Financial Logic (Rules 7, 13, 14, 15, 16) ---
  const totals = useMemo(() => {
    const opEntries = state.outPartyEntries || [];
    const mainEntries = state.mainEntries || [];

    // Out Party Section
    const op = opEntries.reduce((acc, curr) => {
      const amt = Number(curr.amount) || 0;
      if (curr.method === PaymentMethod.CASH) acc.cash += amt;
      if (curr.method === PaymentMethod.CARD) acc.card += amt;
      if (curr.method === PaymentMethod.PAYPAL) acc.paypal += amt;
      return acc;
    }, { cash: 0, card: 0, paypal: 0 });

    const opTotal = op.cash + op.card + op.paypal;

    // Main Section
    const mIn = mainEntries.reduce((sum, e) => sum + (Number(e.cashIn) || 0), 0);
    const mOut = mainEntries.reduce((sum, e) => sum + (Number(e.cashOut) || 0), 0);

    // Grand Totals for Card & PayPal (Rule 14)
    const mCard = mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((sum, e) => sum + (Number(e.cashIn) || 0), 0);
    const mPaypal = mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((sum, e) => sum + (Number(e.cashIn) || 0), 0);
    
    const grandCard = op.card + mCard;
    const grandPaypal = op.paypal + mPaypal;

    // Final Cash In (Rule 13)
    const finalIn = mIn + opTotal;

    // Final Cash Out (Rule 15: Add card/paypal totals to cash out)
    const finalOut = mOut + grandCard + grandPaypal;

    // Balance (Rule 16)
    const finalBalance = finalIn - finalOut;

    return { op, grandCard, grandPaypal, finalIn, finalOut, finalBalance };
  }, [state]);

  // --- Handlers (Laptop Only) ---
  const addOP = () => {
    const current = state.outPartyEntries || [];
    masterUpdate({ ...state, outPartyEntries: [...current, { id: crypto.randomUUID(), index: current.length + 1, amount: 0, method: PaymentMethod.CASH }] });
  };
  
  const editOP = (id: string, field: keyof OutPartyEntry, val: any) => {
    masterUpdate({ ...state, outPartyEntries: (state.outPartyEntries || []).map(e => e.id === id ? { ...e, [field]: val } : e) });
  };

  const delOP = (id: string) => {
    masterUpdate({ ...state, outPartyEntries: (state.outPartyEntries || []).filter(e => e.id !== id).map((e, i) => ({ ...e, index: i + 1 })) });
  };

  const addM = () => {
    const current = state.mainEntries || [];
    masterUpdate({ ...state, mainEntries: [...current, { id: crypto.randomUUID(), roomNo: '', description: '', method: PaymentMethod.CASH, cashIn: 0, cashOut: 0 }] });
  };

  const editM = (id: string, field: keyof MainEntry, val: any) => {
    masterUpdate({ ...state, mainEntries: (state.mainEntries || []).map(e => e.id === id ? { ...e, [field]: val } : e) });
  };

  const delM = (id: string) => masterUpdate({ ...state, mainEntries: (state.mainEntries || []).filter(e => e.id !== id) });

  const runDayEnd = () => {
    if (!confirm("DAY END: Archive data and reset for tomorrow?")) return;
    syncService.saveToHistory({ date: state.currentDate, data: state });
    const d = new Date(); d.setDate(d.getDate() + 1);
    masterUpdate({
      currentDate: d.toLocaleDateString('en-GB'),
      outPartyEntries: [],
      mainEntries: [],
      exchangeRates: state.exchangeRates,
      openingBalance: totals.finalBalance
    });
    setHistory(syncService.getHistory());
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-black">
      
      {/* Top Professional Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-4 shadow-sm backdrop-blur-md bg-white/90">
        <div className="max-w-[1800px] mx-auto flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-black rounded-[1.5rem] flex items-center justify-center text-white shadow-2xl">
              <span className="font-black text-2xl tracking-tighter">SB</span>
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tighter uppercase leading-none">Shivas Beach Cabanas</h1>
              <p className="text-[11px] font-black text-slate-400 mt-1 uppercase tracking-[0.5em]">{state.currentDate}</p>
            </div>
          </div>

          <div className="flex items-center gap-10">
            <div className="flex gap-10 border-r border-slate-200 pr-10">
              <div className="text-right">
                <Label>USD / LKR</Label>
                <div className="text-2xl font-black">Rs. {state.exchangeRates?.usd || 0}</div>
              </div>
              <div className="text-right">
                <Label>EUR / LKR</Label>
                <div className="text-2xl font-black">Rs. {state.exchangeRates?.eur || 0}</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center">
                <div className={`w-3.5 h-3.5 rounded-full ${syncStatus === 'syncing' ? 'bg-blue-500 animate-ping' : syncStatus === 'error' ? 'bg-red-600' : 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]'}`}></div>
                <span className="text-[8px] font-black uppercase text-slate-400 mt-1">Status</span>
              </div>
              <button onClick={() => setShowHistory(true)} className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 rounded-2xl text-[10px] font-black uppercase tracking-widest text-black">Archives</button>
              {isLaptop && <button onClick={runDayEnd} className="px-6 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-red-100">Day End</button>}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1800px] w-full mx-auto p-4 md:p-10 space-y-10">
        
        {/* Highlighted Totals (Rule 17) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-blue-600 rounded-[3.5rem] p-12 text-white shadow-2xl ring-8 ring-blue-50">
            <Label className="text-blue-100">Total Cash In</Label>
            <div className="text-6xl font-black tracking-tighter">Rs. {(totals.finalIn || 0).toLocaleString()}</div>
          </div>
          <div className="bg-red-600 rounded-[3.5rem] p-12 text-white shadow-2xl ring-8 ring-red-50">
            <Label className="text-red-100">Total Cash Out</Label>
            <div className="text-6xl font-black tracking-tighter">Rs. {(totals.finalOut || 0).toLocaleString()}</div>
          </div>
          <div className="bg-emerald-600 rounded-[3.5rem] p-12 text-white shadow-2xl ring-8 ring-emerald-50">
            <Label className="text-emerald-100">Final Balance</Label>
            <div className="text-6xl font-black tracking-tighter">Rs. {(totals.finalBalance || 0).toLocaleString()}</div>
          </div>
        </div>

        {/* Payment Summaries (Rule 14) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          <div className="bg-amber-100 border-4 border-amber-200 p-10 rounded-[3rem] flex justify-between items-center shadow-inner">
            <span className="text-amber-900 font-black uppercase text-sm tracking-widest">Grand Card Total</span>
            <span className="text-amber-600 font-black text-5xl">Rs. {(totals.grandCard || 0).toLocaleString()}</span>
          </div>
          <div className="bg-purple-100 border-4 border-purple-200 p-10 rounded-[3rem] flex justify-between items-center shadow-inner">
            <span className="text-purple-900 font-black uppercase text-sm tracking-widest">Grand PayPal Total</span>
            <span className="text-purple-600 font-black text-5xl">Rs. {(totals.grandPaypal || 0).toLocaleString()}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
          
          {/* Out Party Section (Rule 5, 6, 8, 18, 19) */}
          <div className="xl:col-span-4">
            <Section title="Out Party Section" isLaptop={isLaptop}>
              <div className="space-y-4 max-h-[600px] overflow-y-auto no-scrollbar pr-2">
                {(state.outPartyEntries || []).map((e) => (
                  <div key={e.id} className="group bg-slate-50 border-2 border-slate-100 rounded-3xl p-6 flex items-center gap-6 hover:border-blue-400 transition-all">
                    <div className="w-12 h-12 bg-black text-white rounded-2xl flex items-center justify-center text-sm font-black shadow-lg">{e.index}</div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-400">Rs.</span>
                        <input 
                          type="number"
                          readOnly={!isLaptop}
                          value={e.amount || ''}
                          onChange={(v) => editOP(e.id, 'amount', parseFloat(v.target.value) || 0)}
                          className="bg-transparent text-2xl font-black text-black w-full outline-none"
                          placeholder="0"
                        />
                      </div>
                      <select 
                        disabled={!isLaptop}
                        value={e.method}
                        onChange={(v) => editOP(e.id, 'method', v.target.value as PaymentMethod)}
                        className={`bg-white border-2 border-slate-200 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest outline-none ${
                          e.method === PaymentMethod.CASH ? 'text-blue-600' : e.method === PaymentMethod.CARD ? 'text-amber-600' : 'text-purple-600'
                        }`}
                      >
                        {Object.values(PaymentMethod).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    {isLaptop && (
                      <button onClick={() => delOP(e.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {isLaptop && (
                <button onClick={addOP} className="w-full mt-8 py-5 border-4 border-dashed border-slate-200 rounded-[2.5rem] text-slate-400 font-black text-[11px] uppercase tracking-[0.5em] hover:bg-white hover:border-blue-500 hover:text-blue-500 transition-all">
                   Add New Out Party Entry
                </button>
              )}
              <div className="mt-10 pt-10 border-t-2 border-slate-100 space-y-6">
                <div className="flex justify-between items-center"><Label className="m-0">OP Cash Total</Label><span className="text-blue-700 font-black text-2xl">Rs. {(totals.op.cash || 0).toLocaleString()}</span></div>
                <div className="flex justify-between items-center"><Label className="m-0">OP Card Total</Label><span className="text-amber-600 font-black text-2xl">Rs. {(totals.op.card || 0).toLocaleString()}</span></div>
                <div className="flex justify-between items-center"><Label className="m-0">OP PayPal Total</Label><span className="text-purple-700 font-black text-2xl">Rs. {(totals.op.paypal || 0).toLocaleString()}</span></div>
              </div>
            </Section>
          </div>

          {/* Main Section (Rule 10, 18, 19) */}
          <div className="xl:col-span-8">
            <Section title="Main Section Database" isLaptop={isLaptop}>
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-left border-separate border-spacing-y-4">
                  <thead>
                    <tr className="text-slate-400 font-black text-[10px] uppercase tracking-widest">
                      <th className="px-6 py-2">Room</th>
                      <th className="px-6 py-2 min-w-[350px]">Description</th>
                      <th className="px-6 py-2 text-center">Method</th>
                      <th className="px-6 py-2 text-right">Cash In</th>
                      <th className="px-6 py-2 text-right">Cash Out</th>
                      {isLaptop && <th className="px-6 py-2 w-10"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(state.mainEntries || []).map((e) => (
                      <tr key={e.id} className="group bg-slate-50/50 rounded-[2rem]">
                        <td className="px-6 py-8 first:rounded-l-[2.5rem]">
                          <input type="text" readOnly={!isLaptop} value={e.roomNo} onChange={(v) => editM(e.id, 'roomNo', v.target.value)} placeholder="Rm #" className="bg-transparent font-black text-black w-full outline-none" />
                        </td>
                        <td className="px-6 py-8">
                          <input type="text" readOnly={!isLaptop} value={e.description} onChange={(v) => editM(e.id, 'description', v.target.value)} placeholder="Detailed transaction description..." className="bg-transparent font-bold text-slate-800 w-full outline-none italic placeholder:text-slate-300" />
                        </td>
                        <td className="px-6 py-8 text-center">
                          <select 
                            disabled={!isLaptop}
                            value={e.method}
                            onChange={(v) => editM(e.id, 'method', v.target.value as PaymentMethod)}
                            className={`bg-transparent font-black text-[10px] uppercase tracking-widest outline-none ${
                              e.method === PaymentMethod.CASH ? 'text-blue-600' : e.method === PaymentMethod.CARD ? 'text-amber-600' : 'text-purple-600'
                            }`}
                          >
                            {Object.values(PaymentMethod).map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </td>
                        <td className="px-6 py-8 text-right">
                          <input type="number" readOnly={!isLaptop} value={e.cashIn || ''} onChange={(v) => editM(e.id, 'cashIn', parseFloat(v.target.value) || 0)} className="bg-transparent text-right font-black text-blue-700 w-full outline-none" placeholder="0" />
                        </td>
                        <td className="px-6 py-8 text-right">
                          <input type="number" readOnly={!isLaptop} value={e.cashOut || ''} onChange={(v) => editM(e.id, 'cashOut', parseFloat(v.target.value) || 0)} className="bg-transparent text-right font-black text-red-600 w-full outline-none" placeholder="0" />
                        </td>
                        {isLaptop && (
                          <td className="px-6 py-8 last:rounded-r-[2.5rem] text-center">
                            <button onClick={() => delM(e.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isLaptop && (
                <button onClick={addM} className="w-full mt-10 py-8 bg-black text-white rounded-[3rem] font-black text-[13px] uppercase tracking-[0.5em] shadow-2xl hover:scale-[1.01] transition-all">
                  Add New Transaction Log Entry
                </button>
              )}
            </Section>
          </div>
        </div>
      </main>

      {/* Sync Status Overlay (Rule 3) */}
      <footer className="bg-slate-900 px-8 py-6 text-slate-500 border-t border-slate-800">
        <div className="max-w-[1800px] mx-auto flex justify-between items-center">
          <div className="flex items-center gap-5">
            <div className={`w-3.5 h-3.5 rounded-full ${isLaptop ? 'bg-emerald-500' : 'bg-blue-400 shadow-[0_0_15px_rgba(96,165,250,0.6)] animate-pulse'}`}></div>
            <span className="text-[12px] font-black uppercase tracking-[0.5em]">Mode: {device.toUpperCase()} • Cloud Bridge: STABLE</span>
          </div>
          <div className="text-[11px] font-black uppercase tracking-widest italic opacity-20">Shivas Beach Cabanas Financial Engine v8.0 • Live Relay System</div>
        </div>
      </footer>

      {showHistory && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-6xl rounded-[4rem] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="bg-slate-100 p-12 flex justify-between items-center border-b border-slate-200">
              <h3 className="text-4xl font-black text-black uppercase tracking-widest">Financial Records History</h3>
              <button onClick={() => setShowHistory(false)} className="p-5 hover:bg-white rounded-full transition-all text-slate-400 hover:text-black">
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-12 space-y-8 scrollbar-thin text-black">
              {history.length === 0 ? (
                <div className="py-24 text-center text-slate-300 font-black italic uppercase tracking-widest opacity-40 text-2xl">No archived records found.</div>
              ) : (
                history.map((h, i) => (
                  <div key={i} className="p-16 bg-slate-50 rounded-[4rem] border-2 border-slate-100 hover:border-blue-500 transition-all flex justify-between items-end">
                    <div><Label>Archive Date</Label><div className="text-5xl font-black">{h.date}</div></div>
                    <div className="text-right"><Label>Closing Balance</Label><div className="text-5xl font-black text-emerald-700">Rs. {(h.data?.openingBalance || 0).toLocaleString()}</div></div>
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
