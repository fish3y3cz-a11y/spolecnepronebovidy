// NeboviSeum – diskuze a ankety. Vanilla JS, žádný innerHTML: veškerý text od uživatelů
// se vkládá jen přes textContent / createTextNode, takže se nemůže spustit jako kód.
import { config } from './config.js';

const app = document.getElementById('app');
const nav = document.getElementById('app-nav');

// ---------------------------------------------------------------- helpers
const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
};
const fmt = (d) => new Date(d).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
const ROLES = ['unverified', 'invited', 'verified', 'admin', 'superadmin'];
const ROLE_CS = { unverified: 'neověřený', invited: 'pozvaný', verified: 'ověřený', admin: 'správce', superadmin: 'superadmin' };

const MESSAGES = {
  banned_word: 'Text obsahuje slovo, které na NeboviSeu není povoleno. Upravte ho a zkuste to znovu.',
  rate_limited: 'Příliš mnoho akcí za krátkou dobu. Zkuste to prosím za chvíli.',
  empty_body: 'Text nesmí být prázdný.',
  invalid_name: 'Jméno musí mít jméno a příjmení a jen písmena (bez speciálních znaků).',
  tos_required: 'Je potřeba souhlasit s pravidly.',
  invalid_invite: 'Pozvánka není platná nebo už byla použita.',
  registration_blocked: 'S touto adresou se nelze zaregistrovat.',
  duplicate_email: 'S touto adresou se nelze zaregistrovat.',
  invite_limit: 'Máte vytvořeno maximum aktivních pozvánek.',
  already_voted: 'V této anketě jste už hlasoval(a).',
  ip_limit: 'Z vaší adresy už bylo hlasováno příliš mnohokrát.',
  poll_not_votable: 'V této anketě už nejde hlasovat.',
  captcha: 'Ověření „nejsem robot“ se nepodařilo. Zkuste to znovu.',
  thread_not_open: 'Pod tímto tématem nejde komentovat.',
  self_approval: 'Vlastní příspěvek schválit nemůžete.',
  admin_required: 'Tento příspěvek musí schválit správce.',
  forbidden: 'K této akci nemáte oprávnění.',
  blocked: 'Váš účet je zablokovaný.',
  only_superadmin_can_block_admin: 'Správce může zablokovat jen superadmin.',
};
const explain = (e) => {
  const m = String(e?.message ?? e ?? '');
  for (const k of Object.keys(MESSAGES)) if (m.includes(k)) return MESSAGES[k];
  return 'Něco se nepovedlo. Zkuste to prosím znovu.';
};
const notice = (text, kind = '') => h('div', { class: 'nv-msg ' + kind, role: kind === 'error' ? 'alert' : 'status' }, text);

// ---------------------------------------------------------------- state
let sb = null;
let session = null;
let me = null;
const atLeast = (r) => !!me && !me.blocked && ROLES.indexOf(me.role) >= ROLES.indexOf(r);

async function loadMe() {
  me = null;
  if (!session) return;
  const { data } = await sb.from('profiles').select('id,display_name,full_name,role,blocked').eq('id', session.user.id).maybeSingle();
  me = data || null;
}

