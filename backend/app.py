"""
TranspoBot — Backend FastAPI
"""

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import mysql.connector
import os, re, json, bcrypt
from decimal import Decimal
from datetime import datetime, date, timedelta
import httpx
from dotenv import load_dotenv
from jose import JWTError, jwt

load_dotenv()

app = FastAPI(title="TranspoBot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_CONFIG = {
    "host":     os.getenv("DB_HOST", "localhost"),
    "user":     os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "transpobot"),
}

LLM_API_KEY  = os.getenv("OPENAI_API_KEY", "")
LLM_MODEL    = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
JWT_SECRET   = os.getenv("JWT_SECRET", "transpobot-secret-2026")

bearer_scheme = HTTPBearer()

def verify_password(plain, hashed):
    return bcrypt.checkpw(plain.encode(), hashed.encode())

def create_token(data):
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(hours=8)
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        email = payload.get("sub")
        if not email:
            raise HTTPException(status_code=401, detail="Token invalide")
        return email
    except JWTError:
        raise HTTPException(status_code=401, detail="Token invalide")

DB_SCHEMA = """
Tables MySQL disponibles :
vehicules(id, immatriculation, type[bus/minibus/taxi], capacite, statut[actif/maintenance/hors_service], kilometrage, date_acquisition)
chauffeurs(id, nom, prenom, telephone, numero_permis, categorie_permis, disponibilite, vehicule_id, date_embauche)
lignes(id, code, nom, origine, destination, distance_km, duree_minutes)
tarifs(id, ligne_id, type_client[normal/etudiant/senior], prix)
trajets(id, ligne_id, chauffeur_id, vehicule_id, date_heure_depart, date_heure_arrivee, statut[planifie/en_cours/termine/annule], nb_passagers, recette)
incidents(id, trajet_id, type[panne/accident/retard/autre], description, gravite[faible/moyen/grave], date_incident, resolu)
"""

SYSTEM_PROMPT = f"""Tu es TranspoBot, assistant intelligent de transport urbain.
{DB_SCHEMA}
REGLES :
1. Genere UNIQUEMENT des requetes SELECT.
2. Reponds TOUJOURS en JSON : {{"sql": "SELECT ...", "explication": "..."}}
3. Si pas de SQL possible : {{"sql": null, "explication": "..."}}
4. Utilise des alias clairs. Ajoute LIMIT 100.
"""

def serialize(obj):
    if isinstance(obj, Decimal): return float(obj)
    if isinstance(obj, (datetime, date)): return obj.isoformat()
    if isinstance(obj, bytes): return bool(obj[0]) if obj else False
    raise TypeError(f"Non serialisable: {type(obj)}")

def serialize_rows(rows):
    return json.loads(json.dumps(rows, default=serialize))

FORBIDDEN = re.compile(r'\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE)\b', re.IGNORECASE)

def is_safe_sql(sql):
    s = sql.strip()
    return s.upper().startswith("SELECT") and not FORBIDDEN.search(s)

def get_db():
    return mysql.connector.connect(**DB_CONFIG)

def execute_query(sql):
    if not is_safe_sql(sql):
        raise ValueError("Seules les requetes SELECT sont autorisees.")
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(sql)
        return serialize_rows(cursor.fetchall())
    finally:
        cursor.close()
        conn.close()

async def ask_llm(question):
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}"},
            json={"model": LLM_MODEL, "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": question}], "temperature": 0},
            timeout=30,
        )
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError(f"Reponse LLM invalide: {content}")

class LoginRequest(BaseModel):
    email: str
    password: str

class ChatMessage(BaseModel):
    question: str

@app.post("/api/login")
def login(req: LoginRequest):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM gestionnaires WHERE email = %s AND actif = TRUE", (req.email,))
        user = cursor.fetchone()
    finally:
        cursor.close()
        conn.close()
    if not user or not verify_password(req.password, user["mot_de_passe"]):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    token = create_token({"sub": user["email"], "nom": user["nom"]})
    return {"token": token, "nom": user["nom"], "email": user["email"]}

@app.post("/api/chat")
async def chat(msg: ChatMessage):
    try:
        llm_response = await ask_llm(msg.question)
        sql = llm_response.get("sql")
        explication = llm_response.get("explication", "")
        if not sql:
            return {"answer": explication, "data": [], "sql": None}
        if not is_safe_sql(sql):
            raise ValueError("Requete non autorisee.")
        data = execute_query(sql)
        return {"answer": explication, "data": data, "sql": sql, "count": len(data)}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Erreur LLM: {e.response.text}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stats")
def get_stats():
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
    return execute_query("SELECT c.*, v.immatriculation FROM chauffeurs c LEFT JOIN vehicules v ON c.vehicule_id = v.id ORDER BY c.nom")

@app.get("/api/trajets/recent")
def get_trajets_recent():
    return execute_query("""
        SELECT t.*, l.nom as ligne, ch.nom as chauffeur_nom, v.immatriculation
        FROM trajets t
        JOIN lignes l ON t.ligne_id = l.id
        JOIN chauffeurs ch ON t.chauffeur_id = ch.id
        JOIN vehicules v ON t.vehicule_id = v.id
        ORDER BY t.date_heure_depart DESC LIMIT 20
    """)

@app.get("/health")
def health():
    return {"status": "ok", "app": "TranspoBot", "model": LLM_MODEL}

app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
