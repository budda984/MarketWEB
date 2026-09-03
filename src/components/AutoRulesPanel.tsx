'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Target,
  Plus,
  Trash2,
  Play,
  Loader2,
  ExternalLink,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { MARKETS, type MarketKey } from '@/lib/tickers';

type Rule = {
  id: string;
  name: string | null;
  market: string;
  lookback_days: number;
  threshold_pct: number;
  rearm_pct: number;
  max_drop_30d_pct: number;
  active: boolean;
  notify_telegram: boolean;
};

type Hit = {
  id: string;
  rule_id: string;
  ticker: string;
  price: number;
  period_low: number;
  threshold: number;
  pct_above_low: number;
  drop_from_high_pct: number | null;
  triggered_at: string;
};

type Props = {
  onOpenTicker: (ticker: string) => void;
};

export default function AutoRulesPanel({ onOpenTicker }: Props) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // form
  const [market, setMarket] = useState<MarketKey>('Italia' as MarketKey);
  const [lookback, setLookback] = useState(126);
  const [thresholdPct, setThresholdPct] = useState(10);
  const [rearmPct, setRearmPct] = useState(18);
  const [maxDrop, setMaxDrop] = useState(25);
  const [notifyTg, setNotifyTg] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/auto-rules');
      const d = await r.json();
      if (d.error) setErr(d.error);
      else {
        setRules(d.rules ?? []);
        setHits(d.hits ?? []);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createRule() {
    setErr(null);
    if (rearmPct <= thresholdPct) {
      setErr('La soglia di riarmo deve essere maggiore di quella di ingresso.');
      return;
    }
    try {
      const r = await fetch('/api/auto-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market,
          lookback_days: lookback,
          threshold_pct: thresholdPct,
          rearm_pct: rearmPct,
          max_drop_30d_pct: maxDrop,
          notify_telegram: notifyTg,
        }),
      });
      const d = await r.json();
      if (d.error) setErr(d.error);
      else {
        setShowForm(false);
        await load();
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  async function toggle(rule: Rule) {
    await fetch('/api/auto-rules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rule.id, active: !rule.active }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm('Eliminare questa regola e i suoi scatti?')) return;
    await fetch(`/api/auto-rules?id=${id}`, { method: 'DELETE' });
    await load();
  }

  async function run() {
    setRunning(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch('/api/auto-rules/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const text = await r.text();
      const d = text ? JSON.parse(text) : {};
      if (d.error) {
        setErr(d.error);
        return;
      }
      const s = d.stats;
      setMsg(
        `${s.evaluated} titoli valutati · ${s.newHits} nuovi · ${s.cleared} riarmati` +
          (s.telegramSent ? ' · Telegram inviato' : '') +
          ` · ${(s.elapsedMs / 1000).toFixed(1)}s`
      );
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  }

  const hitsByRule = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = hitsByRule.get(h.rule_id) ?? [];
    list.push(h);
    hitsByRule.set(h.rule_id, list);
  }

  return (
    <div className="space-y-4">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-brand-green" />
            <span className="font-semibold">Regole automatiche</span>
            <span className="text-xs text-brand-muted">
              {rules.length} regole · {hits.length} titoli in fascia
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={run}
              disabled={running || rules.length === 0}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {running ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifico…
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5" /> Verifica ora
                </span>
              )}
            </button>
            <button
              onClick={() => setShowForm(!showForm)}
              className="btn-ghost text-xs"
            >
              {showForm ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {msg && <div className="text-xs text-brand-green">{msg}</div>}
        {err && <div className="text-xs text-brand-down">{err}</div>}

        {showForm && (
          <div className="border-t border-brand-border pt-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs space-y-1">
                <span className="text-brand-muted block">Mercato</span>
                <select
                  value={market}
                  onChange={(e) => setMarket(e.target.value as MarketKey)}
                  className="input text-xs py-1 w-full"
                >
                  {(Object.keys(MARKETS) as MarketKey[]).map((m) => (
                    <option key={m} value={m}>
                      {m} ({(MARKETS[m] as readonly string[]).length})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs space-y-1">
                <span className="text-brand-muted block">Finestra minimo</span>
                <select
                  value={lookback}
                  onChange={(e) => setLookback(Number(e.target.value))}
                  className="input text-xs py-1 w-full"
                >
                  <option value={63}>3 mesi</option>
                  <option value={126}>6 mesi</option>
                  <option value={189}>9 mesi</option>
                  <option value={252}>1 anno</option>
                </select>
              </label>
              <label className="text-xs space-y-1">
                <span className="text-brand-muted block">
                  Avvisa sotto minimo +{thresholdPct}%
                </span>
                <input
                  type="range"
                  min={2}
                  max={30}
                  value={thresholdPct}
                  onChange={(e) => setThresholdPct(Number(e.target.value))}
                  className="w-full"
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-brand-muted block">
                  Riarma sopra minimo +{rearmPct}%
                </span>
                <input
                  type="range"
                  min={5}
                  max={50}
                  value={rearmPct}
                  onChange={(e) => setRearmPct(Number(e.target.value))}
                  className="w-full"
                />
              </label>
              <label className="text-xs space-y-1 sm:col-span-2">
                <span className="text-brand-muted block">
                  Escludi chi ha perso più del {maxDrop}% in 30 giorni
                </span>
                <input
                  type="range"
                  min={10}
                  max={60}
                  value={maxDrop}
                  onChange={(e) => setMaxDrop(Number(e.target.value))}
                  className="w-full"
                />
              </label>
            </div>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={notifyTg}
                onChange={(e) => setNotifyTg(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              Notifica anche su Telegram
            </label>
            <button onClick={createRule} className="btn-primary text-xs w-full">
              Crea regola
            </button>
          </div>
        )}
      </div>

      {loading && rules.length === 0 && (
        <div className="card p-8 text-center text-brand-muted text-sm">
          Caricamento…
        </div>
      )}

      {!loading && rules.length === 0 && (
        <div className="card p-8 text-center space-y-2">
          <div className="text-4xl">🎯</div>
          <div className="text-sm text-brand-muted">
            Nessuna regola. Premi + per crearne una.
          </div>
        </div>
      )}

      {rules.map((rule) => {
        // Dal piu' recente al piu' vecchio: il valore di questi avvisi sta
        // nella tempestivita', quindi i nuovi vanno in cima. A parita' di
        // momento vince chi e' piu' vicino al minimo.
        const rHits = [...(hitsByRule.get(rule.id) ?? [])].sort((a, b) => {
          const byDate = b.triggered_at.localeCompare(a.triggered_at);
          if (byDate !== 0) return byDate;
          return a.pct_above_low - b.pct_above_low;
        });
        return (
          <div key={rule.id} className="card overflow-hidden">
            <div className="px-3 sm:px-4 py-2.5 bg-brand-panel/40 border-b border-brand-border flex items-center gap-2 flex-wrap">
              <label className="cursor-pointer flex items-center">
                <input
                  type="checkbox"
                  checked={rule.active}
                  onChange={() => toggle(rule)}
                  className="w-3.5 h-3.5"
                />
              </label>
              <span className="font-semibold text-sm">{rule.market}</span>
              <span className="text-xs text-brand-muted">
                minimo {lookbackLabel(rule.lookback_days)} +{rule.threshold_pct}%
                · riarmo +{rule.rearm_pct}%
              </span>
              {rule.notify_telegram && (
                <span className="tag bg-brand-panel text-brand-muted text-xs">
                  Telegram
                </span>
              )}
              <span className="flex-1" />
              <span className="text-xs text-brand-muted">
                {rHits.length} in fascia
              </span>
              <button
                onClick={() => remove(rule.id)}
                className="p-1 text-brand-muted hover:text-brand-down"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {rHits.length === 0 ? (
              <div className="p-4 text-center text-xs text-brand-muted">
                Nessun titolo attualmente nella fascia.
              </div>
            ) : (
              <div className="divide-y divide-brand-border">
                {rHits.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => onOpenTicker(h.ticker)}
                    className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-brand-card/40 transition text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-bold text-sm">{h.ticker}</span>
                        <span className="font-mono text-xs">
                          {Number(h.price).toFixed(2)}
                        </span>
                      </div>
                      <div className="text-xs text-brand-muted font-mono">
                        +{Number(h.pct_above_low).toFixed(1)}% dal minimo{' '}
                        {Number(h.period_low).toFixed(2)}
                        {h.drop_from_high_pct != null && (
                          <> · −{Number(h.drop_from_high_pct).toFixed(0)}% dal max</>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-brand-muted flex-shrink-0 text-right">
                      <div>
                        {new Date(h.triggered_at).toLocaleDateString('it-IT', {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </div>
                      <div className="text-brand-muted/70">
                        {new Date(h.triggered_at).toLocaleTimeString('it-IT', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Come funziona
        </div>
        <p>
          La soglia non è fissa: viene ricalcolata a ogni verifica sul minimo
          del periodo scelto. Quando un titolo entra nella fascia ricevi una
          notifica, poi resta in elenco senza ripetersi finché non risale
          sopra la soglia di riarmo.
        </p>
        <p>
          Il filtro sulla discesa recente serve a escludere i titoli in
          caduta: chi sta crollando è vicino al proprio minimo per
          definizione, ma è il minimo che insegue il prezzo, non un
          supporto che tiene.
        </p>
        <p>
          Un prezzo vicino ai minimi non è di per sé un&apos;occasione: può
          esserci una ragione precisa che il grafico non mostra.
        </p>
      </div>
    </div>
  );
}

function lookbackLabel(days: number): string {
  if (days <= 63) return '3 mesi';
  if (days <= 126) return '6 mesi';
  if (days <= 189) return '9 mesi';
  return '1 anno';
}
