/* App interna de Aire de Mar: Producción, Sponsors, Métricas y Equipo sobre Supabase.
   La clave de acá es la pública (anon): lo que protege los datos son las reglas RLS de la base,
   que solo dejan leer y escribir a quien figura en la tabla "equipo". */
const SUPABASE_URL = 'https://rwxrwwuddwuzberqmela.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3eHJ3d3VkZHd1emJlcnFtZWxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MTgxMTUsImV4cCI6MjEwNjI5NDExNX0.eH3xfrpCr7AsZpSj4FygahfOPmXtn59nT6HgMcvr59o';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true, autoRefreshToken: true } });

const emailDe = (usuario) => {
  const u = usuario.trim().toLowerCase();
  return u.includes('@') ? u : `airedemar.uy+${u}@gmail.com`;
};

const ETAPAS_NOTA = ['Grabada', 'Corte', 'Edición', 'Copies', 'Lista', 'Salió'];
const PILARES = ['Deportistas y protagonistas', 'Deporte en acción', 'Medio ambiente y comunidad', 'Cultura del mar', 'Detrás de cámaras', 'Educación y tips'];
const ETAPAS_EMP = [
  { id: 'prospecto', label: 'Prospecto', hint: 'Encaja, falta el contacto' },
  { id: 'listo', label: 'Contacto listo', hint: 'Tiene mail: entra a la secuencia' },
  { id: 'secuencia', label: 'En secuencia', hint: 'Mails enviados, esperando respuesta' },
  { id: 'conversacion', label: 'Conversación', hint: 'Respondió o hay reunión' },
  { id: 'propuesta', label: 'Propuesta', hint: 'Propuesta con precio enviada' },
  { id: 'sponsor', label: 'Sponsor', hint: 'Activo: cuidar y renovar' },
  { id: 'pausa', label: 'No por ahora', hint: 'Dijo que no o pausado' },
];
const NIVELES = { pez_gordo: 'Pez gordo', mediano: 'Mediano', local: 'Local' };
const ACUERDOS = { pago: 'Pago', canje: 'Canje', mixto: 'Mixto' };
const ordenLead = (a, b) => (b.puntaje || 0) - (a.puntaje || 0) || (rangoPrio[a.prioridad] ?? 3) - (rangoPrio[b.prioridad] ?? 3) || porNombre(a, b);
const ESTADOS_MAIL = { borrador: 'Borrador en Gmail', enviado: 'Enviado', respondido: 'Respondió', rebotado: 'Rebotó', descartado: 'Descartado' };
const PASOS = { 1: 'Mail 1', 2: 'Seguimiento', 3: 'Último mail' };
const GMAIL_BORRADORES = 'https://mail.google.com/mail/u/?authuser=airedemar.uy@gmail.com#drafts';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const TABLAS = ['notas', 'empresas', 'contactos', 'envios', 'plantillas', 'paquetes', 'config', 'metricas', 'equipo'];

function vistaGuardada() { try { return localStorage.getItem('calVista') === 'lista' ? 'lista' : 'clasico'; } catch (_) { return 'clasico'; } }
const S = {
  yo: null, tab: 'produccion', calVista: vistaGuardada(), calMes: new Date(), subSp: 'embudo', resp: '', etapa: null, q: '', rubro: '', tipo: '',
  abierta: null, borrador: null, cargado: false, conCuenta: null, claves: {}, nivel: '', acuerdo: '',
  notas: [], empresas: [], contactos: [], envios: [], plantillas: [], paquetes: [], config: [], metricas: [], equipo: [],
};
let canal = null;

/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => Number(n || 0).toLocaleString('es-UY');
const hoyIso = () => iso(new Date());
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function fechaCorta(s) { if (!s) return ''; const d = s.length === 10 ? parse(s) : new Date(s); return isNaN(d) ? s : d.getDate() + ' ' + MESES[d.getMonth()]; }
function hoy0() { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }
function proximoDomingo() { const t = hoy0(); t.setDate(t.getDate() + ((7 - t.getDay()) % 7)); return t; }
const porNombre = (a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es');
const rangoPrio = { A: 0, B: 1, C: 2 };
const contactosDe = (id) => S.contactos.filter(c => c.empresa_id === id);
const enviosDe = (id) => S.envios.filter(e => e.empresa_id === id).sort((a, b) => (b.creado || '').localeCompare(a.creado || ''));
const empresa = (id) => S.empresas.find(e => e.id === id);
const flujo = () => (S.config.find(c => c.id === 'flujo') || {}).datos || {};
const metrica = (id) => (S.metricas.find(m => m.id === id) || {}).datos || null;
const responsables = () => S.equipo.filter(m => m.usuario !== 'airedemar').map(m => m.nombre).sort((a, b) => a.localeCompare(b, 'es'));
const esAdmin = () => S.yo && S.yo.rol === 'admin';

function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
function aviso(t) { const el = $('#aviso'); el.textContent = t || ''; el.hidden = !t; }

async function escribir(promesa, ok) {
  const { error } = await promesa;
  if (error) {
    const msg = error.code === '42501' ? 'No tenés permiso para hacer ese cambio.' : (error.message || 'error desconocido');
    toast('No se pudo guardar: ' + msg);
    return false;
  }
  if (ok) toast(ok);
  return true;
}

/* ---------- login ---------- */
async function iniciar() {
  const { data } = await sb.auth.getSession();
  if (data.session) await entrar(data.session); else mostrarLogin();
  sb.auth.onAuthStateChange((ev, session) => { if (ev === 'SIGNED_OUT') mostrarLogin(); });
}

function mostrarLogin(msg) {
  if (canal) { sb.removeChannel(canal); canal = null; }
  $('#v-app').hidden = true; $('#v-login').hidden = false;
  $('#l-error').textContent = msg || '';
  $('#l-entrar').disabled = false;
  setTimeout(() => $('#l-usuario').focus(), 50);
}

$('#f-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const usuario = $('#l-usuario').value, pass = $('#l-pass').value;
  if (!usuario.trim() || !pass) return;
  $('#l-entrar').disabled = true; $('#l-error').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email: emailDe(usuario), password: pass });
  if (error) {
    $('#l-entrar').disabled = false;
    $('#l-error').textContent = error.status === 400 ? 'Usuario o contraseña incorrectos.' : 'No se pudo entrar: ' + error.message;
    return;
  }
  $('#l-pass').value = '';
  await entrar(data.session);
});

async function entrar(session) {
  const email = (session.user.email || '').toLowerCase();
  const { data: yo } = await sb.from('equipo').select('*').eq('email', email).maybeSingle();
  if (!yo) { await sb.auth.signOut(); mostrarLogin('Tu usuario no está habilitado en el equipo. Hablá con Juandi.'); return; }
  S.yo = yo;
  $('#v-login').hidden = true; $('#v-app').hidden = false;
  $('#yo-nombre').textContent = yo.nombre;
  $('#t-equipo').hidden = !esAdmin();
  await cargarTodo();
  suscribir();
  render();
}

$('#b-salir').addEventListener('click', async () => { await sb.auth.signOut(); });
$('#b-cuenta').addEventListener('click', () => { $('#c-error').textContent = ''; $('#f-cuenta').reset(); $('#d-cuenta').showModal(); });
$('#c-cancelar').addEventListener('click', () => $('#d-cuenta').close());
$('#f-cuenta').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const a = $('#c-pass1').value, b = $('#c-pass2').value;
  if (a.length < 8) { $('#c-error').textContent = 'Usá al menos 8 caracteres.'; return; }
  if (a !== b) { $('#c-error').textContent = 'Las dos contraseñas no coinciden.'; return; }
  const { error } = await sb.auth.updateUser({ password: a });
  if (error) { $('#c-error').textContent = 'No se pudo cambiar: ' + error.message; return; }
  llamarEquipo({ accion: 'guardar-clave', contrasena: a });
  $('#d-cuenta').close(); toast('Contraseña cambiada.');
});

