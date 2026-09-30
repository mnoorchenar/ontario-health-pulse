---
title: ontario-health-pulse
colorFrom: blue
colorTo: green
sdk: static
pinned: false
---

# Ontario Health Pulse

Ontario Health Pulse is an interactive, fully static dashboard for non-technical audiences. It shows a map of Ontario public health units (PHUs). Selecting a region opens a panel with a trend chart, an Ontario comparison line, a short plain-language summary written from the numbers, a simple forecast with an uncertainty band, and an offline chat box for questions about that region. Everything runs in the browser from a saved `data/data.json` snapshot, so it keeps working after the first load even with no internet. There is no backend, no build step, no tracking and no secrets.

> **Independent demo built on public, aggregated data. Not an official tool and not medical advice.**

> Screenshot placeholder: add a screenshot of the dashboard here (Hugging Face Spaces rejects binary files unless Xet storage is set up).

## Finding your place

Type a city or town (about 150 are listed, for example Hamilton, London or Thunder Bay) in the search box. The app shows which public health unit serves it, selects that unit and drops a pin on the map; the main cities are also labelled on the map. City-to-unit assignments come from scripts/build_cities.py, which tests approximate town-centre coordinates against the official boundaries. Selecting a different region starts a fresh chat.

## What the data covers (please read)

Only two official, downloadable, aggregated Ontario datasets could be used, and **both were frozen by the province on 2024-11-14**:

| Indicator | Newest week in this snapshot |
|---|---|
| COVID-19 test positivity by PHU (7-day average) | 2024-07-31 |
| Vaccination coverage: at least one dose / 3+ doses, ages 5+ | 2024-11-06 |

The app therefore shows a **historical view** and says so in a banner. It does not include influenza, RSV or hospital data: see "Sources" for why. Forecasts continue from the last week of data, not from today.

## Run locally (Windows PowerShell)

Any static file server works. With Python installed:

```powershell
cd E:\HuggingFace\ontario-health-pulse
python -m http.server 8080
# then open http://localhost:8080/
```

Other options: `npx serve .` or the VS Code "Live Server" extension. Opening `index.html` directly from disk will not work, because browsers block module scripts and service workers on `file://`.

Run the tests:

```powershell
python -m unittest discover -s tests -p "test_*.py"   # build script: validation, small-count masking
node --test tests/*.test.mjs                           # forecast, chat intents, browser-side validation
```

Rebuild the data yourself (standard library only, no `pip install`):

```powershell
python scripts/build_data.py            # downloads, validates, writes data/data.json only if valid
python scripts/build_boundaries.py      # optional: rebuild the simplified map shapes
```

## How the weekly refresh works

`.github/workflows/refresh-data.yml` runs every Monday and on manual trigger ("Run workflow" in the Actions tab). It runs the tests, runs `scripts/build_data.py`, runs the tests again on the result, and commits `data/data.json` **only if validation passed and the data actually changed**. The build script validates before writing: expected columns, known PHU names and IDs, plausible non-negative numbers, dates that are newer or equal to the existing file, and row counts that are not suspiciously small. On any failure it exits with an error and leaves the existing file untouched, and the workflow stops before the commit step. Counts of 1 to 4 are masked (set to null) so small cells are never published.

Because both source datasets are frozen, the workflow will currently report "no change" each week. It is ready for the day a newer file with the same columns appears.

**Relation to `sync.ps1`:** the workflow commits to the `main` branch on GitHub. Your existing `.\sync.ps1` already fetches the `github` remote, merges it, and pushes to both GitHub and the Hugging Face Space, so the next time you run it the refreshed `data.json` is picked up and published to the Space. Nothing in `sync.ps1` or `.syncconfig` needed to change; `sync.ps1` uses `git add -A`, so every new file and folder is included automatically (largest file is about 210 KB, far below the 10 MB warning limit).

## How the "Update data" button works

The page never calls an official data site. The button fetches `data/data.json` from this repository's raw GitHub URL (one constant, `REMOTE_DATA_URL` in `src/config.js`). In the browser it checks the structure, the known PHU names, plausible numbers, and that the date is newer or equal, and refuses sample data over real data. Only then does it replace the data in memory and in the offline cache. If anything fails, or there is no internet, the current data stays and it says "Could not update, still showing data from [date]."

## Offline behaviour