// ---------------------------------------------------------------- Turnstile + public actions
let tsLoading = null;
function loadTurnstile() {
  if (!config.turnstileSiteKey) return Promise.resolve(null);
  tsLoading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve(window.turnstile || null);
    s.onerror = () => resolve(null);
    document.head.append(s);
  });
  return tsLoading;
}
function captcha() {
  const box = h('div', { class: 'nv-captcha' });
  let token = null; let id = null;
  loadTurnstile().then((ts) => {
    if (!ts) return;
    id = ts.render(box, { sitekey: config.turnstileSiteKey, callback: (t) => { token = t; }, 'expired-callback': () => { token = null; } });
  });
  return { box, token: () => token, reset: () => { token = null; if (id != null && window.turnstile) window.turnstile.reset(id); } };
}
async function publicAction(payload) {
  const res = await fetch(config.supabaseUrl + '/functions/v1/public-actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: config.supabaseAnonKey, authorization: 'Bearer ' + config.supabaseAnonKey },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'server');
}

// ---------------------------------------------------------------- shared UI
function busy(btn, fn) {
  return async (ev) => {
    ev?.preventDefault?.();
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  };
}
function button(label, onclick, cls = 'btn outline') {
  const b = h('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', busy(b, () => onclick(b)));
  return b;
}
function field(label, input) { return h('label', {}, label, input); }
function show(...nodes) { app.replaceChildren(...nodes.flat().filter(Boolean)); }

function renderNav() {
  const here = location.hash || '#/';
  const link = (href, text) => h('a', { href, 'aria-current': here === href ? 'page' : null }, text);
  const items = [link('#/', 'Témata a ankety')];
  if (me) {
    items.push(link('#/nove', 'Nové téma'));
    if (atLeast('verified')) items.push(link('#/fronta', 'Ke schválení'));
    if (atLeast('admin')) items.push(link('#/admin', 'Správa'));
    items.push(link('#/ucet', me.display_name));
  } else if (sb) {
    items.push(link('#/prihlaseni', 'Přihlásit se'));
  }
  nav.replaceChildren(...items);
}

function statusBar() {
  if (!me) return h('div', { class: 'nv-bar' }, h('span', { class: 'who' }, 'Čtete jako host.'),
    h('a', { class: 'btn primary', href: '#/prihlaseni' }, 'Přihlásit se / registrovat'));
  return h('div', { class: 'nv-bar' },
    h('span', { class: 'who' }, 'Přihlášen(a): ', h('strong', {}, me.display_name), h('span', { class: 'nv-badge' }, ROLE_CS[me.role])),
    h('a', { class: 'btn primary', href: '#/nove' }, 'Nové téma'));
}

// ---------------------------------------------------------------- reporting
function reportBox(kind, id, onDone) {
  const reason = h('select', {},
    h('option', { value: 'illegal' }, 'Nezákonný obsah'),
    h('option', { value: 'attack' }, 'Útok na osobu'),
    h('option', { value: 'spam' }, 'Spam'),
    h('option', { value: 'other' }, 'Jiné (vlastní důvod)'));
  const note = h('textarea', { rows: '3', maxlength: '1000', placeholder: 'Stručně popište důvod (u volby „Jiné“ povinné).' });
  const msg = h('div');
  const cap = captcha();
  const send = h('button', { type: 'button', class: 'btn danger' }, 'Nahlásit');
  send.addEventListener('click', busy(send, async () => {
    msg.replaceChildren();
    if (reason.value === 'other' && note.value.trim().length < 5) { msg.append(notice('Napište prosím důvod aspoň několika slovy.', 'error')); return; }
    try {
      await publicAction({ action: 'report', kind, id, reason: reason.value, note: note.value, turnstile: cap.token() });
      msg.append(notice('Děkujeme. Obsah je skrytý a správce ho prověří.', 'ok'));
      setTimeout(onDone, 1500);
    } catch (e) { cap.reset(); msg.append(notice(explain(e), 'error')); }
  }));
  return h('div', { class: 'nv-report nv-form' }, field('Důvod', reason), field('Poznámka', note), cap.box, send, msg);
}
function reportToggle(kind, id, onDone) {
  const holder = h('div');
  const t = h('button', { type: 'button', class: 'nv-link' }, 'Nahlásit');
  t.addEventListener('click', () => {
    if (holder.firstChild) { holder.replaceChildren(); return; }
    holder.append(reportBox(kind, id, onDone));
  });
  return h('div', {}, t, holder);
}

// ---------------------------------------------------------------- home: polls + threads
const deviceId = () => {
  try {
    let d = localStorage.getItem('nv-device');
    if (!d) { d = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '').slice(0, 8); localStorage.setItem('nv-device', d); }
    return d;
  } catch { return crypto.randomUUID().replaceAll('-', ''); }
};
const votedKey = (id) => 'nv-voted-' + id;
const hasVoted = (id) => { try { return !!localStorage.getItem(votedKey(id)); } catch { return false; } };
const markVoted = (id) => { try { localStorage.setItem(votedKey(id), '1'); } catch { /* ignore */ } };

function pollResults(options) {
  const total = options.reduce((s, o) => s + o.votes, 0);
  return h('div', { class: 'nv-bars' }, options.map((o) => {
    const pct = total ? Math.round((o.votes / total) * 100) : 0;
    const fill = h('div', { class: 'fill' });
    fill.style.width = pct + '%';
    return h('div', { class: 'nv-bar-row' }, h('div', {}, o.label, ' – ', String(o.votes), ' (', String(pct), ' %)'), h('div', { class: 'track' }, fill));
  }), h('div', { class: 'meta' }, 'Celkem hlasů: ', String(total), '. Výsledky jsou orientační.'));
}

