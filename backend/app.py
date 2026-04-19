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

TELEGRAM_TOKEN   = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

async def send_telegram(message: str):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                json={"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "HTML"},
                timeout=10,
            )
    except Exception as e:
        print(f"[Telegram] Erreur: {e}")

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

SYSTEM_PROMPT = f"""Tu es TranspoBot, assistant sympathique de gestion de transport urbain.
{DB_SCHEMA}
REGLES :
1. Genere UNIQUEMENT des requetes SELECT. JAMAIS de DELETE, INSERT, UPDATE, DROP, ALTER.
2. Si l'utilisateur demande de supprimer, modifier ou effacer des données, reponds OBLIGATOIREMENT :
   {{"sql": null, "explication": "Je ne peux pas effectuer cette opération. Je suis uniquement autorisé à consulter les données, pas à les modifier ou supprimer."}}
3. Reponds TOUJOURS en JSON : {{"sql": "SELECT ...", "explication": "..."}}
4. L'explication doit etre chaleureuse, informative et inclure les resultats concrets quand possible.
   - Mentionne les chiffres, noms, et details importants directement dans la reponse.
   - Garde un ton positif et professionnel.
   - Maximum 3-4 phrases.
5. Utilise des alias clairs. Ajoute LIMIT 100.
"""

def serialize(obj):
    if isinstance(obj, Decimal): return float(obj)
    if isinstance(obj, (datetime, date)): return obj.isoformat()
    if isinstance(obj, bytes): return bool(obj[0]) if obj else False
    raise TypeError(f"Non serialisable: {type(obj)}")

def serialize_rows(rows):
    # Convertir les floats entiers en int pour éviter le .0
    result = json.loads(json.dumps(rows, default=serialize))
    for row in result:
        for k, v in row.items():
            if isinstance(v, float) and v == int(v):
                row[k] = int(v)
    return result

FORBIDDEN = re.compile(
    r'\b('
    r'INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|MERGE'
    r'|RENAME|LOCK|UNLOCK|FLUSH|RESET|PURGE|LOAD|CALL|EXEC|EXECUTE'
    r'|SLEEP|BENCHMARK|WAIT|DELAY|PG_SLEEP'
    r'|INTO\s+OUTFILE|INTO\s+DUMPFILE|LOAD_FILE'
    r'|INFORMATION_SCHEMA|SYS\.|MYSQL\.'
    r')\b',
    re.IGNORECASE
)

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
        cursor.execute("SET SESSION MAX_EXECUTION_TIME=5000")
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

async def generate_answer(question: str, data: list) -> str:
    """Génère une réponse chaleureuse basée sur les vrais résultats."""
    data_preview = str(data[:10]) if data else "aucun résultat"
    prompt = f"""Question : "{question}"
Résultats de la requête : {data_preview}

Réponds en français, 1-2 phrases max, de façon directe et chaleureuse.
- Si le résultat est un nombre (COUNT, SUM...), dis simplement ce nombre avec contexte. Ex: "Cette semaine, 5 trajets ont été effectués."
- Si 0 résultat : sois honnête mais positif. Ex: "Aucun trajet enregistré cette semaine."
- Cite les noms/valeurs concrets si disponibles.
- Ne dis JAMAIS "le nombre de résultats est de X" ou "selon les données disponibles".
- Pas de phrases techniques. Juste la réponse utile.
Réponds uniquement avec le texte, sans JSON ni guillemets."""

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}"},
            json={"model": LLM_MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0.2},
            timeout=20,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()

class LoginRequest(BaseModel):
    email: str
    password: str

class ChatMessage(BaseModel):
    question: str

class IncidentCreate(BaseModel):
    trajet_id: int
    type: str
    description: str = None
    gravite: str = "faible"
    date_incident: str

class IncidentUpdate(BaseModel):
    type: str = None
    description: str = None
    gravite: str = None
    resolu: bool = None

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
        answer = await generate_answer(msg.question, data)
        return {"answer": answer, "data": data, "sql": sql, "count": len(data)}
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

