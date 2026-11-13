/* Suivi AF — application de suivi des missions (navigateur, sans étape de build) */
(() => {
  'use strict';

  // ------------------------------------------------------------------ outils
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const JOUR = 864e5;
  const pad = (n) => String(n).padStart(2, '0');
  const isoJour = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const aujourdhui = () => isoJour(new Date());
  const d0 = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const ecartJours = (a, b) => Math.round((d0(a) - d0(b)) / JOUR);
  const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const fmtDate = (s) => { if (!s) return ''; const d = d0(s); return `${d.getDate()} ${MOIS_COURT[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`; };
  const fmtPts = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))} pts`;
  const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
  function ilYA(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return "à l'instant";
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    const j = ecartJours(aujourdhui(), isoJour(new Date(iso)));
    if (j === 1) return 'hier';
    if (j < 7) return `il y a ${j} jours`;
    return 'le ' + fmtDate(isoJour(new Date(iso)));
  }
  function dansJ(fin) {
    const j = ecartJours(fin, aujourdhui());
    if (j > 1) return `dans ${j} jours`;
    if (j === 1) return 'demain';
    if (j === 0) return "aujourd'hui";
    if (j === -1) return 'depuis hier';
    return `depuis ${-j} jours`;
  }
  const lienSur = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : null);

  const ICONES = {
    tdb: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z"/>',
    missions: '<path d="M5 6h14M5 12h14M5 18h9"/>',
    agenda: '<path d="M5 6h14v14H5zM5 10h14M9 3v4M15 3v4"/>',
    alertes: '<path d="M6 17h12l-1.5-2.5V10a4.5 4.5 0 0 0-9 0v4.5zM10 20h4"/>',
    equipe: '<path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M16 11a2.5 2.5 0 1 0 0-5M17.5 14.8c1.7.5 2.7 1.9 3 4.2"/>',
  };
  ICONES.dataroom = '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM8 13h8"/>';
  const icone = (n) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n]}</svg>`;

  // États d'une mission : libellé + symbole (jamais la couleur seule)
  const ETATS = {
    avance:    { nom: 'En avance',          sym: '▲' },
    rythme:    { nom: 'Dans les temps',     sym: '●' },
    retard:    { nom: 'En retard',          sym: '▼' },
    depassee:  { nom: 'Échéance dépassée',  sym: '!' },
    a_valider: { nom: 'À valider',          sym: '◆' },
    validee:   { nom: 'Validée',            sym: '✓' },
    a_venir:   { nom: 'À venir',            sym: '○' },
  };
  const NIVEAUX = {
    'au-dessus':  { nom: 'Au-dessus du rythme', etat: 'avance' },
    'dans':       { nom: 'Dans le rythme',      etat: 'rythme' },
    'en-dessous': { nom: 'En dessous du rythme', etat: 'retard' },
    'aucune':     { nom: 'Aucune mission en cours', etat: 'a_venir' },
  };
  const ROLES = { admin: 'Administrateur', responsable: 'Responsable', membre: 'Membre' };

  // ------------------------------------------------------------------ état
  const CFG = window.SUIVI_AF_CONFIG || {};
  const etatApp = {
    session: null, moi: null, pret: false,
    profils: [], missions: [], journal: [], params: null, invitations: [],
    documents: [], docsDispo: true,
    vue: 'tableau-de-bord',
    f: { q: '', pole: '', etat: '', qui: 'toutes' },
    tdbPole: '',
    mois: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
    majLe: null, direct: false,
    dlg: null, // { type, id, ... }
  };
  const VUES = ['tableau-de-bord', 'missions', 'agenda', 'alertes', 'equipe', 'data-room'];
  const BUCKET = 'data-room';
  const TAILLE_MAX = 50 * 1024 * 1024;
  let sb = null;

  // ------------------------------------------------------------------ calculs
  const P = () => etatApp.params || { tolerance: 10, jours_alerte: 7, jours_inactif: 7, poles: [], sous_poles: [], types_mission: [], nom_asso: 'Association' };
  const profil = (id) => etatApp.profils.find((p) => p.id === id);
  const nomDe = (id) => { const p = profil(id); return p ? `${p.prenom} ${p.nom}`.trim() : 'Ancien membre'; };
  const initiales = (id) => { const p = profil(id); return p ? ((p.prenom[0] || '') + (p.nom[0] || '')).toUpperCase() : '?'; };
  const equipeDe = (m) => (m.mission_membres || []).map((x) => x.profil_id);
  const estAssigne = (m, id = etatApp.moi?.id) => equipeDe(m).includes(id);
  const estAdmin = () => etatApp.moi?.role === 'admin';
  function controle(p, pole, sousPole) {
    if (!p || !p.actif) return false;
    if (p.role === 'admin') return true;
    return p.role === 'responsable' && (!p.pole || p.pole === pole) && (!p.sous_pole || p.sous_pole === (sousPole || null));
  }
  const peutControler = (m) => controle(etatApp.moi, m.pole, m.sous_pole);
  const peutMettreAJour = (m) => peutControler(m) || ((estAssigne(m) || m.cree_par === etatApp.moi?.id) && m.statut !== 'validee');
  const peutDeposer = () => ['admin', 'responsable'].includes(etatApp.moi?.role);
  const fmtTaille = (o) => (o == null ? '' : o < 1024 ? `${o} o` : o < 1048576 ? `${Math.round(o / 1024)} Ko` : `${(o / 1048576).toFixed(1).replace('.', ',')} Mo`);
  const extDe = (n) => { const m = /\.([a-z0-9]{1,5})$/i.exec(n || ''); return m ? m[1].toUpperCase() : 'DOC'; };
  // Le stockage n'accepte que des noms simples : on garde le vrai nom à part, pour l'affichage
  function cheminStockage(nom) {
    const propre = String(nom).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'fichier';
    return `${crypto.randomUUID()}/${propre}`;
  }
  const peutValider = (m) => peutControler(m) && (estAdmin() || !estAssigne(m));

  // Rythme attendu : linéaire du premier au dernier jour (50 % à mi-parcours, 100 % à l'échéance)
  function attendu(m, t = Date.now()) {
    const s = d0(m.debut).getTime(), e = d0(m.fin).getTime() + JOUR;
    if (t <= s) return 0;
    if (t >= e) return 100;
    return ((t - s) / (e - s)) * 100;
  }
  function etatDe(m) {
    if (m.statut === 'validee') return 'validee';
    if (m.statut === 'a_valider') return 'a_valider';
    const t = Date.now();
    if (t >= d0(m.fin).getTime() + JOUR) return 'depassee';
    if (t < d0(m.debut).getTime()) return 'a_venir';
    const e = m.progression - attendu(m);
    if (e >= P().tolerance) return 'avance';
    if (e >= -P().tolerance) return 'rythme';
    return 'retard';
  }
  // Synthèse d'un groupe de missions (association, pôle, personne)
  function synthese(liste) {
    const r = { total: liste.length, actives: 0, retard: 0, aValider: 0, validees: 0, aTemps: 0, aVenir: 0, fait: 0, att: 0 };
    let sFait = 0, sAtt = 0;
    for (const m of liste) {
      const e = etatDe(m);
      if (e === 'validee') {
        r.validees++;
        if (!m.soumise_le || isoJour(new Date(m.soumise_le)) <= m.fin) r.aTemps++;
        continue;
      }
      if (e === 'a_venir') { r.aVenir++; continue; }
      r.actives++;
      if (e === 'a_valider') r.aValider++;
      if (e === 'retard' || e === 'depassee') r.retard++;
      sFait += m.progression;
      sAtt += e === 'a_valider' ? Math.min(100, attendu(m)) : attendu(m);
    }
    if (r.actives) { r.fait = sFait / r.actives; r.att = sAtt / r.actives; }
    r.ecart = r.fait - r.att;
    r.niveau = !r.actives ? 'aucune' : r.ecart >= P().tolerance ? 'au-dessus' : r.ecart >= -P().tolerance ? 'dans' : 'en-dessous';
    return r;
  }
  function alertes() {
    const out = [];
    const moi = etatApp.moi;
    if (!moi) return out;
    for (const m of etatApp.missions) {
      const e = etatDe(m), mien = estAssigne(m), ctrl = peutControler(m);
      const j = ecartJours(m.fin, aujourdhui());
      const enCours = ['avance', 'rythme', 'retard', 'depassee'].includes(e);
      const inactif = enCours ? Math.floor((Date.now() - new Date(m.updated_at).getTime()) / JOUR) : 0;
      const att = Math.round(attendu(m));
      if (mien) {
        if (e === 'depassee') out.push({ pour: 'moi', niv: 'depassee', m, texte: `Échéance dépassée ${dansJ(m.fin)} : ${m.progression} % réalisé.` });
        else if (e === 'retard') out.push({ pour: 'moi', niv: 'retard', m, texte: `En retard sur le rythme : ${m.progression} % réalisé pour ${att} % attendu.` });
        else if (enCours && j <= P().jours_alerte) out.push({ pour: 'moi', niv: 'rythme', m, texte: `Échéance ${dansJ(m.fin)} : il reste ${100 - m.progression} % à réaliser.` });
        if (enCours && inactif >= P().jours_inactif) out.push({ pour: 'moi', niv: 'a_venir', m, texte: `Aucune mise à jour depuis ${inactif} jours. Indiquez où vous en êtes.` });
      }
      if (ctrl) {
        if (e === 'a_valider' && peutValider(m)) out.push({ pour: 'perimetre', niv: 'a_valider', m, texte: `Déclarée terminée par ${equipeDe(m).map(nomDe).join(', ') || 'son équipe'} : à vérifier et valider.` });
        if (!mien && e === 'depassee') out.push({ pour: 'perimetre', niv: 'depassee', m, texte: `Échéance dépassée ${dansJ(m.fin)} : ${m.progression} % réalisé.` });
        else if (!mien && e === 'retard') out.push({ pour: 'perimetre', niv: 'retard', m, texte: `En retard sur le rythme : ${m.progression} % réalisé pour ${att} % attendu.` });
        if (!mien && enCours && inactif >= P().jours_inactif) out.push({ pour: 'perimetre', niv: 'a_venir', m, texte: `Aucune mise à jour depuis ${inactif} jours.` });
        if (e !== 'validee' && !equipeDe(m).length) out.push({ pour: 'perimetre', niv: 'a_venir', m, texte: 'Personne n\'est assigné à cette mission.' });
      }
    }
    const ordre = { depassee: 0, retard: 1, a_valider: 2, rythme: 3, a_venir: 4 };
    return out.sort((a, b) => ordre[a.niv] - ordre[b.niv] || a.m.fin.localeCompare(b.m.fin));
  }

  // ------------------------------------------------------------------ composants
  const badge = (e) => `<span class="badge etat-${e}"><span class="badge-sym" aria-hidden="true">${ETATS[e].sym}</span>${ETATS[e].nom}</span>`;
  function barre(fait, att, e, opts = {}) {
    const f = Math.max(0, Math.min(100, fait)), a = Math.max(0, Math.min(100, att));
    const repere = opts.sansRepere ? '' : `<span class="rythme-repere" style="left:${a.toFixed(1)}%"></span>`;
    const txt = opts.sansRepere ? `Avancement ${Math.round(f)} %` : `Avancement ${Math.round(f)} %, rythme attendu ${Math.round(a)} %`;
    return `<span class="rythme etat-${e}${opts.grand ? ' rythme-grand' : ''}" role="img" aria-label="${txt}" title="${txt}">
      <span class="rythme-piste"><span class="rythme-fait" style="width:${f.toFixed(1)}%"></span></span>${repere}</span>`;
  }
  const pastilles = (ids) => ids.length
    ? `<span class="pastilles">${ids.slice(0, 4).map((id) => `<span class="pastille" title="${esc(nomDe(id))}">${esc(initiales(id))}</span>`).join('')}${ids.length > 4 ? `<span class="pastille pastille-plus">+${ids.length - 4}</span>` : ''}</span>`
    : '<span class="discret">Non assignée</span>';
  const options = (liste, sel, vide) => (vide !== undefined ? `<option value="">${esc(vide)}</option>` : '') + liste.map((v) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const perimetre = (p) => (p.pole ? p.pole + (p.sous_pole ? ' / ' + p.sous_pole : '') : 'Tous les pôles');

  function toast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = msg;
    $('#toasts').append(t);
    setTimeout(() => t.remove(), type === 'erreur' ? 7000 : 3500);
  }
  function msgErreur(e) {
    const m = (e && (e.message || e.msg)) || String(e);
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Connexion impossible. Vérifiez votre accès à Internet puis réessayez.';
    if (/row-level security|permission denied/i.test(m)) return "Action non autorisée avec votre rôle.";
    if (/JWT expired/i.test(m)) return 'Session expirée : reconnectez-vous.';
    return m;
  }
  async function exec(promesse, succes) {
    try {
      const r = await promesse;
      if (r && r.error) throw r.error;
      if (succes) toast(succes, 'ok');
      return r || true;
    } catch (e) { toast(msgErreur(e), 'erreur'); return null; }
  }

  // ------------------------------------------------------------------ vues
  function vueTableauDeBord() {
    const poles = [...new Set([...P().poles, ...etatApp.missions.map((m) => m.pole)])];
    const filtre = etatApp.tdbPole;
    const missions = etatApp.missions.filter((m) => !filtre || m.pole === filtre);
    const s = synthese(missions);
    const niv = NIVEAUX[s.niveau];
    const sujet = filtre ? `Le pôle ${filtre}` : P().nom_asso;
    const phrase = s.niveau === 'aucune'
      ? `${sujet} n'a aucune mission en cours`
      : `${sujet} est ${niv.nom.toLowerCase()}`;

    const moi = etatApp.moi;
    const mesEnCours = etatApp.missions.filter((m) => estAssigne(m) && m.statut !== 'validee').length;
    const aValider = etatApp.missions.filter((m) => etatDe(m) === 'a_valider' && peutValider(m)).length;
    const nbAlertes = alertes().length;
    let h = `<section class="hero">
      <div class="hero-haut">
        <p class="hero-bonjour">Bonjour ${esc(moi.prenom)}</p>
        <select id="tdb-pole" data-change="tdb-pole" aria-label="Périmètre affiché">${options(poles, filtre, "Toute l'association")}</select>
      </div>
      <h1 class="rythme-phrase">${esc(phrase)}</h1>
      <div class="raccourcis">
        <button class="raccourci" type="button" data-action="raccourci" data-vue="missions" data-qui="miennes"><strong>${mesEnCours}</strong> ${mesEnCours > 1 ? 'missions pour vous' : 'mission pour vous'}</button>
        ${moi.role !== 'membre' ? `<button class="raccourci" type="button" data-action="raccourci" data-vue="missions" data-etat="a_valider"><strong>${aValider}</strong> à valider</button>` : ''}
        <button class="raccourci" type="button" data-action="raccourci" data-vue="alertes"><strong>${nbAlertes}</strong> ${nbAlertes > 1 ? 'alertes' : 'alerte'}</button>
      </div>
    </section>

    <section class="bloc carte-rythme etat-${niv.etat}">
      ${s.actives ? `
      <div class="carte-rythme-tete"><h2>Avancement moyen face au rythme attendu</h2><span class="badge etat-${niv.etat}"><span class="badge-sym" aria-hidden="true">${ETATS[niv.etat].sym}</span>${niv.nom}</span></div>
      <div class="rythme-hero">
        ${barre(s.fait, s.att, niv.etat, { grand: true })}
        <dl class="rythme-chiffres">
          <div><dt>Réalisé</dt><dd>${Math.round(s.fait)} %</dd></div>
          <div><dt>Attendu à ce jour</dt><dd>${Math.round(s.att)} %</dd></div>
          <div><dt>Écart</dt><dd>${fmtPts(s.ecart)}</dd></div>
        </dl>
      </div>
      <p class="discret">Moyenne des ${pluriel(s.actives, 'mission en cours', 'missions en cours')}. Le trait vertical marque le rythme attendu : 50 % à mi-parcours, 100 % à l'échéance. Tolérance : ${P().tolerance} points.</p>`
      : `<p class="discret">Créez une mission depuis l'onglet Missions pour commencer le suivi.</p>`}
    </section>

    <section class="tuiles" aria-label="Chiffres clés">
      <div class="tuile"><span class="tuile-val">${s.actives}</span><span class="tuile-nom">en cours</span></div>
      <div class="tuile${s.retard ? ' tuile-alerte' : ''}"><span class="tuile-val">${s.retard}</span><span class="tuile-nom">en retard</span></div>
      <div class="tuile"><span class="tuile-val">${s.aValider}</span><span class="tuile-nom">à valider</span></div>
      <div class="tuile"><span class="tuile-val">${s.validees}</span><span class="tuile-nom">validées${s.validees ? `, dont ${s.aTemps} dans les délais` : ''}</span></div>
    </section>`;

    // Par pôle et sous-pôle
    const lignesPoles = [];
    for (const pole of (filtre ? [filtre] : poles)) {
      const duPole = missions.filter((m) => m.pole === pole);
      if (!duPole.length) continue;
      lignesPoles.push({ nom: pole, s: synthese(duPole), niveau: 0 });
      const sous = [...new Set(duPole.map((m) => m.sous_pole).filter(Boolean))];
      for (const sp of sous) lignesPoles.push({ nom: sp, s: synthese(duPole.filter((m) => m.sous_pole === sp)), niveau: 1 });
    }
    h += `<section class="bloc"><h2>Par pôle</h2>${lignesPoles.length ? tableRythme(lignesPoles, 'Pôle') : '<p class="discret">Aucune mission pour ce périmètre.</p>'}</section>`;

    // Par membre
    const lignesMembres = etatApp.profils
      .filter((p) => p.actif && (!filtre || p.pole === filtre || missions.some((m) => estAssigne(m, p.id))))
      .map((p) => ({ nom: `${p.prenom} ${p.nom}`, sous: p.poste || ROLES[p.role], s: synthese(missions.filter((m) => estAssigne(m, p.id))), niveau: 0 }))
      .filter((l) => l.s.total);
    h += `<section class="bloc"><h2>Par membre</h2>${lignesMembres.length ? tableRythme(lignesMembres, 'Membre') : '<p class="discret">Aucune mission assignée pour ce périmètre.</p>'}</section>`;

    // Activité récente
    const ids = new Set(missions.map((m) => m.id));
    const recents = etatApp.journal.filter((j) => ids.has(j.mission_id)).slice(0, 12);
    h += `<section class="bloc"><h2>Activité récente</h2>${recents.length ? `<ul class="fil">${recents.map(ligneJournal).join('')}</ul>` : '<p class="discret">Les mises à jour des membres apparaîtront ici.</p>'}</section>`;
    return h;
  }
  function tableRythme(lignes, titre) {
    return `<div class="table-defile"><table class="table-rythme">
      <thead><tr><th>${titre}</th><th>Avancement et rythme attendu</th><th class="num">Réalisé</th><th class="num">Écart</th><th>Situation</th><th class="num">En retard</th><th class="num">Validées</th></tr></thead>
      <tbody>${lignes.map((l) => {
        const n = NIVEAUX[l.s.niveau];
        return `<tr class="${l.niveau ? 'ligne-sous' : ''}">
          <th scope="row">${esc(l.nom)}${l.sous ? `<span class="sous-nom">${esc(l.sous)}</span>` : ''}</th>
          <td class="col-barre">${l.s.actives ? barre(l.s.fait, l.s.att, n.etat) : '<span class="discret">–</span>'}</td>
          <td class="num">${l.s.actives ? Math.round(l.s.fait) + ' %' : '–'}</td>
          <td class="num">${l.s.actives ? fmtPts(l.s.ecart) : '–'}</td>
          <td><span class="badge etat-${n.etat}"><span class="badge-sym" aria-hidden="true">${ETATS[n.etat].sym}</span>${n.nom}</span></td>
          <td class="num">${l.s.retard}</td>
          <td class="num">${l.s.validees}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }
  function ligneJournal(j) {
    const m = etatApp.missions.find((x) => x.id === j.mission_id);
    const qui = j.auteur ? nomDe(j.auteur) : 'Système';
    const quoi = {
      creation: 'a créé',
      progression: `a mis à jour (${j.progression} %)`,
      soumission: 'a déclaré terminée',
      validation: 'a validé',
      renvoi: `a renvoyé en cours (${j.progression} %)`,
      modification: 'a modifié',
      commentaire: 'a commenté',
    }[j.type];
    return `<li><span class="fil-quand">${ilYA(j.created_at)}</span>
      <span><strong>${esc(qui)}</strong> ${quoi}${m ? ` <button class="lien" type="button" data-action="ouvrir" data-id="${m.id}">${esc(m.titre)}</button>` : ''}${j.message ? `<span class="fil-msg">${esc(j.message)}</span>` : ''}</span></li>`;
  }

  function missionsFiltrees() {
    const f = etatApp.f, q = f.q.trim().toLowerCase();
    return etatApp.missions.filter((m) => {
      if (f.pole && m.pole !== f.pole) return false;
      if (f.qui === 'miennes' && !estAssigne(m)) return false;
      const e = etatDe(m);
      if (f.etat === 'en_cours' && ['validee', 'a_venir'].includes(e)) return false;
      if (f.etat === 'retard' && !['retard', 'depassee'].includes(e)) return false;
      if (f.etat && !['en_cours', 'retard'].includes(f.etat) && e !== f.etat) return false;
      if (q && !(`${m.titre} ${m.type} ${m.pole} ${m.sous_pole || ''} ${equipeDe(m).map(nomDe).join(' ')}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => (a.statut === 'validee') - (b.statut === 'validee') || a.fin.localeCompare(b.fin));
  }
  function carteMission(m) {
    const e = etatDe(m), att = attendu(m);
    const fini = e === 'validee' || e === 'a_valider';
    let action = '';
    if (e === 'a_valider' && peutValider(m)) action = `<button class="btn btn-principal btn-petit" type="button" data-action="ouvrir" data-id="${m.id}">Vérifier</button>`;
    else if (peutMettreAJour(m) && !fini) action = `<button class="btn btn-petit" type="button" data-action="ouvrir" data-id="${m.id}">Mettre à jour</button>`;
    return `<li class="mission">
      <div class="mission-tete">
        <button class="mission-titre" type="button" data-action="ouvrir" data-id="${m.id}">${esc(m.titre)}</button>
        ${badge(e)}
      </div>
      <p class="mission-meta">${esc(m.type)}, ${esc(m.pole)}${m.sous_pole ? ' / ' + esc(m.sous_pole) : ''}</p>
      <div class="mission-rythme">
        ${barre(m.progression, att, e, { sansRepere: fini || e === 'a_venir' })}
        <span class="mission-pct">${m.progression} %</span>
        ${fini || e === 'a_venir' ? '' : `<span class="discret">attendu ${Math.round(att)} %</span>`}
      </div>
      <div class="mission-pied">
        ${pastilles(equipeDe(m))}
        <span class="mission-date">${e === 'validee' ? 'Échéance du ' + fmtDate(m.fin) : `Échéance le ${fmtDate(m.fin)} (${dansJ(m.fin)})`}</span>
        ${action}
      </div>
    </li>`;
  }
  function vueMissions() {
    const f = etatApp.f;
    const poles = [...new Set([...P().poles, ...etatApp.missions.map((m) => m.pole)])];
    const liste = missionsFiltrees();
    const etats = [['', 'Tous les états'], ['en_cours', 'En cours (toutes)'], ['retard', 'En retard ou dépassées'], ['a_valider', 'À valider'], ['validee', 'Validées'], ['a_venir', 'À venir']];
    return `<header class="entete">
      <h1>Missions</h1>
      <button class="btn btn-principal" type="button" data-action="nouvelle">Nouvelle mission</button>
    </header>
    <div class="filtres">
      <div class="segment" role="group" aria-label="Missions affichées">
        <button type="button" data-action="filtre-qui" data-qui="toutes" aria-pressed="${f.qui === 'toutes'}">Toutes</button>
        <button type="button" data-action="filtre-qui" data-qui="miennes" aria-pressed="${f.qui === 'miennes'}">Mes missions</button>
      </div>
      <select id="f-pole" data-change="filtre" data-cle="pole" aria-label="Pôle">${options(poles, f.pole, 'Tous les pôles')}</select>
      <select id="f-etat" data-change="filtre" data-cle="etat" aria-label="État">${etats.map(([v, n]) => `<option value="${v}"${v === f.etat ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <input id="f-q" type="search" placeholder="Rechercher une mission ou un membre" value="${esc(f.q)}" data-input="recherche" aria-label="Rechercher">
    </div>
    ${liste.length ? `<ul class="missions">${liste.map(carteMission).join('')}</ul>`
      : `<div class="vide"><p>${etatApp.missions.length ? 'Aucune mission ne correspond à ces filtres.' : "Aucune mission pour l'instant."}</p>
          ${etatApp.missions.length ? '<button class="btn" type="button" data-action="filtres-raz">Effacer les filtres</button>' : '<button class="btn btn-principal" type="button" data-action="nouvelle">Créer la première mission</button>'}</div>`}`;
  }

  function vueAgenda() {
    const mois = etatApp.mois, an = mois.getFullYear(), mo = mois.getMonth();
    const premier = new Date(an, mo, 1), decal = (premier.getDay() + 6) % 7;
    const nbJours = new Date(an, mo + 1, 0).getDate();
    const parJour = {};
    for (const m of etatApp.missions) (parJour[m.fin] = parJour[m.fin] || []).push(m);
    const auj = aujourdhui();
    let cases = '';
    for (let i = 0; i < decal; i++) cases += '<div class="jour jour-vide"></div>';
    for (let j = 1; j <= nbJours; j++) {
      const cle = `${an}-${pad(mo + 1)}-${pad(j)}`;
      const ms = parJour[cle] || [];
      cases += `<div class="jour${cle === auj ? ' jour-auj' : ''}"><span class="jour-num">${j}</span>
        ${ms.map((m) => { const e = etatDe(m); return `<button class="puce etat-${e}" type="button" data-action="ouvrir" data-id="${m.id}" title="${esc(m.titre)} – ${ETATS[e].nom}"><span aria-hidden="true">${ETATS[e].sym}</span> ${esc(m.titre)}</button>`; }).join('')}</div>`;
    }
    for (let i = (decal + nbJours) % 7; i > 0 && i < 7; i++) cases += '<div class="jour jour-vide"></div>';
    const prefixe = `${an}-${pad(mo + 1)}`;
    const duMois = etatApp.missions.filter((m) => m.fin.startsWith(prefixe)).sort((a, b) => a.fin.localeCompare(b.fin));
    const token = P().agenda_token;
    const urlIcs = token ? `${CFG.supabaseUrl}/rest/v1/rpc/agenda_ics?token=${token}&apikey=${encodeURIComponent(CFG.supabaseKey)}` : '';
    return `<header class="entete">
      <h1>Agenda des échéances</h1>
      <div class="mois-nav">
        <button class="btn btn-petit" type="button" data-action="mois" data-pas="-1" aria-label="Mois précédent">‹</button>
        <strong class="mois-nom">${MOIS[mo]} ${an}</strong>
        <button class="btn btn-petit" type="button" data-action="mois" data-pas="1" aria-label="Mois suivant">›</button>
        <button class="btn btn-petit" type="button" data-action="mois" data-pas="0">Aujourd'hui</button>
      </div>
    </header>
    <section class="bloc calendrier-bloc">
      <div class="calendrier" aria-hidden="true">
        ${['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((j) => `<div class="jour-nom">${j}</div>`).join('')}
        ${cases}
      </div>
      <h2 class="${duMois.length ? '' : 'masque-grand'}">Échéances de ${MOIS[mo].toLowerCase()}</h2>
      ${duMois.length ? `<ul class="echeances">${duMois.map((m) => `<li>
          <span class="echeance-date">${fmtDate(m.fin)}</span>
          <button class="lien" type="button" data-action="ouvrir" data-id="${m.id}">${esc(m.titre)}</button>
          <span class="discret">${esc(m.pole)}${equipeDe(m).length ? ', ' + esc(equipeDe(m).map(nomDe).join(', ')) : ''}</span>
          ${badge(etatDe(m))}</li>`).join('')}</ul>` : '<p class="discret">Aucune échéance ce mois-ci.</p>'}
    </section>
    <section class="bloc">
      <h2>Relier au Google Agenda de l'association</h2>
      <p>Ajoutez ce lien dans Google Agenda : toutes les échéances y apparaissent et se mettent à jour seules. Google actualise les agendas abonnés à son rythme, souvent en quelques heures, pas à la minute.</p>
      <div class="copie">
        <input type="text" readonly value="${esc(urlIcs)}" id="url-ics" aria-label="Lien d'abonnement à l'agenda">
        <button class="btn" type="button" data-action="copier" data-cible="url-ics">Copier le lien</button>
      </div>
      <ol class="etapes">
        <li>Dans Google Agenda, à gauche : « Autres agendas », bouton +, puis « À partir de l'URL ».</li>
        <li>Collez le lien, puis validez.</li>
        <li>Le lien est le même pour tous : chaque membre peut refaire ces deux étapes dans son propre agenda.</li>
      </ol>
      <p class="discret">Pour un rappel sur une échéance précise, ouvrez la mission et choisissez « Ajouter à Google Agenda ».</p>
      <button class="btn" type="button" data-action="ics">Télécharger les échéances (.ics)</button>
    </section>`;
  }

  function vueAlertes() {
    const a = alertes();
    const bloc = (titre, liste, vide) => `<section class="bloc"><h2>${titre}</h2>${liste.length ? `<ul class="alertes">${liste.map((x) => `<li class="alerte etat-${x.niv}">
        <span class="alerte-sym" aria-hidden="true">${ETATS[x.niv].sym}</span>
        <div><button class="lien alerte-titre" type="button" data-action="ouvrir" data-id="${x.m.id}">${esc(x.m.titre)}</button>
        <p>${esc(x.texte)}</p></div>
        <button class="btn btn-petit" type="button" data-action="ouvrir" data-id="${x.m.id}">Ouvrir</button></li>`).join('')}</ul>` : `<p class="discret">${vide}</p>`}</section>`;
    const moi = a.filter((x) => x.pour === 'moi'), per = a.filter((x) => x.pour === 'perimetre');
    const responsable = etatApp.moi.role !== 'membre';
    return `<header class="entete"><h1>Alertes</h1></header>
      ${bloc('Vos missions', moi, 'Rien à signaler sur vos missions.')}
      ${responsable ? bloc(`Votre périmètre (${esc(perimetre(etatApp.moi))})`, per, 'Rien à signaler dans votre périmètre.') : ''}
      <p class="discret">Une alerte apparaît quand une échéance approche (${P().jours_alerte} jours), quand l'avancement passe sous le rythme attendu de plus de ${P().tolerance} points, ou sans mise à jour depuis ${P().jours_inactif} jours.</p>`;
  }

  function vueEquipe() {
    const admin = estAdmin();
    const groupes = {};
    for (const p of etatApp.profils) (groupes[p.pole || 'Bureau / tous les pôles'] = groupes[p.pole || 'Bureau / tous les pôles'] || []).push(p);
    let h = `<header class="entete"><h1>Équipe</h1><span class="discret">${pluriel(etatApp.profils.filter((p) => p.actif).length, 'compte actif', 'comptes actifs')}</span></header>`;
    for (const [pole, gens] of Object.entries(groupes).sort()) {
      h += `<section class="bloc"><h2>${esc(pole)}</h2><div class="table-defile"><table class="table-equipe">
        <thead><tr><th>Membre</th><th>Poste</th><th>Rôle dans le suivi</th><th class="num">Missions en cours</th><th>Situation</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>
        ${gens.sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => {
          const s = synthese(etatApp.missions.filter((m) => estAssigne(m, p.id)));
          const n = NIVEAUX[s.niveau];
          return `<tr class="${p.actif ? '' : 'inactif'}">
            <th scope="row">${esc(p.prenom)} ${esc(p.nom)}${p.id === etatApp.moi.id ? ' <span class="discret">(vous)</span>' : ''}${p.actif ? '' : ' <span class="discret">(désactivé)</span>'}</th>
            <td>${esc(p.poste || '')}${p.sous_pole ? `<span class="sous-nom">${esc(p.sous_pole)}</span>` : ''}</td>
            <td>${ROLES[p.role]}${p.role === 'responsable' ? `<span class="sous-nom">valide : ${esc(perimetre(p))}</span>` : ''}</td>
            <td class="num">${s.actives}</td>
            <td>${s.actives ? `<span class="badge etat-${n.etat}"><span class="badge-sym" aria-hidden="true">${ETATS[n.etat].sym}</span>${n.nom}</span>` : '<span class="discret">–</span>'}</td>
            ${admin ? `<td class="num"><button class="btn btn-petit" type="button" data-action="membre" data-id="${p.id}">Modifier</button></td>` : ''}
          </tr>`;
        }).join('')}</tbody></table></div></section>`;
    }
    if (admin) h += vueAdmin();
    return h;
  }
  function vueAdmin() {
    const inv = etatApp.invitations;
    const enAttente = inv.filter((i) => !i.utilisee_le).length;
    const pr = P();
    return `<section class="bloc"><h2>Invitations</h2>
      <p>Chaque membre crée son compte avec son e-mail et son code personnel. Son pôle, son poste et son rôle viennent de cette liste. ${pluriel(enAttente, 'invitation en attente', 'invitations en attente')} sur ${inv.length}.</p>
      ${inv.length ? `<div class="table-defile"><table class="table-equipe"><thead><tr><th>Membre</th><th>E-mail</th><th>Pôle</th><th>Poste</th><th>Rôle</th><th>Code</th><th>Compte</th><th></th></tr></thead><tbody>
        ${inv.map((i) => `<tr>
          <th scope="row">${esc(i.prenom)} ${esc(i.nom)}</th><td>${esc(i.email)}</td>
          <td>${esc(i.pole || 'Tous')}${i.sous_pole ? `<span class="sous-nom">${esc(i.sous_pole)}</span>` : ''}</td>
          <td>${esc(i.poste || '')}</td><td>${ROLES[i.role]}</td>
          <td><code>${esc(i.code)}</code></td>
          <td>${i.utilisee_le ? 'Créé' : '<span class="discret">En attente</span>'}</td>
          <td class="num">${i.utilisee_le ? '' : `<button class="btn btn-petit" type="button" data-action="inv-message" data-email="${esc(i.email)}">Copier le message</button> `}<button class="btn btn-petit" type="button" data-action="inv-suppr" data-email="${esc(i.email)}">Retirer</button></td>
        </tr>`).join('')}</tbody></table></div>` : ''}
      <div class="actions">
        <button class="btn btn-principal" type="button" data-action="inv-ajout">Inviter un membre</button>
        <button class="btn" type="button" data-action="inv-import">Importer une liste</button>
        ${enAttente ? '<button class="btn" type="button" data-action="inv-messages">Copier tous les messages en attente</button>' : ''}
      </div>
    </section>
    <section class="bloc"><h2>Réglages</h2>
      <form id="form-reglages" class="form-grille">
        <label>Nom de l'association<input name="nom_asso" value="${esc(pr.nom_asso)}" required></label>
        <label>Tolérance autour du rythme (points)<input name="tolerance" type="number" min="0" max="50" value="${pr.tolerance}" required></label>
        <label>Alerte d'échéance proche (jours)<input name="jours_alerte" type="number" min="1" max="60" value="${pr.jours_alerte}" required></label>
        <label>Alerte sans mise à jour (jours)<input name="jours_inactif" type="number" min="1" max="60" value="${pr.jours_inactif}" required></label>
        <label>Pôles (un par ligne)<textarea name="poles" rows="4">${esc(pr.poles.join('\n'))}</textarea></label>
        <label>Sous-pôles (un par ligne)<textarea name="sous_poles" rows="4">${esc(pr.sous_poles.join('\n'))}</textarea></label>
        <label class="large">Types de mission (un par ligne)<textarea name="types_mission" rows="5">${esc(pr.types_mission.join('\n'))}</textarea></label>
        <div class="large"><button class="btn btn-principal" type="submit">Enregistrer les réglages</button></div>
      </form>
    </section>`;
  }

  function ligneDocument(d) {
    const fichier = d.genre === 'fichier', depot = peutDeposer();
    const lien = lienSur(d.url);
    const maj = new Date(d.updated_at) - new Date(d.created_at) > 60000;
    return `<li class="document">
      <span class="doc-type${fichier ? '' : ' doc-lien'}" aria-hidden="true">${fichier ? esc(extDe(d.nom_fichier)) : 'LIEN'}</span>
      <div class="doc-corps">
        <strong class="doc-titre">${esc(d.titre)}</strong>
        ${d.description ? `<p class="doc-desc">${esc(d.description)}</p>` : ''}
        <p class="discret">${fichier ? `${esc(d.nom_fichier)}, ${fmtTaille(d.taille)}` : 'Document en ligne'}<br>Ajouté le ${fmtDate(isoJour(new Date(d.created_at)))} par ${esc(d.ajoute_par ? nomDe(d.ajoute_par) : 'un administrateur')}${maj ? `, mis à jour ${ilYA(d.updated_at)}` : ''}</p>
      </div>
      <div class="doc-actions">
        ${fichier ? `<button class="btn btn-principal btn-petit" type="button" data-action="doc-telecharger" data-id="${d.id}">Télécharger</button>`
          : (lien ? `<a class="btn btn-principal btn-petit" href="${esc(lien)}" target="_blank" rel="noopener noreferrer">Ouvrir</a>` : '')}
        ${depot && fichier ? `<button class="btn btn-petit" type="button" data-action="doc-remplacer" data-id="${d.id}">Remplacer</button>` : ''}
        ${depot ? `<button class="btn btn-petit btn-danger" type="button" data-action="doc-supprimer" data-id="${d.id}">Retirer</button>` : ''}
      </div>
    </li>`;
  }
  function vueDataRoom() {
    const depot = peutDeposer();
    const bouton = '<button class="btn btn-principal" type="button" data-action="doc-ajout">Ajouter un document</button>';
    let h = `<header class="entete"><h1>Data Room</h1>${depot && etatApp.docsDispo && etatApp.documents.length ? bouton : ''}</header>`;
    if (!etatApp.docsDispo) return h + '<div class="vide"><p>La Data Room n\'est pas encore activée dans la base de données.</p><p class="discret">Un administrateur doit relancer le script supabase/schema.sql.</p></div>';
    if (!etatApp.documents.length) {
      return h + `<div class="vide"><p>La Data Room est vide.</p>
        <p class="discret">${depot ? 'Déposez un fichier, ou ajoutez le lien d\'un document en ligne. Tous les membres y auront accès.' : 'Les responsables y déposeront les fichiers de l\'association.'}</p>${depot ? bouton : ''}</div>`;
    }
    return h + `<ul class="documents">${etatApp.documents.map(ligneDocument).join('')}</ul>
      <p class="discret">Un fichier déposé ici est une copie conservée : pour le modifier, téléchargez-le, puis remplacez-le par la nouvelle version. Pour travailler à plusieurs en même temps, ajoutez le lien d'un document en ligne (Excel Online, Google Sheets).</p>`;
  }

  // ------------------------------------------------------------------ rendu
  const RENDUS = { 'tableau-de-bord': vueTableauDeBord, missions: vueMissions, agenda: vueAgenda, alertes: vueAlertes, equipe: vueEquipe, 'data-room': vueDataRoom };
  function rendre() {
    if (!etatApp.pret) return;
    const main = $('#main');
    const actif = document.activeElement;
    const idActif = actif && main.contains(actif) && actif.id ? actif.id : null;
    let pos = null;
    try { pos = idActif ? actif.selectionStart : null; } catch { /* champ sans sélection */ }
    // Ne pas écraser un formulaire en cours de saisie (réglages) lors d'une actualisation automatique
    if (main.dataset.saisie === '1' && main.dataset.vue === etatApp.vue && actif && actif.closest && actif.closest('#form-reglages')) return;
    main.innerHTML = RENDUS[etatApp.vue]();
    main.dataset.vue = etatApp.vue;
    if (idActif) {
      const n = document.getElementById(idActif);
      if (n) { n.focus(); try { if (pos !== null) n.setSelectionRange(pos, pos); } catch { /* ignore */ } }
    }
    rendreNav();
  }
  function rendreNav() {
    const nb = alertes().length;
    const items = [['tableau-de-bord', 'Tableau de bord', 'tdb', 'Synthèse'], ['missions', 'Missions', 'missions'], ['agenda', 'Agenda', 'agenda'], ['alertes', 'Alertes', 'alertes'], ['equipe', 'Équipe', 'equipe'], ['data-room', 'Data Room', 'dataroom', 'Data']];
    $('#nav').innerHTML = items.map(([v, n, i, court]) => `<a href="#${v}" class="nav-lien"${etatApp.vue === v ? ' aria-current="page"' : ''}>${icone(i)}<span${court ? ` class="nav-long"` : ''}>${n}</span>${court ? `<span class="nav-court" aria-hidden="true">${court}</span>` : ''}${v === 'alertes' && nb ? `<span class="nav-nb" aria-label="${nb} alertes">${nb}</span>` : ''}</a>`).join('');
    const moi = etatApp.moi;
    $('#compte-nom').textContent = `${moi.prenom} ${moi.nom}`;
    $('#compte-poste').textContent = [moi.poste, ROLES[moi.role]].filter(Boolean).join(', ');
    $('#marque-nom').textContent = P().nom_asso;
    const sync = $('#sync');
    sync.className = 'marque-sync' + (etatApp.direct ? ' en-direct' : '');
    sync.textContent = etatApp.majLe ? `${etatApp.direct ? 'En direct' : 'Actualisé'} à ${pad(etatApp.majLe.getHours())}:${pad(etatApp.majLe.getMinutes())}` : '';
    sync.title = etatApp.direct ? 'Les changements des autres membres apparaissent immédiatement.' : 'Actualisation automatique chaque minute.';
  }
  function allerA(vue) {
    etatApp.vue = VUES.includes(vue) ? vue : 'tableau-de-bord';
    $('#main').dataset.saisie = '0';
    rendre();
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ données
  let enCharge = false, encoreUneFois = false;
  async function charger() {
    if (enCharge) { encoreUneFois = true; return; }
    enCharge = true;
    try {
      const uid = etatApp.session.user.id;
      const [p, m, j, par, docs] = await Promise.all([
        sb.from('profils').select('*').order('nom'),
        sb.from('missions').select('*, mission_membres(profil_id)').order('fin'),
        sb.from('journal').select('*').order('created_at', { ascending: false }).limit(300),
        sb.from('parametres').select('*').eq('id', 1).maybeSingle(),
        sb.from('documents').select('*').order('created_at', { ascending: false }),
      ]);
      const err = p.error || m.error || j.error || par.error;
      if (err) throw err;
      etatApp.profils = p.data; etatApp.missions = m.data; etatApp.journal = j.data; etatApp.params = par.data;
      // La Data Room ne doit pas bloquer le reste si sa table n'est pas encore installée
      etatApp.docsDispo = !docs.error; etatApp.documents = docs.data || [];
      etatApp.moi = p.data.find((x) => x.id === uid) || null;
      if (etatApp.moi?.role === 'admin') {
        const inv = await sb.from('invitations').select('*').order('nom');
        if (!inv.error) etatApp.invitations = inv.data;
      }
      etatApp.majLe = new Date();
      const actif = !!(etatApp.moi && etatApp.moi.actif && etatApp.params);
      etatApp.pret = actif;
      afficherEcran(actif ? 'app' : 'ecran-inactif');
      if (actif) { rendre(); rafraichirDialogue(); }
    } catch (e) {
      if (!etatApp.pret) { afficherEcran('ecran-auth'); montrerErreur('err-connexion', msgErreur(e)); }
      else toast(msgErreur(e), 'erreur');
    } finally {
      enCharge = false;
      if (encoreUneFois) { encoreUneFois = false; charger(); }
    }
  }
  let minuteur = null;
  const planifier = () => { clearTimeout(minuteur); minuteur = setTimeout(charger, 350); };
  let canal = null, intervalle = null;
  function ecouter() {
    arreter();
    canal = sb.channel('suivi-af')
      .on('postgres_changes', { event: '*', schema: 'public' }, planifier)
      .subscribe((statut) => { etatApp.direct = statut === 'SUBSCRIBED'; if (etatApp.pret) rendreNav(); });
    intervalle = setInterval(() => { if (!document.hidden) charger(); }, 60000);
  }
  function arreter() {
    if (canal) { sb.removeChannel(canal); canal = null; }
    clearInterval(intervalle);
    etatApp.direct = false;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && etatApp.session) charger(); });

  function afficherEcran(id) {
    for (const e of ['ecran-config', 'ecran-auth', 'app', 'ecran-inactif']) $('#' + e).hidden = e !== id;
  }
  function montrerErreur(id, msg) { const n = $('#' + id); n.textContent = msg || ''; n.hidden = !msg; }

  // ------------------------------------------------------------------ dialogues
  const dlg = $('#dlg');
  function ouvrirDlg(html, info) {
    etatApp.dlg = info || { type: 'autre' };
    dlg.innerHTML = `<button class="dlg-fermer" type="button" data-action="fermer" aria-label="Fermer">×</button>${html}`;
    dlg.dataset.saisie = '0';
    if (!dlg.open) dlg.showModal();
  }
  function fermerDlg() { etatApp.dlg = null; if (dlg.open) dlg.close(); }
  dlg.addEventListener('close', () => { etatApp.dlg = null; });
  dlg.addEventListener('input', () => { dlg.dataset.saisie = '1'; });
  function rafraichirDialogue() {
    const d = etatApp.dlg;
    if (!d || d.type !== 'mission' || dlg.dataset.saisie === '1') return;
    if (!etatApp.missions.some((m) => m.id === d.id)) { fermerDlg(); toast('Cette mission vient d\'être supprimée.'); return; }
    ouvrirMission(d.id, true);
  }

  const HISTO = {};
  async function ouvrirMission(id, silencieux) {
    const m = etatApp.missions.find((x) => x.id === id);
    if (!m) return;
    const e = etatDe(m), att = attendu(m), ctrl = peutControler(m);
    const fini = e === 'validee' || e === 'a_valider';
    const lien = lienSur(m.lien_livrable);
    const ecart = m.progression - att;
    let h = `<h2 id="dlg-titre">${esc(m.titre)}</h2>
      <p class="dlg-meta">${badge(e)} <span>${esc(m.type)}, ${esc(m.pole)}${m.sous_pole ? ' / ' + esc(m.sous_pole) : ''}</span></p>
      ${m.description ? `<p class="description">${esc(m.description)}</p>` : ''}
      <dl class="fiche">
        <div><dt>Période</dt><dd>du ${fmtDate(m.debut)} au ${fmtDate(m.fin)}${e === 'validee' ? '' : ` (échéance ${dansJ(m.fin)})`}</dd></div>
        <div><dt>Équipe</dt><dd>${equipeDe(m).map(nomDe).map(esc).join(', ') || 'Personne pour le moment'}</dd></div>
        ${lien ? `<div><dt>Livrable</dt><dd><a href="${esc(lien)}" target="_blank" rel="noopener noreferrer">${esc(lien.replace(/^https?:\/\//, '').slice(0, 60))}</a></dd></div>` : ''}
        ${m.valide_par ? `<div><dt>Validation</dt><dd>par ${esc(nomDe(m.valide_par))}, ${ilYA(m.valide_le)}</dd></div>` : ''}
      </dl>
      <div class="rythme-hero">
        ${barre(m.progression, att, e, { grand: true, sansRepere: fini || e === 'a_venir' })}
        <dl class="rythme-chiffres">
          <div><dt>Réalisé</dt><dd>${m.progression} %</dd></div>
          ${fini || e === 'a_venir' ? '' : `<div><dt>Attendu à ce jour</dt><dd>${Math.round(att)} %</dd></div><div><dt>Écart</dt><dd>${fmtPts(ecart)}</dd></div>`}
        </dl>
      </div>`;

    if (e === 'a_valider' && peutValider(m)) {
      h += `<form id="form-validation" class="zone-action" data-id="${m.id}">
        <h3>Vérification</h3>
        <p>L'équipe a déclaré cette mission terminée. Validez-la, ou renvoyez-la avec un motif.</p>
        <label>Commentaire (obligatoire pour un renvoi)<textarea name="commentaire" rows="2"></textarea></label>
        <label class="champ-court">Avancement en cas de renvoi (%)<input type="number" name="progression" min="0" max="95" step="5" value="80"></label>
        <div class="actions">
          <button class="btn btn-principal" type="submit" value="valider">Valider la mission</button>
          <button class="btn" type="submit" value="renvoyer">Renvoyer en cours</button>
        </div></form>`;
    } else if (e === 'a_valider' && ctrl && !peutValider(m)) {
      h += `<p class="zone-action">Cette mission vous est assignée : un autre responsable ou un administrateur doit la valider.</p>`;
    }
    if (peutMettreAJour(m) && e !== 'validee' && !(e === 'a_valider' && peutValider(m))) {
      h += `<form id="form-avancement" class="zone-action" data-id="${m.id}">
        <h3>${e === 'a_valider' ? 'Corriger l\'avancement' : 'Où en êtes-vous ?'}</h3>
        <div class="curseur">
          <input type="range" name="progression" min="0" max="100" step="5" value="${m.progression}" aria-label="Avancement en pourcentage" data-input="curseur">
          <output id="curseur-val">${m.progression} %</output>
        </div>
        <label>Lien vers le livrable (facultatif)<input type="url" name="lien_livrable" placeholder="https://…" value="${esc(m.lien_livrable || '')}"></label>
        <label>Commentaire (facultatif)<textarea name="commentaire" rows="2" placeholder="Ce qui a avancé, ce qui bloque…"></textarea></label>
        <p class="discret">À 100 %, la mission part en validation auprès d'un responsable.</p>
        <div class="actions"><button class="btn btn-principal" type="submit" id="btn-avancement">Enregistrer l'avancement</button></div>
      </form>`;
    } else if (e !== 'validee' && !ctrl) {
      h += `<p class="zone-action discret">Seules les personnes assignées à cette mission peuvent mettre à jour son avancement.</p>`;
    }
    h += `<div class="actions actions-secondaires">
        <a class="btn btn-petit" href="${esc(lienGoogleAgenda(m))}" target="_blank" rel="noopener noreferrer">Ajouter à Google Agenda</a>
        ${ctrl ? `<button class="btn btn-petit" type="button" data-action="modifier" data-id="${m.id}">Modifier</button>` : ''}
        ${ctrl && e === 'validee' ? `<button class="btn btn-petit" type="button" data-action="rouvrir" data-id="${m.id}">Rouvrir</button>` : ''}
        ${ctrl ? `<button class="btn btn-petit btn-danger" type="button" data-action="supprimer" data-id="${m.id}">Supprimer</button>` : ''}
      </div>
      <h3>Historique</h3><ul class="fil" id="historique">${HISTO[id] || '<li class="discret">Chargement…</li>'}</ul>`;
    ouvrirDlg(h, { type: 'mission', id });
    const r = await sb.from('journal').select('*').eq('mission_id', id).order('created_at', { ascending: false }).limit(100);
    const hist = $('#historique');
    if (hist && etatApp.dlg?.id === id) {
      const html = r.error ? `<li class="discret">${esc(msgErreur(r.error))}</li>` : (r.data.map((j) => ligneJournal({ ...j, mission_id: null })).join('') || '<li class="discret">Aucune activité.</li>');
      if (!r.error) HISTO[id] = html;
      hist.innerHTML = html;
    }
    if (!silencieux) dlg.scrollTop = 0;
  }
  function lienGoogleAgenda(m) {
    const f = m.fin.replaceAll('-', ''), f1 = isoJour(new Date(d0(m.fin).getTime() + JOUR + 3600e3)).replaceAll('-', '');
    const details = `${m.type} – ${m.pole}${m.sous_pole ? ' / ' + m.sous_pole : ''}\nÉquipe : ${equipeDe(m).map(nomDe).join(', ') || 'non assignée'}\n${location.origin}${location.pathname}#missions`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Échéance – ' + m.titre)}&dates=${f}/${f1}&details=${encodeURIComponent(details)}`;
  }

  function formMission(m) {
    const moi = etatApp.moi, pr = P();
    const neuf = !m;
    m = m || { titre: '', description: '', type: pr.types_mission[0] || 'Autre', pole: moi.pole || pr.poles[0] || '', sous_pole: moi.sous_pole || '', debut: aujourdhui(), fin: isoJour(new Date(Date.now() + 28 * JOUR)), mission_membres: moi.role === 'membre' ? [{ profil_id: moi.id }] : [] };
    const equipe = equipeDe(m);
    const poles = [...new Set([...pr.poles, m.pole].filter(Boolean))];
    const types = [...new Set([...pr.types_mission, m.type].filter(Boolean))];
    const gens = etatApp.profils.filter((p) => p.actif || equipe.includes(p.id));
    ouvrirDlg(`<h2 id="dlg-titre">${neuf ? 'Nouvelle mission' : 'Modifier la mission'}</h2>
      <form id="form-mission" class="form-grille" data-id="${neuf ? '' : m.id}">
        <label class="large">Titre<input name="titre" required maxlength="120" value="${esc(m.titre)}"></label>
        <label class="large">Description (facultatif)<textarea name="description" rows="2">${esc(m.description || '')}</textarea></label>
        <label>Type<select name="type">${options(types, m.type)}</select></label>
        <label>Pôle<select name="pole" required>${options(poles, m.pole)}</select></label>
        <label>Sous-pôle<select name="sous_pole">${options(pr.sous_poles, m.sous_pole || '', 'Tout le pôle')}</select></label>
        <span></span>
        <label>Début<input type="date" name="debut" required value="${m.debut}"></label>
        <label>Échéance<input type="date" name="fin" required value="${m.fin}"></label>
        <fieldset class="large"><legend>Qui travaille dessus ?</legend>
          <div class="cases">${gens.map((p) => `<label class="case"><input type="checkbox" name="equipe" value="${p.id}"${equipe.includes(p.id) ? ' checked' : ''}> ${esc(p.prenom)} ${esc(p.nom)}<span class="sous-nom">${esc(p.pole || 'Bureau')}</span></label>`).join('')}</div>
        </fieldset>
        <p class="msg-erreur large" id="err-mission" role="alert" hidden></p>
        <div class="actions large">
          <button class="btn btn-principal" type="submit">${neuf ? 'Créer la mission' : 'Enregistrer'}</button>
          <button class="btn" type="button" data-action="${neuf ? 'fermer' : 'ouvrir'}" data-id="${neuf ? '' : m.id}">Annuler</button>
        </div>
      </form>`, { type: 'form-mission' });
  }

  function formMembre(id) {
    const p = profil(id), pr = P();
    ouvrirDlg(`<h2 id="dlg-titre">${esc(p.prenom)} ${esc(p.nom)}</h2>
      <p class="discret">${esc(p.email)}</p>
      <form id="form-membre" class="form-grille" data-id="${p.id}">
        <label>Prénom<input name="prenom" required value="${esc(p.prenom)}"></label>
        <label>Nom<input name="nom" value="${esc(p.nom)}"></label>
        <label>Pôle<select name="pole">${options([...new Set([...pr.poles, p.pole].filter(Boolean))], p.pole || '', 'Tous les pôles (bureau)')}</select></label>
        <label>Sous-pôle<select name="sous_pole">${options([...new Set([...pr.sous_poles, p.sous_pole].filter(Boolean))], p.sous_pole || '', 'Tout le pôle')}</select></label>
        <label>Poste<input name="poste" value="${esc(p.poste || '')}" placeholder="Président, VP, Responsable Event…"></label>
        <label>Rôle dans le suivi<select name="role">${Object.entries(ROLES).map(([v, n]) => `<option value="${v}"${v === p.role ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <p class="discret large">Un responsable valide les missions de son pôle, ou de son seul sous-pôle s'il en a un. Un administrateur valide tout et gère les comptes.</p>
        <label class="case large"><input type="checkbox" name="actif"${p.actif ? ' checked' : ''}> Compte actif (décochez pour retirer l'accès)</label>
        <div class="actions large"><button class="btn btn-principal" type="submit">Enregistrer</button><button class="btn" type="button" data-action="fermer">Annuler</button></div>
      </form>`, { type: 'form-membre' });
  }
  function formInvitation() {
    const pr = P();
    ouvrirDlg(`<h2 id="dlg-titre">Inviter un membre</h2>
      <form id="form-invitation" class="form-grille">
        <label>Prénom<input name="prenom" required></label>
        <label>Nom<input name="nom" required></label>
        <label class="large">Adresse e-mail<input type="email" name="email" required></label>
        <label>Pôle<select name="pole">${options(pr.poles, '', 'Tous les pôles (bureau)')}</select></label>
        <label>Sous-pôle<select name="sous_pole">${options(pr.sous_poles, '', 'Tout le pôle')}</select></label>
        <label>Poste<input name="poste" placeholder="Président, VP, Responsable Event, Membre…"></label>
        <label>Rôle dans le suivi<select name="role"><option value="membre">Membre</option><option value="responsable">Responsable (valide les missions)</option><option value="admin">Administrateur</option></select></label>
        <p class="msg-erreur large" id="err-invitation" role="alert" hidden></p>
        <div class="actions large"><button class="btn btn-principal" type="submit">Créer l'invitation</button><button class="btn" type="button" data-action="fermer">Annuler</button></div>
      </form>`, { type: 'form-invitation' });
  }
  function formImport() {
    ouvrirDlg(`<h2 id="dlg-titre">Importer une liste de membres</h2>
      <p>Collez la liste depuis Excel ou Google Sheets, ou choisissez un fichier CSV. Colonnes, dans cet ordre :</p>
      <p><code>prenom ; nom ; email ; pole ; sous_pole ; poste ; role</code></p>
      <p class="discret">Rôle : <code>membre</code>, <code>responsable</code> ou <code>admin</code>. Pôle vide = tous les pôles. Une invitation déjà présente est mise à jour, son code ne change pas.</p>
      <form id="form-import">
        <input type="file" id="import-fichier" accept=".csv,.txt,text/csv" aria-label="Fichier CSV">
        <label>Liste<textarea name="liste" rows="9" id="import-texte" placeholder="Camille;Durand;camille.durand@exemple.fr;Corporate finance;;Présidente;responsable"></textarea></label>
        <p class="msg-erreur" id="err-import" role="alert" hidden></p>
        <div class="actions"><button class="btn btn-principal" type="submit">Importer</button><button class="btn" type="button" data-action="fermer">Annuler</button></div>
      </form>`, { type: 'form-import' });
  }
  function lireListe(texte) {
    const lignes = texte.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lignes.length) return { rangs: [], erreurs: ['La liste est vide.'] };
    const sep = [';', '\t', ','].find((s) => lignes[0].includes(s)) || ';';
    const couper = (l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());
    let cols = ['prenom', 'nom', 'email', 'pole', 'sous_pole', 'poste', 'role'];
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
    const tete = couper(lignes[0]).map(norm);
    if (tete.includes('email') || tete.includes('e_mail') || tete.includes('mail')) {
      cols = tete.map((c) => ({ e_mail: 'email', mail: 'email', sous_poles: 'sous_pole', souspole: 'sous_pole', poles: 'pole' }[c] || c));
      lignes.shift();
    }
    const rangs = [], erreurs = [];
    lignes.forEach((l, i) => {
      const v = couper(l), o = {};
      cols.forEach((c, k) => { o[c] = v[k] || ''; });
      const email = (o.email || '').toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !o.prenom) { erreurs.push(`Ligne ${i + 1} ignorée : prénom ou e-mail manquant (${l.slice(0, 40)})`); return; }
      const r = norm(o.role || '');
      rangs.push({ email, prenom: o.prenom, nom: o.nom || '', pole: o.pole || null, sous_pole: o.sous_pole || null, poste: o.poste || null,
        role: r.startsWith('admin') ? 'admin' : /^(resp|chef|president|vp|vice)/.test(r) ? 'responsable' : 'membre' });
    });
    return { rangs, erreurs };
  }
  const messageInvitation = (i) => `Bonjour ${i.prenom},\n\nTon accès au suivi des missions de ${P().nom_asso} est prêt.\n1. Ouvre ${location.origin}${location.pathname}\n2. Onglet « Première connexion »\n3. E-mail : ${i.email}\n4. Code d'invitation : ${i.code}\n5. Choisis ton mot de passe.\n\nTu pourras ensuite mettre à jour l'avancement de tes missions dès qu'il change.`;
  async function copier(texte, succes) {
    try { await navigator.clipboard.writeText(texte); toast(succes || 'Copié.', 'ok'); }
    catch { ouvrirDlg(`<h2 id="dlg-titre">Copiez ce texte</h2><textarea rows="12" readonly class="large">${esc(texte)}</textarea>`); }
  }
  function formDocument() {
    ouvrirDlg(`<h2 id="dlg-titre">Ajouter un document</h2>
      <form id="form-document" class="form-pile" novalidate>
        <fieldset><legend>Que voulez-vous ajouter ?</legend>
          <label class="case"><input type="radio" name="genre" value="fichier" checked data-change="doc-genre"> Un fichier (Excel, PDF…), conservé ici</label>
          <label class="case"><input type="radio" name="genre" value="lien" data-change="doc-genre"> Le lien d'un document en ligne, modifiable à plusieurs en temps réel</label>
        </fieldset>
        <label id="champ-fichier">Fichier (50 Mo maximum)<input type="file" name="fichier" data-change="doc-fichier"></label>
        <label id="champ-lien" hidden>Adresse du document<input type="url" name="url" placeholder="https://…"></label>
        <label>Titre<input name="titre" required maxlength="120"></label>
        <label>Description (facultatif)<textarea name="description" rows="2"></textarea></label>
        <p class="msg-erreur" id="err-document" role="alert" hidden></p>
        <div class="actions"><button class="btn btn-principal" type="submit">Ajouter à la Data Room</button><button class="btn" type="button" data-action="fermer">Annuler</button></div>
      </form>`, { type: 'form-document' });
  }
  function formRemplacement(id) {
    const d = etatApp.documents.find((x) => x.id === id);
    ouvrirDlg(`<h2 id="dlg-titre">Remplacer le fichier</h2>
      <p>« ${esc(d.titre)} » : la nouvelle version prend la place de ${esc(d.nom_fichier)}. L'ancienne est supprimée.</p>
      <form id="form-remplacement" class="form-pile" data-id="${d.id}">
        <label>Nouvelle version (50 Mo maximum)<input type="file" name="fichier" required></label>
        <p class="msg-erreur" id="err-document" role="alert" hidden></p>
        <div class="actions"><button class="btn btn-principal" type="submit">Remplacer le fichier</button><button class="btn" type="button" data-action="fermer">Annuler</button></div>
      </form>`, { type: 'form-remplacement' });
  }
  // Envoie un fichier dans le stockage ; renvoie { chemin, nom_fichier, taille } ou un message d'erreur
  async function deposerFichier(fichier) {
    if (!fichier || !fichier.size) return { erreur: 'Choisissez un fichier.' };
    if (fichier.size > TAILLE_MAX) return { erreur: `Ce fichier pèse ${fmtTaille(fichier.size)} : la limite est de 50 Mo.` };
    const chemin = cheminStockage(fichier.name);
    const r = await sb.storage.from(BUCKET).upload(chemin, fichier, { contentType: fichier.type || 'application/octet-stream', upsert: false });
    if (r.error) return { erreur: "L'envoi du fichier a échoué : " + msgErreur(r.error) };
    return { chemin, nom_fichier: fichier.name, taille: fichier.size };
  }
  function formMotDePasse(recuperation) {
    ouvrirDlg(`<h2 id="dlg-titre">${recuperation ? 'Choisissez un nouveau mot de passe' : 'Changer de mot de passe'}</h2>
      <form id="form-mdp">
        <label>Nouveau mot de passe (8 caractères minimum)<input type="password" name="password" minlength="8" required autocomplete="new-password"></label>
        <p class="msg-erreur" id="err-mdp" role="alert" hidden></p>
        <div class="actions"><button class="btn btn-principal" type="submit">Enregistrer le mot de passe</button></div>
      </form>`, { type: 'form-mdp' });
  }
  function confirmer(titre, texte, libelle, action) {
    ouvrirDlg(`<h2 id="dlg-titre">${esc(titre)}</h2><p>${esc(texte)}</p>
      <div class="actions"><button class="btn btn-danger" type="button" id="btn-confirmer">${esc(libelle)}</button><button class="btn" type="button" data-action="fermer">Annuler</button></div>`, { type: 'confirmation' });
    $('#btn-confirmer').addEventListener('click', action, { once: true });
  }
  function telechargerIcs() {
    const e = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Suivi AF//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + e(P().nom_asso + ' – Échéances')];
    for (const m of etatApp.missions) {
      const f1 = isoJour(new Date(d0(m.fin).getTime() + JOUR + 3600e3));
      l.push('BEGIN:VEVENT', `UID:${m.id}@suivi-af`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${m.fin.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${f1.replaceAll('-', '')}`,
        'SUMMARY:' + e(`Échéance – ${m.titre} (${m.pole})`), 'DESCRIPTION:' + e(`Équipe : ${equipeDe(m).map(nomDe).join(', ') || 'non assignée'}\nAvancement : ${m.progression} %`), 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    l.push('END:VCALENDAR');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([l.join('\r\n') + '\r\n'], { type: 'text/calendar' }));
    a.download = 'echeances-suivi-af.ics';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------------ actions
  const ACTIONS = {
    'auth-onglet': (el) => {
      const insc = el.dataset.onglet === 'inscription';
      $('#form-connexion').hidden = insc; $('#form-inscription').hidden = !insc;
      $('#tab-connexion').setAttribute('aria-selected', String(!insc)); $('#tab-inscription').setAttribute('aria-selected', String(insc));
    },
    'mdp-oublie': async () => {
      const email = $('#form-connexion').email.value.trim();
      if (!email) return montrerErreur('err-connexion', 'Saisissez votre adresse e-mail, puis cliquez à nouveau sur « Mot de passe oublié ».');
      const r = await exec(sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
      if (r) { montrerErreur('err-connexion', ''); toast('Si un compte existe pour cette adresse, un e-mail de réinitialisation vient de partir.', 'ok'); }
    },
    'mdp-changer': () => formMotDePasse(false),
    deconnexion: async () => { await sb.auth.signOut(); },
    fermer: fermerDlg,
    ouvrir: (el) => ouvrirMission(el.dataset.id),
    nouvelle: () => formMission(null),
    modifier: (el) => formMission(etatApp.missions.find((m) => m.id === el.dataset.id)),
    rouvrir: async (el) => {
      if (await exec(sb.from('missions').update({ statut: 'en_cours', progression: 90 }).eq('id', el.dataset.id), 'Mission rouverte à 90 %.')) { dlg.dataset.saisie = '0'; await charger(); }
    },
    supprimer: (el) => {
      const m = etatApp.missions.find((x) => x.id === el.dataset.id);
      confirmer('Supprimer cette mission ?', `« ${m.titre} » et son historique seront supprimés définitivement.`, 'Supprimer la mission', async () => {
        if (await exec(sb.from('missions').delete().eq('id', m.id), 'Mission supprimée.')) { fermerDlg(); charger(); }
      });
    },
    'filtre-qui': (el) => { etatApp.f.qui = el.dataset.qui; rendre(); },
    raccourci: (el) => {
      if (el.dataset.vue === 'missions') etatApp.f = { q: '', pole: '', etat: el.dataset.etat || '', qui: el.dataset.qui || 'toutes' };
      if (location.hash.slice(1) === el.dataset.vue) allerA(el.dataset.vue); else location.hash = el.dataset.vue;
    },
    'filtres-raz': () => { etatApp.f = { q: '', pole: '', etat: '', qui: 'toutes' }; rendre(); },
    mois: (el) => {
      const pas = Number(el.dataset.pas), d = new Date();
      etatApp.mois = pas ? new Date(etatApp.mois.getFullYear(), etatApp.mois.getMonth() + pas, 1) : new Date(d.getFullYear(), d.getMonth(), 1);
      rendre();
    },
    copier: (el) => copier($('#' + el.dataset.cible).value, 'Lien copié.'),
    ics: telechargerIcs,
    'doc-ajout': formDocument,
    'doc-remplacer': (el) => formRemplacement(el.dataset.id),
    'doc-telecharger': async (el) => {
      const d = etatApp.documents.find((x) => x.id === el.dataset.id);
      el.disabled = true;
      const r = await sb.storage.from(BUCKET).createSignedUrl(d.chemin, 120);
      el.disabled = false;
      if (r.error) return toast('Téléchargement impossible : ' + msgErreur(r.error), 'erreur');
      // Le nom d'origine est ajouté ici : la bibliothèque encode deux fois les accents
      location.href = `${r.data.signedUrl}&download=${encodeURIComponent(d.nom_fichier)}`;
    },
    'doc-supprimer': (el) => {
      const d = etatApp.documents.find((x) => x.id === el.dataset.id);
      confirmer('Retirer ce document ?', d.genre === 'fichier' ? `« ${d.titre} » sera supprimé définitivement de la Data Room.` : `Le lien « ${d.titre} » sera retiré. Le document en ligne lui-même n'est pas supprimé.`, 'Retirer le document', async () => {
        if (!(await exec(sb.from('documents').delete().eq('id', d.id).select().single(), 'Document retiré.'))) return;
        if (d.chemin) await sb.storage.from(BUCKET).remove([d.chemin]);
        fermerDlg(); charger();
      });
    },
    membre: (el) => formMembre(el.dataset.id),
    'inv-ajout': formInvitation,
    'inv-import': formImport,
    'inv-message': (el) => copier(messageInvitation(etatApp.invitations.find((i) => i.email === el.dataset.email)), 'Message d\'invitation copié.'),
    'inv-messages': () => copier(etatApp.invitations.filter((i) => !i.utilisee_le).map(messageInvitation).join('\n\n----------\n\n'), 'Messages copiés.'),
    'inv-suppr': (el) => {
      const i = etatApp.invitations.find((x) => x.email === el.dataset.email);
      confirmer('Retirer cette invitation ?', i.utilisee_le ? `Le compte de ${i.prenom} ${i.nom} existe déjà : il reste actif. Pour retirer son accès, désactivez le compte dans la liste de l'équipe.` : `${i.prenom} ${i.nom} ne pourra plus créer de compte avec ce code.`, 'Retirer l\'invitation', async () => {
        if (await exec(sb.from('invitations').delete().eq('email', i.email), 'Invitation retirée.')) { fermerDlg(); charger(); }
      });
    },
  };
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el, ev);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.change === 'tdb-pole') { etatApp.tdbPole = el.value; rendre(); }
    if (el.dataset.change === 'filtre') { etatApp.f[el.dataset.cle] = el.value; rendre(); }
    if (el.dataset.change === 'doc-genre') {
      const lien = el.value === 'lien';
      $('#champ-fichier').hidden = lien; $('#champ-lien').hidden = !lien;
    }
    if (el.dataset.change === 'doc-fichier' && el.files[0] && !el.form.titre.value) el.form.titre.value = el.files[0].name.replace(/\.[a-z0-9]{1,5}$/i, '');
    if (el.id === 'import-fichier' && el.files[0]) el.files[0].text().then((t) => { $('#import-texte').value = t; });
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.input === 'recherche') { etatApp.f.q = el.value; rendre(); }
    if (el.dataset.input === 'curseur') {
      $('#curseur-val').textContent = el.value + ' %';
      $('#btn-avancement').textContent = Number(el.value) >= 100 ? 'Déclarer la mission terminée' : "Enregistrer l'avancement";
    }
    if (el.closest('#form-reglages')) $('#main').dataset.saisie = '1';
  });

  document.addEventListener('submit', async (ev) => {
    const f = ev.target;
    ev.preventDefault();
    const bouton = ev.submitter;
    const v = Object.fromEntries(new FormData(f).entries());
    if (bouton) bouton.disabled = true;
    try {
      if (f.id === 'form-connexion') {
        montrerErreur('err-connexion', '');
        const r = await sb.auth.signInWithPassword({ email: v.email.trim(), password: v.password });
        if (r.error) montrerErreur('err-connexion', /Invalid login/i.test(r.error.message) ? 'E-mail ou mot de passe incorrect.' : /not confirmed/i.test(r.error.message) ? 'Adresse non confirmée : cliquez sur le lien reçu par e-mail.' : msgErreur(r.error));
      }
      else if (f.id === 'form-inscription') {
        montrerErreur('err-inscription', '');
        const email = v.email.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return montrerErreur('err-inscription', 'Saisissez une adresse e-mail valide.');
        if ((v.password || '').length < 8) return montrerErreur('err-inscription', 'Le mot de passe doit contenir au moins 8 caractères.');
        const verif = await sb.rpc('verifier_invitation', { p_email: email, p_code: v.code || '' });
        if (verif.error) return montrerErreur('err-inscription', msgErreur(verif.error));
        if (verif.data === 'deja') return montrerErreur('err-inscription', 'Un compte existe déjà pour cette adresse : utilisez « Se connecter ».');
        if (verif.data === 'refus') return montrerErreur('err-inscription', "E-mail ou code d'invitation incorrect. Vérifiez le message reçu du bureau.");
        if (verif.data === 'premier' && !v.prenom.trim()) {
          $('#champs-premier').hidden = false; f.prenom.focus();
          return montrerErreur('err-inscription', 'Indiquez votre prénom et votre nom pour créer le compte administrateur.');
        }
        const r = await sb.auth.signUp({ email, password: v.password, options: { data: { code: (v.code || '').trim(), prenom: v.prenom.trim(), nom: v.nom.trim() } } });
        if (r.error) return montrerErreur('err-inscription', /already registered/i.test(r.error.message) ? 'Un compte existe déjà pour cette adresse : utilisez « Se connecter ».' : /Database error/i.test(r.error.message) ? "Inscription refusée : e-mail ou code d'invitation incorrect." : msgErreur(r.error));
        if (!r.data.session) { ACTIONS['auth-onglet']({ dataset: { onglet: 'connexion' } }); toast('Compte créé. Confirmez votre adresse via l\'e-mail reçu, puis connectez-vous.', 'ok'); }
      }
      else if (f.id === 'form-mdp') {
        const r = await sb.auth.updateUser({ password: v.password });
        if (r.error) return montrerErreur('err-mdp', msgErreur(r.error));
        fermerDlg(); toast('Mot de passe enregistré.', 'ok');
      }
      else if (f.id === 'form-avancement') {
        const id = f.dataset.id, prog = Number(v.progression);
        const lien = v.lien_livrable.trim();
        if (lien && !lienSur(lien)) return toast('Le lien doit commencer par https://', 'erreur');
        const r = await exec(sb.from('missions').update({ progression: prog, lien_livrable: lien || null }).eq('id', id).select().single(), prog >= 100 ? 'Mission déclarée terminée, envoyée en validation.' : 'Avancement enregistré.');
        if (!r) return;
        if (v.commentaire.trim()) await exec(sb.from('journal').insert({ mission_id: id, auteur: etatApp.moi.id, type: 'commentaire', message: v.commentaire.trim() }));
        dlg.dataset.saisie = '0';
        await charger();
      }
      else if (f.id === 'form-validation') {
        const id = f.dataset.id, valider = bouton && bouton.value === 'valider';
        if (!valider && !v.commentaire.trim()) return toast('Indiquez le motif du renvoi dans le commentaire.', 'erreur');
        const r = await exec(sb.from('missions').update(valider ? { statut: 'validee' } : { statut: 'en_cours', progression: Math.min(95, Number(v.progression) || 80) }).eq('id', id).select().single(), valider ? 'Mission validée.' : 'Mission renvoyée en cours.');
        if (!r) return;
        if (v.commentaire.trim()) await exec(sb.from('journal').insert({ mission_id: id, auteur: etatApp.moi.id, type: 'commentaire', message: v.commentaire.trim() }));
        dlg.dataset.saisie = '0';
        await charger();
      }
      else if (f.id === 'form-mission') {
        montrerErreur('err-mission', '');
        if (v.fin < v.debut) return montrerErreur('err-mission', "L'échéance doit être après la date de début.");
        const equipe = new FormData(f).getAll('equipe');
        const donnees = { titre: v.titre.trim(), description: v.description.trim() || null, type: v.type, pole: v.pole, sous_pole: v.sous_pole || null, debut: v.debut, fin: v.fin };
        let id = f.dataset.id;
        if (!id) {
          const r = await sb.from('missions').insert(donnees).select().single();
          if (r.error) return montrerErreur('err-mission', msgErreur(r.error));
          id = r.data.id;
          if (equipe.length) {
            const a = await sb.from('mission_membres').insert(equipe.map((p) => ({ mission_id: id, profil_id: p })));
            if (a.error) toast("Mission créée, mais l'équipe n'a pas pu être enregistrée : " + msgErreur(a.error), 'erreur');
          }
          toast('Mission créée.', 'ok');
        } else {
          const r = await sb.from('missions').update(donnees).eq('id', id).select().single();
          if (r.error) return montrerErreur('err-mission', msgErreur(r.error));
          const avant = equipeDe(etatApp.missions.find((m) => m.id === id));
          const plus = equipe.filter((p) => !avant.includes(p)), moins = avant.filter((p) => !equipe.includes(p));
          if (plus.length) await exec(sb.from('mission_membres').insert(plus.map((p) => ({ mission_id: id, profil_id: p }))));
          if (moins.length) await exec(sb.from('mission_membres').delete().eq('mission_id', id).in('profil_id', moins));
          toast('Mission enregistrée.', 'ok');
        }
        dlg.dataset.saisie = '0';
        await charger();
        ouvrirMission(id);
      }
      else if (f.id === 'form-document') {
        montrerErreur('err-document', '');
        const base = { titre: v.titre.trim(), description: v.description.trim() || null };
        if (!base.titre) return montrerErreur('err-document', 'Donnez un titre au document.');
        if (v.genre === 'lien') {
          if (!lienSur(v.url)) return montrerErreur('err-document', "L'adresse doit commencer par https://");
          const r = await sb.from('documents').insert({ ...base, genre: 'lien', url: v.url.trim() });
          if (r.error) return montrerErreur('err-document', msgErreur(r.error));
        } else {
          if (bouton) bouton.textContent = 'Envoi en cours…';
          const d = await deposerFichier(f.fichier.files[0]);
          if (bouton) bouton.textContent = 'Ajouter à la Data Room';
          if (d.erreur) return montrerErreur('err-document', d.erreur);
          const r = await sb.from('documents').insert({ ...base, genre: 'fichier', ...d });
          if (r.error) { await sb.storage.from(BUCKET).remove([d.chemin]); return montrerErreur('err-document', msgErreur(r.error)); }
        }
        fermerDlg(); toast('Document ajouté à la Data Room.', 'ok'); charger();
      }
      else if (f.id === 'form-remplacement') {
        montrerErreur('err-document', '');
        const ancien = etatApp.documents.find((x) => x.id === f.dataset.id);
        if (bouton) bouton.textContent = 'Envoi en cours…';
        const d = await deposerFichier(f.fichier.files[0]);
        if (bouton) bouton.textContent = 'Remplacer le fichier';
        if (d.erreur) return montrerErreur('err-document', d.erreur);
        const r = await sb.from('documents').update(d).eq('id', ancien.id).select().single();
        if (r.error) { await sb.storage.from(BUCKET).remove([d.chemin]); return montrerErreur('err-document', msgErreur(r.error)); }
        if (ancien.chemin) await sb.storage.from(BUCKET).remove([ancien.chemin]);
        fermerDlg(); toast('Fichier remplacé.', 'ok'); charger();
      }
      else if (f.id === 'form-membre') {
        const r = await exec(sb.from('profils').update({ prenom: v.prenom.trim(), nom: v.nom.trim(), pole: v.pole || null, sous_pole: v.sous_pole || null, poste: v.poste.trim() || null, role: v.role, actif: f.actif.checked }).eq('id', f.dataset.id).select().single(), 'Compte mis à jour.');
        if (r) { fermerDlg(); charger(); }
      }
      else if (f.id === 'form-invitation') {
        const r = await sb.from('invitations').insert({ email: v.email.trim().toLowerCase(), prenom: v.prenom.trim(), nom: v.nom.trim(), pole: v.pole || null, sous_pole: v.sous_pole || null, poste: v.poste.trim() || null, role: v.role });
        if (r.error) return montrerErreur('err-invitation', /duplicate|already exists/i.test(r.error.message) ? 'Cette adresse est déjà invitée.' : msgErreur(r.error));
        fermerDlg(); toast('Invitation créée.', 'ok'); charger();
      }
      else if (f.id === 'form-import') {
        const { rangs, erreurs } = lireListe(v.liste || '');
        if (!rangs.length) return montrerErreur('err-import', erreurs[0] || 'Aucune ligne exploitable.');
        const uniques = [...new Map(rangs.map((r) => [r.email, r])).values()];
        const r = await sb.from('invitations').upsert(uniques, { onConflict: 'email' });
        if (r.error) return montrerErreur('err-import', msgErreur(r.error));
        fermerDlg();
        toast(`${pluriel(uniques.length, 'invitation enregistrée', 'invitations enregistrées')}.${erreurs.length ? ' ' + pluriel(erreurs.length, 'ligne ignorée', 'lignes ignorées') + '.' : ''}`, erreurs.length ? 'info' : 'ok');
        charger();
      }
      else if (f.id === 'form-reglages') {
        const liste = (t) => [...new Set(t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean))];
        const r = await exec(sb.from('parametres').update({ nom_asso: v.nom_asso.trim(), tolerance: Number(v.tolerance), jours_alerte: Number(v.jours_alerte), jours_inactif: Number(v.jours_inactif), poles: liste(v.poles), sous_poles: liste(v.sous_poles), types_mission: liste(v.types_mission) }).eq('id', 1).select().single(), 'Réglages enregistrés.');
        if (r) { $('#main').dataset.saisie = '0'; charger(); }
      }
    } finally {
      if (bouton) bouton.disabled = false;
    }
  });

  window.addEventListener('hashchange', () => { if (etatApp.pret) allerA(location.hash.slice(1)); });

  // ------------------------------------------------------------------ démarrage
  function demarrer() {
    if (!CFG.supabaseUrl || !CFG.supabaseKey || /VOTRE-PROJET|A_REMPLACER/.test(CFG.supabaseUrl + CFG.supabaseKey) || !window.supabase) {
      afficherEcran('ecran-config');
      return;
    }
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
    etatApp.vue = VUES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'tableau-de-bord';
    sb.auth.onAuthStateChange((evenement, session) => {
      // Les appels à la base se font hors du rappel (recommandation Supabase)
      setTimeout(() => {
        const avant = etatApp.session?.user?.id;
        etatApp.session = session;
        if (!session) {
          arreter(); etatApp.pret = false; etatApp.moi = null; fermerDlg();
          afficherEcran('ecran-auth');
          return;
        }
        if (evenement === 'PASSWORD_RECOVERY') formMotDePasse(true);
        if (avant !== session.user.id) { charger().then(ecouter); }
      }, 0);
    });
  }
  demarrer();
})();