function pollCard(poll, options, reload) {
  const closed = poll.status === 'closed' || (poll.closes_at && new Date(poll.closes_at) <= new Date());
  const card = h('div', { class: 'nv-card' }, h('h3', {}, poll.question),
    h('div', { class: 'meta' }, poll.mode === 'verified' ? 'Hlasují jen ověření členové' : 'Otevřená anketa, hlasuje kdokoli',
      poll.closes_at ? ' · do ' + fmt(poll.closes_at) : ''));
  const resultsView = () => card.append(pollResults(options));
  if (closed || hasVoted(poll.id)) { resultsView(); return card; }
  if (poll.mode === 'verified' && !atLeast('verified')) {
    card.append(notice(me ? 'V této anketě mohou hlasovat jen ověření členové.' : 'Pro hlasování se přihlaste jako ověřený člen.'));
    return card;
  }
  const name = 'opt-' + poll.id;
  const radios = options.map((o) => h('label', {}, h('input', { type: 'radio', name, value: o.id }), o.label));
  const msg = h('div');
  const cap = poll.mode === 'open' ? captcha() : null;
  const send = h('button', { type: 'button', class: 'btn primary' }, 'Hlasovat');
  send.addEventListener('click', busy(send, async () => {
    msg.replaceChildren();
    const pick = card.querySelector('input[name="' + name + '"]:checked');
    if (!pick) { msg.append(notice('Vyberte jednu možnost.', 'error')); return; }
    try {
      if (poll.mode === 'open') await publicAction({ action: 'vote', poll: poll.id, option: pick.value, device: deviceId(), turnstile: cap.token() });
      else { const { error } = await sb.rpc('cast_vote', { p_poll: poll.id, p_option: pick.value }); if (error) throw error; }
      markVoted(poll.id);
      reload();
    } catch (e) { cap?.reset(); if (String(e.message).includes('already_voted')) markVoted(poll.id); msg.append(notice(explain(e), 'error')); }
  }));
  card.append(h('div', { class: 'nv-opts' }, radios), cap?.box, h('div', { class: 'nv-row' }, send, button('Jen výsledky', () => { markVoted(poll.id); reload(); })), msg);
  return card;
}

async function renderHome() {
  show(statusBar(), h('p', {}, 'Načítám…'));
  const [polls, threads] = await Promise.all([
    sb.from('public_polls').select('*').order('created_at', { ascending: false }).limit(10),
    sb.from('public_threads').select('id,title,author_name,created_at').order('created_at', { ascending: false }).limit(50),
  ]);
  const pollIds = (polls.data || []).map((p) => p.id);
  const opts = pollIds.length ? await sb.from('poll_options').select('id,poll_id,label,votes').in('poll_id', pollIds) : { data: [] };
  const out = [statusBar()];
  out.push(h('h2', {}, 'Ankety'));
  if (!polls.data?.length) out.push(h('p', { class: 'meta' }, 'Zatím tu žádná anketa není.'));
  for (const p of polls.data || []) {
    out.push(pollCard(p, (opts.data || []).filter((o) => o.poll_id === p.id).sort((a, b) => a.label.localeCompare(b.label, 'cs')), renderHome));
  }
  out.push(h('h2', {}, 'Témata'));
  if (!threads.data?.length) out.push(h('p', { class: 'meta' }, 'Zatím tu není žádné téma. Buďte první.'));
  for (const t of threads.data || []) {
    out.push(h('div', { class: 'nv-card' }, h('a', { class: 'title', href: '#/t/' + t.id }, t.title),
      h('div', { class: 'meta' }, (t.author_name || 'smazaný uživatel'), ' · ', fmt(t.created_at))));
  }
  show(out);
}

