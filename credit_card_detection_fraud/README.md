# AI-Powered Fraud Detection Dashboard

This is a small full‑stack prototype I built for the HOPn internship task. It simulates a financial transaction monitoring system and shows how a trained ML model can sit behind a modern web dashboard.

## Architecture Overview – how the pieces talk

```
┌─────────────────────┐      ┌─────────────────────┐      ┌─────────────────────┐
│   Next.js Frontend  │ ───►  │  Node.js API        │ ───►  │  Python ML API      │
│   (Dashboard)       │       │  (TypeScript)       │       │  (FastAPI)          │
│   Port 3000         │       │  Port 3001          │       │  Port 8000          │
└─────────────────────┘       └─────────────────────┘      └─────────────────────┘
        │                              │                              │
        │  GET /transactions           │  GET /transactions            │  Serves transaction data
        │  GET /stats                  │  POST /predict              │  GET /sample-transaction
        │  POST /predict               │  GET /stats (in-memory)      │  POST /predict (model)
        │  GET /sample-transaction     │  Proxies to Python           │  Loads model.pkl, scaler.pkl
        └──────────────────────────────┴──────────────────────────────┘
```

- **Frontend (Next.js)** – what the user sees:
  - Dashboard with:
    - Transaction list (paged 500 at a time),
    - Fraud vs normal pie chart,
    - Summary statistics,
    - Buttons to run predictions (sampled transaction or manual input).
- **Backend (Node.js / TypeScript)** – glue layer:
  - REST API that proxies requests to the Python ML service.
  - Keeps simple in‑memory stats like “predictions made”.
- **ML API (Python / FastAPI)** – the actual model:
  - Serves transaction data from the CSV.
  - Exposes `/predict` using a trained Logistic Regression model + StandardScaler.
  - Can return a completely random transaction for demo purposes.

## Machine Learning Model – what’s under the hood

- **Algorithm**: Logistic Regression (binary classification).
  - I chose it because it’s fast to train, easy to serve, and easy to explain.
- **Dataset**: [Credit Card Fraud Detection](https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud)  
  - Features: anonymous `V1`–`V28` from PCA, plus `Time` and `Amount`.
  - Target: `Class` (0 = normal, 1 = fraud).
- **Preprocessing**:
  - StandardScaler on all 30 features.
  - Severe class imbalance handled by **undersampling** the majority (legit) class to match the fraud count, then shuffling.
- **Output**:
  - For each request, the model returns:
    - `is_fraud` (boolean label),
    - `fraud_probability` (from `predict_proba`),
    - a human‑readable `status`.

The model is trained offline via `ml/train.py`. The resulting `model.pkl` and `scaler.pkl` are loaded once by the FastAPI app at startup, so `/predict` calls are fast.

## Prerequisites

- Node.js 18+
- Python 3.10+
- npm or yarn

## How to Run Locally (what I run on my machine)

### 1. Train the ML model (first time only)

```bash
cd credit_card_detection_fraud/ml
python -m venv venv
source venv/bin/activate   # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python train.py
```

This creates `ml/model/model.pkl` and `ml/model/scaler.pkl`.

Dataset note:
- This repo includes a deploy-friendly dataset: `ml/data/creditcard_small.csv` (5,000 rows, includes fraud cases).
- The full Kaggle dataset (`creditcard.csv`) is not committed because it exceeds GitHub’s 100MB limit.

### 2. Start the Python ML API

```bash
cd credit_card_detection_fraud/ml
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Leave this running. Health check: [http://localhost:8000/health](http://localhost:8000/health).

### 3. Start the Node.js backend

```bash
cd credit_card_detection_fraud/backend
npm install
npm run dev
```

API runs at [http://localhost:3001](http://localhost:3001). It expects the ML API at `http://localhost:8000` (you can override this with `ML_API_URL`).

### 4. Start the Next.js frontend

```bash
cd credit_card_detection_fraud/frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dashboard will call the backend at `http://localhost:3001` (set `NEXT_PUBLIC_API_URL` to point to your backend when deploying).

## API Reference (Node.js backend)


| Method | Endpoint                   | Description                                            |
| ------ | -------------------------- | ------------------------------------------------------ |
| GET    | `/transactions?limit=5000` | Transaction list from dataset                          |
| GET    | `/stats`                   | Total predictions made, suspicious count               |
| GET    | `/sample-transaction`      | One random transaction (30 features) for demo          |
| POST   | `/predict`                 | Body: `{ "features": [30 floats] }` → fraud prediction |


## Deployment

- **Frontend**: Deploy the Next.js app to [Vercel](https://vercel.com). Set `NEXT_PUBLIC_API_URL` to your backend’s public URL.
- **Backend**: Deploy the Node.js API to [Render](https://render.com), [Railway](https://railway.app), or [Fly.io](https://fly.io). Set `ML_API_URL` to your Python ML service URL and `PORT` as required by the platform.
- **ML API**: Deploy the FastAPI app to [Railway](https://railway.app), [Render](https://render.com), or [Hugging Face Spaces](https://huggingface.co/spaces) (e.g. with Docker). Ensure the `model/` and `data/` directories (or equivalent) are present and the app listens on `0.0.0.0`.

For a single-link demo, you can host all three on the same provider (e.g. Render: one web service for Next.js or Node, one for FastAPI) and wire the URLs via environment variables.

---

## Deploy frontend to Vercel

1. **Push your project to GitHub** (if you haven’t already).
2. **Go to [vercel.com](https://vercel.com)** and sign in (e.g. with GitHub).
3. **Import the repo**: Click **Add New… → Project**, select your GitHub repo, then **Import**.
4. **Set the root directory**
  - Under **Root Directory** click **Edit**, choose **frontend**, then **Continue**.  
  - (So Vercel builds the Next.js app, not the whole monorepo.)
5. **Environment variable**
  - Open **Environment Variables**.  
  - Add: **Name** `NEXT_PUBLIC_API_URL`, **Value** = your backend’s public URL (e.g. `https://your-backend.onrender.com`).  
  - If the backend isn’t deployed yet, use a placeholder like `https://localhost:3001` and change it later in Vercel → Project → Settings → Environment Variables.
6. **Deploy**
  - Click **Deploy**.  
  - When it’s done, Vercel gives you a URL like `https://your-project.vercel.app`.

**Important:** The dashboard only works end-to-end if the **Node backend** (and optionally the **Python ML API**) are also deployed and reachable at the URL you set in `NEXT_PUBLIC_API_URL`. Deploy the backend (e.g. on [Render](https://render.com) or [Railway](https://railway.app)) first, then set `NEXT_PUBLIC_API_URL` to that URL and redeploy the frontend on Vercel if needed.

## Project Structure

```
credit_card_detection_fraud/
├── ml/                    # Python ML API
│   ├── data/
│   │   └── creditcard.csv
│   ├── model/             # model.pkl, scaler.pkl (after train.py)
│   ├── main.py            # FastAPI app
│   ├── train.py           # Train and save model
│   └── requirements.txt
├── backend/               # Node.js API (TypeScript)
│   ├── src/index.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/              # Next.js dashboard
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── package.json
│   └── next.config.js
└── README.md
```

# Dataset: [https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud](https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud)