/* ---------- datos ---------- */
async function cargar(tabla) {
  const { data, error } = await sb.from(tabla).select('*');
  if (error) { aviso('No se pudo leer ' + tabla + ': ' + error.message); return; }
  S[tabla] = data || [];
}
async function cargarTodo() { await Promise.all(TABLAS.map(cargar)); S.cargado = true; }

function suscribir() {
  if (canal) sb.removeChannel(canal);
  let pendiente = new Set(), timer = null;
  canal = sb.channel('cambios')
    .on('postgres_changes', { event: '*', schema: 'public' }, (p) => {
      pendiente.add(p.table);
      clearTimeout(timer);
      timer = setTimeout(async () => { const t = [...pendiente]; pendiente = new Set(); await Promise.all(t.map(cargar)); render(); }, 250);
    })
    .subscribe();
}

/* ---------- render general ---------- */
function render() {
  if (!S.yo) return;
  document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  const pend = S.envios.filter(e => e.estado === 'borrador').length;
  $('#t-sponsors').innerHTML = 'Sponsors' + (pend ? `<span class="badge">${pend}</span>` : '');
  for (const t of ['produccion', 'calendario', 'sponsors', 'metricas', 'equipo']) $('#v-' + t).hidden = S.tab !== t;
  if (S.tab === 'produccion') renderProduccion();
  if (S.tab === 'calendario') renderCalendario();
  if (S.tab === 'sponsors') renderSponsors();
  if (S.tab === 'metricas') renderMetricas();
  if (S.tab === 'equipo') renderEquipo();
  if (S.abierta) renderFicha();
}

/* ================= PRODUCCIÓN ================= */
function notasFiltradas() { return S.resp ? S.notas.filter(n => n.responsable === S.resp) : S.notas; }

function tarjetaNota(n) {
  const fecha = n.emision ? `<span class="chip line">dom ${esc(fechaCorta(n.emision))}</span>` : '<span class="chip warn">sin fecha</span>';
  const pubs = `<span class="pubs"><span class="pub ${n.tv ? 'on' : ''}">TV</span><span class="pub ${n.ig ? 'on' : ''}">IG</span><span class="pub ${n.yt ? 'on' : ''}">YT</span></span>`;
  const faltan = n.etapa >= 5 ? [!n.ig && 'falta IG', !n.yt && 'falta YouTube'].filter(Boolean).map(x => `<span class="chip alert">${x}</span>`).join('') : '';
  return `<div class="card" role="button" tabindex="0" draggable="true" data-nota="${esc(n.id)}">
    <span class="tt"><span>${esc(n.titulo)}</span></span>
    ${n.protagonista ? `<span class="meta">${esc(n.protagonista)}</span>` : ''}
    <span class="flags">${fecha}${pubs}${n.responsable ? `<span class="chip">${esc(n.responsable)}</span>` : ''}${n.duracion ? `<span class="chip line">${esc(n.duracion)}</span>` : ''}</span>
    ${faltan ? `<span class="flags">${faltan}</span>` : ''}
    ${n.pendientes ? `<span class="pend">${esc(n.pendientes)}</span>` : ''}
  </div>`;
}

function barraNotas(izq = '') {
  const opcResp = ['', ...new Set([...responsables(), ...S.notas.map(n => n.responsable).filter(Boolean)])];
  return `<div class="barra">${izq || '<span></span>'}
      <div class="herr">
        <select id="f-resp" aria-label="Responsable">${opcResp.map(r => `<option value="${esc(r)}" ${r === S.resp ? 'selected' : ''}>${r ? esc(r) : 'Todo el equipo'}</option>`).join('')}</select>
        <button class="btn" data-nueva-nota>+ Nueva nota</button>
      </div>
    </div>`;
}

function chipNota(n) {
  return `<div class="chip-nota e${n.etapa}" role="button" tabindex="0" draggable="true" data-nota="${esc(n.id)}" title="${esc(n.titulo)}${n.responsable ? ' · ' + esc(n.responsable) : ''}">${esc(n.titulo)}</div>`;
}

function renderProduccion() {
  const v = $('#v-produccion');
  const ns = S.notas, dom = iso(proximoDomingo());
  const stats = [
    [ns.filter(n => n.etapa < 4).length, 'en producción'],
    [ns.filter(n => n.etapa === 4).length, 'listas para emitir'],
    [ns.filter(n => n.emision === dom).length, 'para este domingo', ns.filter(n => n.emision === dom).length === 0],
    [ns.filter(n => !n.emision && n.etapa < 5).length, 'sin fecha de emisión', ns.some(n => !n.emision && n.etapa < 5)],
    [ns.filter(n => n.etapa >= 5 && !n.yt).length, 'salieron y faltan en YouTube', ns.some(n => n.etapa >= 5 && !n.yt)],
  ];
  const lista = notasFiltradas();
  v.innerHTML = `
    <div class="tira">${stats.map(([n, l, a]) => `<div class="${a ? 'alerta' : ''}"><span class="n">${n}</span><span class="l">${l}</span></div>`).join('')}</div>
    ${barraNotas()}
    <div class="tablero">${ETAPAS_NOTA.map((et, i) => {
      const items = lista.filter(n => n.etapa === i).sort((a, b) => (a.emision || '9').localeCompare(b.emision || '9'));
      return `<div class="col ${i === 5 ? 'fin' : ''}" data-soltar-etapa="${i}"><h3><span>${et}</span><span>${items.length}</span></h3><div class="cards">${items.length ? items.map(tarjetaNota).join('') : '<div class="vacio">Nada acá.</div>'}</div></div>`;
    }).join('')}</div>`;
}

