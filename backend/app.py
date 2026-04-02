"""
TranspoBot — Backend FastAPI
Projet GLSi L3 — ESP/UCAD
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import mysql.connector
import os
import re
import json
from decimal import Decimal
from datetime import datetime, date
import httpx
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="TranspoBot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Configuration ──────────────────────────────────────────────
DB_CONFIG = {
    "host":     os.getenv("DB_HOST", "localhost"),
    "user":     os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "transpobot"),
}

LLM_API_KEY  = os.getenv("OPENAI_API_KEY", "")
LLM_MODEL    = os.getenv("LLM_MODEL", "llama3-8b-8192")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")

# ── Schéma de la base (pour le prompt système) ─────────────────
DB_SCHEMA = """
Tables MySQL disponibles :

vehicules(id, immatriculation, type[bus/minibus/taxi], capacite, statut[actif/maintenance/hors_service], kilometrage, date_acquisition)
chauffeurs(id, nom, prenom, telephone, numero_permis, categorie_permis, disponibilite, vehicule_id, date_embauche)
lignes(id, code, nom, origine, destination, distance_km, duree_minutes)
tarifs(id, ligne_id, type_client[normal/etudiant/senior], prix)
trajets(id, ligne_id, chauffeur_id, vehicule_id, date_heure_depart, date_heure_arrivee, statut[planifie/en_cours/termine/annule], nb_passagers, recette)
incidents(id, trajet_id, type[panne/accident/retard/autre], description, gravite[faible/moyen/grave], date_incident, resolu)
"""

SYSTEM_PROMPT = f"""Tu es TranspoBot, l'assistant intelligent de la compagnie de transport.
Tu aides les gestionnaires à interroger la base de données en langage naturel.

{DB_SCHEMA}

RÈGLES IMPORTANTES :
1. Génère UNIQUEMENT des requêtes SELECT (pas de INSERT, UPDATE, DELETE, DROP, ALTER, CREATE).
2. Réponds TOUJOURS en JSON strict avec ce format exact, sans texte avant ou après :
   {{"sql": "SELECT ...", "explication": "Ce que fait la requête en français"}}
3. Si la question ne peut pas être répondue avec SQL, réponds :
   {{"sql": null, "explication": "Explication claire en français"}}
4. Utilise des alias lisibles dans les requêtes (ex: COUNT(*) as total).
5. Ajoute toujours LIMIT 100 sauf si la question demande un résultat unique.
6. Pour les dates, utilise les fonctions MySQL : NOW(), DATE_SUB(), MONTH(), YEAR().
"""

# ── Sérialisation JSON MySQL ───────────────────────────────────
def serialize(obj):
    """Convertit les types MySQL non-JSON-sérialisables."""
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, bytes):
        return bool(obj[0]) if obj else False
    raise TypeError(f"Type non sérialisable : {type(obj)}")

def serialize_rows(rows: list) -> list:
    return json.loads(json.dumps(rows, default=serialize))

# ── Validation SQL ─────────────────────────────────────────────
FORBIDDEN = re.compile(
    r'\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE)\b',
    re.IGNORECASE
)

def is_safe_sql(sql: str) -> bool:
    """Vérifie que la requête est bien un SELECT sans commandes dangereuses."""
    sql_clean = sql.strip()
    if not sql_clean.upper().startswith("SELECT"):
        return False
    if FORBIDDEN.search(sql_clean):
        return False
    return True

# ── Connexion MySQL ────────────────────────────────────────────
def get_db():
    return mysql.connector.connect(**DB_CONFIG)

def execute_query(sql: str) -> list:
    if not is_safe_sql(sql):
        raise ValueError("Requête non autorisée : seules les requêtes SELECT sont permises.")
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(sql)
        rows = cursor.fetchall()
        return serialize_rows(rows)
    finally:
        cursor.close()
        conn.close()

# ── Appel LLM ─────────────────────────────────────────────────
async def ask_llm(question: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}"},
            json={
                "model": LLM_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": question},
                ],
                "temperature": 0,
            },
            timeout=30,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]

        # Extraire le JSON même si le LLM ajoute du texte autour
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError(f"Réponse LLM invalide : {content}")

# ── Modèles ────────────────────────────────────────────────────
class ChatMessage(BaseModel):
    question: str

# ── Routes API ─────────────────────────────────────────────────
@app.post("/api/chat")
async def chat(msg: ChatMessage):
    """Question en langage naturel → SQL → résultats"""
    try:
        llm_response = await ask_llm(msg.question)
        sql = llm_response.get("sql")
        explication = llm_response.get("explication", "")

        if not sql:
            return {"answer": explication, "data": [], "sql": None}

        # Double vérification sécurité côté backend
        if not is_safe_sql(sql):
            raise ValueError("Le LLM a généré une requête non autorisée.")

        data = execute_query(sql)
        return {
            "answer": explication,
            "data": data,
            "sql": sql,
            "count": len(data),
        }
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Erreur LLM : {e.response.text}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stats")
def get_stats():
    """Tableau de bord — KPIs"""
    queries = {
        "total_trajets":    "SELECT COUNT(*) as n FROM trajets WHERE statut='termine'",
        "trajets_en_cours": "SELECT COUNT(*) as n FROM trajets WHERE statut='en_cours'",
        "vehicules_actifs": "SELECT COUNT(*) as n FROM vehicules WHERE statut='actif'",
        "incidents_ouverts":"SELECT COUNT(*) as n FROM incidents WHERE resolu=FALSE",
        "recette_totale":   "SELECT COALESCE(SUM(recette),0) as n FROM trajets WHERE statut='termine'",
    }
    stats = {}
    for key, sql in queries.items():
        result = execute_query(sql)
        stats[key] = result[0]["n"] if result else 0
    return stats

@app.get("/api/vehicules")
def get_vehicules():
    return execute_query("SELECT * FROM vehicules ORDER BY immatriculation")

@app.get("/api/chauffeurs")
def get_chauffeurs():
    return execute_query("""
        SELECT c.*, v.immatriculation
        FROM chauffeurs c
        LEFT JOIN vehicules v ON c.vehicule_id = v.id
        ORDER BY c.nom
    """)

@app.get("/api/trajets/recent")
def get_trajets_recent():
    return execute_query("""
        SELECT t.*, l.nom as ligne, ch.nom as chauffeur_nom, v.immatriculation
        FROM trajets t
        JOIN lignes l ON t.ligne_id = l.id
        JOIN chauffeurs ch ON t.chauffeur_id = ch.id
        JOIN vehicules v ON t.vehicule_id = v.id
        ORDER BY t.date_heure_depart DESC
        LIMIT 20
    """)

@app.get("/health")
def health():
    return {"status": "ok", "app": "TranspoBot", "model": LLM_MODEL}

# ── Lancement ─────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
