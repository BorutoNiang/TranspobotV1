const API = window.location.hostname === 'localhost' ? 'http://localhost:8000' : 'https://gregarious-ambition-production-302e.up.railway.app';

function getToken() { return localStorage.getItem('token'); }

function logout() {
  localStorage.clear();
  window.location.replace('login.html');
}

function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
  var overlay = document.getElementById('sidebar-overlay');
  if (overlay) overlay.classList.toggle('open');
}

function authFetch(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign(
    { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
    opts.headers || {}
  );
  return fetch(url, opts).then(function(r) {
    if (r.status === 401) { logout(); }
    return r;
  });
}

document.addEventListener('DOMContentLoaded', function() {
  if (!getToken()) { window.location.replace('login.html'); return; }
  lucide.createIcons();
  var nameEl = document.getElementById('user-name');
  var emailEl = document.getElementById('user-email');
  if (nameEl) nameEl.textContent = localStorage.getItem('user_nom') || 'Gestionnaire';
  if (emailEl) emailEl.textContent = localStorage.getItem('user_email') || '';
  loadStats();
  loadTrajets();
});

var pageTitles = { dashboard: 'Dashboard', vehicules: 'Véhicules', chauffeurs: 'Chauffeurs', trajets: 'Trajets', chat: 'Assistant IA' };

function showTab(name, btn) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  document.getElementById('page-title').textContent = pageTitles[name] || name;
  if (name === 'vehicules') loadVehicules();
  if (name === 'chauffeurs') loadChauffeurs();
  if (name === 'trajets') loadTrajetsTab();
  document.querySelector('.sidebar').classList.remove('open');
  var overlay = document.getElementById('sidebar-overlay');
  if (overlay) overlay.classList.remove('open');
}

function refreshAll() {
  loadStats();
  loadTrajets();
}

function badge(statut) {
  var map = {
    'termine':     ['badge-green',  'Terminé'],
    'actif':       ['badge-green',  'Actif'],
    'en_cours':    ['badge-orange', 'En cours'],
    'planifie':    ['badge-blue',   'Planifié'],
    'maintenance': ['badge-orange', 'Maintenance'],
    'annule':      ['badge-red',    'Annulé'],
    'hors_service':['badge-red',    'Hors service'],
  };
  var entry = map[statut] || ['badge-gray', statut];
  return '<span class="badge ' + entry[0] + '">' + entry[1] + '</span>';
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
  return (v !== undefined && v !== null) ? Number(v).toLocaleString('fr-FR') : '—';
}

