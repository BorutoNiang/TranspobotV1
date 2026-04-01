const API = 'http://localhost:8000';

// ── Init Lucide icons ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  loadStats();
  loadTrajets();
});

// ── Navigation ────────────────────────────────────────────────
const pageTitles = {
  dashboard: 'Dashboard',
  vehicules: 'Véhicules',
  chauffeurs: 'Chauffeurs',
  trajets: 'Trajets',
  chat: 'Assistant IA',
};

function showTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  if (btn) btn.classList.add('active');
  document.getElementById('page-title').textContent = pageTitles[name] || name;

  if (name === 'vehicules') loadVehicules();
  if (name === 'chauffeurs') loadChauffeurs();
  if (name === 'trajets') loadTrajetsTab();
}

function refreshAll() {
  const icon = document.querySelector('.btn-icon svg');
  if (icon) icon.style.animation = 'spin 0.6s linear';
  setTimeout(() => { if (icon) icon.style.animation = ''; }, 700);
  loadStats();
  loadTrajets();
}

// ── Helpers ───────────────────────────────────────────────────
function badge(statut) {
  const map = {
    'termine':     ['badge-green',  'Terminé'],
    'actif':       ['badge-green',  'Actif'],
    'en_cours':    ['badge-orange', 'En cours'],
    'planifie':    ['badge-blue',   'Planifié'],
    'maintenance': ['badge-orange', 'Maintenance'],
    'annule':      ['badge-red',    'Annulé'],
    'hors_service':['badge-red',    'Hors service'],
  };
  const [cls, label] = map[statut] || ['badge-gray', statut];
  return `<span class="badge ${cls}">${label}</span>`;
}

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtNum(v) {
  return v !== undefined && v !== null ? Number(v).toLocaleString('fr-FR') : '—';
}