function renderCalendario() {
  const v = $('#v-calendario');
  const lista = notasFiltradas();
  const clasico = S.calVista === 'clasico';
  const mes = new Date(S.calMes.getFullYear(), S.calMes.getMonth(), 1);
  const nombreMes = mes.toLocaleDateString('es-UY', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
  const izq = `<div class="herr"><div class="sub" role="tablist"><button data-calvista="clasico" aria-selected="${clasico}">Clásico</button><button data-calvista="lista" aria-selected="${!clasico}">Lista</button></div>` +
    (clasico ? `<div class="mes-nav"><button class="btn quiet small" data-calmes="-1" aria-label="Mes anterior">‹</button><b class="mes-nombre">${esc(nombreMes)}</b><button class="btn quiet small" data-calmes="1" aria-label="Mes siguiente">›</button><button class="btn quiet small" data-calmes="hoy">Hoy</button></div>` : '') + '</div>';
  const sin = lista.filter(n => !n.emision && n.etapa < 5);
  let cuerpo;
  if (clasico) {
    const offset = (mes.getDay() + 6) % 7, total = Math.ceil((offset + new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate()) / 7) * 7;
    const hoy = hoyIso();
    const dias = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<div class="cab">${d}</div>`).join('');
    const celdas = Array.from({ length: total }, (_, i) => {
      const d = new Date(mes.getFullYear(), mes.getMonth(), 1 - offset + i), s = iso(d);
      const items = lista.filter(n => n.emision === s);
      return `<div class="dia ${d.getMonth() !== mes.getMonth() ? 'fuera' : ''} ${s === hoy ? 'hoy' : ''} ${d.getDay() === 0 ? 'domingo' : ''}" data-soltar-fecha="${s}"><span class="num">${d.getDate()}</span>${items.map(chipNota).join('')}</div>`;
    }).join('');
    cuerpo = `<div class="grilla-wrap"><div class="grilla">${dias}${celdas}</div></div>
      <div class="sinfecha" data-soltar-fecha=""><h4>Sin fecha <span>${sin.length}</span></h4><div class="items">${sin.length ? sin.map(chipNota).join('') : '<div class="nota">Todas tienen fecha.</div>'}</div></div>`;
  } else {
    const prox = proximoDomingo(), proxIso = iso(prox), dias = new Set();
    for (let k = -3; k <= 6; k++) { const d = new Date(prox); d.setDate(d.getDate() + 7 * k); dias.add(iso(d)); }
    lista.forEach(n => n.emision && dias.add(n.emision));
    let html = [...dias].sort().map(s => {
      const items = lista.filter(n => n.emision === s), d = parse(s);
      const pasado = s < proxIso, esProx = s === proxIso;
      return `<div class="dom ${pasado ? 'pasado' : ''} ${esProx ? 'proximo' : ''}" data-soltar-fecha="${s}">
        <div class="d"><b>${d.getDate()} ${MESES[d.getMonth()]}</b><span>${d.getFullYear()} · 17:30${d.getDay() !== 0 ? ' · no es domingo' : ''}</span>${esProx ? '<br><em>Este domingo</em>' : ''}</div>
        <div class="items">${items.length ? items.map(tarjetaNota).join('') : `<div class="nota">${pasado ? 'Sin notas registradas.' : 'Sin notas asignadas todavía.'}</div>`}</div></div>`;
    }).join('');
    html += `<div class="dom" data-soltar-fecha=""><div class="d"><b>Sin fecha</b><span>${sin.length} nota${sin.length === 1 ? '' : 's'}</span></div><div class="items">${sin.length ? sin.map(tarjetaNota).join('') : '<div class="nota">Todas tienen fecha.</div>'}</div></div>`;
    cuerpo = `<div class="cal">${html}</div>`;
  }
  v.innerHTML = barraNotas(izq) + cuerpo;
}

/* ---------- arrastrar tarjetas: en el tablero cambia la etapa, en el calendario el domingo ---------- */
async function moverNota(id, cambio) {
  const n = S.notas.find(x => x.id === id);
  if (!n || Object.keys(cambio).every(k => n[k] === cambio[k])) return;
  const antes = { ...n };
  Object.assign(n, cambio); render();
  if (!(await escribir(sb.from('notas').update(cambio).eq('id', id)))) { Object.assign(n, antes); render(); }
}
let arrastrando = null;
document.addEventListener('dragstart', (ev) => {
  const c = ev.target.closest && ev.target.closest('[draggable="true"][data-nota]'); if (!c) return;
  arrastrando = c.dataset.nota; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', arrastrando);
  setTimeout(() => c.classList.add('arrastrando'), 0);
});
document.addEventListener('dragend', () => { arrastrando = null; document.querySelectorAll('.arrastrando, .sobre').forEach(e => e.classList.remove('arrastrando', 'sobre')); });
const destino = (ev) => ev.target.closest && ev.target.closest('[data-soltar-etapa], [data-soltar-fecha]');
document.addEventListener('dragover', (ev) => { const d = arrastrando && destino(ev); if (!d) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; });
document.addEventListener('dragenter', (ev) => { const d = arrastrando && destino(ev); if (d) d.classList.add('sobre'); });
document.addEventListener('dragleave', (ev) => { const d = destino(ev); if (d && !d.contains(ev.relatedTarget)) d.classList.remove('sobre'); });
document.addEventListener('drop', (ev) => {
  const d = arrastrando && destino(ev); if (!d) return;
  ev.preventDefault();
  const id = arrastrando; arrastrando = null;
  if (d.dataset.soltarEtapa !== undefined) moverNota(id, { etapa: Number(d.dataset.soltarEtapa) });
  else moverNota(id, { emision: d.dataset.soltarFecha || null });
});

function abrirNota(id) {
  const n = id ? S.notas.find(x => x.id === id) : null;
  const resp = [...new Set([...responsables(), n?.responsable].filter(Boolean))];
  const f = $('#f-nota');
  f.innerHTML = `
    <h3>${n ? 'Editar nota' : 'Nueva nota'}</h3>
    <label class="f"><span>Título de la nota</span><input id="n-titulo" required value="${esc(n?.titulo)}" placeholder="Ej: ADES · Aniversario 75 años"></label>
    <div class="campos">
      <label class="f"><span>Protagonista / entrevistado</span><input id="n-protagonista" value="${esc(n?.protagonista)}"></label>
      <label class="f"><span>Pilar</span><select id="n-pilar"><option value="">—</option>${PILARES.map(p => `<option ${p === n?.pilar ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    </div>
    <div class="f"><span>Etapa</span><div class="opciones">${ETAPAS_NOTA.map((e, i) => `<button type="button" class="op" data-etapa-nota="${i}" aria-pressed="${(n?.etapa ?? 0) === i}">${e}</button>`).join('')}</div></div>
    <div class="campos">
      <label class="f"><span>Domingo de emisión</span><input id="n-emision" type="date" value="${esc(n?.emision)}"></label>
      <label class="f"><span>Responsable</span><select id="n-responsable"><option value="">—</option>${resp.map(r => `<option ${r === (n?.responsable ?? S.yo.nombre) ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <label class="f"><span>Duración del informe</span><input id="n-duracion" value="${esc(n?.duracion)}" placeholder="Ej: 1:30"></label>
      <label class="f"><span>Carpeta</span><input id="n-carpeta" value="${esc(n?.carpeta)}" placeholder="Redes\\..."></label>
    </div>
    <div class="f"><span>Publicado</span><div class="checks">
      <label><input type="checkbox" id="n-tv" ${n?.tv ? 'checked' : ''}> TV</label>
      <label><input type="checkbox" id="n-ig" ${n?.ig ? 'checked' : ''}> Recap en IG</label>
      <label><input type="checkbox" id="n-yt" ${n?.yt ? 'checked' : ''}> YouTube</label></div></div>
    <label class="f"><span>Pendientes (uno por línea)</span><textarea id="n-pendientes">${esc(n?.pendientes)}</textarea></label>
    <div class="acciones" style="justify-content:space-between">
      <span id="n-borrar-zona">${n ? '<button type="button" class="btn danger" id="n-borrar">Borrar</button>' : ''}</span>
      <span class="acciones"><button type="button" class="btn quiet" id="n-cancelar">Cancelar</button><button type="submit" class="btn">Guardar</button></span>
    </div>`;
  f.dataset.id = n ? n.id : '';
  f.dataset.etapa = String(n?.etapa ?? 0);
  $('#d-nota').showModal();
}

$('#f-nota').addEventListener('click', async (ev) => {
  const t = ev.target.closest('button'); if (!t) return;
  const f = $('#f-nota');
  if (t.dataset.etapaNota) { f.dataset.etapa = t.dataset.etapaNota; f.querySelectorAll('[data-etapa-nota]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); }
  if (t.id === 'n-cancelar') $('#d-nota').close();
  if (t.id === 'n-borrar') { $('#n-borrar-zona').innerHTML = '<span class="acciones"><span class="nota">¿Borrar esta nota?</span><button type="button" class="btn danger" id="n-si">Sí, borrar</button><button type="button" class="btn quiet" id="n-no">No</button></span>'; }
  if (t.id === 'n-no') $('#n-borrar-zona').innerHTML = '<button type="button" class="btn danger" id="n-borrar">Borrar</button>';
  if (t.id === 'n-si') { if (await escribir(sb.from('notas').delete().eq('id', f.dataset.id), 'Nota borrada.')) $('#d-nota').close(); }
});
$('#f-nota').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = $('#f-nota');
  const body = {
    titulo: $('#n-titulo').value.trim(), protagonista: $('#n-protagonista').value.trim(), pilar: $('#n-pilar').value,
    etapa: Number(f.dataset.etapa || 0), emision: $('#n-emision').value || null, responsable: $('#n-responsable').value,
    duracion: $('#n-duracion').value.trim(), carpeta: $('#n-carpeta').value.trim(),
    tv: $('#n-tv').checked, ig: $('#n-ig').checked, yt: $('#n-yt').checked, pendientes: $('#n-pendientes').value.trim(),
  };
  if (!body.titulo) { toast('Poné un título.'); return; }
  const q = f.dataset.id ? sb.from('notas').update(body).eq('id', f.dataset.id) : sb.from('notas').insert(body);
  if (await escribir(q, f.dataset.id ? 'Nota guardada.' : 'Nota creada.')) { $('#d-nota').close(); await cargar('notas'); render(); }
});

/* ================= SPONSORS ================= */
function banderas(e) {
  const f = [];
  if (e.nivel === 'pez_gordo') f.push('<span class="chip ok">🐋 Pez gordo</span>');
  if (e.acuerdo === 'canje') f.push('<span class="chip line">Canje</span>');
  if (e.acuerdo === 'mixto') f.push('<span class="chip line">Mixto</span>');
  if (!contactosDe(e.id).some(c => c.email && !c.baja)) f.push('<span class="chip warn">Sin mail</span>');
  if (e.conflicto) f.push('<span class="chip alert">Conflicto</span>');
  if (e.verificar) f.push('<span class="chip warn">Verificar</span>');
  if (e.proxima_fecha) { const venc = e.proxima_fecha < hoyIso(); f.push(`<span class="chip ${venc ? 'alert' : 'line'}">${venc ? 'Vencido · ' : ''}${esc(fechaCorta(e.proxima_fecha))}</span>`); }
  return f.join('');
}

function renderSponsors() {
  const v = $('#v-sponsors');
  const pend = S.envios.filter(e => e.estado === 'borrador').length;
  v.innerHTML = `
    <div class="tira">${ETAPAS_EMP.map(e => `<button data-etapa-emp="${e.id}" aria-pressed="${S.etapa === e.id}" title="${esc(e.hint)}"><span class="n">${S.empresas.filter(x => x.etapa === e.id).length}</span><span class="l">${esc(e.label)}</span></button>`).join('')}</div>
    <div class="barra"><div class="sub" role="tablist">
      <button data-subsp="embudo" aria-selected="${S.subSp === 'embudo'}">Embudo</button>
      <button data-subsp="empresas" aria-selected="${S.subSp === 'empresas'}">Empresas</button>
      <button data-subsp="mails" aria-selected="${S.subSp === 'mails'}">Mails${pend ? `<span class="badge">${pend}</span>` : ''}</button>
      <button data-subsp="formatos" aria-selected="${S.subSp === 'formatos'}">Formatos</button></div>
      <button class="btn" data-nueva-empresa>+ Empresa</button></div>
    <div id="sp-cuerpo"></div>`;
  const c = $('#sp-cuerpo');
  if (S.subSp === 'embudo') c.innerHTML = htmlEmbudo();
  if (S.subSp === 'empresas') { c.innerHTML = htmlEmpresas(); }
  if (S.subSp === 'mails') c.innerHTML = htmlMails();
  if (S.subSp === 'formatos') c.innerHTML = htmlFormatos();
}

function htmlEmbudo() {
  if (!S.empresas.length) return '<div class="vacio">Todavía no hay empresas. Sumá la primera con "+ Empresa".</div>';
  const etapas = S.etapa ? ETAPAS_EMP.filter(e => e.id === S.etapa) : ETAPAS_EMP;
  return `<div class="tablero">${etapas.map(et => {
    const items = S.empresas.filter(e => e.etapa === et.id && (!S.nivel || e.nivel === S.nivel) && (!S.acuerdo || e.acuerdo === S.acuerdo)).sort(ordenLead);
    return `<div class="col ${et.id === 'sponsor' ? 'fin' : ''}"><h3><span>${esc(et.label)}</span><span>${items.length}</span></h3><p class="hint">${esc(et.hint)}</p><div class="cards">${
      items.length ? items.map(e => `<button class="card" data-empresa="${esc(e.id)}">
        <span class="tt"><span>${esc(e.nombre)}</span><span style="display:flex;gap:6px;align-items:center">${e.puntaje ? `<span class="nota num">${e.puntaje}/10</span>` : ''}<span class="prio ${esc(e.prioridad)}">${esc(e.prioridad)}</span></span></span>
        <span class="meta">${esc(e.rubro)}${e.responsable ? ' · ' + esc(e.responsable) : ''}</span>
        ${e.proximo_paso ? `<span class="meta">→ ${esc(e.proximo_paso)}</span>` : ''}
        <span class="flags">${banderas(e)}</span></button>`).join('') : '<div class="vacio">Nada en esta etapa.</div>'}</div></div>`;
  }).join('')}</div>`;
}

function htmlEmpresas() {
  const rubros = [...new Set(S.empresas.map(e => e.rubro).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const q = S.q.toLowerCase();
  const filas = S.empresas.filter(e => (!S.etapa || e.etapa === S.etapa) && (!S.rubro || e.rubro === S.rubro) && (!S.tipo || e.tipo === S.tipo)
    && (!S.nivel || e.nivel === S.nivel) && (!S.acuerdo || e.acuerdo === S.acuerdo)
    && (!q || [e.nombre, e.rubro, e.zona, e.encaje, e.notas].join(' ').toLowerCase().includes(q)))
    .sort(ordenLead);
  return `<div class="herr" style="margin-bottom:12px">
      <input type="search" id="f-q" placeholder="Buscar empresa, rubro o nota" value="${esc(S.q)}" aria-label="Buscar">
      <select id="f-rubro" aria-label="Rubro"><option value="">Todos los rubros</option>${rubros.map(r => `<option ${r === S.rubro ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
      <select id="f-nivel" aria-label="Nivel"><option value="">Todos los niveles</option>${Object.entries(NIVELES).map(([k, v]) => `<option value="${k}" ${S.nivel === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select id="f-acuerdo" aria-label="Acuerdo"><option value="">Pago, canje o mixto</option>${Object.entries(ACUERDOS).map(([k, v]) => `<option value="${k}" ${S.acuerdo === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select id="f-tipo" aria-label="Tipo"><option value="">Sponsors y prospectos</option><option value="sponsor" ${S.tipo === 'sponsor' ? 'selected' : ''}>Solo sponsors</option><option value="prospecto" ${S.tipo === 'prospecto' ? 'selected' : ''}>Solo prospectos</option></select>
      <span class="nota">${filas.length} de ${S.empresas.length}</span></div>
    <div class="tabla"><table><thead><tr><th></th><th>Puntaje</th><th>Empresa</th><th>Rubro</th><th>Nivel</th><th>Acuerdo</th><th>Etapa</th><th>Contacto</th><th>Por qué encaja</th></tr></thead>
    <tbody>${filas.map(e => {
      const c = contactosDe(e.id).find(c => c.email && !c.baja);
      return `<tr data-empresa="${esc(e.id)}"><td><span class="prio ${esc(e.prioridad)}">${esc(e.prioridad)}</span></td><td class="num"><b>${e.puntaje ?? '—'}</b></td>
        <td><b>${esc(e.nombre)}</b>${e.conflicto ? ' <span class="chip alert">Conflicto</span>' : ''}${e.zona ? `<div class="nota">${esc(e.zona)}</div>` : ''}</td><td>${esc(e.rubro)}</td>
        <td>${e.nivel === 'pez_gordo' ? '🐋 ' : ''}${esc(NIVELES[e.nivel] || '')}</td><td>${esc(ACUERDOS[e.acuerdo] || '')}</td>
        <td>${esc((ETAPAS_EMP.find(x => x.id === e.etapa) || {}).label || e.etapa)}</td>
        <td>${c ? esc(c.nombre || c.email) : (e.contacto_publico ? `<span class="nota">${esc(e.contacto_publico)}</span>` : '<span class="chip warn">Sin mail</span>')}</td>
        <td><div class="enc">${esc(e.encaje)}</div></td></tr>`;
    }).join('') || '<tr><td colspan="9" class="nota">Ninguna empresa coincide con el filtro.</td></tr>'}</tbody></table></div>`;
}

function tarjetaMail(m, pendiente) {
  const e = empresa(m.empresa_id) || {}, c = S.contactos.find(x => x.id === m.contacto_id) || {};
  return `<div class="item">
    <div class="row"><span><b>${esc(e.nombre || '—')}</b> · <span class="nota">${esc(c.nombre)} ${c.email ? '&lt;' + esc(c.email) + '&gt;' : ''}</span></span>
      <span class="chip ${m.estado === 'respondido' ? 'ok' : m.estado === 'rebotado' ? 'alert' : ''}">${esc(ESTADOS_MAIL[m.estado] || m.estado)} · ${esc(fechaCorta(m.enviado || m.creado))}</span></div>
    <div><span class="chip line">${esc(PASOS[m.paso] || 'Mail')}</span> <b>${esc(m.asunto)}</b></div>
    ${pendiente ? `<pre>${esc(m.cuerpo)}</pre><div class="acciones"><a class="btn" href="${GMAIL_BORRADORES}" target="_blank" rel="noopener">Abrir en Gmail</a><button class="btn quiet" data-descartar="${esc(m.id)}">Descartar</button></div>` : ''}
    ${m.respuesta ? `<div class="nota"><b>${esc(m.respuesta.de)}</b> · ${esc(fechaCorta(m.respuesta.fecha))}: ${esc(m.respuesta.extracto)}</div>` : ''}
    ${!pendiente && m.notas ? `<div class="nota">${esc(m.notas)}</div>` : ''}</div>`;
}

function htmlMails() {
  const pend = S.envios.filter(e => e.estado === 'borrador').sort((a, b) => (a.creado || '').localeCompare(b.creado || ''));
  const hist = S.envios.filter(e => e.estado !== 'borrador').sort((a, b) => (b.enviado || b.creado || '').localeCompare(a.enviado || a.creado || ''));
  const cfg = flujo();
  const tpls = [...S.plantillas].sort((a, b) => a.orden - b.orden);
  return `
    <div class="seccion"><h2>Para revisar y enviar</h2>
      <p class="lead">Claude deja estos mails como borradores en el Gmail de Aire de Mar. Revisalos ahí y tocá <b>Enviar</b>: eso es la aprobación. Si uno no va, descartalo acá y el flujo lo borra de Gmail.</p>
      <div class="lista">${pend.length ? pend.map(m => tarjetaMail(m, true)).join('') : '<div class="vacio">No hay borradores esperando. Cuando una empresa pase a <b>Contacto listo</b>, en la próxima corrida del flujo su primer mail aparece acá y en Gmail.</div>'}</div></div>
    <div class="seccion"><h2>Historial</h2><div class="lista">${hist.length ? hist.map(m => tarjetaMail(m, false)).join('') : '<div class="vacio">Todavía no salió ningún mail.</div>'}</div></div>
    <div class="seccion"><h2>Reglas del flujo</h2>
      ${cfg.reglas ? `<p class="lead">Sale desde <b>${esc(cfg.remitente)}</b> · hasta ${esc(cfg.limiteDiario)} primeros contactos por corrida · seguimiento cada ${esc(cfg.diasSeguimiento)} días hábiles</p><ul class="reglas">${cfg.reglas.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '<div class="vacio">Sin reglas cargadas.</div>'}</div>
    <div class="seccion"><h2>Plantillas</h2>
      <p class="lead">Variables: {{nombre}}, {{empresa}}, {{encaje}}, {{formato}}, {{firma}}. Los próximos borradores salen con la versión que guardes acá.</p>
      <div class="grid2">${tpls.map(t => `<div class="item">
        <div class="row"><b>${esc(t.nombre)}</b><span class="chip">${esc(t.cuando)}</span></div>
        <label class="f"><span>Asunto</span><input id="tpl-a-${esc(t.id)}" value="${esc(t.asunto)}"></label>
        <label class="f"><span>Cuerpo</span><textarea id="tpl-c-${esc(t.id)}" style="min-height:220px">${esc(t.cuerpo)}</textarea></label>
        <div class="acciones"><button class="btn ghost" data-guardar-tpl="${esc(t.id)}">Guardar plantilla</button></div></div>`).join('')}</div></div>`;
}

function htmlFormatos() {
  const packs = [...S.paquetes].sort((a, b) => a.orden - b.orden);
  return `<div class="seccion"><h2>Formatos que vendemos</h2>
    <p class="lead">El inventario real del programa, sacado de las placas y spots que ya salieron al aire. "Hoy" muestra qué sponsors lo ocupan.</p>
    <div class="grid2">${packs.map(p => {
      const quienes = S.empresas.filter(e => e.etapa === 'sponsor' && (e.formatos || []).includes(p.id)).map(e => e.nombre);
      return `<div class="item"><h3 style="color:var(--teal)">${esc(p.nombre)}</h3><div>${esc(p.descripcion)}</div>
        <div class="nota">${esc(p.pantallas)}${p.cupo ? ' · Cupo: ' + esc(p.cupo) : ''}</div>
        <div class="nota">Hoy: ${quienes.length ? esc(quienes.join(', ')) : 'libre'}</div>
        <label class="f"><span>Precio de lista</span><input id="precio-${esc(p.id)}" value="${esc(p.precio)}" placeholder="A definir"></label>
        <div class="acciones"><button class="btn ghost" data-guardar-precio="${esc(p.id)}">Guardar precio</button></div></div>`;
    }).join('')}</div></div>`;
}

/* ---- ficha de empresa ---- */
function abrirFicha(id) {
  const e = empresa(id); if (!e) return;
  S.abierta = id; S.borrador = JSON.parse(JSON.stringify(e));
  $('#velo').hidden = false; $('#ficha').hidden = false;
  renderFicha(true);
}
function cerrarFicha() { S.abierta = null; S.borrador = null; $('#velo').hidden = true; $('#ficha').hidden = true; }

function renderFicha(primera) {
  const e = empresa(S.abierta); if (!e) { cerrarFicha(); return; }
  const p = $('#ficha');
  if (!primera && document.activeElement && p.contains(document.activeElement) && (document.activeElement.id || '').startsWith('d-')) return;
  const d = S.borrador, cs = contactosDe(e.id), ms = enviosDe(e.id);
  const inp = (k, label, type = 'text', full) => `<label class="f ${full ? 'full' : ''}"><span>${label}</span><input id="d-${k}" data-k="${k}" type="${type}" value="${esc(d[k] ?? '')}"></label>`;
  const area = (k, label) => `<label class="f full"><span>${label}</span><textarea id="d-${k}" data-k="${k}">${esc(d[k] ?? '')}</textarea></label>`;
  const sel = (k, label, ops) => `<label class="f"><span>${label}</span><select id="d-${k}" data-k="${k}">${ops.map(([v, t]) => `<option value="${esc(v)}" ${d[k] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  p.innerHTML = `
    <header><div><div class="eyebrow">${e.tipo === 'sponsor' ? 'Sponsor' : 'Prospecto'} · ${esc(e.rubro)}</div><h2>${esc(e.nombre)}</h2></div><button class="cerrar" id="cerrar-ficha" aria-label="Cerrar">×</button></header>
    <div class="campos">
      ${inp('nombre', 'Nombre', 'text', true)}
      ${sel('etapa', 'Etapa', ETAPAS_EMP.map(x => [x.id, x.label]))}
      ${sel('prioridad', 'Prioridad', [['A', 'A · ir ya'], ['B', 'B · esta temporada'], ['C', 'C · más adelante']])}
      ${sel('responsable', 'Responsable', [['', '—'], ...responsables().map(r => [r, r])])}
      ${sel('tipo', 'Tipo', [['prospecto', 'Prospecto'], ['sponsor', 'Sponsor']])}
      ${sel('nivel', 'Nivel', Object.entries(NIVELES))}
      ${sel('acuerdo', 'Acuerdo', Object.entries(ACUERDOS))}
      ${inp('puntaje', 'Puntaje (1 a 10)', 'number')}
      ${inp('proximo_paso', 'Próximo paso', 'text', true)}
      ${inp('proxima_fecha', 'Fecha', 'date')}
      ${inp('valor', 'Valor estimado (USD/mes)')}
      ${area('encaje', 'Por qué encaja con Aire de Mar')}
      <div class="f full"><span>Formatos que le proponemos</span><div class="opciones">${[...S.paquetes].sort((a, b) => a.orden - b.orden).map(pk =>
        `<button type="button" class="op" data-formato="${esc(pk.id)}" aria-pressed="${(d.formatos || []).includes(pk.id)}">${esc(pk.nombre)}</button>`).join('')}</div></div>
      ${inp('conflicto', 'Conflicto de rubro (vacío si no hay)', 'text', true)}
      ${inp('rubro', 'Rubro')}${inp('zona', 'Zona')}${inp('web', 'Web')}${inp('instagram', 'Instagram')}
      ${inp('contacto_publico', 'Contacto público (web, IG o teléfono del negocio)', 'text', true)}
      ${inp('fuente', 'Fuente del dato', 'text', true)}${/^https?:/.test(d.fuente || '') ? `<a class="nota full" href="${esc(d.fuente)}" target="_blank" rel="noopener">Abrir la fuente</a>` : ''}
      ${area('notas', 'Notas')}
      <label class="f full" style="flex-direction:row;display:flex;gap:8px;align-items:center"><input type="checkbox" id="d-verificar" ${d.verificar ? 'checked' : ''}><span style="font-size:14px;color:var(--ink)">Datos a verificar</span></label>
    </div>
    <div class="guardar"><button class="btn" id="guardar-empresa">Guardar cambios</button><span class="nota" id="msg-empresa"></span></div>
    <div class="bloque"><h3>Contactos</h3>
      <div class="lista">${cs.length ? cs.map(c => `<div class="contacto"><div class="who"><b>${esc(c.nombre || 'Sin nombre')}</b>${c.cargo ? ' · ' + esc(c.cargo) : ''}
        <small>${esc(c.email || 'sin mail')}${c.telefono ? ' · ' + esc(c.telefono) : ''}${c.origen ? ' · ' + esc(c.origen) : ''}</small>
        ${c.baja ? '<span class="chip alert">Pidió no recibir mails</span>' : ''}</div>
        <div class="acciones"><button class="btn quiet small" data-baja="${esc(c.id)}">${c.baja ? 'Reactivar' : 'Dar de baja'}</button><button class="btn danger small" data-borrar-contacto="${esc(c.id)}">Borrar</button></div></div>`).join('')
        : '<div class="vacio">Sin contactos. Sin un mail, esta empresa no puede entrar a la secuencia.</div>'}</div>
      <form class="campos" id="f-contacto" style="margin-top:8px">
        <label class="f"><span>Nombre</span><input id="c-nombre"></label><label class="f"><span>Cargo</span><input id="c-cargo" placeholder="Ej: Marketing"></label>
        <label class="f"><span>Mail</span><input id="c-email" type="email"></label><label class="f"><span>Teléfono</span><input id="c-tel"></label>
        <label class="f full"><span>¿De dónde salió?</span><input id="c-origen" placeholder="Ej: web oficial, conocido de Floppy"></label>
        <div class="full acciones"><button class="btn ghost" type="submit">Agregar contacto</button><span class="nota" id="msg-contacto"></span></div>
      </form></div>
    <div class="bloque"><h3>Mails</h3><div class="lista">${ms.length ? ms.map(m => `<div class="item"><div class="row"><b>${esc(m.asunto)}</b><span class="chip">${esc(ESTADOS_MAIL[m.estado] || m.estado)} · ${esc(fechaCorta(m.enviado || m.creado))}</span></div>${m.notas ? `<div class="nota">${esc(m.notas)}</div>` : ''}</div>`).join('') : '<div class="vacio">Sin mails todavía.</div>'}</div></div>
    ${e.carpeta ? `<p class="nota" style="margin-top:18px">Material de la marca en Drive: ${esc(e.carpeta)}</p>` : ''}
    <p class="nota">Último cambio: ${e.actualizado ? new Date(e.actualizado).toLocaleString('es-UY') : '—'}${e.actualizado_por ? ' · ' + esc(nombreDe(e.actualizado_por)) : ''}</p>`;
}
function nombreDe(email) { const m = S.equipo.find(x => x.email === email); return m ? m.nombre : email; }

async function guardarEmpresa() {
  const e = empresa(S.abierta), d = S.borrador, ch = {};
  for (const k of ['nombre', 'etapa', 'prioridad', 'responsable', 'tipo', 'nivel', 'acuerdo', 'proximo_paso', 'proxima_fecha', 'valor', 'encaje', 'conflicto', 'web', 'instagram', 'rubro', 'zona', 'notas', 'contacto_publico', 'fuente'])
    if ((d[k] ?? '') !== (e[k] ?? '')) ch[k] = k === 'proxima_fecha' ? (d[k] || null) : (d[k] ?? '');
  if (String(d.puntaje ?? '') !== String(e.puntaje ?? '')) {
    const n = d.puntaje === '' || d.puntaje == null ? null : Math.round(Number(d.puntaje));
    if (n !== null && (isNaN(n) || n < 1 || n > 10)) { $('#msg-empresa').textContent = 'El puntaje va de 1 a 10.'; return; }
    ch.puntaje = n;
  }
  d.verificar = $('#d-verificar').checked;
  if (d.verificar !== e.verificar) ch.verificar = d.verificar;
  if (JSON.stringify(d.formatos || []) !== JSON.stringify(e.formatos || [])) ch.formatos = d.formatos || [];
  if (!Object.keys(ch).length) { $('#msg-empresa').textContent = 'No hay cambios.'; return; }
  if (ch.nombre === '') { $('#msg-empresa').textContent = 'La empresa necesita un nombre.'; return; }
  if (await escribir(sb.from('empresas').update(ch).eq('id', e.id), 'Guardado.')) { await cargar('empresas'); S.borrador = JSON.parse(JSON.stringify(empresa(e.id))); render(); }
}

async function nuevaEmpresa() {
  const { data, error } = await sb.from('empresas').insert({ nombre: 'Empresa nueva', proximo_paso: 'Conseguir contacto' }).select().single();
  if (error) { toast('No se pudo crear: ' + error.message); return; }
  await cargar('empresas'); S.tab = 'sponsors'; render(); abrirFicha(data.id);
  setTimeout(() => { const n = $('#d-nombre'); if (n) { n.focus(); n.select(); } }, 60);
}

/* ================= MÉTRICAS ================= */
function renderMetricas() {
  const v = $('#v-metricas');
  const ig = metrica('instagram'), yt = metrica('youtube');
  if (!ig) { v.innerHTML = '<div class="vacio">Todavía no hay métricas cargadas. Pedile a Claude que las actualice.</div>'; return; }
  const tramos = ig.tramos || [];
  const bruto = Math.max(...tramos.map(t => t.reproducciones), 1);
  const paso = bruto > 100000 ? 50000 : bruto > 20000 ? 10000 : 1000;
  const max = Math.ceil(bruto / paso) * paso;
  const W = 640, H = 220, pad = { l: 44, r: 8, t: 12, b: 30 }, bw = (W - pad.l - pad.r) / Math.max(tramos.length, 1);
  const escala = (x) => pad.t + (H - pad.t - pad.b) * (1 - x / max);
  const ticks = [0, max / 2, max];
  const svg = `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reproducciones por período de 30 días">
    ${ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${escala(t)}" y2="${escala(t)}" stroke="var(--line)" stroke-width="1"/><text x="${pad.l - 6}" y="${escala(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${t >= 1000 ? Math.round(t / 1000) + 'k' : t}</text>`).join('')}
    ${tramos.map((t, i) => { const x = pad.l + i * bw + 3, y = escala(t.reproducciones), d = parse(t.desde); const ult = i === tramos.length - 1;
      return `<rect x="${x}" y="${y}" width="${bw - 6}" height="${H - pad.b - y}" rx="3" fill="${ult ? 'var(--teal)' : 'var(--sea)'}"><title>${MESES[d.getMonth()]} ${d.getFullYear()}: ${nf(t.reproducciones)} reproducciones · ${nf(t.alcance)} cuentas</title></rect>
      <text x="${x + (bw - 6) / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--muted)">${MESES[d.getMonth()]}</text>`; }).join('')}
  </svg>`;
  const barras = (items, k, lab, fmt) => { const m = Math.max(...items.map(x => x[k]), 1);
    return `<div class="barras">${items.map(x => `<div class="fila"><span>${esc(x[lab])}</span><div class="track"><div class="fill ${x[k] === m ? 'hi' : ''}" style="width:${(100 * x[k] / m).toFixed(1)}%"></div></div><span class="v">${fmt(x[k])}</span></div>`).join('')}</div>`; };
  v.innerHTML = `
    <p class="nota" style="margin:0 0 12px">Instagram ${esc(ig.cuenta)} · datos al ${esc(fechaCorta(ig.fecha))} ${esc((ig.fecha || '').slice(0, 4))}</p>
    <div class="kpis">
      <div class="kpi"><div class="n">${nf(ig.seguidores)}</div><div class="l">seguidores</div></div>
      <div class="kpi"><div class="n">${nf(ig.ultimos30.alcance)}</div><div class="l">cuentas alcanzadas (30 días)</div></div>
      <div class="kpi"><div class="n">${nf(ig.ultimos30.reproducciones)}</div><div class="l">reproducciones (30 días)</div></div>
      <div class="kpi"><div class="n">${nf(ig.doceMeses.reproducciones)}</div><div class="l">reproducciones (12 meses)</div></div>
    </div>
    <div class="paneles">
      <div class="panel" style="grid-column:1/-1"><h4>Reproducciones por período de 30 días</h4>${svg}</div>
      <div class="panel"><h4>Reproducciones por publicación (mediana)</h4>${barras(ig.medianaPorPost, 'reproducciones', 'anio', nf)}</div>
      <div class="panel"><h4>Edad de los seguidores</h4>${barras(ig.edades, 'pct', 'rango', x => x.toFixed(0) + '%')}</div>
      <div class="panel"><h4>Ciudades</h4>${barras(ig.ciudades, 'pct', 'ciudad', x => x.toFixed(1).replace('.', ',') + '%')}</div>
      <div class="panel"><h4>YouTube</h4>${yt ? `<div class="kpis" style="margin:0"><div><div class="n num" style="font-family:var(--display);font-size:26px;color:var(--teal)">${nf(yt.suscriptores)}</div><div class="nota">suscriptores</div></div><div><div class="n num" style="font-family:var(--display);font-size:26px;color:var(--teal)">${nf(yt.programas)}</div><div class="nota">programas publicados</div></div><div><div class="n num" style="font-family:var(--display);font-size:26px;color:var(--teal)">${nf(yt.reproduccionesTotales)}</div><div class="nota">reproducciones totales</div></div></div>` : '<div class="nota">Sin datos.</div>'}</div>
    </div>
    <div class="panel"><h4>Publicaciones que más funcionaron</h4><div class="tabla" style="border:0"><table><thead><tr><th>Fecha</th><th>Publicación</th><th>Reproducciones</th><th>Cuentas</th><th>Compartidos</th></tr></thead><tbody>
      ${(ig.top || []).map(t => `<tr><td class="num">${esc(fechaCorta(t.fecha))}</td><td>${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">${esc(t.titulo)}</a>` : esc(t.titulo)}</td><td class="num">${nf(t.reproducciones)}</td><td class="num">${nf(t.alcance)}</td><td class="num">${nf(t.compartidos)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

/* ================= EQUIPO ================= */
async function llamarEquipo(body) {
  const { data, error } = await sb.functions.invoke('equipo-admin', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j.error) msg = j.error; } catch (_) {}
    return { error: msg };
  }
  return data;
}

const OJO = '<button type="button" class="ojo" data-ojo aria-label="Mostrar contraseña" aria-pressed="false" title="Mostrar contraseña"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="ojo-abierto" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle class="ojo-abierto" cx="12" cy="12" r="3"/><path class="ojo-tachado" d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 5.1A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22"/></svg></button>';

async function guardarContrasena(btn) {
  const u = btn.dataset.pass || btn.dataset.activar;
  const inp = btn.closest('.acciones').querySelector('input[data-fpass]');
  if (inp.value.length < 8) { toast('La contraseña tiene que tener al menos 8 caracteres.'); inp.focus(); return; }
  const fila = S.equipo.find(m => m.usuario === u) || {};
  const r = await llamarEquipo(btn.dataset.pass
    ? { accion: 'contrasena', usuario: u, contrasena: inp.value }
    : { accion: 'crear', usuario: u, nombre: fila.nombre, rol: fila.rol, contrasena: inp.value });
  if (r.error) { toast(r.error); return; }
  toast('Listo: ' + u + ' ya puede entrar con esa contraseña.'); S.conCuenta = null; render();
}

function renderEquipo() {
  const v = $('#v-equipo');
  if (!esAdmin()) { v.innerHTML = '<div class="vacio">Esta sección es solo para administradores.</div>'; return; }
  if (S.conCuenta === null) { S.conCuenta = []; llamarEquipo({ accion: 'estado' }).then(r => { S.conCuenta = r.conCuenta || []; S.claves = r.claves || {}; if (S.tab === 'equipo') renderEquipo(); }); }
  const miembros = [...S.equipo].sort((a, b) => a.usuario.localeCompare(b.usuario));
  v.innerHTML = `
    <div class="seccion"><h2>Equipo</h2><p class="lead">Cada persona entra con su usuario y contraseña. Desde acá creás usuarios, les cambiás la contraseña si se la olvidan o les sacás el acceso.</p>
      <div class="tabla"><table><thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Contraseña</th><th></th></tr></thead><tbody>
      ${miembros.map(m => { const tiene = (S.conCuenta || []).includes(m.usuario);
        return `<tr><td><b>${esc(m.usuario)}</b></td><td>${esc(m.nombre)}</td><td>${m.rol === 'admin' ? 'Administrador' : 'Editor'}</td>
        <td>${tiene ? '<span class="chip ok">Puede entrar</span>' : '<span class="chip warn">Sin contraseña</span>'}</td>
        <td><span class="pass-wrap fila-pass"><input type="password" data-fpass="${esc(m.usuario)}" value="${esc((S.claves || {})[m.usuario] || '')}" placeholder="${tiene ? 'No registrada: escribí una' : 'Elegí una (mín. 8)'}" autocomplete="new-password" minlength="8" aria-label="Contraseña de ${esc(m.usuario)}">${OJO}</span></td>
        <td><div class="acciones">${tiene ? `<button class="btn quiet small" data-pass="${esc(m.usuario)}">Cambiar contraseña</button>` : `<button class="btn small" data-activar="${esc(m.usuario)}">Crear contraseña</button>`}
        ${m.email !== S.yo.email ? `<button class="btn danger small" data-quitar="${esc(m.usuario)}">Quitar</button>` : ''}</div></td></tr>`; }).join('')}
      </tbody></table></div></div>
    <div class="seccion"><h2>Sumar a alguien</h2>
      <form class="campos" id="f-miembro" style="max-width:640px">
        <label class="f"><span>Usuario (minúsculas, sin espacios)</span><input id="m-usuario" autocapitalize="none" spellcheck="false" required pattern="[a-z0-9._\\-]{2,30}"></label>
        <label class="f"><span>Nombre</span><input id="m-nombre" required></label>
        <label class="f"><span>Contraseña inicial (mínimo 8)</span><span class="pass-wrap"><input id="m-pass" type="password" autocomplete="new-password" minlength="8" required>${OJO}</span></label>
        <label class="f"><span>Rol</span><select id="m-rol"><option value="editor">Editor</option><option value="admin">Administrador</option></select></label>
        <div class="full acciones"><button class="btn" type="submit">Crear usuario</button><span class="nota" id="msg-miembro"></span></div>
      </form></div>`;
}

/* ---------- eventos ---------- */
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button, tr[data-empresa], [data-nota]');
  if (!t || t.closest('#f-nota') || t.closest('#f-login') || t.closest('#f-cuenta')) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; render(); return; }
  if (t.dataset.subsp) { S.subSp = t.dataset.subsp; render(); return; }
  if (t.dataset.nota) { abrirNota(t.dataset.nota); return; }
  if (t.dataset.calvista) { S.calVista = t.dataset.calvista; try { localStorage.setItem('calVista', S.calVista); } catch (_) {} render(); return; }
  if (t.dataset.calmes) { S.calMes = t.dataset.calmes === 'hoy' ? new Date() : new Date(S.calMes.getFullYear(), S.calMes.getMonth() + Number(t.dataset.calmes), 1); render(); return; }
  if (t.hasAttribute('data-nueva-nota')) { abrirNota(null); return; }
  if (t.dataset.etapaEmp) { S.etapa = S.etapa === t.dataset.etapaEmp ? null : t.dataset.etapaEmp; render(); return; }
  if (t.dataset.empresa) { abrirFicha(t.dataset.empresa); return; }
  if (t.hasAttribute('data-nueva-empresa')) { await nuevaEmpresa(); return; }
  if (t.id === 'cerrar-ficha') { cerrarFicha(); return; }
  if (t.dataset.formato) { const f = new Set(S.borrador.formatos || []); f.has(t.dataset.formato) ? f.delete(t.dataset.formato) : f.add(t.dataset.formato); S.borrador.formatos = [...f]; t.setAttribute('aria-pressed', String(f.has(t.dataset.formato))); $('#msg-empresa').textContent = 'Cambios sin guardar'; return; }
  if (t.id === 'guardar-empresa') { await guardarEmpresa(); return; }
  if (t.dataset.baja) { const c = S.contactos.find(x => x.id === t.dataset.baja); if (await escribir(sb.from('contactos').update({ baja: !c.baja }).eq('id', c.id))) { await cargar('contactos'); render(); } return; }
  if (t.dataset.borrarContacto) { if (t.dataset.confirmar === '1') { if (await escribir(sb.from('contactos').delete().eq('id', t.dataset.borrarContacto), 'Contacto borrado.')) { await cargar('contactos'); render(); } } else { t.dataset.confirmar = '1'; t.textContent = '¿Seguro?'; } return; }
  if (t.dataset.descartar) { if (await escribir(sb.from('envios').update({ estado: 'descartado', notas: 'Descartado desde la app' }).eq('id', t.dataset.descartar), 'Descartado. El flujo lo borra de Gmail.')) { await cargar('envios'); render(); } return; }
  if (t.dataset.guardarTpl) { const id = t.dataset.guardarTpl; if (await escribir(sb.from('plantillas').update({ asunto: $('#tpl-a-' + id).value, cuerpo: $('#tpl-c-' + id).value }).eq('id', id), 'Plantilla guardada.')) await cargar('plantillas'); return; }
  if (t.dataset.guardarPrecio) { const id = t.dataset.guardarPrecio; if (await escribir(sb.from('paquetes').update({ precio: $('#precio-' + id).value.trim() }).eq('id', id), 'Precio guardado.')) await cargar('paquetes'); return; }
  if (t.dataset.pass || t.dataset.activar) { await guardarContrasena(t); return; }
  if (t.dataset.ojo !== undefined) { const i = t.parentElement.querySelector('input'), ver = i.type === 'password'; i.type = ver ? 'text' : 'password'; t.setAttribute('aria-pressed', String(ver)); const l = ver ? 'Ocultar contraseña' : 'Mostrar contraseña'; t.setAttribute('aria-label', l); t.title = l; return; }
  if (t.dataset.quitar) {
    if (t.dataset.confirmar !== '1') { t.dataset.confirmar = '1'; t.textContent = '¿Quitar acceso?'; return; }
    const r = await llamarEquipo({ accion: 'quitar', usuario: t.dataset.quitar });
    if (r.error) { toast(r.error); return; }
    toast('Acceso quitado.'); S.conCuenta = null; await cargar('equipo'); render(); return;
  }
});
$('#velo').addEventListener('click', cerrarFicha);
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && S.abierta) cerrarFicha(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.fpass) { ev.preventDefault(); ev.target.closest('.acciones').querySelector('[data-pass], [data-activar]').click(); } });
document.addEventListener('keydown', (ev) => { const c = ev.target.dataset && ev.target.getAttribute('role') === 'button' && ev.target.dataset.nota; if (c && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); abrirNota(c); } });
document.addEventListener('input', (ev) => {
  const k = ev.target.dataset && ev.target.dataset.k;
  if (k && S.borrador) { S.borrador[k] = ev.target.value; const m = $('#msg-empresa'); if (m) m.textContent = 'Cambios sin guardar'; return; }
  if (ev.target.id === 'f-q') { S.q = ev.target.value; const pos = ev.target.selectionStart; $('#sp-cuerpo').innerHTML = htmlEmpresas(); const el = $('#f-q'); el.focus(); el.setSelectionRange(pos, pos); }
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'f-resp') { S.resp = ev.target.value; render(); }
  if (ev.target.id === 'f-rubro') { S.rubro = ev.target.value; $('#sp-cuerpo').innerHTML = htmlEmpresas(); }
  if (ev.target.id === 'f-tipo') { S.tipo = ev.target.value; $('#sp-cuerpo').innerHTML = htmlEmpresas(); }
  if (ev.target.id === 'f-nivel') { S.nivel = ev.target.value; $('#sp-cuerpo').innerHTML = htmlEmpresas(); }
  if (ev.target.id === 'f-acuerdo') { S.acuerdo = ev.target.value; $('#sp-cuerpo').innerHTML = htmlEmpresas(); }
  if (ev.target.id === 'd-verificar') { const m = $('#msg-empresa'); if (m) m.textContent = 'Cambios sin guardar'; }
});
document.addEventListener('submit', async (ev) => {
  if (ev.target.id === 'f-contacto') {
    ev.preventDefault();
    const email = $('#c-email').value.trim(), nombre = $('#c-nombre').value.trim(), msg = $('#msg-contacto');
    if (!email && !nombre) { msg.textContent = 'Poné al menos un nombre o un mail.'; return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Ese mail no parece válido.'; return; }
    const ok = await escribir(sb.from('contactos').insert({ empresa_id: S.abierta, nombre, cargo: $('#c-cargo').value.trim(), email, telefono: $('#c-tel').value.trim(), origen: $('#c-origen').value.trim() }), 'Contacto agregado.');
    if (ok) {
      const e = empresa(S.abierta);
      if (email && e.etapa === 'prospecto') await escribir(sb.from('empresas').update({ etapa: 'listo' }).eq('id', e.id));
      await Promise.all([cargar('contactos'), cargar('empresas')]);
      S.borrador.etapa = empresa(S.abierta).etapa; render();
    }
  }
  if (ev.target.id === 'f-miembro') {
    ev.preventDefault();
    const msg = $('#msg-miembro'); msg.textContent = 'Creando…';
    const r = await llamarEquipo({ accion: 'crear', usuario: $('#m-usuario').value.trim().toLowerCase(), nombre: $('#m-nombre').value.trim(), contrasena: $('#m-pass').value, rol: $('#m-rol').value });
    if (r.error) { msg.textContent = r.error; return; }
    toast('Usuario creado. Ya puede entrar.'); S.conCuenta = null; await cargar('equipo'); render();
  }
}); 

iniciar();
