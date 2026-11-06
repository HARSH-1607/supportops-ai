"""Small, transparent local ML baseline; recommendations require human review."""
from __future__ import annotations

from functools import lru_cache
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics.pairwise import cosine_similarity

EXAMPLES = {
    "critical": [
        "production outage all customers cannot access service", "security breach customer data exposed",
        "payment processing down for every customer", "database unavailable entire application offline",
        "system wide outage users cannot log in", "critical data loss after deployment",
        "all checkout transactions failing", "service unavailable across all regions",
    ],
    "high": [
        "checkout fails for several customers", "account access blocked for paying team",
        "billing charged twice for subscription", "dashboard errors prevent daily work",
        "api errors on important integration", "report export fails for all team members",
        "invoice amount incorrect for business account", "urgent workflow blocked for a customer",
    ],
    "medium": [
        "one customer cannot reset password", "page loads slowly on some browsers",
        "email notification arrived late", "search results missing some records",
        "single user sees a display bug", "request to change billing address",
        "monthly report has missing row", "intermittent error in account settings",
    ],
    "low": [
        "feature request for dark mode", "suggestion for new dashboard colors",
        "minor typo in help article", "question about optional settings",
        "request for documentation example", "cosmetic spacing issue on mobile",
        "idea for future integration", "small wording change on button",
    ],
}


@lru_cache(maxsize=1)
def priority_model():
    texts = [text for values in EXAMPLES.values() for text in values]
    labels = [label for label, values in EXAMPLES.items() for _ in values]
    vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)
    features = vectorizer.fit_transform(texts)
    model = LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42)
    model.fit(features, labels)
    return vectorizer, model


def suggest_priority(title: str, description: str) -> dict:
    vectorizer, model = priority_model()
    probabilities = model.predict_proba(vectorizer.transform([title + " " + description]))[0]
    index = int(probabilities.argmax())
    return {"priority": str(model.classes_[index]), "confidence": round(float(probabilities[index]), 3),
            "model": "tfidf-logistic-regression-demo-v1"}


def find_duplicates(title: str, description: str, candidates: list[dict], limit: int = 5) -> list[dict]:
    if not candidates:
        return []
    texts = [row["title"] + " " + row["description"] for row in candidates]
    matrix = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5)).fit_transform(texts + [title + " " + description])
    scores = cosine_similarity(matrix[-1], matrix[:-1]).ravel()
    ranked = sorted(zip(candidates, scores), key=lambda pair: pair[1], reverse=True)
    return [{"ticket_id": row["id"], "title": row["title"], "score": round(float(score), 3)}
            for row, score in ranked[:limit] if score >= 0.18]
