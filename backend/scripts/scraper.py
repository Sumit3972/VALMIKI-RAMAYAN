import requests
from bs4 import BeautifulSoup
import json
import concurrent.futures
import time
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE_URL = "https://www.valmiki.iitk.ac.in/sloka"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}


def clean_text(text):
    """Strip BOM, zero-width chars, normalize whitespace."""
    if not text:
        return ""
    text = text.replace('\ufeff', '').replace('\u200b', '')
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def scrape_sarga(kanda_id, sarga_id, retries=3):
    url = f"{BASE_URL}?field_kanda_tid={kanda_id}&language=dv&field_sarga_value={sarga_id}"
    print(f"Fetching: {url}")

    time.sleep(0.5)
    response = None
    for attempt in range(retries):
        try:
            response = requests.get(url, headers=HEADERS, timeout=15)
            response.raise_for_status()
            break
        except Exception as e:
            if attempt == retries - 1:
                print(f"Error fetching {url} after {retries} attempts: {e}")
                return []
            print(f"Retry {attempt + 1}/{retries} for {url}: {e}")
            time.sleep(1)

    soup = BeautifulSoup(response.text, 'html.parser')
    rows = soup.find_all('div', class_='views-row')

    if not rows:
        return []

    seen_nums = set()  # deduplicate
    sarga_data = []

    for row in rows:
        # ---- 1. Get Sanskrit from views-field-body ----
        body_div = row.find('div', class_='views-field-body')
        if not body_div:
            continue
        body_fc = body_div.find('div', class_='field-content')
        if not body_fc:
            continue
        raw_sanskrit = clean_text(body_fc.get_text(separator=' ', strip=True))

        # Find all shloka markers like ।।1.1.1।।
        markers = re.findall(r'।।\s*([\d\.]+)\s*।।', raw_sanskrit)
        if not markers:
            # No shloka number = summary-only or footer row, skip
            continue

        # Remove [summary...] bracket text from Sanskrit
        sanskrit_clean = re.sub(r'\[.*?\]', '', raw_sanskrit).strip()
        # Remove shloka markers from Sanskrit text
        sanskrit_clean = re.sub(r'।।\s*[\d\.]+\s*।।', '', sanskrit_clean)
        sanskrit_clean = clean_text(sanskrit_clean)

        # ---- 2. Get English translation from views-field-field-explanation ----
        translation = ""
        trans_div = row.find('div', class_='views-field-field-explanation')
        if trans_div:
            trans_fc = trans_div.find('div', class_='field-content')
            if trans_fc:
                translation = clean_text(trans_fc.get_text(separator=' ', strip=True))
                # Remove footer/colophon text that leaks into last shloka
                # e.g. 'इत्यार्षे श्रीमद्रामायणे... Thus ends the...'
                translation = re.split(r'इत्यार्षे', translation)[0]
                translation = re.split(r'Thus ends', translation)[0]
                translation = translation.strip().rstrip('"').rstrip("'").strip()

        # ---- 3. Handle multi-shloka rows ----
        # If row has multiple shloka numbers (e.g., 1.1.21 + 1.1.22),
        # split Sanskrit by markers and assign same translation to each.
        if len(markers) == 1:
            num = markers[0]
            if num not in seen_nums:
                seen_nums.add(num)
                sarga_data.append({
                    "kanda": kanda_id,
                    "sarga": sarga_id,
                    "shloka_num": num,
                    "sanskrit": sanskrit_clean,
                    "translation": translation
                })
        else:
            # Split the Sanskrit text by the marker positions
            # Pattern: text1 ।।X।। text2 ।।Y।। ...
            parts = re.split(r'।।\s*[\d\.]+\s*।।', raw_sanskrit)
            # Remove summary bracket from first part
            parts = [re.sub(r'\[.*?\]', '', p).strip() for p in parts]
            parts = [clean_text(p) for p in parts if clean_text(p)]

            for i, num in enumerate(markers):
                if num in seen_nums:
                    continue
                seen_nums.add(num)

                # Try to assign the right Sanskrit chunk
                # parts[0] = text before first marker, parts[1] = between marker 1 and 2, etc.
                # For a 2-marker row: parts = [sanskrit_chunk1, sanskrit_chunk2, trailing]
                # We want the chunk BEFORE each marker
                if i < len(parts):
                    shloka_sanskrit = parts[i]
                else:
                    shloka_sanskrit = sanskrit_clean

                sarga_data.append({
                    "kanda": kanda_id,
                    "sarga": sarga_id,
                    "shloka_num": num,
                    "sanskrit": shloka_sanskrit,
                    "translation": translation  # shared for multi-shloka rows
                })

    return sarga_data


def main():
    all_data = []
    kanda = 6
    sargas_to_fetch = list(range(1, 132))  # Yuddha Kand: 131 sargas

    results = []
    print(f"Starting scrape for Kanda {kanda} (131 sargas)...")

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        future_to_sarga = {executor.submit(scrape_sarga, kanda, s): s for s in sargas_to_fetch}

        for future in concurrent.futures.as_completed(future_to_sarga):
            sarga = future_to_sarga[future]
            try:
                data = future.result()
                if data:
                    results.append((sarga, data))
                    print(f"Scraped {len(data)} shlokas from Kanda {kanda}, Sarga {sarga}")
            except Exception as exc:
                print(f"Kanda {kanda}, Sarga {sarga} exception: {exc}")

    # Sort by sarga number
    results.sort(key=lambda x: x[0])
    for _, data in results:
        all_data.extend(data)

    # Save to JSON
    with open('valmiki_ramayana_dataset.json', 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)

    print(f"\nDone! Scraped {len(all_data)} shlokas total.")
    print("Saved to valmiki_ramayana_dataset.json")

    # Quick stats
    if all_data:
        print(f"\nSample record:")
        print(json.dumps(all_data[1], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
