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

  // Pré-remplir la date incident
  var dateInput = document.getElementById('inc-date');
  if (dateInput) {
    var now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dateInput.value = now.toISOString().slice(0, 16);
  }

  loadStats();
  loadTrajets();
});

var pageTitles = { dashboard: 'Dashboard', vehicules: 'Véhicules', chauffeurs: 'Chauffeurs', trajets: 'Trajets', incidents: 'Incidents', chat: 'Assistant IA' };

function showTab(name, btn) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  document.getElementById('page-title').textContent = pageTitles[name] || name;
  if (name === 'vehicules') loadVehicules();
  if (name === 'chauffeurs') loadChauffeurs();
  if (name === 'trajets') loadTrajetsTab();
  if (name === 'incidents') { loadTrajetsSelect(); loadIncidents(); }
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

// Incidents
async function loadTrajetsSelect() {
  try {
    var r = await authFetch(API + '/api/trajets/recent');
    if (!r) return;
    var data = await r.json();
    var select = document.getElementById('inc-trajet');
    if (!select) return;
    select.innerHTML = '<option value="">— Sélectionner un trajet —</option>';
    data.forEach(function(t) {
      select.innerHTML += '<option value="' + t.id + '">' + t.ligne + ' — ' + t.chauffeur_nom + ' (' + fmtDateTime(t.date_heure_depart) + ')</option>';
    });
  } catch(e) { console.warn('Trajets select:', e); }
}

async function loadIncidents() {
  var el = document.getElementById('incidents-table');
  if (!el) return;
  el.innerHTML = '<div class="loading"><i data-lucide="loader"></i> Chargement...</div>';
  lucide.createIcons();
  try {
    var r = await authFetch(API + '/api/incidents');
    if (!r) return;
    var data = await r.json();
    el.innerHTML = buildTable(data, [
      { key: 'id',            label: '#' },
      { key: 'ligne',         label: 'Ligne' },
      { key: 'immatriculation', label: 'Véhicule' },
      { key: 'chauffeur_nom', label: 'Chauffeur' },
      { key: 'type',          label: 'Type', render: function(v) {
        var icons = { panne: '🔧', accident: '💥', retard: '⏰', autre: 'ℹ️' };
        return (icons[v] || '') + ' ' + v.charAt(0).toUpperCase() + v.slice(1);
      }},
      { key: 'gravite',       label: 'Gravité', render: function(v) {
        var map = { faible: 'badge-gray', moyen: 'badge-orange', grave: 'badge-red' };
        return '<span class="badge ' + (map[v] || 'badge-gray') + '">' + v.charAt(0).toUpperCase() + v.slice(1) + '</span>';
      }},
      { key: 'description',   label: 'Description', render: function(v) { return v || '—'; } },
      { key: 'date_incident', label: 'Date', render: fmtDateTime },
      { key: 'resolu',        label: 'Statut', render: function(v) {
        return v ? '<span class="badge badge-green">✅ Résolu</span>' : '<span class="badge badge-red">🔴 Ouvert</span>';
      }},
      { key: 'id',            label: 'Action', render: function(v, row) {
        var btns = '';
        if (row.resolu) btns += '<button class="btn-action btn-reopen" onclick="toggleResolu(' + v + ', false)">Réouvrir</button> ';
        else btns += '<button class="btn-action btn-resolve" onclick="toggleResolu(' + v + ', true)">Résoudre</button> ';
        btns += '<button class="btn-action btn-delete" onclick="deleteIncident(' + v + ')">Supprimer</button>';
        return btns;
      }},
    ]);
    lucide.createIcons();
  } catch(e) {
    el.innerHTML = '<div class="empty">Données non disponibles.</div>';
  }
}

async function submitIncident() {
  var trajetId    = document.getElementById('inc-trajet').value;
  var type        = document.getElementById('inc-type').value;
  var gravite     = document.getElementById('inc-gravite').value;
  var date        = document.getElementById('inc-date').value;
  var description = document.getElementById('inc-description').value;
  var feedback    = document.getElementById('inc-feedback');

  if (!trajetId) { showFeedback(feedback, 'Veuillez sélectionner un trajet.', 'error'); return; }
  if (!date)     { showFeedback(feedback, 'Veuillez indiquer une date.', 'error'); return; }

  var btn = document.querySelector('.btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader"></i> Envoi...';
  lucide.createIcons();

  try {
    var r = await authFetch(API + '/api/incidents', {
      method: 'POST',
      body: JSON.stringify({
        trajet_id: parseInt(trajetId),
        type: type, gravite: gravite,
        date_incident: date.replace('T', ' ') + ':00',
        description: description || null
      })
    });
    if (!r) return;
    if (!r.ok) { var err = await r.json(); showFeedback(feedback, 'Erreur : ' + (err.detail || 'inconnue'), 'error'); return; }
    showFeedback(feedback, '✅ Incident signalé ! Notification Telegram envoyée.', 'success');
    document.getElementById('inc-trajet').value = '';
    document.getElementById('inc-description').value = '';
    document.getElementById('inc-type').value = 'panne';
    document.getElementById('inc-gravite').value = 'faible';
    loadIncidents();
    loadStats();
  } catch(e) {
    showFeedback(feedback, 'Impossible de joindre le serveur.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="send"></i> Signaler l\'incident';
    lucide.createIcons();
  }
}

async function toggleResolu(id, resolu) {
  try {
    var r = await authFetch(API + '/api/incidents/' + id, { method: 'PUT', body: JSON.stringify({ resolu: resolu }) });
    if (!r || !r.ok) return;
    loadIncidents();
    loadStats();
  } catch(e) { console.warn('Toggle resolu:', e); }
}

async function deleteIncident(id) {
  if (!confirm('Supprimer cet incident ? Cette action est irréversible.')) return;
  try {
    var r = await authFetch(API + '/api/incidents/' + id, { method: 'DELETE' });
    if (!r || !r.ok) return;
    loadIncidents();
    loadStats();
  } catch(e) { console.warn('Delete incident:', e); }
}

function showFeedback(el, message, type) {
  el.textContent = message;
  el.className = 'inc-feedback ' + type;
  setTimeout(function() { el.textContent = ''; el.className = 'inc-feedback'; }, 5000);
}

function ask(question) {
  showTab('chat', document.querySelectorAll('.nav-item')[5]);
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
    // Afficher les suggestions dynamiques
    if (data.suggestions && data.suggestions.length > 0) {
      var sugDiv = document.createElement('div');
      sugDiv.className = 'chat-suggestions-dynamic';
      data.suggestions.forEach(function(s) {
        var btn = document.createElement('button');
        btn.textContent = s;
        btn.onclick = function() { ask(s); };
        sugDiv.appendChild(btn);
      });
      document.getElementById('chat-box').appendChild(sugDiv);
      document.getElementById('chat-box').scrollTop = document.getElementById('chat-box').scrollHeight;
    }
    document.getElementById('results-section').style.display = 'none';
  } catch(e) { loading.remove(); addMessage('bot', 'Impossible de joindre le serveur.'); }
  finally { btn.disabled = false; }
}
