import os
import pandas as pd

import pickle
import numpy as np

from fastapi import FastAPI
from pydantic import BaseModel

from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from fastapi import FastAPI

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(SCRIPT_DIR, "model")
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
# Prefer a small deploy-friendly dataset committed to GitHub.
DATA_PATH = os.path.join(DATA_DIR, "creditcard_small.csv")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: load model and scaler once
    load_model()
    yield
    # Shutdown: nothing special to clean up


app = FastAPI(
    title="Fraud Detection ML API",
    lifespan=lifespan,
)


# Here I used the add_middleware() in order to block any unnecessary requests from the backend(localhost:3000) to the
# the frontend (localhost:8000)

app.add_middleware(
    CORSMiddleware,  # Cross-Origin Resource Sharing: blocks requsts between two origins
    allow_origins=["*"],  # any origin may call this API
    allow_methods=["*"],  # any HTTP method is allowed
    allow_headers=["*"],  # any header is allowed
)

# Load model and scaler at startup
model = None
scaler = None


# Load the model and scalar - this is essential in order for the the model to not be retrained every time
# and the dataset wont have to be scaled every time, this saves CPU energy and time
# so the model.pkl and scalar.pkl is loaded once the app is ran immediately


def load_model():
    global model, scaler
    model_path = os.path.join(MODEL_DIR, "model.pkl")
    scaler_path = os.path.join(MODEL_DIR, "scaler.pkl")
    if os.path.exists(model_path) and os.path.exists(scaler_path):
        with open(model_path, "rb") as f:
            model = pickle.load(f)
        with open(scaler_path, "rb") as f:
            scaler = pickle.load(f)


# BaseModel is a class that acts as a verifier to verify that all features are loaded and are safe(error-safe to be precise)
# this helps the TransactionPredict class to do its job - in summary TransactionPredict inherits from this explained BaseModel subclass
class TransactionPredict(BaseModel):
    features: list[float]  # 30 features: Time, V1..V28, Amount


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


@app.get("/sample-transaction")
def get_sample_transaction():
    """Return one random transaction with all 30 features for prediction demo."""
    df = pd.read_csv(DATA_PATH)
    row = df.sample(n=1).iloc[0]
    features = [float(row[c]) for c in df.columns if c != "Class"]
    return {
        "features": features,
        "Amount": float(row["Amount"]),
        "Time": float(row["Time"]),
    }


@app.get("/transactions")
def get_transactions(limit: int = 500, offset: int = 0):
    """Return transaction data from the dataset for the dashboard.
    Uses simple offset-based paging so the UI can browse the dataset in chunks."""
    if offset < 0:
        offset = 0

    # Skip the header row when using skiprows; start after `offset` data rows
    skip = range(1, offset + 1)
    df = pd.read_csv(DATA_PATH, skiprows=skip, nrows=limit)

    records = []
    # Use a running id that reflects the global row index (offset + local index)
    for idx, (_, row) in enumerate(df.iterrows()):
        records.append(
            {
                "id": str(offset + idx + 1),
                "Time": float(row["Time"]),
                "Amount": float(row["Amount"]),
                "Class": int(row["Class"]),
                "ClassLabel": "Fraud" if row["Class"] == 1 else "Normal",
            }
        )
    return {"transactions": records, "total": len(records), "offset": offset}


@app.post("/predict")
def predict(transaction: TransactionPredict):

    # cannot make predictions without the scaler and the model
    if model is None or scaler is None:
        return {
            "is_fraud": False,
            "fraud_probability": 0.0,
            "status": "legitimate",
            "error": "Model not loaded. Run train.py first.",
        }

    features = np.array(transaction.features).reshape(1, -1)
    scaled = scaler.transform(features)  # scale features

    prediction = model.predict(scaled)[0]
    print(prediction)

    proba = model.predict_proba(scaled)[0]  # get the last column and use it as target
    print(proba)

    fraud_probability = float(proba[1])

    return {
        "is_fraud": bool(prediction),
        "fraud_probability": round(fraud_probability, 4),
        "status": "fraudulent" if prediction == 1 else "legitimate",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
