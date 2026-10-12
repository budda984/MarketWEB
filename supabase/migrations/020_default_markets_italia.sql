-- Migration 020: 'Europa' non e' piu' un mercato valido
--
-- Dopo la divisione dei mercati europei per nazione, 'Europa' non e' piu'
-- una MarketKey. Il valore predefinito di user_settings.default_markets lo
-- conteneva ancora: lo sostituisco con 'Italia', il mercato predefinito
-- della Dashboard, sia nel default sia nelle righe gia' salvate.

alter table public.user_settings
  alter column default_markets
  set default array['S&P 500','NASDAQ','Crypto','Italia']::text[];

update public.user_settings
set default_markets = case
  when 'Italia' = any(default_markets) then array_remove(default_markets, 'Europa')
  else array_replace(default_markets, 'Europa', 'Italia')
end
where 'Europa' = any(default_markets);