function buildTable(data, columns) {
  if (!data || !data.length) return '<div class="empty">Aucune donnée disponible.</div>';
  const headers = columns.map(c => `<th>${c.label}</th>`).join('');
  const rows = data.map(row =>
    `<tr>${columns.map(c => `<td>${c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}</td>`).join('')}</tr>`
  ).join('');
  return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

// ── Dashboard ─────────────────────────────────────────────────
async function loadStats() {
  try {
    const r = await fetch(`${API}/api/stats`);
    const d = await r.json();
    document.getElementById('stat-trajets').textContent   = fmtNum(d.total_trajets);
    document.getElementById('stat-encours').textContent   = fmtNum(d.trajets_en_cours);
    document.getElementById('stat-vehicules').textContent = fmtNum(d.vehicules_actifs);
    document.getElementById('stat-incidents').textContent = fmtNum(d.incidents_ouverts);
    document.getElementById('stat-recette').textContent   = fmtNum(d.recette_totale);
  } catch (e) {
    console.warn('Stats non disponibles', e);
  }
}

async function loadTrajets() {
  try {
    const r = await fetch(`${API}/api/trajets/recent`);
    const data = await r.json();
    document.getElementById('trajets-table').innerHTML = buildTable(data.slice(0, 8), [
      { key: 'ligne',             label: 'Ligne' },
      { key: 'chauffeur_nom',     label: 'Chauffeur' },
      { key: 'immatriculation',   label: 'Véhicule' },
      { key: 'date_heure_depart', label: 'Départ',    render: fmtDateTime },
      { key: 'nb_passagers',      label: 'Passagers' },
      { key: 'recette',           label: 'Recette',   render: v => fmtNum(v) + ' FCFA' },
      { key: 'statut',            label: 'Statut',    render: badge },
    ]);
    lucide.createIcons();
  } catch (e) {
    document.getElementById('trajets-table').innerHTML = '<div class="empty">Données non disponibles.</div>';
  }
}

// ── Véhicules ─────────────────────────────────────────────────
async function loadVehicules() {
  try {
    const r = await fetch(`${API}/api/vehicules`);
    const data = await r.json();
    document.getElementById('vehicules-table').innerHTML = buildTable(data, [
      { key: 'immatriculation',  label: 'Immatriculation' },
      { key: 'type',             label: 'Type',        render: v => `<span class="badge badge-blue">${v}</span>` },
      { key: 'capacite',         label: 'Capacité',    render: v => v + ' places' },
      { key: 'kilometrage',      label: 'Kilométrage', render: v => fmtNum(v) + ' km' },
      { key: 'statut',           label: 'Statut',      render: badge },
      { key: 'date_acquisition', label: 'Acquisition', render: fmtDate },
    ]);
    lucide.createIcons();
  } catch (e) {
    document.getElementById('vehicules-table').innerHTML = '<div class="empty">Données non disponibles.</div>';
  }
}

// ── Chauffeurs ────────────────────────────────────────────────
async function loadChauffeurs() {
  try {
    const r = await fetch(`${API}/api/chauffeurs`);
    const data = await r.json();
    document.getElementById('chauffeurs-table').innerHTML = buildTable(data, [
      { key: 'nom',              label: 'Nom' },
      { key: 'prenom',           label: 'Prénom' },
      { key: 'telephone',        label: 'Téléphone' },
      { key: 'categorie_permis', label: 'Permis',    render: v => `<span class="badge badge-blue">${v}</span>` },
      { key: 'immatriculation',  label: 'Véhicule',  render: v => v ?? '<span class="badge badge-gray">Non assigné</span>' },
      { key: 'disponibilite',    label: 'Disponible',
        render: v => v
          ? '<span class="badge badge-green">Disponible</span>'
          : '<span class="badge badge-red">Indisponible</span>' },
      { key: 'date_embauche',    label: 'Embauche',  render: fmtDate },
    ]);
    lucide.createIcons();
  } catch (e) {
    document.getElementById('chauffeurs-table').innerHTML = '<div class="empty">Données non disponibles.</div>';
  }
}

// ── Trajets (onglet dédié) ────────────────────────────────────
async function loadTrajetsTab() {
  try {
    const r = await fetch(`${API}/api/trajets/recent`);
    const data = await r.json();
    document.getElementById('trajets-full-table').innerHTML = buildTable(data, [
      { key: 'ligne',             label: 'Ligne' },
      { key: 'chauffeur_nom',     label: 'Chauffeur' },
      { key: 'immatriculation',   label: 'Véhicule' },
      { key: 'date_heure_depart', label: 'Départ',   render: fmtDateTime },
      { key: 'date_heure_arrivee',label: 'Arrivée',  render: fmtDateTime },
      { key: 'nb_passagers',      label: 'Passagers' },
      { key: 'recette',           label: 'Recette',  render: v => fmtNum(v) + ' FCFA' },
      { key: 'statut',            label: 'Statut',   render: badge },
    ]);
    lucide.createIcons();
  } catch (e) {
    document.getElementById('trajets-full-table').innerHTML = '<div class="empty">Données non disponibles.</div>';
  }
}

// ── Chat IA ───────────────────────────────────────────────────
function ask(question) {
  showTab('chat', document.querySelectorAll('.nav-item')[4]);
  document.getElementById('user-input').value = question;
  sendMessage();
}

function addMessage(role, text, sql = null) {
  const box = document.getElementById('chat-box');
  const div = document.createElement('div');
  div.className = `msg ${role}`;

  const avatarIcon = role === 'bot' ? 'bot' : 'user';
  const sqlBlock = sql ? `<div class="sql-preview">${sql}</div>` : '';

  div.innerHTML = `
    <div class="msg-avatar">
      <i data-lucide="${avatarIcon}"></i>
    </div>
    <div class="bubble">${text}${sqlBlock}</div>
  `;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  lucide.createIcons();
}

async function sendMessage() {
  const input = document.getElementById('user-input');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';

  addMessage('user', question);
  addMessage('bot', '<span style="color:var(--gray-400)">Analyse en cours...</span>');

  try {
    const r = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = await r.json();

    document.querySelector('#chat-box .msg.bot:last-child').remove();

    const countText = data.count !== undefined
      ? ` <span style="color:var(--gray-400);font-size:12px">(${data.count} résultat${data.count > 1 ? 's' : ''})</span>`
      : '';
    addMessage('bot', data.answer + countText, data.sql);

    const section = document.getElementById('results-section');
    if (data.data && data.data.length > 0) {
      section.style.display = 'block';
      const keys = Object.keys(data.data[0]);
      document.getElementById('results-table').innerHTML = buildTable(
        data.data,
        keys.map(k => ({ key: k, label: k }))
      );
      lucide.createIcons();
    } else {
      section.style.display = 'none';
    }
  } catch (e) {
    document.querySelector('#chat-box .msg.bot:last-child').remove();
    addMessage('bot', 'Erreur de connexion au serveur. Vérifiez que le backend est démarré.');
  }
}