// ---------------------------------------------------------------- thread
async function renderThread(id) {
  const { data: t } = await sb.from('public_threads').select('*').eq('id', id).maybeSingle();
  if (!t) { show(notice('Toto téma neexistuje nebo bylo skryto.'), h('a', { href: '#/' }, '← Zpět')); return; }
  const { data: comments } = await sb.from('public_comments').select('*').eq('thread_id', id).order('created_at', { ascending: true });
  const out = [h('a', { href: '#/' }, '← Všechna témata'),
    h('div', { class: 'nv-card' }, h('h3', {}, t.title),
      h('div', { class: 'meta' }, (t.author_name || 'smazaný uživatel'), t.author_verified ? h('span', { class: 'nv-badge' }, 'ověřený') : null, ' · ', fmt(t.created_at)),
      h('p', { class: 'nv-body' }, t.body), reportToggle('thread', t.id, () => { location.hash = '#/'; renderRoute(); }))];
  out.push(h('h2', {}, 'Komentáře (' + (comments || []).length + ')'));
  for (const c of comments || []) {
    out.push(h('div', { class: 'nv-comment' },
      h('div', { class: 'meta' }, h('strong', {}, c.author_name || 'smazaný uživatel'), c.author_verified ? h('span', { class: 'nv-badge' }, 'ověřený') : null, ' · ', fmt(c.created_at)),
      h('p', { class: 'nv-body' }, c.body), reportToggle('comment', c.id, () => renderThread(id))));
  }
  if (me) {
    const body = h('textarea', { required: true, maxlength: '5000', rows: '4' });
    const msg = h('div');
    const send = h('button', { type: 'button', class: 'btn primary' }, 'Přidat komentář');
    send.addEventListener('click', busy(send, async () => {
      msg.replaceChildren();
      const { error } = await sb.rpc('create_comment', { p_thread: id, p_body: body.value });
      if (error) { msg.append(notice(explain(error), 'error')); return; }
      body.value = '';
      msg.append(notice(atLeast('verified') ? 'Komentář je zveřejněn.' : 'Komentář čeká na schválení ověřeným členem.', 'ok'));
      if (atLeast('verified')) setTimeout(() => renderThread(id), 600);
    }));
    out.push(h('div', { class: 'nv-form' }, field('Váš komentář', body), send, msg));
  } else {
    out.push(notice('Pro komentování se přihlaste.'), h('a', { class: 'btn primary', href: '#/prihlaseni' }, 'Přihlásit se'));
  }
  show(out);
}

// ---------------------------------------------------------------- new thread
function renderNew() {
  if (!me) { location.hash = '#/prihlaseni'; return; }
  const title = h('input', { type: 'text', required: true, maxlength: '140', minlength: '3' });
  const body = h('textarea', { required: true, maxlength: '10000', rows: '8' });
  const msg = h('div');
  const send = h('button', { type: 'button', class: 'btn primary' }, 'Odeslat téma');
  send.addEventListener('click', busy(send, async () => {
    msg.replaceChildren();
    const { data, error } = await sb.rpc('create_thread', { p_title: title.value, p_body: body.value });
    if (error) { msg.append(notice(explain(error), 'error')); return; }
    if (atLeast('verified')) { location.hash = '#/t/' + data; return; }
    msg.append(notice('Děkujeme. Téma čeká na schválení ověřeným členem a poté se zobrazí.', 'ok'));
    title.value = ''; body.value = '';
  }));
  show(h('a', { href: '#/' }, '← Zpět'), h('h2', {}, 'Nové téma'),
    h('div', { class: 'nv-form' }, field('Nadpis', title), field('Text', body), send, msg),
    atLeast('verified') ? null : h('p', { class: 'meta' }, 'Jako ' + ROLE_CS[me.role] + ' člen potřebujete schválení jiným ověřeným členem.'));
}

