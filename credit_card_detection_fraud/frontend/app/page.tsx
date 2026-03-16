"use client";

import { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type Transaction = {
  id: string;
  Time: number;
  Amount: number;
  Class: number;
  ClassLabel: string;
};

type Stats = {
  totalAnalyzed: number;
  suspiciousCount: number;
};

type PredictionResult = {
  is_fraud: boolean;
  fraud_probability: number;
  status: string;
  error?: string;
};

const CHART_COLORS = ["#22c55e", "#ef4444"];

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<Stats>({ totalAnalyzed: 0, suspiciousCount: 0 });
  const [loading, setLoading] = useState(true);
  const [predictLoading, setPredictLoading] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualFeaturesText, setManualFeaturesText] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 500;

  
  useEffect(() => {
    let cancelled = false;
    setError(null);
    const offset = page * pageSize;
    const t = Date.now(); // cache-buster
    Promise.all([
      fetch(`${API_URL}/transactions?limit=${pageSize}&offset=${offset}&_=${t}`),
      fetch(`${API_URL}/stats`),
    ])
      .then(async ([txRes, statsRes]) => {
        if (cancelled) return;
        if (!txRes.ok) {
          const errBody = await txRes.json().catch(() => ({}));
          throw new Error(errBody.details || errBody.error || `Transactions: ${txRes.status}`);
        }
        if (!statsRes.ok) {
          const errBody = await statsRes.json().catch(() => ({}));
          throw new Error(errBody.details || errBody.error || `Stats: ${statsRes.status}`);
        }
        const [txData, statsData] = await Promise.all([txRes.json(), statsRes.json()]);
        setTransactions(txData.transactions || []);
        setStats(statsData);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [page]);

  const chartData = [
    {
      name: "Normal",
      value: transactions.filter((t) => t.Class === 0).length,
      color: CHART_COLORS[0],
    },
    {
      name: "Fraud",
      value: transactions.filter((t) => t.Class === 1).length,
      color: CHART_COLORS[1],
    },
  ].filter((d) => d.value > 0);

  const runSamplePrediction = async () => {
    setPredictLoading(true);
    setPrediction(null);
    setError(null);
    try {
      const sampleRes = await fetch(`${API_URL}/sample-transaction`);
      if (!sampleRes.ok) {
        const errBody = await sampleRes.json().catch(() => ({}));
        throw new Error(errBody.details || errBody.error || `Sample: ${sampleRes.status}`);
      }
      const sample = await sampleRes.json();
      const predictRes = await fetch(`${API_URL}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: sample.features }),
      });
      if (!predictRes.ok) {
        const errBody = await predictRes.json().catch(() => ({}));
        throw new Error(errBody.details || errBody.error || `Predict: ${predictRes.status}`);
      }
      const result: PredictionResult = await predictRes.json();
      setPrediction(result);
      const statsRes = await fetch(`${API_URL}/stats`);
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prediction failed");
    } finally {
      setPredictLoading(false);
    }
  };

  const submitManualTransaction = async () => {
    setPredictLoading(true);
    setPrediction(null);
    setError(null);
    try {
      const parts = manualFeaturesText
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      const features = parts.map((p) => Number(p));
      if (features.some((v) => Number.isNaN(v))) {
        throw new Error("All features must be numeric values.");
      }
      if (features.length !== 30) {
        throw new Error(`Expected 30 features (Time, V1–V28, Amount) but got ${features.length}.`);
      }

      const predictRes = await fetch(`${API_URL}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features }),
      });
      if (!predictRes.ok) {
        const errBody = await predictRes.json().catch(() => ({}));
        throw new Error(errBody.details || errBody.error || `Predict: ${predictRes.status}`);
      }
      const result: PredictionResult = await predictRes.json();
      setPrediction(result);
      const statsRes = await fetch(`${API_URL}/stats`);
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Manual prediction failed");
    } finally {
      setPredictLoading(false);
    }
  };

  return (
    <main className="container">
      <h1>Fraud Detection Dashboard</h1>
      <p className="subtitle">
        AI-powered transaction monitoring · Credit card fraud detection
      </p>

      {error && (
        <div className="card" style={{ borderColor: "rgba(239,68,68,0.5)" }}>
          <span className="error-msg">{error}</span>
        </div>
      )}
      <section className="stats-grid">
        <div className="stat-card">
          <div className="value">{stats.totalAnalyzed}</div>
          <div className="label">Predictions made</div>
        </div>
        <div className="stat-card">
          <div className="value">
            {transactions.filter((t) => t.Class === 1).length}
          </div>
          <div className="label">Frauds in current page</div>
        </div>
        <div className="stat-card">
          <div className="value">{transactions.length}</div>
          <div className="label">Transactions loaded</div>
        </div>
      </section>

      <section className="card">
        <h2>Fraud vs normal transactions</h2>
        <div className="chart-container">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <span className="loading">Loading chart data…</span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Transaction list</h2>
        {loading ? (
          <p className="loading">Loading transactions…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Time</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 500).map((t) => (
                  <tr key={t.id}>
                    <td>{t.id}</td>
                    <td>{(t.Time ?? 0).toFixed(1)}</td>
                    <td>${(t.Amount ?? 0).toFixed(2)}</td>
                    <td>
                      <span
                        className={`badge ${t.Class === 1 ? "fraud" : "normal"}`}
                      >
                        {t.ClassLabel ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.75rem" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
          >
            Previous {pageSize}
          </button>
          <span className="loading">
            Page {page + 1} · showing up to {transactions.length} transactions
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setPage((p) => p + 1)}
            disabled={loading || transactions.length < pageSize}
          >
            Next {pageSize}
          </button>
        </div>
      </section>

      <section className="card predict-section">
        <h2>Check fraud prediction</h2>
        <p className="loading" style={{ marginBottom: "1rem" }}>
          Use either a random transaction from the dataset or submit your own feature vector to get an AI fraud prediction.
        </p>
        <div className="predict-box">
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={runSamplePrediction}
              disabled={predictLoading}
            >
              {predictLoading ? "Checking…" : "Use sample transaction"}
            </button>

            <div>
              <p className="loading" style={{ marginBottom: "0.5rem" }}>
                Or paste 30 comma-separated numeric features (Time, V1–V28, Amount) to submit a custom transaction:
              </p>
              <textarea
                value={manualFeaturesText}
                onChange={(e) => setManualFeaturesText(e.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: 8,
                  border: "1px solid rgba(71,85,105,0.8)",
                  background: "rgba(15,23,42,0.8)",
                  color: "#e5e7eb",
                  fontSize: "0.85rem",
                  fontFamily: "monospace",
                }}
                placeholder="Example: 0.0, -1.3598, -0.0728, 2.5363, ..., 149.62, 0"
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitManualTransaction}
                disabled={predictLoading || manualFeaturesText.trim().length === 0}
                style={{ marginTop: "0.5rem" }}
              >
                {predictLoading ? "Checking…" : "Submit manual transaction"}
              </button>
            </div>
          </div>
          {prediction && (
            <div
              className={`result-box ${prediction.is_fraud ? "fraud" : "legit"}`}
            >
              <strong>Result: {prediction.status}</strong>
              <div className="prob">
                Fraud probability: {(prediction.fraud_probability * 100).toFixed(2)}%
              </div>
              {prediction.error && (
                <div className="error-msg">{prediction.error}</div>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
