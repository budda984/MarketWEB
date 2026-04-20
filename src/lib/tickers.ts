/**
 * Liste ticker organizzate per mercato.
 *
 * Totale ~1000 ticker. Vercel serverless function maxDuration 60s,
 * ma il cron splitta per mercato quindi ogni batch è veloce (3-8s).
 *
 * Yahoo Finance suffix per borse europee:
 *  .ST = Stoccolma    .CO = Copenhagen    .OL = Oslo
 *  .HE = Helsinki     .VI = Vienna        .BR = Bruxelles
 *  .LS = Lisbona      .WA = Varsavia      .IS = Istanbul
 *  .AT = Atene        .MI = Milano        .PA = Parigi
 *  .DE = Francoforte  .AS = Amsterdam     .L = Londra
 *  .MC = Madrid       .SW = Zurigo
 */

export const MARKETS = {
  'S&P 500': [
    'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA',
    'BRK-B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'C', 'AXP',
    'BLK', 'SCHW', 'USB', 'PNC', 'TFC', 'COF', 'BK', 'MET', 'AIG', 'PRU',
    'ALL', 'TRV', 'AFL', 'CB', 'PGR', 'HIG', 'CME', 'ICE', 'SPGI', 'MCO',
    'MSCI', 'NDAQ',
    'JNJ', 'UNH', 'LLY', 'ABBV', 'MRK', 'PFE', 'TMO', 'ABT', 'DHR', 'BMY',
    'AMGN', 'MDT', 'ELV', 'GILD', 'ISRG', 'CVS', 'HUM', 'CI', 'VRTX', 'REGN',
    'BSX', 'SYK', 'ZTS', 'BDX', 'EW', 'HCA', 'A', 'IQV', 'MCK', 'COR',
    'WMT', 'PG', 'HD', 'COST', 'KO', 'PEP', 'MCD', 'NKE', 'DIS', 'LOW',
    'SBUX', 'TGT', 'CL', 'MDLZ', 'MO', 'PM', 'EL', 'KMB', 'GIS', 'K',
    'HSY', 'CLX', 'CHD', 'MKC', 'SJM', 'HRL', 'CAG', 'TAP', 'STZ', 'KHC',
    'TSN', 'ADM', 'KR',
    'BA', 'CAT', 'HON', 'UPS', 'RTX', 'LMT', 'GE', 'MMM', 'DE', 'EMR',
    'ITW', 'ETN', 'PH', 'CMI', 'FDX', 'NOC', 'GD', 'CARR', 'ROK', 'OTIS',
    'TDG', 'WM', 'RSG', 'PCAR', 'CSX', 'UNP', 'NSC', 'LUV', 'DAL', 'UAL',
    'XOM', 'CVX', 'COP', 'EOG', 'PXD', 'MPC', 'PSX', 'VLO', 'OXY', 'WMB',
    'KMI', 'OKE', 'HES', 'DVN', 'FANG', 'HAL', 'SLB', 'BKR', 'APA', 'CTRA',
    'NEE', 'DUK', 'SO', 'D', 'AEP', 'SRE', 'EXC', 'XEL', 'PCG', 'ED',
    'WEC', 'ES', 'AWK', 'PPL', 'AEE', 'CMS', 'DTE', 'ETR', 'FE', 'EIX',
    'T', 'VZ', 'CMCSA', 'TMUS', 'CHTR', 'NFLX', 'WBD', 'PARA',
    'EA', 'TTWO', 'OMC', 'IPG',
    'PLD', 'AMT', 'EQIX', 'PSA', 'CCI', 'WELL', 'SPG', 'DLR', 'O', 'VICI',
    'EXR', 'AVB', 'EQR', 'ARE', 'INVH', 'ESS', 'MAA', 'UDR', 'CPT', 'BXP',
    'LIN', 'APD', 'SHW', 'ECL', 'NEM', 'FCX', 'DOW', 'DD', 'NUE', 'VMC',
    'MLM', 'PPG', 'CTVA', 'LYB', 'CE', 'ALB', 'IFF', 'PKG', 'AVY', 'IP',
    'ORCL', 'ADBE', 'CRM', 'AMD', 'INTC', 'CSCO', 'QCOM', 'TXN', 'IBM', 'NOW',
    'INTU', 'ACN', 'PYPL', 'UBER', 'SHOP', 'ADI', 'MU', 'LRCX', 'KLAC', 'AMAT',
    'SNPS', 'CDNS', 'MRVL', 'PANW', 'FTNT', 'CRWD', 'ANET', 'WDAY', 'TEAM', 'DDOG',
    'NET', 'SNOW', 'ZS', 'OKTA', 'SPLK', 'DOCU', 'ZM', 'TWLO', 'ROKU', 'PINS',
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
  Italia: [
    'ENI.MI', 'ISP.MI', 'UCG.MI', 'ENEL.MI', 'STM.MI', 'TIT.MI', 'G.MI', 'RACE.MI',
    'MB.MI', 'LUX.MI', 'CNHI.MI', 'MONC.MI', 'PRY.MI', 'AMP.MI', 'A2A.MI',
    'AZM.MI', 'ATL.MI', 'BAMI.MI', 'BMED.MI', 'BMPS.MI', 'BPE.MI', 'BRE.MI',
    'BZU.MI', 'CPR.MI', 'CRL.MI', 'DAN.MI', 'DIA.MI', 'ERG.MI', 'FBK.MI',
    'HER.MI', 'IG.MI', 'IP.MI', 'IRE.MI', 'ITM.MI', 'JUVE.MI', 'LDO.MI',
    'NEXI.MI', 'PIRC.MI', 'PLT.MI', 'PST.MI', 'REC.MI', 'RWAY.MI',
    'SPM.MI', 'SRG.MI', 'STLAM.MI', 'TEN.MI', 'TRN.MI', 'UNI.MI',
  ],
  Francia: [
    'SAN.PA', 'AIR.PA', 'MC.PA', 'OR.PA', 'BNP.PA', 'KER.PA', 'CAP.PA', 'SU.PA',
    'ORA.PA', 'RI.PA', 'ACA.PA', 'AI.PA', 'BN.PA', 'CA.PA', 'CS.PA',
    'EL.PA', 'EN.PA', 'ENGI.PA', 'GLE.PA', 'HO.PA', 'ML.PA', 'PUB.PA', 'RMS.PA',
    'RNO.PA', 'SAF.PA', 'SGO.PA', 'STLAP.PA', 'TEP.PA', 'TTE.PA', 'URW.PA',
    'VIE.PA', 'VIV.PA', 'WLN.PA',
  ],
  Germania: [
    'SAP.DE', 'SIE.DE', 'BAS.DE', 'ALV.DE', 'BMW.DE', 'VOW3.DE', 'DTE.DE', 'DBK.DE',
    'ADS.DE', 'IFX.DE', 'MRK.DE', 'LIN.DE', 'MUV2.DE', 'HEN3.DE', 'BEI.DE',
    'CON.DE', 'DB1.DE', 'DHL.DE', 'DTG.DE', 'EOAN.DE', 'FRE.DE', 'HEI.DE',
    'MBG.DE', 'P911.DE', 'PAH3.DE', 'PUM.DE', 'QIA.DE', 'RWE.DE', 'SHL.DE',
    'SY1.DE', 'VNA.DE', 'ZAL.DE',
  ],
  Olanda: [
    'ASML.AS', 'ADYEN.AS', 'HEIA.AS', 'INGA.AS', 'PHIA.AS', 'AD.AS', 'UNA.AS',
    'PRX.AS', 'RAND.AS', 'DSM.AS', 'ABN.AS', 'AKZA.AS', 'KPN.AS', 'NN.AS',
    'REN.AS', 'WKL.AS',
  ],
  UK: [
    'ULVR.L', 'SHEL.L', 'HSBA.L', 'AZN.L', 'BP.L', 'GSK.L', 'RIO.L', 'DGE.L',
    'BHP.L', 'GLEN.L', 'VOD.L', 'LLOY.L', 'BARC.L', 'NWG.L', 'STAN.L', 'PRU.L',
    'LGEN.L', 'AV.L', 'REL.L', 'RKT.L', 'TSCO.L', 'BT-A.L', 'BATS.L', 'CRH.L',
    'CPG.L', 'EXPN.L', 'FLTR.L', 'IHG.L', 'LSEG.L', 'NG.L', 'SSE.L', 'SVT.L',
    'UU.L', 'WTB.L',
  ],
  Spagna: [
    'ITX.MC', 'IBE.MC', 'SAN.MC', 'BBVA.MC', 'TEF.MC', 'REP.MC', 'FER.MC',
    'AMS.MC', 'ACS.MC', 'CLNX.MC', 'ELE.MC', 'ENG.MC', 'GRF.MC', 'MAP.MC',
    'MRL.MC', 'NTGY.MC', 'RED.MC', 'ROVI.MC', 'SAB.MC',
  ],
  Svizzera: [
    'NESN.SW', 'ROG.SW', 'NOVN.SW', 'UBSG.SW', 'ZURN.SW', 'ABBN.SW', 'CFR.SW',
    'SGSN.SW', 'GIVN.SW', 'SIKA.SW', 'LONN.SW', 'GEBN.SW', 'HOLN.SW', 'KNIN.SW',
  ],
  Svezia: [
    // OMX Stockholm 30 + large cap
    'ATCO-A.ST', 'ATCO-B.ST', 'VOLV-B.ST', 'ERIC-B.ST', 'HEXA-B.ST', 'INVE-B.ST',
    'ABB.ST', 'AZN.ST', 'ASSA-B.ST', 'EQT.ST', 'SEB-A.ST', 'SHB-A.ST',
    'SWED-A.ST', 'SWMA.ST', 'SAND.ST', 'SKF-B.ST', 'SCA-B.ST', 'SSAB-A.ST',
    'ESSITY-B.ST', 'ELUX-B.ST', 'TEL2-B.ST', 'TELIA.ST', 'NDA-SE.ST',
    'ALFA.ST', 'BOL.ST', 'GETI-B.ST', 'KINV-B.ST', 'HM-B.ST', 'EVO.ST',
    'SINCH.ST',
  ],
  Danimarca: [
    // OMX Copenhagen 25
    'NOVO-B.CO', 'DSV.CO', 'NZYM-B.CO', 'ORSTED.CO', 'CARL-B.CO', 'DANSKE.CO',
    'MAERSK-B.CO', 'MAERSK-A.CO', 'TRYG.CO', 'VWS.CO', 'DEMANT.CO', 'GN.CO',
    'PNDORA.CO', 'ROCK-B.CO', 'COLO-B.CO', 'CHR.CO', 'GMAB.CO', 'JYSK.CO',
    'ISS.CO', 'AMBU-B.CO', 'NETC.CO',
  ],
  Norvegia: [
    // Oslo Bors OBX
    'EQNR.OL', 'DNB.OL', 'TEL.OL', 'YAR.OL', 'NHY.OL', 'MOWI.OL',
    'ORK.OL', 'AKERBP.OL', 'STB.OL', 'SUBC.OL', 'SALM.OL', 'BAKKA.OL',
    'GJF.OL', 'KOG.OL', 'SCATC.OL', 'FRO.OL', 'TOM.OL', 'LSG.OL',
    'NEL.OL', 'REC.OL',
  ],
  Finlandia: [
    // OMX Helsinki 25
    'NOKIA.HE', 'NESTE.HE', 'KNEBV.HE', 'SAMPO.HE', 'UPM.HE', 'STERV.HE',
    'FORTUM.HE', 'OUT1V.HE', 'TYRES.HE', 'WRT1V.HE', 'METSO.HE', 'ELISA.HE',
    'TELIA1.HE', 'KESKOB.HE', 'NDA-FI.HE', 'QTCOM.HE', 'KCR.HE', 'HUH1V.HE',
    'TIETO.HE', 'KOJAMO.HE',
  ],
  Austria: [
    // ATX Vienna
    'EBS.VI', 'OMV.VI', 'VOE.VI', 'RBI.VI', 'VER.VI', 'ANDR.VI',
    'BG.VI', 'CAI.VI', 'IIA.VI', 'LNZ.VI', 'MMK.VI', 'POST.VI',
    'SBO.VI', 'UQA.VI', 'WIE.VI', 'VIG.VI',
  ],
  Belgio: [
    // BEL 20
    'ABI.BR', 'KBC.BR', 'UCB.BR', 'GBLB.BR', 'SOLB.BR', 'COFB.BR',
    'AGS.BR', 'PROX.BR', 'UMI.BR', 'GLPG.BR', 'ARGX.BR', 'AED.BR',
    'BPOST.BR', 'COLR.BR', 'BEKB.BR', 'SOF.BR',
  ],
  Portogallo: [
    // PSI 20
    'GALP.LS', 'EDP.LS', 'JMT.LS', 'BCP.LS', 'NOS.LS', 'ALTR.LS',
    'COR.LS', 'CTT.LS', 'EGL.LS', 'GLINT.LS', 'NVG.LS', 'RENE.LS',
    'SEM.LS', 'SON.LS', 'SONC.LS',
  ],
  Polonia: [
    // WIG20 Varsavia
    'PKO.WA', 'PZU.WA', 'PEO.WA', 'PKN.WA', 'KGH.WA', 'CDR.WA',
    'LPP.WA', 'ALE.WA', 'DNP.WA', 'MBK.WA', 'PGE.WA', 'SPL.WA',
    'CPS.WA', 'JSW.WA', 'OPL.WA', 'TPE.WA', 'ACP.WA', 'KRU.WA',
    'BDX.WA', 'PCO.WA',
  ],
  Turchia: [
    // BIST 30 Istanbul
    'AKBNK.IS', 'ARCLK.IS', 'ASELS.IS', 'BIMAS.IS', 'DOHOL.IS',
    'EKGYO.IS', 'EREGL.IS', 'FROTO.IS', 'GARAN.IS', 'HALKB.IS',
    'ISCTR.IS', 'KCHOL.IS', 'KOZAL.IS', 'KRDMD.IS', 'PETKM.IS',
    'PGSUS.IS', 'SAHOL.IS', 'SISE.IS', 'TAVHL.IS', 'TCELL.IS',
    'THYAO.IS', 'TKFEN.IS', 'TOASO.IS', 'TUPRS.IS', 'VAKBN.IS',
    'YKBNK.IS',
  ],
  Grecia: [
    // ATHEX 25 Atene
    'OPAP.AT', 'ETE.AT', 'EUROB.AT', 'ALPHA.AT', 'TPEIR.AT', 'HTO.AT',
    'MYTIL.AT', 'ELPE.AT', 'PPC.AT', 'TITC.AT', 'MOH.AT', 'METLK.AT',
    'VIO.AT', 'JUMBO.AT', 'LAMDA.AT', 'SAR.AT', 'OTE.AT',
  ],
  Commodities: [
    'GC=F', 'SI=F', 'PL=F', 'PA=F', 'HG=F',
    'CL=F', 'BZ=F', 'NG=F', 'HO=F', 'RB=F',
    'ZC=F', 'ZS=F', 'ZW=F', 'ZL=F', 'ZM=F', 'ZR=F', 'ZO=F',
    'KC=F', 'CC=F', 'SB=F', 'CT=F', 'OJ=F',
    'LE=F', 'HE=F', 'GF=F',
    'GLD', 'SLV', 'USO', 'UNG', 'DBA', 'DBC', 'PDBC', 'GSG', 'CORN', 'WEAT',
    'SOYB', 'JO', 'CANE',
    'GDX', 'GDXJ', 'SIL', 'SILJ', 'COPX', 'URA', 'LIT', 'REMX',
  ],
  ETF: [
    'SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO', 'IVV', 'VXF', 'VB',
    'VEA', 'VWO', 'EFA', 'EEM', 'IEFA', 'IEMG', 'ACWI', 'VXUS',
    'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLY', 'XLU', 'XLB', 'XLRE',
    'XLC', 'XHB', 'XRT', 'XME', 'XOP', 'XBI', 'XPH', 'XSD',
    'ARKK', 'ARKG', 'ARKF', 'ARKQ', 'ARKW', 'SMH', 'SOXX', 'IGV', 'IYR',
    'JETS', 'TAN', 'ICLN', 'HACK', 'ROBO', 'BOTZ', 'ESPO', 'HERO',
    'AGG', 'BND', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'JNK', 'TIP', 'MUB',
    'VIG', 'VYM', 'SCHD', 'DVY', 'HDV', 'NOBL',
    'EWJ', 'EWG', 'EWU', 'EWZ', 'EWW', 'EWC', 'EWA', 'EWH', 'MCHI', 'INDA',
    'TQQQ', 'SQQQ', 'SSO', 'SDS', 'UPRO', 'SPXU', 'UDOW',
    'VXX', 'UVXY', 'SVXY',
  ],
} as const;

export type MarketKey = keyof typeof MARKETS;

export const ALL_TICKERS: string[] = Array.from(
  new Set(Object.values(MARKETS).flat())
);
