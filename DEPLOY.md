# Déploiement TranspoBot sur Railway

## Prérequis

- Compte GitHub avec le code pushé
- Compte Railway : [railway.app](https://railway.app)
- Clé API Groq : [console.groq.com](https://console.groq.com)

---

## Étape 1 — Créer le projet Railway

1. Connecte-toi sur [railway.app](https://railway.app)
2. Clique sur **New Project**
3. Choisis **Deploy from GitHub repo**
4. Sélectionne le repo `TranspobotV1`
5. Railway détecte automatiquement le `railway.toml` et lance le build

---

## Étape 2 — Ajouter la base de données MySQL

1. Dans ton projet Railway, clique sur **+ New**
2. Choisis **Database** → **MySQL**
3. Railway crée automatiquement une instance MySQL et expose les variables de connexion

---

## Étape 3 — Configurer les variables d'environnement

Dans ton service backend Railway → onglet **Variables**, ajoute :

| Variable | Valeur |
|----------|--------|
| `DB_HOST` | `${{MySQL.MYSQL_HOST}}` |
| `DB_USER` | `${{MySQL.MYSQL_USER}}` |
| `DB_PASSWORD` | `${{MySQL.MYSQL_PASSWORD}}` |
| `DB_NAME` | `${{MySQL.MYSQL_DATABASE}}` |
| `OPENAI_API_KEY` | ta clé Groq `gsk_...` |
| `LLM_MODEL` | `llama-3.3-70b-versatile` |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` |
| `JWT_SECRET` | une chaîne secrète de ton choix |

---

## Étape 4 — Importer le schéma SQL

### Option A — Via Railway CLI
```bash
npm install -g @railway/cli
railway login
railway connect MySQL
mysql -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < backend/schema.sql
```

### Option B — Via un client graphique (DBeaver, TablePlus)
1. Récupère les credentials MySQL dans Railway → onglet **Connect**
2. Connecte-toi avec ton client
3. Exécute le fichier `backend/schema.sql`

---

## Étape 5 — Vérifier le déploiement

Une fois le build terminé, Railway te donne une URL publique du type :
```
https://transpobot-production.up.railway.app
```

Teste les endpoints :
- `https://ton-url.railway.app/health` → doit retourner `{"status": "ok"}`
- `https://ton-url.railway.app/login.html` → page de connexion

---

## Étape 6 — Ajouter le compte administrateur

Si tu as réinitialisé la base, recrée le compte admin en exécutant dans MySQL :

```sql
INSERT INTO gestionnaires (nom, email, mot_de_passe) VALUES
('Administrateur', 'admin@transpobot.sn', '$2b$12$v0rc5ZYWyHshz4m9QaqIP.QFsTKuWXLOG/Ztc1yAY7fWgX2PumF3u');
```

Identifiants : `admin@transpobot.sn` / `admin123`

---

## Redéploiement automatique

Chaque `git push origin main` déclenche automatiquement un nouveau déploiement sur Railway.

```powershell
git add .
git commit -m "update"
git push origin main
```

---

## Variables locales vs production

| Variable | Local | Production |
|----------|-------|------------|
| `DB_HOST` | `localhost` | fourni par Railway |
| `API` (frontend) | `http://localhost:8000` | vide `''` (même domaine) |

Le frontend détecte automatiquement l'environnement :
```js
const API = window.location.hostname === 'localhost' ? 'http://localhost:8000' : '';
```