@app.post("/api/incidents")
async def create_incident(incident: IncidentCreate, email: str = Depends(verify_token)):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("""
            SELECT t.id, l.nom as ligne, ch.nom as chauffeur_nom, ch.prenom as chauffeur_prenom, v.immatriculation
            FROM trajets t
            JOIN lignes l ON t.ligne_id = l.id
            JOIN chauffeurs ch ON t.chauffeur_id = ch.id
            JOIN vehicules v ON t.vehicule_id = v.id
            WHERE t.id = %s
        """, (incident.trajet_id,))
        trajet = cursor.fetchone()

        cursor.execute("""
            INSERT INTO incidents (trajet_id, type, description, gravite, date_incident, resolu)
            VALUES (%s, %s, %s, %s, %s, FALSE)
        """, (incident.trajet_id, incident.type, incident.description, incident.gravite, incident.date_incident))
        conn.commit()
        incident_id = cursor.lastrowid

        gravite_emoji = {"faible": "🟡", "moyen": "🟠", "grave": "🔴"}.get(incident.gravite, "⚠️")
        type_emoji    = {"panne": "🔧", "accident": "💥", "retard": "⏰", "autre": "ℹ️"}.get(incident.type, "📋")
        ligne_info    = trajet["ligne"] if trajet else f"Trajet #{incident.trajet_id}"
        chauffeur     = f"{trajet['chauffeur_prenom']} {trajet['chauffeur_nom']}" if trajet else "Inconnu"
        vehicule      = trajet["immatriculation"] if trajet else "Inconnu"

        message = (
            f"{gravite_emoji} <b>NOUVEL INCIDENT — TranspoBot</b>\n\n"
            f"{type_emoji} <b>Type :</b> {incident.type.capitalize()}\n"
            f"🚨 <b>Gravité :</b> {incident.gravite.capitalize()}\n"
            f"🚌 <b>Véhicule :</b> {vehicule}\n"
            f"👤 <b>Chauffeur :</b> {chauffeur}\n"
            f"🗺️ <b>Ligne :</b> {ligne_info}\n"
            f"📝 <b>Description :</b> {incident.description or 'Aucune'}\n"
            f"🕐 <b>Date :</b> {incident.date_incident}\n"
            f"🔖 <b>Incident #</b>{incident_id}"
        )
        await send_telegram(message)
        return {"id": incident_id, "message": "Incident créé et notification envoyée"}
    finally:
        cursor.close()
        conn.close()

@app.put("/api/incidents/{incident_id}")
async def update_incident(incident_id: int, update: IncidentUpdate, email: str = Depends(verify_token)):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM incidents WHERE id = %s", (incident_id,))
        existing = cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Incident non trouvé")

        fields, values = [], []
        if update.type is not None:        fields.append("type = %s");        values.append(update.type)
        if update.description is not None: fields.append("description = %s"); values.append(update.description)
        if update.gravite is not None:     fields.append("gravite = %s");     values.append(update.gravite)
        if update.resolu is not None:      fields.append("resolu = %s");      values.append(update.resolu)

        if fields:
            values.append(incident_id)
            cursor.execute(f"UPDATE incidents SET {', '.join(fields)} WHERE id = %s", values)
            conn.commit()

        if update.resolu is True and not existing["resolu"]:
            await send_telegram(
                f"✅ <b>INCIDENT RÉSOLU — TranspoBot</b>\n\n"
                f"L'incident <b>#{incident_id}</b> a été marqué comme résolu.\n"
                f"Type : {existing['type'].capitalize()} | Gravité : {existing['gravite'].capitalize()}"
            )
        elif update.resolu is False and existing["resolu"]:
            await send_telegram(
                f"🔄 <b>INCIDENT RÉOUVERT — TranspoBot</b>\n\n"
                f"L'incident <b>#{incident_id}</b> a été réouvert.\n"
                f"Type : {existing['type'].capitalize()} | Gravité : {existing['gravite'].capitalize()}"
            )
        return {"message": "Incident mis à jour"}
    finally:
        cursor.close()
        conn.close()

@app.delete("/api/incidents/{incident_id}")
async def delete_incident(incident_id: int, email: str = Depends(verify_token)):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM incidents WHERE id = %s", (incident_id,))
        existing = cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Incident non trouvé")
        cursor.execute("DELETE FROM incidents WHERE id = %s", (incident_id,))
        conn.commit()
        return {"message": "Incident supprimé"}
    finally:
        cursor.close()
        conn.close()

@app.get("/api/incidents")
def get_incidents(email: str = Depends(verify_token)):
    return execute_query("""
        SELECT i.*, t.id as trajet_ref, l.nom as ligne, v.immatriculation, ch.nom as chauffeur_nom
        FROM incidents i
        JOIN trajets t ON i.trajet_id = t.id
        JOIN lignes l ON t.ligne_id = l.id
        JOIN vehicules v ON t.vehicule_id = v.id
        JOIN chauffeurs ch ON t.chauffeur_id = ch.id
        ORDER BY i.date_incident DESC
    """)

@app.get("/health")
def health():
    return {"status": "ok", "app": "TranspoBot", "model": LLM_MODEL}

@app.get("/api/init-db")
def init_db():
    """Route temporaire pour initialiser la BDD sur Railway"""
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS gestionnaires (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nom VARCHAR(100) NOT NULL,
                email VARCHAR(150) NOT NULL UNIQUE,
                mot_de_passe VARCHAR(255) NOT NULL,
                actif BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            INSERT IGNORE INTO gestionnaires (nom, email, mot_de_passe) VALUES
            ('Administrateur', 'admin@transpobot.sn', '$2b$12$v0rc5ZYWyHshz4m9QaqIP.QFsTKuWXLOG/Ztc1yAY7fWgX2PumF3u')
        """)
        conn.commit()
        return {"status": "ok", "message": "Base de données initialisée"}
    finally:
        cursor.close()
        conn.close()

frontend_path = os.path.join(os.path.dirname(__file__), "../frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)



