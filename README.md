<div align="center">

<img src="public/assets/aistudio/image_c96ff192.png" alt="FINGuard Logo" width="84" height="84" />

# FINGuard (FINQuant)

**India's AI Quant Wealth, Hybrid RAG Research & Smart UPI SIP Operating System**

[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Gemini AI](https://img.shields.io/badge/Gemini_AI-GenAI_SDK-8E75B2?style=flat-square&logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Firebase](https://img.shields.io/badge/Firebase-Auth_%26_Firestore-FFCA28?style=flat-square&logo=firebase&logoColor=black)](https://firebase.google.com/)

[Features](#-features) • [Architecture](#-architecture) • [Quick Start](#-quick-start) • [Environment Variables](#-environment-variables) • [API Reference](#-api-reference) • [Security](#-security--firestore-rules)

</div>

---

## Overview

**FINGuard** is a full-stack Indian retail & quant wealth platform built with React 19, Vite, Express, and TypeScript. It unifies live NSE/BSE market streaming, Upstox broker OAuth, deterministic quantitative strategy backtesting, Markowitz portfolio optimization, Indian FY26 capital-gains tax-loss harvesting, a Gemini-powered hybrid RAG copilot, and UPI cashflow-aware Smart SIP mandates in a single dark/light-mode terminal.

---

## ✨ Features

### 📈 Live Markets & Broker Connectivity
- **Real-Time SSE & WebSocket Feeds**: Streams live quotes and depth ticks for NSE/BSE indices (`^NSEI`, `^BSESN`, `^NSEBANK`, `^INDIAVIX`), equities, and ETFs via Server-Sent Events (`/api/market/stream`).
- **Upstox OAuth v2/v3 Integration**: Connect an Upstox Demat account for live portfolio sync, available margin tracking, protobuf market feed streaming, and PIN-gated order placement.
- **Interactive Financial Charting**: Powered by TradingView `lightweight-charts` across `1D`, `1W`, `1M`, `6M`, `1Y`, and `3Y` timeframes alongside `three` 3D hero visualizations.

### 🧪 AI Quant Lab & Deterministic Backtester
- **Natural-Language to Quant DSL**: Convert English or Hinglish strategy prompts into structured `QuantStrategyDSL` rules (`MOMENTUM`, `SMA_CROSSOVER`, `EMA_CROSSOVER`, `MEAN_REVERSION`, `EQUAL_WEIGHT`) via Gemini.
- **India VIX Regime Switching**: Automatically rotate capital into `GOLDBEES.NS` or `LIQUIDBEES.NS` when `^INDIAVIX` crosses configurable volatility thresholds.
- **Institutional Risk Metrics & Monte Carlo**: Computes CAGR, Alpha, Sharpe, Sortino, Calmar, Max Drawdown, Win Rate, Daily VaR (95%), and 1,000-path deterministic Geometric Brownian Motion (GBM) fan projections benchmarked against India's 6.7% 91-day T-Bill risk-free rate.

### 💼 Portfolio, Double-Entry Ledger & FY26 Tax Engine
- **FIFO Trade Accounting & CSV Import**: Log manual trades or import tradebook CSVs from Zerodha, Groww, or Upstox with automatic FIFO cost-basis matching.
- **Markowitz Efficient Frontier**: Calculates current vs. Maximum Sharpe and Minimum Variance allocations with concrete `BUY` / `SELL` / `HOLD` rebalance deltas.
- **Mutual Fund Overlap Analyzer**: Searches live mutual fund schemes (`MFAPI`) and computes pairwise return correlation, R², and closet-indexing overlap percentages.
- **Indian FY26 Tax-Loss Harvesting**: Tracks realized/unrealized **STCG (20% u/s 111A)** and **LTCG (12.5% u/s 112A)** with the ₹1,25,000 annual LTCG exemption tracker and actionable harvesting recommendations.
- **Double-Entry Paise Ledger**: Segregates `CASH_INR`, `BROKER_SETTLED`, `SIP_ESCROW`, and `TAX_RESERVE` balances with idempotent transfers.

### 🤖 Hybrid RAG Copilot & BS Detector
- **Vector + Keyword Hybrid Search**: Pre-seeded with SEBI taxation, Nifty 50 sector risk, and RBI hedging playbooks, plus user document ingestion (`.pdf`, `.txt`, `.md`, `.csv`, `.json`) embedded with `gemini-embedding-2`.
- **Three Copilot Modes**:
  - `RESEARCH`: Grounded Q&A with inline document citations.
  - `BS_DETECTOR`: Cross-checks viral stock tips and finfluencer claims against live NSE prices, 1-year returns, and realized volatility.
  - `PORTFOLIO_DIAGNOSTIC`: Audits holdings, tax exposure, and concentration risks.

### 💳 Smart UPI SIP & Cashflow Volatility Engine
- **UPI SMS & Statement Parser**: Parses raw bank/UPI SMS alerts or CSV logs locally into categorized monthly income, spend, and surplus series.
- **Emergency Buffer Sizing**: Calculates `Monthly Spend Mean + 1.5 × StdDev` to surface safe monthly SIP capacity.
- **NPCI UPI Intent Mandates**: Creates `WEEKLY` or `MONTHLY` SIP plans linked to a VPA with generated `upi://pay` QR codes and 4-digit PIN authorization.

### 📰 Live Macro Wire & Economic Calendar
- Aggregates live Indian & global market RSS feeds, Forex Factory macro calendar events (cached locally in `data/ff-calendar-cache.json`), and optional Finnhub / NewsAPI streams over SSE (`/api/market/news/stream`).

---

## 🏗 Architecture

```text
├── server.ts                      # Express + Vite middleware entrypoint (port 3000)
├── shared/
│   └── types.ts                   # Shared TypeScript domain models (Ledger, Quant DSL, RAG, Market)
├── server/
│   ├── ai/
│   │   ├── geminiClient.ts        # @google/genai client (gemini-4-hydrogen & gemini-embedding-2)
│   │   └── ragService.ts          # Hybrid RAG chunking, embeddings, PDF extraction & Copilot tools
│   ├── auth/
│   │   └── authMiddleware.ts      # JWT access/refresh tokens, Firebase Google ID token & idempotency
│   ├── db/
│   │   └── store.ts               # Dual persistence: PostgreSQL (JSONB) or zero-config JSON store
│   ├── quant/
│   │   ├── backtestEngine.ts      # Deterministic strategy backtester & GBM Monte Carlo engine
│   │   ├── cashflowEngine.ts      # UPI SMS/CSV parser & emergency buffer analyzer
│   │   ├── mfOverlapEngine.ts     # Mutual fund correlation & overlap engine
│   │   ├── optimizer.ts           # Markowitz Efficient Frontier & rebalance optimizer
│   │   └── taxEngine.ts           # FIFO lot matcher & Indian FY26 STCG/LTCG tax harvester
│   ├── routes/
│   │   └── api.ts                 # REST + SSE API router (/api/*)
│   └── services/
│       ├── marketDataService.ts   # NSE universe catalog, quotes, historical series & WS relay
│       ├── newsService.ts         # Live RSS, Forex Factory calendar & Finnhub/NewsAPI aggregator
│       └── upstoxService.ts       # Upstox v2/v3 OAuth, order routing & protobuf feed decoder
├── src/
│   ├── App.tsx                    # Root shell, theme toggle, navigation & auth/PIN state
│   ├── components/                # HomeTab, MarketsTab, NewsTab, QuantLabTab, PortfolioTab, UpiProfileTab, CopilotSheet
│   └── lib/
│       ├── api.ts                 # Authenticated fetch wrapper with automatic token refresh
│       └── firebase.ts            # Firebase Auth (Google Sign-In) & split-PII Firestore sync
├── firebase-blueprint.json        # Firestore schema blueprint
├── firestore.rules                # Strict owner-isolated security rules
├── firestore.rules.test.ts        # Adversarial "Dirty Dozen" Firestore rules test suite
└── security_spec.md               # Zero-trust data invariants & security specification
```

---

## 🛠 Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite 8, Tailwind CSS v4, Motion, Lucide Icons |
| **Charts & 3D** | TradingView `lightweight-charts`, `recharts`, `three`, `qrcode` |
| **Backend** | Node.js, Express 4, `tsx`, `ws`, `protobufjs`, `multer` |
| **AI & RAG** | `@google/genai` (`gemini-4-hydrogen`, `gemini-embedding-2`) |
| **Auth & Security** | `jose` (JWT), `bcryptjs` (passwords & 4-digit PIN), Firebase Auth (Google) |
| **Persistence** | Zero-config atomic JSON (`data/finquant-db.json`), PostgreSQL (`pg`), Cloud Firestore |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** `>= 20.x`
- **npm** (or `bun`)

### Installation

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd <repo-folder>

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY (and optional broker/DB/news keys)

# 4. Start the full-stack development server (Express + Vite on port 3000)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

| Script | Description |
| :--- | :--- |
| `npm run dev` | Starts Express + Vite dev server via `tsx server.ts` on port `3000` |
| `npm run build` | Builds the frontend production bundle into `dist/` |
| `npm start` | Runs the production server (`node server.ts`) |
| `npm run lint` | Runs TypeScript type-checking (`tsc --noEmit`) |
| `npm run clean` | Removes `dist/` and compiled artifacts |

---

## 🔐 Environment Variables

Configure these in `.env` (see `.env.example`):

| Variable | Required | Description |
| :--- | :---: | :--- |
| `GEMINI_API_KEY` | **Yes** | Google Gemini API key for Quant DSL generation, Copilot Q&A, and RAG embeddings |
| `APP_URL` | Optional | Public URL of the app (used for OAuth callbacks and self-referential links) |
| `DATABASE_URL` | Optional | PostgreSQL connection string. If omitted, uses `data/finquant-db.json` automatically |
| `UPSTOX_API_KEY` | Optional | Upstox Developer API key for live Demat OAuth, quotes, and order routing |
| `UPSTOX_API_SECRET` | Optional | Upstox Developer API secret |
| `FINNHUB_API_KEY` | Optional | Enables additional Finnhub institutional market news |
| `NEWS_API_KEY` | Optional | Enables additional NewsAPI macro headlines |

---

## 📡 API Reference

All routes are mounted under `/api` (health check available at `GET /api/health`).

<details>
<summary><strong>Authentication & Profile</strong></summary>

- `POST /api/auth/register` — Email/password registration with 4-digit PIN
- `POST /api/auth/login` — Credential sign-in returning JWT access/refresh pair
- `POST /api/auth/google` — Firebase Google ID token exchange
- `POST /api/auth/refresh` / `POST /api/auth/logout` — Token rotation & revocation
- `GET /api/auth/me` / `PATCH /api/auth/profile` — Fetch or update investor profile & VPA
- `POST /api/auth/verify-pin` / `set-pin` / `update-pin` — Manage 4-digit transaction PIN

</details>

<details>
<summary><strong>Markets, News & Upstox Broker</strong></summary>

- `GET /api/market/catalog` — Curated NSE/ETF/Index universe
- `GET /api/market/search` & `GET /api/market/quotes` — Stock & quote lookup
- `GET /api/market/chart` — Historical OHLCV candles (`1D` – `3Y`)
- `GET /api/market/stream` — Real-time SSE market tick stream
- `GET /api/market/mf/search` — Live mutual fund scheme search
- `GET /api/market/news` & `GET /api/market/news/stream` — Live news & Forex Factory calendar SSE
- `GET /api/upstox/status` / `auth-url` / `callback` / `disconnect` / `holdings` / `orders`

</details>

<details>
<summary><strong>Portfolio, Tax & Quant Lab</strong></summary>

- `GET /api/portfolio/summary` — Net worth, holdings, orders & double-entry ledger
- `POST /api/portfolio/trades` / `import-csv` / `DELETE /trades/:id` — FIFO trade management
- `GET /api/portfolio/optimize` — Markowitz Efficient Frontier & rebalance plan
- `GET /api/portfolio/tax-harvest` — Indian FY26 STCG/LTCG tax harvesting report
- `POST /api/portfolio/mf-overlap` — Mutual fund overlap & correlation matrix
- `POST /api/orders` & `POST /api/ledger/transfer` — PIN-gated & idempotent execution
- `GET /api/quant/strategies` & `POST /api/quant/prompt-backtest` / `run-backtest` / `save`

</details>

<details>
<summary><strong>UPI Cashflow, Mandates & Hybrid RAG</strong></summary>

- `GET /api/upi/cashflow` & `POST /api/upi/cashflow/analyze` — UPI SMS/CSV analysis
- `GET /api/upi/mandates` / `POST /api/upi/mandates` / `PATCH /:id` / `POST /:id/run`
- `GET /api/rag/documents` & `POST /api/rag/upload` — Knowledge base & PDF/text ingestion
- `POST /api/copilot/ask` — Hybrid RAG Copilot (`RESEARCH`, `BS_DETECTOR`, `PORTFOLIO_DIAGNOSTIC`)

</details>

---

## 🛡 Security & Firestore Rules

FINGuard enforces zero-trust data isolation (documented in `security_spec.md`):
- **Split-PII Firestore Schema**: Non-PII account metadata lives at `/users/{userId}`, while personal info (`email`, `displayName`, `upiId`, `phone`, tax profile) is isolated at `/users/{userId}/private/{profileId}`.
- **Strict Ownership & Bounds**: `firestore.rules` enforces `request.auth.uid == userId`, verified email checks, immutable `ownerId` / `createdAt` timestamps, strict key allowlists, and terminal state locks on revoked mandates.
- **Transactional Safeguards**: Orders, ledger transfers, and SIP mandates require a `bcrypt`-verified 4-digit PIN and an `Idempotency-Key` header.
- **Adversarial Rules Testing**: Verified against the 12-vector "Dirty Dozen" suite in `firestore.rules.test.ts`.
