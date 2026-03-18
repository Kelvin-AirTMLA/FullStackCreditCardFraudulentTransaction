## Development Log – Credit Card Fraud Detection Dashboard

This is my personal log for the project – what I actually did, what I got wrong at first, what I fixed, and how I used AI more like a coding partner than a “do it for me” tool.

---

### 1. Dataset exploration and CSV handling

I started with the Kaggle credit card fraud dataset (`creditcard.csv`, ~285k rows, ~143MB).

- My editor choked on the full CSV, so instead of fighting the UI I:
  - Created a smaller sample file (`creditcard_5_sample.csv`) with the first ~1000 rows.
  - Used that to quickly confirm the columns: `Time`, `V1`–`V28`, `Amount`, `Class`.
- With pandas I checked the class distribution:
  - `Class = 0` (legit): 284,315 rows.
  - `Class = 1` (fraud): 492 rows.
  - So fraud is only about **0.17%** of the data – extremely imbalanced.

What I took away from this:

- For big CSVs, it’s much more practical to explore via code (pandas, sampling) than to try to open them fully in an editor.
- With this kind of imbalance, “accuracy” alone is useless – I need to think about balancing the data or at least using metrics that care about the rare class.

---

### 2. Training the ML model (`ml/train.py`)

For the ML side I went with a **Logistic Regression** classifier in scikit‑learn.

What I implemented and understand:

- Loaded the dataset with `pandas.read_csv`.
- Split the data into two DataFrames: one for legitimate (`Class == 0`), one for fraud (`Class == 1`).
- Because fraud is so rare, I used **undersampling**:
  - Took a random sample of legitimate transactions that matches the fraud count:
    - `legit_sample = legit.sample(n=len(fraud), random_state=42)`
  - Combined `legit_sample` and `fraud`, then shuffled:
    - `balanced_df = pd.concat([legit_sample, fraud]).sample(frac=1)`
  - This gives a **balanced** training set (roughly 50/50) so the model actually learns what fraud looks like.
- Split into features and target:
  - `X = balanced_df.drop("Class", axis=1)`
  - `y = balanced_df["Class"]`
- Applied `StandardScaler` to all 30 features (Time, V1–V28, Amount).
- Did a train/test split with `random_state=42` so results are reproducible.
- Trained `LogisticRegression(max_iter=1000, random_state=42)` and checked the classification report + confusion matrix.
- Saved the trained `model` and `scaler` to `.pkl` files (`model.pkl`, `scaler.pkl`) in `ml/model/` using `pickle`.

What I learned here:

- Why undersampling makes sense for this kind of problem (otherwise the model just learns to say “not fraud” all the time).
- How `random_state` is effectively a “seed” that makes experiments repeatable.
- What pickle (`.pkl`) gives me: the ability to load a trained model and scaler without retraining on every API request.

---

### 3. Building the ML API (`ml/main.py` with FastAPI)

On top of the model, I built a small **FastAPI** app to serve predictions.

Core ideas:

- I added CORS middleware (`CORSMiddleware`) so the frontend (running on a different origin/port) can call the API without browser CORS errors.
- On startup, the app loads `model.pkl` and `scaler.pkl` once so predictions are fast and we don’t retrain on every call.
- I defined a Pydantic model `TransactionPredict(BaseModel)` with `features: list[float]`:
  - This acts as a schema/verifier for the request body.
  - If the JSON is missing fields or has wrong types, FastAPI returns a 422 instead of running broken logic.

Endpoints I implemented:

- `GET /health` – health check, also tells me if the model actually loaded.
- `GET /transactions` – the main data source for the dashboard:
  - In its current version, it supports `limit` and `offset` and uses pandas with `skiprows` to implement simple paging.
  - Returns records shaped for the UI: `id`, `Time`, `Amount`, `Class`, `ClassLabel`.
- `GET /sample-transaction` – picks one random row from the entire CSV (`df.sample(n=1).iloc[0]`) and returns all 30 features.
- `POST /predict` – runs the model:
  - Validates the payload via `TransactionPredict`.
  - Scales the features with the stored `StandardScaler`.
  - Calls `model.predict` and `model.predict_proba`.
  - Returns `is_fraud`, `fraud_probability`, and a human-readable `status`, plus a clear error if the model hasn’t been loaded.

What I learned here:

- `uvicorn` is the ASGI web server that actually runs the FastAPI app and handles HTTP.
- CORS is critical when the frontend and backend aren’t on the same origin.
- It’s cleaner to separate **training** (offline `train.py`) from **serving** (online `main.py`), and only load the saved artifacts at startup.

---

### 4. Node.js backend API (`backend/src/index.ts`)