A service worker (`sw.js`) caches every app file, the map shapes and the latest `data.json` after the first load. The Chart.js library is bundled in `vendor/`; there are no CDN links, web fonts or map tiles. The optional "Smarter answers" panel is the single exception and needs internet: you pick one of a few free Hugging Face models (or type a model id) and paste your own free access token. Nothing is downloaded. The token is kept in memory for that tab only (never saved, never in this repository), and only a small fact list for the selected region plus your question is sent. If the call fails, the chat quietly stays in rules mode, and any model answer containing a number that is not in the facts is discarded. The model list is one constant in `src/config.js`.

## Chat

The default chat is rules-based: keyword and intent matching over the loaded data (latest value, change from last week or last year, comparison with Ontario, highest/lowest region, trend, data date, what a term means). Code calculates every number, and every answer shows the data date and source. Unknown questions get "I don't have that data" plus clickable examples. Personal medical questions are politely declined.

## Sources and licences

| Data | Publisher and link | Licence |
|---|---|---|
| COVID-19 testing metrics by PHU | Ontario Data Catalogue: [Ontario COVID-19 testing metrics by Public Health Unit (PHU)](https://data.ontario.ca/dataset/ontario-covid-19-testing-metrics-by-public-health-unit-phu) | [Open Government Licence - Ontario](https://www.ontario.ca/page/open-government-licence-ontario) |
| Vaccination coverage by PHU | Ontario Data Catalogue: [COVID-19 Vaccine Data in Ontario](https://data.ontario.ca/dataset/covid-19-vaccine-data-in-ontario) (file "by PHU and age group") | Open Government Licence - Ontario |
| PHU boundaries (map shapes) | Ontario Ministry of Health, Land Information Ontario: [Public health unit boundaries](https://data.ontario.ca/dataset/public-health-unit-boundaries), current 29-unit layer. Simplified to about 75 KB for display only. | Open Government Licence - Ontario |
| Chart.js 4.5.1 | [chartjs.org](https://www.chartjs.org) | MIT (`vendor/chart.js.LICENSE.md`) |

Contains information licensed under the Open Government Licence - Ontario. The code is MIT licensed (see `LICENSE`).

Sources that were checked but not used:

- **Public Health Ontario, Ontario Respiratory Virus Tool** (COVID-19, influenza and RSV by PHU): the tool is a Power BI embed. Its CSV export buttons run inside the report and there is no stable file URL to download. Scraping the report was ruled out. If PHO publishes a stable data file, add a parser in `scripts/build_data.py`. Its terms of use are at publichealthontario.ca and should be reviewed before reuse.
- **PHO immunization coverage data**: the page I tried returned 404; the Ontario Data Catalogue vaccine file above was used instead.
- **Ontario open data "Weekly influenza activity level within PHUs"**: listed in the catalogue but marked "not available"; the ministry says it is still reviewing whether it can be opened.

Public health units that merged on 1 January 2025 (Brant + Haldimand-Norfolk = Grand Erie; Haliburton Kawartha Pine Ridge + Peterborough = Lakelands; Porcupine + Timiskaming = Northeastern; Hastings Prince Edward + Kingston Frontenac Lennox & Addington + Leeds Grenville Lanark = Southeast) are combined for the whole history. Rates are recomputed from combined counts, not averaged.

## Limitations

- Historical only: the newest data is from mid-2024 (testing) and November 2024 (vaccination).
- Test positivity reflects who gets tested; it is not the share of people infected, and it is not the number of cases.
- Vaccination counts exclude doses without consent to record them and some Indigenous community records, so real coverage may be higher. Population estimates are from 2021.
- The forecast is a simple exponential-smoothing estimate. It cannot anticipate new variants, policy changes or reporting changes.
- The map shapes are simplified and are not for legal or analytic use.
- No influenza, RSV or hospital data (source not downloadable).

## Privacy and safety

Only public, aggregated data by PHU and date is used. No personal data is requested, stored or sent, and what you type in the chat never leaves the page (except that, if you turn on smarter answers, your question and the region facts are sent to the Hugging Face model you chose, using your own token). Real use would follow Ontario privacy laws such as PHIPA and MFIPPA. The app gives no medical advice; for personal health questions contact a health professional or your local public health unit.

## Project layout

```
index.html            page shell            sw.js            service worker
assets/               styles, icon          vendor/          Chart.js (bundled)
src/                  app modules (ES modules, no build)
data/data.json        snapshot              data/phu_boundaries.geojson   map shapes
scripts/              build_data.py, build_boundaries.py
tests/                Python and Node tests
.github/workflows/    weekly refresh
```

## Disclaimer

Independent demo built on public, aggregated data. Not an official tool and not medical advice.
