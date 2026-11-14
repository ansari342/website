#!/usr/bin/env bash
# Download the free datasets used by scripts/lab100.mjs into a folder.
# Usage: bash scripts/lab100-fetch.sh <output folder>
set -u
OUT="$1"; mkdir -p "$OUT/binance" "$OUT/hourly" "$OUT/macro"
UA="Mozilla/5.0"
NOW=$(date +%s)
# 1. Binance public archive: 5-minute spot bars, 48 months.
for sym in BTCUSDT ETHUSDT SOLUSDT; do
  for ym in $(node -e 'for(let y=2022,m=11;y<2026||m<=10;m++){if(m>12){m=1;y++}if(y>2026||(y==2026&&m>10))break;console.log(y+"-"+String(m).padStart(2,"0"))}'); do
    f="$OUT/binance/$sym-5m-$ym"
    [ -s "$f.csv" ] && continue
    curl -sS -m 60 -o "$f.zip" "https://data.binance.vision/data/spot/monthly/klines/$sym/5m/$sym-5m-$ym.zip" && unzip -p "$f.zip" > "$f.csv" && rm -f "$f.zip"
  done
done
# 2. Yahoo: 2 years of hourly bars for the halal ETFs.
for s in SPUS HLAL UMMA SPTE SPWO SPRE; do
  curl -sS -m 40 -A "$UA" "https://query1.finance.yahoo.com/v8/finance/chart/$s?range=2y&interval=60m" -o "$OUT/hourly/$s.json"; sleep 0.4
done
# 3. Yahoo: daily market gauges (fear, rates, dollar, credit, gold).
for s in %5EVIX %5EVIX3M %5ETNX DX-Y.NYB HYG GLD; do
  curl -sS -m 40 -A "$UA" "https://query1.finance.yahoo.com/v8/finance/chart/$s?period1=1546300800&period2=$NOW&interval=1d" -o "$OUT/macro/$(echo $s | sed 's/%5E//').json"; sleep 0.4
done
# 3b. Yahoo: daily bars with volume for the tradable ETFs, stocks (for breadth) and coins.
mkdir -p "$OUT/daily"
for s in SPUS HLAL UMMA SPTE SPWO SPRE AAPL MSFT NVDA ADBE ASML TSM BTC-USD ETH-USD SOL-USD XRP-USD ADA-USD LTC-USD LINK-USD AVAX-USD DOT-USD BCH-USD; do
  curl -sS -m 40 -A "$UA" "https://query1.finance.yahoo.com/v8/finance/chart/$s?period1=1546300800&period2=$NOW&interval=1d&events=split" -o "$OUT/daily/$s.json"; sleep 0.4
done
# 4. Crypto Fear & Greed index, full history.
curl -sS -m 40 "https://api.alternative.me/fng/?limit=0&format=json" -o "$OUT/macro/feargreed.json"
# 5. GDELT: daily tone of news mentioning the stock market (one request per year; rate-limited).
for y in 2019 2020 2021 2022 2023 2024 2025 2026; do
  f="$OUT/macro/gdelt-$y.json"
  [ -s "$f" ] && grep -q timeline "$f" && continue
  sleep 6
  curl -sS -m 90 -A "$UA" "https://api.gdeltproject.org/api/v2/doc/doc?query=%22stock%20market%22%20sourcecountry:US&mode=timelinetone&format=json&startdatetime=${y}0101000000&enddatetime=${y}1231235959" -o "$f"
done