Between the frontend and the Python service I added a small **Express + TypeScript** API.

What this layer does:

- Handles routing and CORS for the frontend.
- Knows where the Python ML API lives via environment variables:
  - `ML_API_URL` – base URL of the Python service (default `http://localhost:8000`).
  - `PORT` – port for this backend (default `3001`).
- Endpoints:
  - `GET /transactions` – forwards to `GET {ML_API_URL}/transactions` with `limit`/`offset` and returns the result.
  - `GET /sample-transaction` – forwards to `GET {ML_API_URL}/sample-transaction`.
  - `POST /predict` – forwards the body to `POST {ML_API_URL}/predict` and updates in-memory stats (`totalAnalyzed`, `suspiciousCount`).
  - `GET /stats` – returns the stats that the frontend shows in the summary cards.
  - `GET /health` – simple health check.
- Error handling:
  - Wraps each proxy call in `try/catch` and returns structured JSON errors with `error` and `details` instead of a generic 500.

On the TypeScript side I:

- Configured `tsconfig.json` with `moduleResolution: "node"` and `esModuleInterop: true` so imports like `import axios from "axios"` work properly.
- Switched to `dotenv.config()` for environment variables after debugging a `Cannot find module 'dotenv/config'` issue with ts-node-dev.

What I learned:

- How to structure a small TypeScript Express server as a proxy/middle tier.
- How easy it is to get tripped up by TypeScript module resolution (`axios` types, `moduleResolution`, etc.).
- How the env variables chain together:
  - Frontend → `NEXT_PUBLIC_API_URL` → Node backend.
  - Backend → `ML_API_URL` → Python ML API.

---

### 5. Frontend dashboard (Next.js, `frontend/app/page.tsx`)

The frontend is a Next.js 14 app (App Router) that ties everything together visually.

Main pieces:

- **Summary cards** – show:
  - Total predictions (`totalAnalyzed` from `/stats`).
  - Suspicious (fraud) count (`suspiciousCount` from `/stats`).
  - How many transactions are loaded on the current page.
- **Pie chart** (Recharts) – visualizes fraud vs normal counts for the currently loaded page.
- **Transaction table** – shows up to 500 transactions per page (ID, Time, Amount, Status).
- **Prediction section**:
  - “Use sample transaction” – pulls a random transaction from the dataset via `/sample-transaction` and runs `/predict` on it.
  - Manual input – lets me paste 30 comma‑separated features (Time, V1–V28, Amount) and send them to `/predict` for a completely custom transaction.

Key frontend logic:

- On mount (and whenever the page index changes), I:
  - Fetch `/transactions?limit=500&offset=page*500` and `/stats` in parallel from the backend.
  - Include a small cache-busting query param (`_=${Date.now()}`) to avoid cached responses.
  - Handle non‑OK responses by parsing the backend’s `error`/`details` and surfacing them in the UI.
- The **paging**:
  - Uses `page` state and `pageSize = 500`.
  - “Previous 500” / “Next 500” buttons adjust the offset and refetch, so I’m really paging through the dataset, not just randomly resampling the same front chunk.
- The **manual prediction**:
  - Parses the textarea into numeric features.
  - Validates length (must be exactly 30) and types (no NaNs).
  - Sends `{ features }` to `/predict` and then refreshes `/stats`.

What I learned:

- How to make error states clear and user‑friendly instead of just logging them.
- How a few design choices (e.g. which slice of the dataset I show, whether I fix the random seed) can make the behavior either confusing or intuitive.

---

### 6. Git, large files, and deployment prep

- Initially Git was not tracking changes because there was a root `.gitignore` with `*`, which ignored everything:
  - I fixed this by replacing it with more specific ignore rules (for `venv`, `node_modules`, etc.).
- Ran into GitHub’s 100MB file limit:
  - `creditcard.csv` (~143MB) caused a push rejection.
  - I updated `.gitignore` to exclude `ml/data/creditcard.csv` from the repo and removed it from Git history with `git rm --cached`.
  - The solution is that others (or deployment) should download the dataset themselves and place it in `ml/data/`.
- Prepared for deployment:
  - Added `.env.example` files for backend and frontend.
  - Documented in `README.md` how to deploy the frontend on **Vercel** and backend/ML API on platforms like Render/Railway, and how to wire `NEXT_PUBLIC_API_URL` and `ML_API_URL`.

What I learned:

- How `.gitignore` interacts with what Git tracks.
- Why large raw datasets generally shouldn’t be committed directly to GitHub (use local data or Git LFS for bigger workflows).
- How to set environment variables for different environments (local vs cloud).

---

### 7. How I used AI in this project