// ---------------------------------------------------------------- login / registration
function renderLogin() {
  if (me) { location.hash = '#/'; return; }
  const query = new URLSearchParams((location.hash.split('?')[1] || ''));
  const invite = (query.get('pozvanka') || '').replace(/[^0-9a-f]/gi, '').slice(0, 64);
  const mode = h('select', {}, h('option', { value: 'login' }, 'Už mám účet'), h('option', { value: 'register' }, 'Registrace nového člena'));
  if (invite) mode.value = 'register';
  const email = h('input', { type: 'email', required: true, autocomplete: 'email' });
  const name = h('input', { type: 'text', autocomplete: 'name', maxlength: '80', placeholder: 'Jméno Příjmení' });
  const code = h('input', { type: 'text', maxlength: '64', autocomplete: 'off' });
  code.value = invite;
  const tos = h('input', { type: 'checkbox' });
  const regBox = h('div', { class: 'nv-form' },
    field('Jméno a příjmení (na webu se zobrazí jen např. „J. Novák“)', name),
    field('Kód pozvánky (nepovinný; s pozvánkou můžete později požádat o ověření)', code),
    h('label', { class: 'check' }, tos, h('span', {}, 'Souhlasím s pravidly diskuze (slušné jednání, žádný nezákonný obsah) a se zpracováním jména a e-mailu za účelem provozu NeboviSea. Účet můžu kdykoli smazat.')));
  const msg = h('div');
  const cap = captcha();
  const stepOne = h('div', { class: 'nv-form' }, field('Vaše činnost', mode), field('E-mail', email), regBox, cap.box);
  const sync = () => { regBox.hidden = mode.value !== 'register'; };
  mode.addEventListener('change', sync); sync();

  const codeInput = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '10' });
  const stepTwo = h('div', { class: 'nv-form' }, notice('Poslali jsme vám na e-mail kód. Opište ho sem (zkontrolujte i složku Spam).'), field('Kód z e-mailu', codeInput));
  stepTwo.hidden = true;

  const send = h('button', { type: 'button', class: 'btn primary' }, 'Poslat kód na e-mail');
  const verify = h('button', { type: 'button', class: 'btn primary' }, 'Přihlásit se');
  verify.hidden = true;

  send.addEventListener('click', busy(send, async () => {
    msg.replaceChildren();
    const register = mode.value === 'register';
    if (!email.value.includes('@')) { msg.append(notice('Zadejte e-mail.', 'error')); return; }
    if (register && !(/^[A-Za-z\u00C0-\u017F][A-Za-z\u00C0-\u017F .'-]{1,78}[A-Za-z\u00C0-\u017F]$/.test(name.value.trim()) && /\s/.test(name.value.trim()))) {
      msg.append(notice(MESSAGES.invalid_name, 'error')); return;
    }
    if (register && !tos.checked) { msg.append(notice(MESSAGES.tos_required, 'error')); return; }
    const options = { shouldCreateUser: register, captchaToken: cap.token() || undefined };
    if (register) {
      options.data = { full_name: name.value.trim(), tos: 'true' };
      if (code.value.trim()) options.data.invite_code = code.value.trim();
    }
    const { error } = await sb.auth.signInWithOtp({ email: email.value.trim(), options });
    cap.reset();
    if (error && error.status === 429) { msg.append(notice(MESSAGES.rate_limited, 'error')); return; }
    // The server gives one answer for every refusal (blocked, already registered, bad invite...), so nobody
    // can probe which e-mails exist. Registration failures are explained only in general terms.
    if (error && register && /database error/i.test(error.message)) {
      msg.append(notice('Registrace se nepodařila. Zkontrolujte jméno a příjmení a kód pozvánky. Pokud už účet máte, zvolte „Už mám účet“.', 'error')); return;
    }
    stepOne.hidden = true; send.hidden = true; stepTwo.hidden = false; verify.hidden = false;
  }));
  verify.addEventListener('click', busy(verify, async () => {
    msg.replaceChildren();
    const { error } = await sb.auth.verifyOtp({ email: email.value.trim(), token: codeInput.value.trim(), type: 'email' });
    if (error) { msg.append(notice('Kód není správný nebo vypršel. Zkuste to znovu.', 'error')); return; }
    location.hash = '#/';
  }));
  show(h('a', { href: '#/' }, '← Zpět'), h('h2', {}, 'Přihlášení a registrace'), stepOne, stepTwo, h('div', { class: 'nv-row' }, send, verify), msg);
}

// ---------------------------------------------------------------- account
function renderAccount() {
  if (!me) { location.hash = '#/prihlaseni'; return; }
  const msg = h('div');
  const out = [h('h2', {}, 'Můj účet'),
    h('div', { class: 'nv-card' }, h('div', {}, h('strong', {}, me.display_name), h('span', { class: 'nv-badge' }, ROLE_CS[me.role])),
      h('div', { class: 'meta' }, 'Zobrazuje se jako „', me.display_name, '“. Celé jméno vidí jen správci.'))];
  if (me.role === 'invited') {
    out.push(h('div', { class: 'nv-card' }, h('p', {}, 'Jste pozván(a). Požádejte o ověření a jiný ověřený člen vaši žádost potvrdí.'),
      button('Požádat o ověření', async () => {
        const { error } = await sb.rpc('request_verification');
        msg.replaceChildren(error ? notice(/duplicate/i.test(error.message) ? 'Žádost už je odeslaná.' : explain(error), error && !/duplicate/i.test(error.message) ? 'error' : 'ok') : notice('Žádost byla odeslána.', 'ok'));
      }, 'btn primary')));
  }
  out.push(h('div', { class: 'nv-row' },
    button('Odhlásit se', async () => { await sb.auth.signOut(); location.hash = '#/'; }),
    button('Smazat můj účet', async () => {
      if (!confirm('Opravdu smazat účet? Vaše příspěvky zůstanou, ale bez jména.')) return;
      const { error } = await sb.rpc('delete_my_account');
      if (error) { msg.replaceChildren(notice(explain(error), 'error')); return; }
      await sb.auth.signOut(); location.hash = '#/';
    }, 'btn danger')), msg);
  show(out);
}

// ---------------------------------------------------------------- queue (verified+)
async function renderQueue() {
  if (!atLeast('verified')) { location.hash = '#/'; return; }
  const [content, verifs, invites] = await Promise.all([
    sb.from('pending_content').select('*').order('created_at'),
    sb.from('pending_verifications').select('*').order('created_at'),
    sb.from('invites').select('id,created_at,expires_at,used_by,revoked').eq('created_by', me.id).order('created_at', { ascending: false }).limit(30),
  ]);
  const out = [h('h2', {}, 'Čeká na schválení')];
  const msg = h('div');
  const act = (fn) => async () => { const { error } = await fn(); if (error) { msg.replaceChildren(notice(explain(error), 'error')); return; } renderQueue(); };

  if (!content.data?.length) out.push(h('p', { class: 'meta' }, 'Žádné příspěvky nečekají.'));
  for (const c of content.data || []) {
    const locked = c.needs_admin && !atLeast('admin');
    out.push(h('div', { class: 'nv-card' },
      h('div', { class: 'meta' }, c.kind === 'thread' ? 'Téma' : 'Komentář', ' · ', c.author_name || '—', ' · ', fmt(c.created_at),
        c.needs_admin ? h('span', { class: 'nv-badge warn' }, 'vyžaduje správce') : null),
      c.title ? h('h3', {}, c.title) : null, h('p', { class: 'nv-body' }, c.body),
      locked ? h('p', { class: 'meta' }, 'Tento příspěvek může schválit jen správce.') :
        h('div', { class: 'nv-row' },
          button('Schválit', act(() => sb.rpc('approve_content', { p_kind: c.kind, p_id: c.id, p_approve: true })), 'btn primary'),
          button('Zamítnout', act(() => sb.rpc('approve_content', { p_kind: c.kind, p_id: c.id, p_approve: false }))))));
  }

  out.push(h('h2', {}, 'Žádosti o ověření'));
  if (!verifs.data?.length) out.push(h('p', { class: 'meta' }, 'Žádné žádosti nečekají.'));
  for (const v of verifs.data || []) {
    out.push(h('div', { class: 'nv-card' }, h('strong', {}, v.display_name),
      h('div', { class: 'meta' }, 'Pozval(a): ', v.invited_by_name || '—', ' · ', fmt(v.created_at)),
      h('div', { class: 'nv-row' },
        button('Ověřit', act(() => sb.rpc('decide_verification', { req: v.id, approve: true })), 'btn primary'),
        button('Zamítnout', act(() => sb.rpc('decide_verification', { req: v.id, approve: false }))))));
  }

  out.push(h('h2', {}, 'Pozvánky'));
  const inviteOut = h('div');
  const active = (invites.data || []).filter((i) => !i.used_by && !i.revoked && new Date(i.expires_at) > new Date()).length;
  out.push(h('p', { class: 'meta' }, 'Aktivních pozvánek: ', String(active), ' z 10. Pozvánka platí 14 dní a jde použít jednou.'),
    button('Vytvořit pozvánku', async () => {
      const { data, error } = await sb.rpc('create_invite');
      if (error) { inviteOut.replaceChildren(notice(explain(error), 'error')); return; }
      const link = location.origin + '/neboviseum/#/prihlaseni?pozvanka=' + data;
      inviteOut.replaceChildren(notice('Pozvánka je vytvořená. Zobrazí se jen teď, pošlete ji dál:', 'ok'), h('div', { class: 'nv-code' }, link),
        button('Zkopírovat odkaz', async (b) => { try { await navigator.clipboard.writeText(link); b.textContent = 'Zkopírováno ✓'; } catch { /* ignore */ } }));
    }, 'btn primary'), inviteOut);

  out.push(h('h2', {}, 'Nová anketa'), pollForm(msg), msg);
  show(out);
}

function pollForm(msg) {
  const q = h('input', { type: 'text', maxlength: '300', minlength: '5' });
  const opts = h('textarea', { rows: '4', placeholder: 'Jedna možnost na řádek (2 až 8)' });
  const mode = h('select', {}, h('option', { value: 'open' }, 'Otevřená (hlasuje kdokoli)'), h('option', { value: 'verified' }, 'Jen ověření členové'));
  const until = h('input', { type: 'datetime-local' });
  const send = button('Vytvořit anketu', async () => {
    const options = opts.value.split('\n').map((s) => s.trim()).filter(Boolean);
    const { error } = await sb.rpc('create_poll', { p_question: q.value, p_options: options, p_mode: mode.value, p_closes_at: until.value ? new Date(until.value).toISOString() : null });
    msg.replaceChildren(error ? notice(/invalid_options/.test(error.message) ? 'Zadejte 2 až 8 možností.' : explain(error), 'error') : notice('Anketa je vytvořená.', 'ok'));
    if (!error) { q.value = ''; opts.value = ''; }
  }, 'btn primary');
  return h('div', { class: 'nv-form' }, field('Otázka', q), field('Možnosti', opts), field('Kdo smí hlasovat', mode), field('Konec hlasování (nepovinný)', until), send);
}

// ---------------------------------------------------------------- admin
async function renderAdmin() {
  if (!atLeast('admin')) { location.hash = '#/'; return; }
  const msg = h('div');
  const done = (error, okText) => msg.replaceChildren(error ? notice(explain(error), 'error') : notice(okText, 'ok'));
  const out = [h('h2', {}, 'Nahlášený obsah'), msg];

  const reports = await sb.from('reports').select('id,target_kind,target_id,reason,note,created_at,ignored').is('resolved_at', null).order('created_at');
  const groups = new Map();
  for (const r of reports.data || []) { const k = r.target_kind + ':' + r.target_id; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
  if (!groups.size) out.push(h('p', { class: 'meta' }, 'Žádné nahlášení nečeká.'));
  const REASON = { illegal: 'nezákonný obsah', attack: 'útok na osobu', spam: 'spam', other: 'jiné' };
  for (const list of groups.values()) {
    const r0 = list[0];
    const table = r0.target_kind === 'thread' ? 'threads' : 'comments';
    const { data: tgt } = await sb.from(table).select(r0.target_kind === 'thread' ? 'title,body,status' : 'body,status').eq('id', r0.target_id).maybeSingle();
    const resolve = (action, label, cls) => button(label, async () => {
      if (action === 'delete_and_block' && !confirm('Smazat a zablokovat autora? Jeho e-mail se zapíše do seznamu zablokovaných.')) return;
      const { error } = await sb.rpc('resolve_report', { p_report: r0.id, p_action: action, p_reason: REASON[r0.reason] });
      done(error, 'Vyřízeno.'); if (!error) renderAdmin();
    }, cls);
    out.push(h('div', { class: 'nv-card' },
      h('div', { class: 'meta' }, r0.target_kind === 'thread' ? 'Téma' : 'Komentář', ' · ', String(list.length), '× nahlášeno · ', fmt(r0.created_at), tgt ? ' · stav: ' + tgt.status : ' · obsah už neexistuje'),
      tgt?.title ? h('h3', {}, tgt.title) : null, tgt ? h('p', { class: 'nv-body' }, tgt.body) : null,
      h('ul', {}, list.map((r) => h('li', {}, REASON[r.reason], r.note ? ': ' + r.note : '', r.ignored ? ' (obsah už byl dříve schválen)' : ''))),
      h('div', { class: 'nv-row' }, resolve('restore', 'Obnovit', 'btn primary'), resolve('delete', 'Smazat', 'btn outline'), resolve('delete_and_block', 'Smazat a zablokovat autora', 'btn danger'))));
  }

  out.push(h('h2', {}, 'Zablokovat e-mail'));
  const bem = h('input', { type: 'email' }); const ber = h('input', { type: 'text', maxlength: '200', placeholder: 'Důvod (nepovinný)' });
  out.push(h('div', { class: 'nv-form' }, field('E-mail', bem), field('Důvod', ber),
    button('Zablokovat', async () => { const { error } = await sb.rpc('block_email', { p_email: bem.value, p_reason: ber.value || null }); done(error, 'E-mail je zablokovaný (v databázi jen jako hash).'); })));

  if (atLeast('superadmin')) {
    out.push(h('h2', {}, 'Zakázaná slova'));
    const words = await sb.from('banned_words').select('stem,level').order('stem');
    const stem = h('input', { type: 'text', maxlength: '60' });
    const level = h('select', {}, h('option', { value: 'block' }, 'Blokovat'), h('option', { value: 'review' }, 'Poslat ke schválení správci'));
    out.push(h('div', { class: 'nv-form' }, field('Kmen slova (min. 3 písmena)', stem), field('Úroveň', level),
      button('Přidat', async () => { const { error } = await sb.rpc('add_banned_word', { p_stem: stem.value, p_level: level.value }); done(error, 'Přidáno.'); if (!error) renderAdmin(); })));
    out.push(h('table', { class: 'nv-table' }, h('tbody', {}, (words.data || []).map((w) =>
      h('tr', {}, h('td', {}, w.stem), h('td', {}, w.level === 'block' ? 'blokovat' : 'ke schválení'),
        h('td', {}, button('Odebrat', async () => { const { error } = await sb.rpc('remove_banned_word', { p_stem: w.stem }); done(error, 'Odebráno.'); if (!error) renderAdmin(); })))))));

    out.push(h('h2', {}, 'Zablokovat doménu'));
    const dom = h('input', { type: 'text', placeholder: 'napr-jednorazove.example' });
    out.push(h('div', { class: 'nv-form' }, field('Doména', dom),
      button('Zablokovat doménu', async () => { const { error } = await sb.rpc('block_domain', { p_domain: dom.value, p_reason: null }); done(error, 'Doména je zablokovaná.'); })));

    out.push(h('h2', {}, 'Členové a role'));
    const members = await sb.from('profiles').select('id,display_name,full_name,role,blocked,created_at').order('created_at', { ascending: false }).limit(200);
    out.push(h('table', { class: 'nv-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Jméno'), h('th', {}, 'Role'), h('th', {}, 'Změnit'))),
      h('tbody', {}, (members.data || []).map((m) => {
        const sel = h('select', {}, ['unverified', 'invited', 'verified', 'admin'].map((r) => h('option', { value: r, selected: r === m.role }, ROLE_CS[r])));
        return h('tr', {}, h('td', {}, m.full_name, ' (', m.display_name, ')', m.blocked ? h('span', { class: 'nv-badge warn' }, 'zablokován') : null),
          h('td', {}, ROLE_CS[m.role]),
          h('td', {}, m.role === 'superadmin' ? '—' : h('div', { class: 'nv-row' }, sel,
            button('Uložit', async () => { const { error } = await sb.rpc('set_role', { p_user: m.id, p_role: sel.value }); done(error, 'Role změněna.'); if (!error) renderAdmin(); }))));
      }))));
  }
  show(out);
}

// ---------------------------------------------------------------- router
async function renderRoute() {
  renderNav();
  const hash = location.hash.replace(/^#/, '') || '/';
  const path = hash.split('?')[0];
  try {
    if (path === '/') await renderHome();
    else if (path.startsWith('/t/')) await renderThread(path.slice(3));
    else if (path === '/nove') renderNew();
    else if (path === '/prihlaseni') renderLogin();
    else if (path === '/ucet') renderAccount();
    else if (path === '/fronta') await renderQueue();
    else if (path === '/admin') await renderAdmin();
    else show(notice('Tato stránka neexistuje.'), h('a', { href: '#/' }, '← Zpět'));
  } catch (e) {
    show(notice('Něco se nepovedlo. Zkuste stránku obnovit.', 'error'));
    console.error(e);
  }
  renderNav();
}

async function start() {
  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
    show(notice('NeboviSeum se připravuje. Brzy tu bude.'));
    return;
  }
  sb = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const { data } = await sb.auth.getSession();
  session = data.session;
  await loadMe();
  sb.auth.onAuthStateChange(async (_event, s) => { session = s; await loadMe(); renderRoute(); });
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}
start();
