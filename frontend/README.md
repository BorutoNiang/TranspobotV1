# TranspoBot — Frontend

Interface web en HTML/CSS/JS pur. Aucune dépendance, aucun build requis.

## Prérequis

- Le backend doit tourner sur `http://localhost:8000` (voir `backend/README.md`)

## Lancement

### Option 1 — Ouvrir directement dans le navigateur

Double-clique sur `index.html`. Simple et rapide pour le développement local.

### Option 2 — Serveur HTTP local (recommandé)

Avec Python :
```bash
cd frontend
python -m http.server 3000
```

Puis ouvre `http://localhost:3000` dans le navigateur.

## Changer l'URL du backend

Si ton backend tourne sur une autre adresse (déploiement, autre port...), modifie la première ligne de `app.js` :

```js
const API = 'http://localhost:8000'; // ← remplace par ton URL
```

## Pages disponibles

| Onglet        | Description                                      |
|---------------|--------------------------------------------------|
| Dashboard     | KPIs + liste des trajets récents                 |
| Véhicules     | Liste complète des véhicules avec statut         |
| Chauffeurs    | Liste des chauffeurs et véhicule assigné         |
| Assistant IA  | Chat en langage naturel → requête SQL → résultat |