- I used an AI assistant as a **pair programmer / tutor**, not as a black-box generator:
  - Asked conceptual questions (e.g., what `BaseModel` is, what CORS does, what `uvicorn` is).
  - Asked for help debugging concrete issues (TypeScript module resolution, CORS, random sampling, Git `.gitignore`, GitHub file size limits).
  - I **read and modified the code myself**, including:
    - Changes to sampling logic and understanding of `random_state`.
    - Adjustments to Next.js fetching logic and error handling.
    - `.gitignore` fixes and Git history cleanup.
  - I also experimented (e.g., changing how many rows the table shows, changing transaction limits) and then debugged the consequences.

Overall, the assistant helped me:

- Move faster on boilerplate and cross-language wiring.
- Understand unfamiliar pieces (FastAPI, Pydantic, ASGI, etc.).
- Catch subtle issues (e.g., fixed seeds, invisible `.gitignore` rules, GitHub size limits).

But I was the one:

- Running the code locally (ML API, backend, frontend).
- Inspecting and interpreting the outputs (class distributions, fraud counts).
- Making design choices (undersampling, random sampling for the UI, environment variable wiring).
- Writing and editing code across Python, TypeScript, and React/Next.js.

---

### 8. Why FastAPI, Pydantic, and (optionally) contextlib

I also made the core tech choices on the Python side:

- **FastAPI vs. alternatives (e.g. Flask):**
  - FastAPI is async-ready, very fast, and aligns well with type hints.
  - It auto-generates OpenAPI docs and plays nicely with Pydantic models.
  - For a small ML microservice, it gives clean, modern APIs with minimal boilerplate.
- **Pydantic (`BaseModel`) instead of raw dicts:**
  - Pydantic lets me define schemas (e.g. `features: list[float]`) once and automatically:
    - Validates JSON bodies (missing/invalid fields return 422).
    - Converts types when possible (e.g. string to float).
  - This keeps the route handlers focused on logic, not manual validation.
- `**contextlib` and lifecycle management:**
  - In more advanced setups, `contextlib` (e.g. `asynccontextmanager`) can be used with FastAPI’s lifespan to manage startup/shutdown resources.
  - In this project I used `@app.on_event("startup")` to load the model and scaler, which is a simpler pattern but serves the same purpose: load heavy resources once, not per request.

In short: FastAPI + Pydantic give me a clean, type-safe, and production-friendly way to expose the ML model, and any use of `contextlib` would be about managing the app’s lifecycle cleanly rather than doing something “magic.”

---

### 9. Questions, mistakes, and my corrections

I also want to be transparent about where I got stuck, what I asked, and how I corrected things rather than just accepting AI output blindly.

- **Understanding tools and concepts**
  - I explicitly asked what things like:
    - `BaseModel` (Pydantic),
    - `.pkl` files,
    - `df.sample(...).iloc[0]`,
    - CORS,
    - `uvicorn`,
    - `ML_API_URL` vs `NEXT_PUBLIC_API_URL`
    actually do. I used the explanations to reason about validation, serialization, sampling, and how the three services (frontend, Node backend, Python API) wire together.
  - I made sure I could restate these in my own words (e.g. “BaseModel as a verifier”, “random_state fixes a sample”, “uvicorn is the ASGI web server”).
