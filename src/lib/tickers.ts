/**
 * Liste ticker estese — ~700 simboli dalla versione desktop.
 *
 * ATTENZIONE: Vercel serverless functions hanno maxDuration 60s.
 * Con 700 ticker in parallelo (concurrency 15) il cron impiega ~40-60s.
 * Se diventa troppo lento, il cron splitta per mercato (vedi /api/cron/scan).
 *
 * Ticker problematici rimossi dalla versione desktop:
 * NIB, STLA.MI, DFS, SQ, DG.PA (delistati o JSONDecodeError persistente).
 */

export const MARKETS = {
  'S&P 500': [
    // Mega cap tech
    'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA',
    // Large cap finanza
    'BRK-B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'C', 'AXP',
    'BLK', 'SCHW', 'USB', 'PNC', 'TFC', 'COF', 'BK', 'MET', 'AIG', 'PRU',
    'ALL', 'TRV', 'AFL', 'CB', 'PGR', 'HIG', 'CME', 'ICE', 'SPGI', 'MCO',
    'MSCI', 'NDAQ',
    // Healthcare
    'JNJ', 'UNH', 'LLY', 'ABBV', 'MRK', 'PFE', 'TMO', 'ABT', 'DHR', 'BMY',
    'AMGN', 'MDT', 'ELV', 'GILD', 'ISRG', 'CVS', 'HUM', 'CI', 'VRTX', 'REGN',
    'BSX', 'SYK', 'ZTS', 'BDX', 'EW', 'HCA', 'A', 'IQV', 'MCK', 'COR',
    // Consumer
    'WMT', 'PG', 'HD', 'COST', 'KO', 'PEP', 'MCD', 'NKE', 'DIS', 'LOW',
    'SBUX', 'TGT', 'CL', 'MDLZ', 'MO', 'PM', 'EL', 'KMB', 'GIS', 'K',
    'HSY', 'CLX', 'CHD', 'MKC', 'SJM', 'HRL', 'CAG', 'TAP', 'STZ', 'KHC',
    'TSN', 'ADM', 'KR',
    // Industriali
    'BA', 'CAT', 'HON', 'UPS', 'RTX', 'LMT', 'GE', 'MMM', 'DE', 'EMR',
    'ITW', 'ETN', 'PH', 'CMI', 'FDX', 'NOC', 'GD', 'CARR', 'ROK', 'OTIS',
    'TDG', 'WM', 'RSG', 'PCAR', 'CSX', 'UNP', 'NSC', 'LUV', 'DAL', 'UAL',
    // Energia
    'XOM', 'CVX', 'COP', 'EOG', 'PXD', 'MPC', 'PSX', 'VLO', 'OXY', 'WMB',
    'KMI', 'OKE', 'HES', 'DVN', 'FANG', 'HAL', 'SLB', 'BKR', 'APA', 'CTRA',
    // Utilities
    'NEE', 'DUK', 'SO', 'D', 'AEP', 'SRE', 'EXC', 'XEL', 'PCG', 'ED',
    'WEC', 'ES', 'AWK', 'PPL', 'AEE', 'CMS', 'DTE', 'ETR', 'FE', 'EIX',
    // Telecom/Media
    'T', 'VZ', 'CMCSA', 'TMUS', 'CHTR', 'NFLX', 'WBD', 'PARA',
    'EA', 'TTWO', 'OMC', 'IPG',
    // Real estate
    'PLD', 'AMT', 'EQIX', 'PSA', 'CCI', 'WELL', 'SPG', 'DLR', 'O', 'VICI',
    'EXR', 'AVB', 'EQR', 'ARE', 'INVH', 'ESS', 'MAA', 'UDR', 'CPT', 'BXP',
    // Materiali
    'LIN', 'APD', 'SHW', 'ECL', 'NEM', 'FCX', 'DOW', 'DD', 'NUE', 'VMC',
    'MLM', 'PPG', 'CTVA', 'LYB', 'CE', 'ALB', 'IFF', 'PKG', 'AVY', 'IP',
    // Tech aggiuntivi S&P
    'ORCL', 'ADBE', 'CRM', 'AMD', 'INTC', 'CSCO', 'QCOM', 'TXN', 'IBM', 'NOW',
    'INTU', 'ACN', 'PYPL', 'UBER', 'SHOP', 'ADI', 'MU', 'LRCX', 'KLAC', 'AMAT',
    'SNPS', 'CDNS', 'MRVL', 'PANW', 'FTNT', 'CRWD', 'ANET', 'WDAY', 'TEAM', 'DDOG',
    'NET', 'SNOW', 'ZS', 'OKTA', 'SPLK', 'DOCU', 'ZM', 'TWLO', 'ROKU', 'PINS',
    // Resto S&P rilevanti
    'BKNG', 'ABNB', 'MAR', 'HLT', 'MGM', 'LVS', 'CCL', 'RCL', 'NCLH', 'YUM',
    'CMG', 'DPZ', 'ORLY', 'AZO', 'GPC', 'ULTA', 'BBY', 'DG', 'DLTR', 'KSS',
    'M', 'JWN', 'TJX', 'ROST', 'LULU', 'CROX', 'DECK', 'RL', 'VFC', 'TPR',
    'CPRI', 'PVH', 'HAS', 'MAT', 'NWL',
  ],
  NASDAQ: [
    'AVGO', 'ASML', 'PEP', 'COST', 'CSCO', 'ADBE', 'NFLX', 'TMUS', 'AMD', 'CMCSA',
    'INTC', 'QCOM', 'TXN', 'AMGN', 'INTU', 'HON', 'AMAT', 'ISRG', 'BKNG', 'SBUX',
    'ADI', 'LRCX', 'MDLZ', 'GILD', 'REGN', 'VRTX', 'PANW', 'ADP', 'KLAC', 'CSX',
    'MELI', 'CDNS', 'SNPS', 'MU', 'MAR', 'ORLY', 'ABNB', 'CHTR', 'FTNT', 'MRVL',
    'PYPL', 'NXPI', 'CTAS', 'MNST', 'KDP', 'PCAR', 'WDAY', 'AEP', 'PAYX', 'ROST',
    'ODFL', 'FAST', 'KHC', 'MCHP', 'BIIB', 'EXC', 'EA', 'CSGP', 'CRWD', 'XEL',
    'IDXX', 'DXCM', 'CTSH', 'LULU', 'DDOG', 'GEHC', 'TEAM', 'ANSS', 'ON', 'CDW',
    'VRSK', 'ZS', 'ILMN', 'TTD', 'DLTR', 'SIRI', 'ALGN', 'SMCI', 'ARM', 'MDB',
    'OKTA', 'NET', 'SNOW', 'ROKU', 'HOOD', 'COIN', 'RIVN', 'LCID', 'PLTR', 'SOFI',
    'AFRM', 'UPST', 'DKNG', 'PENN', 'ETSY', 'W', 'CHWY', 'EBAY', 'PINS', 'SNAP',
    'SPOT', 'U', 'RBLX', 'DASH', 'HUBS',
  ],
  Crypto: [
    'BTC-USD', 'ETH-USD', 'BNB-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD',
    'AVAX-USD', 'DOT-USD', 'MATIC-USD', 'LINK-USD', 'TRX-USD', 'LTC-USD',
    'UNI7083-USD', 'ATOM-USD', 'ETC-USD', 'XLM-USD', 'NEAR-USD', 'FIL-USD',
    'ICP-USD', 'APT-USD', 'ARB-USD', 'HBAR-USD', 'VET-USD', 'ALGO-USD',
    'MANA-USD', 'SAND-USD', 'AXS-USD', 'GALA-USD', 'CHZ-USD',
    'AAVE-USD', 'MKR-USD', 'COMP-USD', 'SNX-USD', 'CRV-USD', 'YFI-USD',
    'SUSHI-USD', '1INCH-USD', 'LDO-USD', 'GRT-USD',
    'SHIB-USD', 'PEPE24478-USD', 'FLOKI-USD', 'BONK-USD',
    'RNDR-USD', 'FET-USD', 'INJ-USD', 'TIA-USD', 'SEI-USD', 'SUI20947-USD',
    'OP-USD', 'IMX10603-USD', 'STX-USD', 'KAS-USD', 'ORDI-USD',
    'EOS-USD', 'XTZ-USD', 'NEO-USD', 'QTUM-USD', 'ZEC-USD',
    'XMR-USD', 'BCH-USD', 'BSV-USD',
    'THETA-USD', 'KAVA-USD', 'ENJ-USD', 'BAT-USD', 'ZIL-USD', 'ICX-USD',
    'WAVES-USD', 'ONT-USD', 'ANKR-USD', 'CELO-USD',
    'RUNE-USD', 'KSM-USD', 'FTM-USD', 'EGLD-USD', 'FLOW-USD', 'ROSE-USD',
    'MINA-USD', 'HNT-USD', 'AR-USD', 'GMT-USD',
    'APE18876-USD', 'BLUR-USD', 'PYTH-USD', 'JTO-USD', 'WIF-USD',
    'DYDX-USD', 'GMX-USD', 'OSMO-USD',
    'CFX-USD', 'BTT-USD', 'JASMY-USD', 'LUNC-USD', 'LUNA-USD',
  ],
  Europa: [
    // Italia (Milano)
    'ENI.MI', 'ISP.MI', 'UCG.MI', 'ENEL.MI', 'STM.MI', 'TIT.MI', 'G.MI', 'RACE.MI',
    'MB.MI', 'LUX.MI', 'CNHI.MI', 'MONC.MI', 'PRY.MI', 'AMP.MI', 'A2A.MI',
    'AZM.MI', 'ATL.MI', 'BAMI.MI', 'BMED.MI', 'BMPS.MI', 'BPE.MI', 'BRE.MI',
    'BZU.MI', 'CPR.MI', 'CRL.MI', 'DAN.MI', 'DIA.MI', 'ERG.MI', 'FBK.MI',
    'HER.MI', 'IG.MI', 'IP.MI', 'IRE.MI', 'ITM.MI', 'JUVE.MI', 'LDO.MI',
    'NEXI.MI', 'PIRC.MI', 'PLT.MI', 'PST.MI', 'REC.MI', 'RWAY.MI',
    'SPM.MI', 'SRG.MI', 'STLAM.MI', 'TEN.MI', 'TRN.MI', 'UNI.MI',
    // Francia (Parigi)
    'SAN.PA', 'AIR.PA', 'MC.PA', 'OR.PA', 'BNP.PA', 'KER.PA', 'CAP.PA', 'SU.PA',
    'ORA.PA', 'RI.PA', 'ACA.PA', 'AI.PA', 'BN.PA', 'CA.PA', 'CS.PA',
    'EL.PA', 'EN.PA', 'ENGI.PA', 'GLE.PA', 'HO.PA', 'ML.PA', 'PUB.PA', 'RMS.PA',
    'RNO.PA', 'SAF.PA', 'SGO.PA', 'STLAP.PA', 'TEP.PA', 'TTE.PA', 'URW.PA',
    'VIE.PA', 'VIV.PA', 'WLN.PA',
    // Germania (Francoforte)
    'SAP.DE', 'SIE.DE', 'BAS.DE', 'ALV.DE', 'BMW.DE', 'VOW3.DE', 'DTE.DE', 'DBK.DE',
    'ADS.DE', 'IFX.DE', 'MRK.DE', 'LIN.DE', 'MUV2.DE', 'HEN3.DE', 'BEI.DE',
    'CON.DE', 'DB1.DE', 'DHL.DE', 'DTG.DE', 'EOAN.DE', 'FRE.DE', 'HEI.DE',
    'MBG.DE', 'P911.DE', 'PAH3.DE', 'PUM.DE', 'QIA.DE', 'RWE.DE', 'SHL.DE',
    'SY1.DE', 'VNA.DE', 'ZAL.DE',
    // Olanda (Amsterdam)
    'ASML.AS', 'ADYEN.AS', 'HEIA.AS', 'INGA.AS', 'PHIA.AS', 'AD.AS', 'UNA.AS',
    'PRX.AS', 'RAND.AS', 'DSM.AS', 'ABN.AS', 'AKZA.AS', 'KPN.AS', 'NN.AS',
    'REN.AS', 'WKL.AS',
    // UK (Londra)
    'ULVR.L', 'SHEL.L', 'HSBA.L', 'AZN.L', 'BP.L', 'GSK.L', 'RIO.L', 'DGE.L',
    'BHP.L', 'GLEN.L', 'VOD.L', 'LLOY.L', 'BARC.L', 'NWG.L', 'STAN.L', 'PRU.L',
    'LGEN.L', 'AV.L', 'REL.L', 'RKT.L', 'TSCO.L', 'BT-A.L', 'BATS.L', 'CRH.L',
    'CPG.L', 'EXPN.L', 'FLTR.L', 'IHG.L', 'LSEG.L', 'NG.L', 'SSE.L', 'SVT.L',
    'UU.L', 'WTB.L',
    // Spagna (Madrid)
    'ITX.MC', 'IBE.MC', 'SAN.MC', 'BBVA.MC', 'TEF.MC', 'REP.MC', 'FER.MC',
    'AMS.MC', 'ACS.MC', 'CLNX.MC', 'ELE.MC', 'ENG.MC', 'GRF.MC', 'MAP.MC',
    'MRL.MC', 'NTGY.MC', 'RED.MC', 'ROVI.MC', 'SAB.MC',
    // Svizzera (Zurich)
    'NESN.SW', 'ROG.SW', 'NOVN.SW', 'UBSG.SW', 'ZURN.SW', 'ABBN.SW', 'CFR.SW',
    'SGSN.SW', 'GIVN.SW', 'SIKA.SW', 'LONN.SW', 'GEBN.SW', 'HOLN.SW', 'KNIN.SW',
  ],
  Commodities: [
    // Metalli preziosi
    'GC=F', 'SI=F', 'PL=F', 'PA=F', 'HG=F',
    // Energia
    'CL=F', 'BZ=F', 'NG=F', 'HO=F', 'RB=F',
    // Agricoli
    'ZC=F', 'ZS=F', 'ZW=F', 'ZL=F', 'ZM=F', 'ZR=F', 'ZO=F',
    // Softs
    'KC=F', 'CC=F', 'SB=F', 'CT=F', 'OJ=F',
    // Carni
    'LE=F', 'HE=F', 'GF=F',
    // ETF commodities come proxy
    'GLD', 'SLV', 'USO', 'UNG', 'DBA', 'DBC', 'PDBC', 'GSG', 'CORN', 'WEAT',
    'SOYB', 'JO', 'CANE',
    // Gold miners e commodity ETF
    'GDX', 'GDXJ', 'SIL', 'SILJ', 'COPX', 'URA', 'LIT', 'REMX',
  ],
  ETF: [
    // US broad
    'SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO', 'IVV', 'VXF', 'VB',
    // International
    'VEA', 'VWO', 'EFA', 'EEM', 'IEFA', 'IEMG', 'ACWI', 'VXUS',
    // Sector SPDR
    'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLY', 'XLU', 'XLB', 'XLRE',
    'XLC', 'XHB', 'XRT', 'XME', 'XOP', 'XBI', 'XPH', 'XSD',
    // Thematic
    'ARKK', 'ARKG', 'ARKF', 'ARKQ', 'ARKW', 'SMH', 'SOXX', 'IGV', 'IYR',
    'JETS', 'TAN', 'ICLN', 'HACK', 'ROBO', 'BOTZ', 'ESPO', 'HERO',
    // Fixed income
    'AGG', 'BND', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'JNK', 'TIP', 'MUB',
    // Dividend/Value
    'VIG', 'VYM', 'SCHD', 'DVY', 'HDV', 'NOBL',
    // Country
    'EWJ', 'EWG', 'EWU', 'EWZ', 'EWW', 'EWC', 'EWA', 'EWH', 'MCHI', 'INDA',
    // Leveraged
    'TQQQ', 'SQQQ', 'SSO', 'SDS', 'UPRO', 'SPXU', 'UDOW',
    // Volatility
    'VXX', 'UVXY', 'SVXY',
  ],
} as const;

export type MarketKey = keyof typeof MARKETS;

export const ALL_TICKERS: string[] = Array.from(
  new Set(Object.values(MARKETS).flat())
);