function buildTable(data, columns) {
  if (!data || !data.length) return '<div class="empty">Aucune donnée disponible.</div>';
  var headers = columns.map(function(c) { return '<th>' + c.label + '</th>'; }).join('');
  var rows = data.map(function(row) {
    return '<tr>' + columns.map(function(c) {
      var val = c.render ? c.render(row[c.key], row) : (row[c.key] != null ? row[c.key] : '—');
      return '<td>' + val + '</td>';
    }).join('') + '</tr>';
  }).join('');
  return '<table><thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

async function loadStats() {
  try {
    var r = await authFetch(API + '/api/stats');
    if (!r) return;
    var d = await r.json();
    document.getElementById('stat-trajets').textContent   = fmtNum(d.total_trajets);
    document.getElementById('stat-encours').textContent   = fmtNum(d.trajets_en_cours);
    document.getElementById('stat-vehicules').textContent = fmtNum(d.vehicules_actifs);
    document.getElementById('stat-incidents').textContent = fmtNum(d.incidents_ouverts);
    document.getElementById('stat-recette').textContent   = fmtNum(d.recette_totale);
  } catch(e) { console.warn('Stats:', e); }
}

async function loadTrajets() {
  try {
    var r = await authFetch(API + '/api/trajets/recent');
    if (!r) return;
    var data = await r.json();
    document.getElementById('trajets-table').innerHTML = buildTable(data.slice(0, 8), [
      { key: 'ligne',             label: 'Ligne' },
      { key: 'chauffeur_nom',     label: 'Chauffeur' },
      { key: 'immatriculation',   label: 'Véhicule' },
      { key: 'date_heure_depart', label: 'Départ',   render: fmtDateTime },
      { key: 'nb_passagers',      label: 'Passagers' },
      { key: 'recette',           label: 'Recette',  render: function(v) { return fmtNum(v) + ' FCFA'; } },
      { key: 'statut',            label: 'Statut',   render: badge },
    ]);
    lucide.createIcons();
  } catch(e) {
    document.getElementById('trajets-table').innerHTML = '<div class="empty">Données non disponibles.</div>';
  }
}

async function loadVehicules() {
  try {
    var r = await authFetch(API + '/api/vehicules');
    if (!r) return;
    var data = await r.json();
    document.getElementById('vehicules-table').innerHTML = buildTable(data, [
      { key: 'immatriculation',  label: 'Immatriculation' },
      { key: 'type',             label: 'Type',        render: function(v) { return '<span class="badge badge-blue">' + v + '</span>'; } },
      { key: 'capacite',         label: 'Capacité',    render: function(v) { return v + ' places'; } },
      { key: 'kilometrage',      label: 'Kilométrage', render: function(v) { return fmtNum(v) + ' km'; } },
      { key: 'statut',           label: 'Statut',      render: badge },
      { key: 'date_acquisition', label: 'Acquisition', render: fmtDate },
    ]);
    lucide.createIcons();
  } catch(e) {
    document.getElementById('vehicules-table').innerHTML = '<div class="empty">Données non disponibles.</div>';
  }
}

async function loadChauffeurs() {
  try {
    var r = await authFetch(API + '/api/chauffeurs');
    if (!r) return;
    var data = await r.json();
    document.getElementById('chauffeurs-table').innerHTML = buildTable(data, [
      { key: 'nom',              label: 'Nom' },
      { key: 'prenom',           label: 'Prénom' },
      { key: 'telephone',        label: 'Téléphone' },
      { key: 'categorie_permis', label: 'Permis',     render: function(v) { return '<span class="badge badge-blue">' + v + '</span>'; } },
      { key: 'immatriculation',  label: 'Véhicule',   render: function(v) { return v || '<span class="badge badge-gray">Non assigné</span>'; } },
      { key: 'disponibilite',    label: 'Disponible', render: function(v) { return v ? '<span class="badge badge-green">Disponible</span>' : '<span class="badge badge-red">Indisponible</span>'; } },
      { key: 'date_embauche',    label: 'Embauche',   render: fmtDate },
    ]);
    lucide.createIcons();
  } catch(e) {
    document.getElementById('chauffeurs-table').innerHTML = '<div class="empty">Données non disponibles.</div>';
  }
}

async function loadTrajetsTab() {
  try {
    var r = await authFetch(API + '/api/trajets/recent');
    if (!r) return;
    var data = await r.json();
    document.getElementById('trajets-full-table').innerHTML = buildTable(data, [
      { key: 'ligne',              label: 'Ligne' },
      { key: 'chauffeur_nom',      label: 'Chauffeur' },
      { key: 'immatriculation',    label: 'Véhicule' },
      { key: 'date_heure_depart',  label: 'Départ',  render: fmtDateTime },
      { key: 'date_heure_arrivee', label: 'Arrivée', render: fmtDateTime },
      { key: 'nb_passagers',       label: 'Passagers' },
      { key: 'recette',            label: 'Recette', render: function(v) { return fmtNum(v) + ' FCFA'; } },
      { key: 'statut',             label: 'Statut',  render: badge },
    ]);
    lucide.createIcons();
  } catch(e) {
    document.getElementById('trajets-full-table').innerHTML = '<div class="empty">Données non disponibles.</div>';
  }
}

function ask(question) {
  showTab('chat', document.querySelectorAll('.nav-item')[4]);
  document.getElementById('user-input').value = question;
  sendMessage();
}

function addMessage(role, text, sql, tableHtml) {
  var box = document.getElementById('chat-box');
  var div = document.createElement('div');
  div.className = 'msg ' + role;
  var icon = role === 'bot' ? 'bot' : 'user';
  var sqlBlock = sql ? '<div class="sql-preview">' + sql + '</div>' : '';
  var tableBlock = tableHtml ? tableHtml : '';
  div.innerHTML = '<div class="msg-avatar"><i data-lucide="' + icon + '"></i></div><div class="bubble">' + text + sqlBlock + tableBlock + '</div>';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  lucide.createIcons();
  return div;
}

async function sendMessage() {
  var input = document.getElementById('user-input');
  var question = input.value.trim();
  if (!question) return;
  input.value = '';
  var btn = document.querySelector('.btn-send');
  btn.disabled = true;
  addMessage('user', question);
  var loading = addMessage('bot', '<span style="color:var(--gray-400)">Analyse en cours...</span>');
  try {
    var r = await authFetch(API + '/api/chat', { method: 'POST', body: JSON.stringify({ question: question }) });
    loading.remove();
    if (!r) return;
    if (!r.ok) { var err = await r.json(); addMessage('bot', 'Erreur : ' + (err.detail || '?')); return; }
    var data = await r.json();
    var ct = '';
    if (data.data && data.data.length > 0) {
      var keys = Object.keys(data.data[0]);
      var tableHtml = '<div class="table-wrap">' + buildTable(data.data, keys.map(function(k) { return { key: k, label: k }; })) + '</div>';
      addMessage('bot', data.answer + ct, data.sql, tableHtml);
    } else {
      addMessage('bot', data.answer + ct, data.sql);
    }
    document.getElementById('results-section').style.display = 'none';
  } catch(e) { loading.remove(); addMessage('bot', 'Impossible de joindre le serveur.'); }
  finally { btn.disabled = false; }
}