- **Initial mistakes and fixes**
  - **Huge CSV in Git & .gitignore `*`:**
    - Mistake: root `.gitignore` contained `*`, so Git tracked nothing; I also tried to push the full `creditcard.csv` (~143MB) and hit GitHub’s 100MB limit.
    - Fix: I updated the root `.gitignore` to ignore only venv/node_modules and added `ml/data/creditcard.csv` to the project-level `.gitignore`, then removed it from Git history. This was my decision to keep the repo clean and require local dataset download.
  - **Axios / TypeScript resolution error:**
    - Mistake: TypeScript/ts-node-dev couldn’t find `axios` or its types.
    - Fix: I installed dependencies in the correct folder and adjusted `tsconfig.json` (`moduleResolution: "node"`, `esModuleInterop: true`). I also verified with `npx tsc --noEmit`.
  - **dotenv import error:**
    - Mistake: Using `import "dotenv/config"` didn’t work under ts-node-dev.
    - Fix: Switched to `import dotenv from "dotenv"; dotenv.config();` which resolved correctly and kept env variables working.
  - **Transaction sampling / fraud count confusion:**
    - Mistakes:
      - Initially taking the **first N rows** of the CSV (which are mostly normal) → almost no fraud in the list.
      - Using `random_state=42` in sampling → the sample (and fraud count) never changed.
      - Later, requesting `limit=50000` from the frontend, which effectively disabled sampling on the Python side.
    - Fix:
      - I changed `get_transactions()` to read a 50k chunk and sample a smaller `limit` with **no `random_state`** so each API call gives a fresh, random subset.
      - I aligned the frontend `limit` to 500 and added a cache-busting query param so the browser doesn’t reuse old responses.
      - I explicitly asked whether the constant fraud count could be coming from `train.py`’s `random_state`; I then reasoned that `train.py` only affects model training, not the live sampling, so the real issue had to be in `main.py` and the frontend `limit`.
  - **Frontend UX vs. recruiter requirements:**
    - Initially I only had a “Use sample transaction” button that picked a random row from the dataset.
    - After re-reading the assignment (“submit a new transaction and receive a fraud prediction”) I realized this might be interpreted as **user-entered** input.
    - Fix: I added a manual submission form on the dashboard where the user can paste 30 comma‑separated features; I wrote validation logic for numeric values and exact length, then reused the same `/predict` endpoint.
  - **Pie chart vs. transaction list mismatch:**
    - Mistake: The pie chart was counting fraud/normal over all loaded transactions (500), while the table only showed the first 200 rows. This made it look like “the chart is lying” (e.g. chart says 9 fraud, table shows only 3).
    - Fix: I updated the transaction list to display all 500 rows per page, so the counts in the chart and the visible rows match. This also makes the app feel more realistic, since the table now shows the full sample the stats and chart are based on.
  - **Sample prediction vs. visible transactions:**
    - Question: I noticed that sometimes the current 500-row page contained only normal transactions, yet the “Result” box at the bottom showed a small non-zero fraud probability (e.g. 2.14%) for the sample transaction, and I wanted to understand why.
    - Explanation/Fix:
      - The sample prediction flow deliberately uses `df.sample(n=1)` over the **entire dataset**, not just the currently visible 500 rows, so it can pick any transaction in the file.
      - The model outputs a probability between 0 and 1, and even a normal transaction can get a small fraud probability; that’s how logistic regression works.
      - I confirmed that changing `df.sample(n=2)` would just pick 2 random rows but, since I still index `.iloc[0]`, only the first one would be used, so sticking with `n=1` is correct for a single-result UI.
  - **Deployment debugging (Vercel + Render)**
    - This was a stressful moment: the recruiter opened my Vercel link from his phone and the dashboard showed “Failed to load”. I opened it from my phone too and got the same error.
    - I realized the mistake was simple: **Vercel only hosts the frontend**. If the frontend is still trying to call `localhost` (or the env var isn’t set), it will work on my laptop but it will fail for anyone else.
    - What I did step-by-step:
      - I deployed my **Python ML API** to Render first and tested real endpoints like `/health` and `/transactions` (I learned that opening `/` usually just shows “Not Found”).
      - Then I deployed the **Node backend** to Render and set `ML_API_URL` so the backend can talk to the ML service.
      - Finally, I set `NEXT_PUBLIC_API_URL` in Vercel to the public backend URL and redeployed the frontend.
  - **Render Python version + scikit‑learn installs**
    - Render initially tried to use Python 3.14, and my build failed (same problem I had locally on Python 3.13): scikit‑learn/numpy didn’t have an easy wheel install and it tried to compile from source.
    - I fixed this by pinning the ML service to **Python 3.11.9** and redeploying.
  - **Making the dataset work on Render**
    - Because the full Kaggle dataset is >100MB, I couldn’t commit it to GitHub. That meant the ML service on Render had no `creditcard.csv` to read.
    - To keep it simple (and still satisfy “≥ 5,000 rows”), I generated and committed a small dataset file: `creditcard_small.csv` (5,000 rows, includes all fraud cases), and changed both `ml/main.py` and `ml/train.py` to use it by default.
  - **Why the ML service said `model_loaded:false`**
    - At one point `/health` returned `model_loaded:false`. That meant Render was running the API but it couldn’t find `model.pkl` and `scaler.pkl`.
    - The tricky part: my `.gitignore` was ignoring `*.pkl`, so even after I trained locally I couldn’t push the model files.
    - I fixed it by keeping `*.pkl` ignored generally, but explicitly allowing `ml/model/model.pkl` and `ml/model/scaler.pkl`, then redeploying. After that `/health` showed `model_loaded:true`.
  - **Backend → ML API 404 (tiny detail that broke everything)**
    - My backend was returning 502 with details “status code 404” for `/transactions`, even though the ML API worked.
    - The cause was embarrassingly small: I had set `ML_API_URL` with a trailing slash (`https://.../`), which made the backend call `//transactions` upstream.
    - I fixed it by normalizing the base URL in the backend (strip trailing slashes), redeployed, and the proxy immediately worked.

