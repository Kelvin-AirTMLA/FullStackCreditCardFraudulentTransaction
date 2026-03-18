import os
import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, confusion_matrix
import pickle

# Paths relative to this script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
# Prefer a small deploy-friendly dataset committed to GitHub.
# If the full dataset exists locally, you can swap the filename back.
DATA_PATH = os.path.join(DATA_DIR, "creditcard_small.csv")
MODEL_DIR = os.path.join(SCRIPT_DIR, "model")

def main():
    os.makedirs(MODEL_DIR, exist_ok=True)

    print("Loading dataset...")
    df = pd.read_csv(DATA_PATH)

    # Check class distribution
    print(df["Class"].value_counts())

    # Features and target
    legit = df[df["Class"] == 0]
    fraud = df[df["Class"] == 1]

    # Undersample majority class for balanced training
    legit_sample = legit.sample(n=len(fraud), random_state=42) # reproduce 492 "legit" samples every run
    balanced_df = pd.concat([legit_sample, fraud]).sample(frac=1)

    X = balanced_df.drop("Class", axis=1)
    y = balanced_df["Class"]

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42
    )

    print("Training Logistic Regression model...")
    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))
    print("Confusion Matrix:")
    print(confusion_matrix(y_test, y_pred))

    model_path = os.path.join(MODEL_DIR, "model.pkl")
    scaler_path = os.path.join(MODEL_DIR, "scaler.pkl")
    with open(model_path, "wb") as f:
        pickle.dump(model, f)
    with open(scaler_path, "wb") as f:
        pickle.dump(scaler, f)

    print("\nModel and scaler saved to", MODEL_DIR)


if __name__ == "__main__":
    main()
