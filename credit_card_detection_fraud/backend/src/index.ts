import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
const PORT = process.env.PORT || 3001;

const ML_API_URL = process.env.ML_API_URL || "http://localhost:8000";

// In-memory stats for predictions made through this API
let stats = {
  totalAnalyzed: 0,
  suspiciousCount: 0,
};

app.use(cors());
app.use(express.json());

// GET /sample-transaction - get one random transaction for prediction demo
app.get("/sample-transaction", async (_req, res) => {
  try {
    const { data } = await axios.get(`${ML_API_URL}/sample-transaction`, {
      timeout: 10000,
    });
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: "Failed to get sample", details: message });
  }
});

// GET /transactions - proxy to Python ML API with paging
app.get("/transactions", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 500;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const { data } = await axios.get(`${ML_API_URL}/transactions`, {
      params: { limit, offset },
      timeout: 30000,
    });
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GET /transactions error:", message);
    res.status(502).json({
      error: "Failed to fetch transactions",
      details: message,
    });
  }
});

// POST /predict - proxy to Python ML API and update stats
app.post("/predict", async (req, res) => {
  try {
    const { data } = await axios.post(`${ML_API_URL}/predict`, req.body, {
      timeout: 10000,
    });
    stats.totalAnalyzed += 1;
    if (data.is_fraud) {
      stats.suspiciousCount += 1;
    }
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("POST /predict error:", message);
    res.status(502).json({
      error: "Prediction failed",
      details: message,
    });
  }
});

// GET /stats - return summary statistics
app.get("/stats", (_req, res) => {
  res.json({
    totalAnalyzed: stats.totalAnalyzed,
    suspiciousCount: stats.suspiciousCount,
  });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
  console.log(`ML API URL: ${ML_API_URL}`);
});
