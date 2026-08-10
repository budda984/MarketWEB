import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/insider?days=90&code=P&ticker=AAPL&minValue=100000
 *
 * Ritorna le transazioni e i "cluster": titoli su cui piu' insider
 * distinti hanno comprato a mercato nello stesso periodo. Un solo
 * dirigente che compra dice poco; tre nella stessa settimana dicono di piu'.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const days = Math.min(Number(url.searchParams.get('days') ?? 90), 365);
  const code = url.searchParams.get('code') ?? 'P';
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  const minValue = Number(url.searchParams.get('minValue') ?? 0);

  const since = new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 10);

  let q = supabase
    .from('insider_trades')
    .select('*')
    .gte('transaction_date', since)
    .eq('is_derivative', false)
    .order('transaction_date', { ascending: false })
    .limit(500);

  if (code !== 'ALL') q = q.eq('transaction_code', code);
  if (ticker) q = q.eq('ticker', ticker);
  if (minValue > 0) q = q.gte('value', minValue);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const trades = data ?? [];

  // Cluster: per ogni ticker conto gli insider distinti che hanno comprato
  type ClusterAcc = {
    ticker: string;
    issuerName: string | null;
    owners: Set<string>;
    totalValue: number;
    count: number;
    lastDate: string | null;
  };
  const byTicker = new Map<string, ClusterAcc>();

  for (const t of trades) {
    if (t.transaction_code !== 'P' || !t.ticker) continue;
    const acc = byTicker.get(t.ticker) ?? {
      ticker: t.ticker,
      issuerName: t.issuer_name,
      owners: new Set<string>(),
      totalValue: 0,
      count: 0,
      lastDate: null,
    };
    acc.owners.add(t.owner_name);
    acc.totalValue += Number(t.value ?? 0);
    acc.count += 1;
    if (!acc.lastDate || (t.transaction_date ?? '') > acc.lastDate) {
      acc.lastDate = t.transaction_date;
    }
    byTicker.set(t.ticker, acc);
  }

  const clusters = Array.from(byTicker.values())
    .map((c) => ({
      ticker: c.ticker,
      issuerName: c.issuerName,
      distinctOwners: c.owners.size,
      transactions: c.count,
      totalValue: c.totalValue,
      lastDate: c.lastDate,
    }))
    .filter((c) => c.distinctOwners >= 2)
    .sort(
      (a, b) => b.distinctOwners - a.distinctOwners || b.totalValue - a.totalValue
    );

  const { count: totalRows } = await supabase
    .from('insider_trades')
    .select('*', { count: 'exact', head: true });

  return NextResponse.json({ trades, clusters, totalRows: totalRows ?? 0 });
}
