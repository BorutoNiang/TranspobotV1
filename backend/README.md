# TranspoBot — Backend

API REST FastAPI connectée à MySQL et à un LLM (OpenAI / Ollama).

## Prérequis

- Python 3.10+
- MySQL 8.x en cours d'exécution
- Une clé API OpenAI (ou Ollama en local)

## Installation

```bash
cd backend
```

Crée et active un environnement virtuel :

> Si PowerShell bloque l'activation avec "l'exécution de scripts est désactivée", lance cette commande une seule fois :
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

## Configuration

Copie `.env.example` en `.env` et remplis les valeurs :

```bash
cp .env.example .env
```

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=ton_mot_de_passe
DB_NAME=transpobot
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

> Pour utiliser Ollama en local, ajoute aussi :
> ```env
> LLM_BASE_URL=http://localhost:11434/v1
> LLM_MODEL=llama3
> ```

## Base de données

Importe le schéma et les données de test :

```bash
mysql -u root -p < schema.sql
```

## Lancement

```bash
uvicorn app:app --reload
```

L'API est disponible sur `http://localhost:8000`.

## Endpoints

| Méthode | Route                  | Description                        |
|---------|------------------------|------------------------------------|
| GET     | `/health`              | Vérification que l'API tourne      |
| GET     | `/api/stats`           | KPIs du tableau de bord            |
| GET     | `/api/vehicules`       | Liste des véhicules                |
| GET     | `/api/chauffeurs`      | Liste des chauffeurs               |
| GET     | `/api/trajets/recent`  | 20 derniers trajets                |
| POST    | `/api/chat`            | Question en langage naturel → SQL  |

La documentation interactive Swagger est accessible sur `http://localhost:8000/docs`.
