export type DbSignal = {
  id: string;
  user_id: string | null;
  ticker: string;
  strategy: string;
  strength: number;
  price: number;
  hma_value: number | null;
  distance_pct: number | null;
  crossed_bars_ago: number | null;
  change_pct: number | null;
  ha_bullish: boolean | null;
  details: string | null;
  signal_at: string;
  status: 'ACTIVE' | 'TP_HIT' | 'SL_HIT' | 'TIME_STOP' | 'CLOSED';
  entry_price: number | null;
  exit_price: number | null;
  exit_at: string | null;
  pnl_percent: number | null;
  market: string | null;
  pattern_data: unknown | null;
};

export type DbWatchlist = {
  id: string;
  user_id: string;
  name: string;
  tickers: string[];
  is_default: boolean;
};

export type DbAlert = {
  id: string;
  user_id: string;
  ticker: string;
  direction: 'above' | 'below';
  target_price: number;
  note: string | null;
  active: boolean;
  triggered_at: string | null;
};

export type DbBacktestResult = {
  id: string;
  user_id: string;
  name: string | null;
  strategy: string;
  params: Record<string, unknown>;
  universe: string[];
  date_from: string | null;
  date_to: string | null;
  total_trades: number | null;
  win_rate: number | null;
  total_pnl: number | null;
  max_drawdown: number | null;
  avg_bars_held: number | null;
  trades: unknown;
  equity: unknown;
  created_at: string;
};
