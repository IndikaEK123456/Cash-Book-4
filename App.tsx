
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

// --- UI Framework ---
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
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
          <span className="text-blue-400 text-[9px] font-black uppercase tracking-widest">Live Viewer</span>
        </div>
      )}
    </div>
    <div className="p-6 md:p-10 flex-1">{children}</div>
  </div>
);

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
  
  // Ref to track state for sync comparison
  const stateJsonRef = useRef(JSON.stringify(state));

  // Device and Connection Setup
  useEffect(() => {
    const handleDevice = () => {
      const hash = window.location.hash.toLowerCase();
      const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      if (hash.includes('android')) setDevice(DeviceType.ANDROID);
      else if (hash.includes('iphone')) setDevice(DeviceType.IPHONE);
      else if (isMobile) setDevice(DeviceType.ANDROID);
      else setDevice(DeviceType.LAPTOP);
    };

    handleDevice();
    window.addEventListener('hashchange', handleDevice);

    // Initial Fetch
    syncService.getState().then(s => { 
      if(s && s.outPartyEntries && s.mainEntries) {
        setState(s); 
        stateJsonRef.current = JSON.stringify(s);
      }
    });
    setHistory(syncService.getHistory());

    // Rule 3: AGGRESSIVE AUTO-RECONNECT SYNC (Every 1.2 seconds)
    const syncLoop = setInterval(async () => {
      const cloud = await syncService.getState();
      if (cloud && cloud.outPartyEntries && cloud.mainEntries) {
        const cloudJson = JSON.stringify(cloud);
        if (cloudJson !== stateJsonRef.current) {
          setState(cloud);
          stateJsonRef.current = cloudJson;
        }
      }
    }, 1200);

    // Rule 12: Exchange Rates
    const fetchRates = async () => {
      try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await res.json();
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
      window.removeEventListener('hashchange', handleDevice);
      clearInterval(syncLoop);
    };
  }, []);

  const isLaptop = device === DeviceType.LAPTOP;

  // Master update function (laptop only)
  const masterUpdate = useCallback((next: CashBookState) => {
    if (!isLaptop) return;
    setState(next);
    stateJsonRef.current = JSON.stringify(next);
    syncService.saveState(next);
  }, [isLaptop]);

  // --- Calculation Engine (Rules 13, 14, 15, 16) ---
  const totals = useMemo(() => {
    const outPartyEntries = state.outPartyEntries || [];
    const mainEntries = state.mainEntries || [];

    // Out Party Totals
    const op = outPartyEntries.reduce((acc, curr) => {
      const amt = curr.amount || 0;
      if (curr.method === PaymentMethod.CASH) acc.cash += amt;
      if (curr.method === PaymentMethod.CARD) acc.card += amt;
      if (curr.method === PaymentMethod.PAYPAL) acc.paypal += amt;
      return acc;
    }, { cash: 0, card: 0, paypal: 0 });

    const opTotal = op.cash + op.card + op.paypal;

    // Main Section Calculations
    const mainCashInTotal = mainEntries.reduce((sum, e) => sum + (e.cashIn || 0), 0);
    const mainCashOutTotal = mainEntries.reduce((sum, e) => sum + (e.cashOut || 0), 0);

    // Rule 14: Combine Card/PayPal from OP and Main
    const mainCard = mainEntries.filter(e => e.method === PaymentMethod.CARD).reduce((sum, e) => sum + (e.cashIn || 0), 0);
    const mainPaypal = mainEntries.filter(e => e.method === PaymentMethod.PAYPAL).reduce((sum, e) => sum + (e.cashIn || 0), 0);
    
    const grandCard = op.card + mainCard;
    const grandPaypal = op.paypal + mainPaypal;

    // Rule 13: Final Cash In
    const finalCashIn = mainCashInTotal + opTotal;

    // Rule 15: Final Cash Out (Base Cash Out + Grand Card + Grand PayPal)
    const finalCashOut = mainCashOutTotal + grandCard + grandPaypal;

    // Rule 16: Final Balance
    const finalBalance = finalCashIn - finalCashOut;

    return { op, grandCard, grandPaypal, finalCashIn, finalCashOut, finalBalance };
  }, [state]);

  // --- Master Handlers (Laptop Only) ---
  const addOP = () => {
    const outPartyEntries = state.outPartyEntries || [];
    masterUpdate({ ...state, outPartyEntries: [...outPartyEntries, { id: crypto.randomUUID(), index: outPartyEntries.length + 1, amount: 0, method: PaymentMethod.CASH }] });
  };
  
  const editOP = (id: string, field: keyof OutPartyEntry, val: any) => {
    const outPartyEntries = state.outPartyEntries || [];
    const next = outPartyEntries.map(e => e.id === id ? { ...e, [field]: val } : e);
    masterUpdate({ ...state, outPartyEntries: next });
  };

  const delOP = (id: string) => {
    const outPartyEntries = state.outPartyEntries || [];
    const next = outPartyEntries.filter(e => e.id !== id).map((e, i) => ({ ...e, index: i + 1 }));
    masterUpdate({ ...state, outPartyEntries: next });
  };

  const addM = () => {
    const mainEntries = state.mainEntries || [];
    masterUpdate({ ...state, mainEntries: [...mainEntries, { id: crypto.randomUUID(), roomNo: '', description: '', method: PaymentMethod.CASH, cashIn: 0, cashOut: 0 }] });
  };

  const editM = (id: string, field: keyof MainEntry, val: any) => {
    const mainEntries = state.mainEntries || [];
    const next = mainEntries.map(e => e.id === id ? { ...e, [field]: val } : e);
    masterUpdate({ ...state, mainEntries: next });
  };

  const delM = (id: string) => {
    const mainEntries = state.mainEntries || [];
    masterUpdate({ ...state, mainEntries: mainEntries.filter(e => e.id !== id) });
  };

  const doDayEnd = () => {
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
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-black">
      
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-5 shadow-sm">
        <div className="max-w-[1750px] mx-auto flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-black rounded-3xl flex items-center justify-center text-white shadow-2xl">
              <span className="font-black text-2xl tracking-tighter">SB</span>
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tighter uppercase">Shivas Beach Cabanas</h1>
              <p className="text-[11px] font-black text-slate-400 mt-0.5 uppercase tracking-[0.5em]">{state.currentDate}</p>
            </div>
          </div>

          <div className="flex items-center gap-12">
            <div className="flex gap-12 border-r border-slate-200 pr-12">
              <div className="text-right">
                <Label>USD Rate</Label>
                <div className="text-2xl font-black leading-none">Rs. {state.exchangeRates?.usd ?? 0}</div>
              </div>
              <div className="text-right">
                <Label>EUR Rate</Label>
                <div className="text-2xl font-black leading-none">Rs. {state.exchangeRates?.eur ?? 0}</div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowHistory(true)} className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all text-black">Records</button>
              {isLaptop && <button onClick={doDayEnd} className="px-6 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-red-100">Day End</button>}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1750px] w-full mx-auto p-4 md:p-10 space-y-10">
        
        {/* Highlight Totals */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-blue-600 rounded-[3rem] p-12 text-white shadow-2xl relative overflow-hidden">
            <Label className="text-blue-100">Total Cash In</Label>
            <div className="text-6xl font-black tracking-tighter">Rs. {(totals.finalIn ?? 0).toLocaleString()}</div>
          </div>
          <div className="bg-red-600 rounded-[3rem] p-12 text-white shadow-2xl relative overflow-hidden">
            <Label className="text-red-100">Total Cash Out</Label>
            <div className="text-6xl font-black tracking-tighter">Rs. {(totals.finalOut ?? 0).toLocaleString()}</div>
          </div>
          <div className="bg-emerald-600 rounded-[3rem] p-12 text-white shadow-2xl relative overflow-hidden">
            <Label className="text-emerald-100">Final Balance</Label>
            <div className="text-6xl font-black tracking-tighter">Rs. {(totals.finalBalance ?? 0).toLocaleString()}</div>
          </div>
        </div>

        {/* Card/PayPal Summaries */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          <div className="bg-amber-100 border-4 border-amber-200 p-10 rounded-[2.5rem] flex justify-between items-center">
            <span className="text-amber-900 font-black uppercase text-sm tracking-widest">Grand Card Total</span>
            <span className="text-amber-600 font-black text-5xl">Rs. {(totals.grandCard ?? 0).toLocaleString()}</span>
          </div>
          <div className="bg-purple-100 border-4 border-purple-200 p-10 rounded-[2.5rem] flex justify-between items-center">
            <span className="text-purple-900 font-black uppercase text-sm tracking-widest">Grand PayPal Total</span>
            <span className="text-purple-600 font-black text-5xl">Rs. {(totals.grandPaypal ?? 0).toLocaleString()}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
          
          {/* Out Party List */}
          <div className="xl:col-span-4">
            <Section title="Out Party Section" isLaptop={isLaptop}>
              <div className="space-y-4 max-h-[600px] overflow-y-auto no-scrollbar pr-2">
                {(state.outPartyEntries || []).map((e) => (
                  <div key={e.id} className="group bg-slate-50 border-2 border-slate-100 rounded-2xl p-6 flex items-center gap-6 hover:border-blue-400 transition-all">
                    <div className="w-12 h-12 bg-black text-white rounded-xl flex items-center justify-center text-sm font-black shadow-lg">{e.index}</div>
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
                        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {isLaptop && (
                <button onClick={addOP} className="w-full mt-8 py-5 border-2 border-dashed border-slate-300 rounded-3xl text-slate-400 font-black text-[11px] uppercase tracking-[0.4em] hover:bg-white hover:border-blue-500 hover:text-blue-500 transition-all">
                   Add Out Party Entry
                </button>
              )}
              <div className="mt-10 pt-10 border-t-2 border-slate-100 space-y-6">
                <div className="flex justify-between items-center"><Label className="m-0">OP Cash Total</Label><span className="text-blue-700 font-black text-xl">Rs. {(totals.op.cash ?? 0).toLocaleString()}</span></div>
                <div className="flex justify-between items-center"><Label className="m-0">OP Card Total</Label><span className="text-amber-600 font-black text-xl">Rs. {(totals.op.card ?? 0).toLocaleString()}</span></div>
                <div className="flex justify-between items-center"><Label className="m-0">OP PayPal Total</Label><span className="text-purple-700 font-black text-xl">Rs. {(totals.op.paypal ?? 0).toLocaleString()}</span></div>
              </div>
            </Section>
          </div>

          {/* Main Section Dashboard */}
          <div className="xl:col-span-8">
            <Section title="Main Section Dashboard" isLaptop={isLaptop}>
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
                      <tr key={e.id} className="group bg-slate-50/50 rounded-3xl">
                        <td className="px-6 py-6 first:rounded-l-[2rem]">
                          <input type="text" readOnly={!isLaptop} value={e.roomNo} onChange={(v) => editM(e.id, 'roomNo', v.target.value)} placeholder="Rm #" className="bg-transparent font-black text-black w-full outline-none" />
                        </td>
                        <td className="px-6 py-6">
                          <input type="text" readOnly={!isLaptop} value={e.description} onChange={(v) => editM(e.id, 'description', v.target.value)} placeholder="Wider description field..." className="bg-transparent font-bold text-slate-800 w-full outline-none italic" />
                        </td>
                        <td className="px-6 py-6 text-center">
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
                        <td className="px-6 py-6 text-right">
                          <input type="number" readOnly={!isLaptop} value={e.cashIn || ''} onChange={(v) => editM(e.id, 'cashIn', parseFloat(v.target.value) || 0)} className="bg-transparent text-right font-black text-blue-700 w-full outline-none" placeholder="0" />
                        </td>
                        <td className="px-6 py-6 text-right">
                          <input type="number" readOnly={!isLaptop} value={e.cashOut || ''} onChange={(v) => editM(e.id, 'cashOut', parseFloat(v.target.value) || 0)} className="bg-transparent text-right font-black text-red-600 w-full outline-none" placeholder="0" />
                        </td>
                        {isLaptop && (
                          <td className="px-6 py-6 last:rounded-r-[2rem] text-center">
                            <button onClick={() => delM(e.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isLaptop && (
                <button onClick={addM} className="w-full mt-10 py-7 bg-black text-white rounded-[2.5rem] font-black text-[12px] uppercase tracking-[0.5em] shadow-2xl hover:scale-[1.01] transition-all">
                  Add New Entry to Main Log
                </button>
              )}
            </Section>
          </div>
        </div>
      </main>

      <footer className="bg-slate-900 px-8 py-6 text-slate-500 border-t border-slate-800">
        <div className="max-w-[1750px] mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full animate-pulse shadow-lg ${isLaptop ? 'bg-emerald-500' : 'bg-blue-400'}`}></div>
            <span className="text-[11px] font-black uppercase tracking-[0.5em]">Sync Status: {device.toUpperCase()} CLOUD LINK SECURED</span>
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest italic opacity-30">Shivas Beach Cabanas Financial Suite v6.0 • Cross-Network Live Sync</div>
        </div>
      </footer>

      {showHistory && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-6xl rounded-[4rem] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="bg-slate-100 p-10 flex justify-between items-center border-b border-slate-200">
              <h3 className="text-3xl font-black text-black uppercase tracking-widest">Financial Archives</h3>
              <button onClick={() => setShowHistory(false)} className="p-4 hover:bg-white rounded-full transition-all text-slate-400 hover:text-black">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-12 space-y-8 scrollbar-thin text-black">
              {history.length === 0 ? (
                <div className="py-24 text-center text-slate-300 font-black italic uppercase tracking-widest opacity-40">No records found.</div>
              ) : (
                history.map((h, i) => (
                  <div key={i} className="p-12 bg-slate-50 rounded-[3.5rem] border-2 border-slate-100 hover:border-blue-500 transition-all flex justify-between items-end">
                    <div><Label>Archive Date</Label><div className="text-4xl font-black">{h.date}</div></div>
                    <div className="text-right"><Label>Closing Balance</Label><div className="text-4xl font-black text-emerald-700">Rs. {(h.data?.openingBalance ?? 0).toLocaleString()}</div></div>
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
