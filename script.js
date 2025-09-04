'use strict';
// ===== API base & helpers =====
const API_BASE = location.origin;
function getToken(){ return localStorage.getItem('token'); }
function setToken(t){ localStorage.setItem('token', t); }
function clearToken(){ localStorage.removeItem('token'); }

async function api(path, {method='GET', headers={}, body=null}={}) {
  const h = {...headers};
  const hasForm = (body instanceof FormData);
  if (!hasForm) h['Content-Type'] = h['Content-Type'] || 'application/json';
  const t = getToken(); if (t) h['Authorization'] = 'Bearer ' + t;
  const res = await fetch(API_BASE + path, {method, headers:h, body});
  if (!res.ok) throw new Error(await res.text().catch(()=>res.statusText));
  const ct = res.headers.get('content-type')||'';
  return ct.includes('application/json') ? res.json() : res.text();
}

// helper: format local ISO (no "Z") to avoid UTC shifts
function pad(n){ return String(n).padStart(2,'0'); }
function localIsoString(d){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

// login modal elements
let authDialog, authEmail, authPass, authLoginBtn, authRegisterBtn, authMsg;

function ensureAuthElements(){
  if (authDialog) return;
  authDialog = document.getElementById('auth-dialog');
  authEmail  = document.getElementById('auth-email');
  authPass   = document.getElementById('auth-pass');
  authLoginBtn    = document.getElementById('auth-login');
  authRegisterBtn = document.getElementById('auth-register');
  authMsg    = document.getElementById('auth-msg');

  if (!authDialog) return;

  authDialog.addEventListener('close', ()=>{ if(authMsg) authMsg.textContent=''; });
  authLoginBtn.addEventListener('click', async (e)=>{
    e.preventDefault();
    try{
      const data = await api('/api/auth/login', {
        method:'POST',
        body: JSON.stringify({ email: authEmail.value.trim(), senha: authPass.value })
      });
      if (data && data.token){
        setToken(data.token);
        authMsg.textContent = '';
        if (typeof authDialog.close === 'function') authDialog.close();
        await carregarDoServidor();
      } else {
        authMsg.textContent = 'Erro: resposta inválida do servidor';
      }
    }catch(err){ authMsg.textContent = 'Erro: '+err.message; }
  });

  authRegisterBtn.addEventListener('click', async ()=>{
    try{
      await api('/api/auth/register', {
        method:'POST',
        body: JSON.stringify({ nome: authEmail.value.split('@')[0]||'Usuário', email: authEmail.value.trim(), senha: authPass.value })
      });
      authMsg.textContent = 'Conta criada! Agora clique em Entrar.';
    }catch(err){ authMsg.textContent = 'Erro: '+err.message; }
  });
}

function requireLogin(){
  ensureAuthElements();
  if (!getToken()){
    if (authDialog && typeof authDialog.showModal === 'function') authDialog.showModal();
    return false;
  }
  return true;
}

document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    const sidebar = document.querySelector('.sidebar');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const navLinks = document.querySelectorAll('.nav-link');
    const views = document.querySelectorAll('.view');
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const pointListBody = document.getElementById('point-list-body');
    const addEntryBtn = document.getElementById('add-entry-btn');
    const timeInput = document.getElementById('time-input');
    const todayEntriesList = document.getElementById('today-entries-list');
    const fileInputMain = document.getElementById('file-input-main');
    const fileNameDisplay = document.getElementById('file-name-display');
    const fileInputList = document.getElementById('file-input-list');
    const summaryTrabalhadas = document.getElementById('summary-trabalhadas');
    const summaryExtras = document.getElementById('summary-extras');
    const editTimeModal = document.getElementById('edit-time-modal');
    const editModalTimeInput = document.getElementById('edit-modal-time-input');
    const editModalSaveBtn = document.getElementById('edit-modal-save-btn');
    const editModalCancelBtn = document.getElementById('edit-modal-cancel-btn');
    const confirmationModal = document.getElementById('confirmation-modal');
    const confirmationMessage = document.getElementById('confirmation-message');
    const confirmationConfirmBtn = document.getElementById('confirmation-confirm-btn');
    const confirmationCancelBtn = document.getElementById('confirmation-cancel-btn');
    const reportMonth = document.getElementById('report-month');
    const reportYear = document.getElementById('report-year');
    const reportRefresh = document.getElementById('report-refresh');

    // state
    let todayEntries = [];
    let entryIdCounter = 0;
    let editingEntryId = null;
    const JORNADA_MINUTOS = 6 * 60;
    let confirmAction = null;
    // último agrupamento renderizado (usado para resolver clicks em itens sem id direto)
    let lastByDate = {};

    // upload with unique name
    async function uploadComprovante(file){
      if (!file) return null;
      const parts = file.name.split('.');
      const ext = parts.length>1?'.'+parts.pop():'';
      const base = parts.join('.') || 'file';
      const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${base}${ext}`;
      const fileToSend = new File([file], uniqueName, { type: file.type });

      const fd = new FormData();
      fd.append('file', fileToSend);
      const out = await api('/api/files/upload', { method:'POST', body: fd });
      return out?.url || out?.publicUrl || out?.fileUrl || null;
    }

    async function salvarBatidaServidor(isoString, tipo, comprovanteUrl){
      return api('/api/batidas', {
        method:'POST',
        body: JSON.stringify({ horario: isoString, tipo, comprovante: comprovanteUrl||null })
      });
    }

    async function listarBatidasServidor(params=''){
      return api('/api/batidas' + (params? ('?'+params):''));
    }

    const applyTheme = (theme) => {
        body.className = theme;
        const icon = themeToggleBtn.querySelector('i');
        if (icon) icon.className = `fa-solid ${theme === 'dark-theme' ? 'fa-moon' : 'fa-sun'}`;
        localStorage.setItem('theme', theme);
    };

    window.addEventListener('storage', (event) => {
        if (event.key === 'theme') {
            applyTheme(event.newValue);
        }
    });

    const showConfirmationModal = (message, onConfirm) => {
        if (confirmationMessage) confirmationMessage.textContent = message;
        confirmAction = onConfirm;
        if (confirmationModal) confirmationModal.classList.add('visible');
    };
    const hideConfirmationModal = () => {
        if (confirmationModal) confirmationModal.classList.remove('visible');
        confirmAction = null;
    };

    const setDefaultTime = () => {
        const now = new Date();
        if (timeInput) timeInput.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    };

    const updateTodaySummary = () => {
        if (!summaryTrabalhadas || !summaryExtras) return;
        let totalMinutosEfetivos = 0;
        const batidas = [...todayEntries].sort((a, b) => a.time.localeCompare(b.time));
        for (let i = 0; i < batidas.length - 1; i += 2) {
            const a = batidas[i], b = batidas[i+1];
            if (a && b){
                const [ha, ma] = a.time.split(':').map(Number);
                const [hb, mb] = b.time.split(':').map(Number);
                totalMinutosEfetivos += (hb*60+mb) - (ha*60+ma);
            }
        }
        summaryTrabalhadas.textContent = `${String(Math.floor(totalMinutosEfetivos / 60)).padStart(2, '0')}h ${String(totalMinutosEfetivos % 60).padStart(2, '0')}m`;

        let totalMinutosJornadaCompleta = 0;
        if (batidas.length >= 2) {
            const [hPrimeira, mPrimeira] = batidas[0].time.split(':').map(Number);
            const [hUltima, mUltima] = batidas[batidas.length - 1].time.split(':').map(Number);
            totalMinutosJornadaCompleta = (hUltima * 60 + mUltima) - (hPrimeira * 60 + mPrimeira);
        }
        const minutosExtras = Math.max(0, totalMinutosJornadaCompleta - JORNADA_MINUTOS);
        summaryExtras.textContent = `${String(Math.floor(minutosExtras / 60)).padStart(2, '0')}h ${String(minutosExtras % 60).padStart(2, '0')}m`;
    };

    const renderTodayEntries = () => {
        if (!todayEntriesList) return;
        todayEntriesList.innerHTML = '';
        todayEntries.sort((a, b) => a.time.localeCompare(b.time));
        if (todayEntries.length === 0) {
            todayEntriesList.innerHTML = '<p style="padding: 16px; color: var(--text-secondary);">Nenhuma batida registrada hoje.</p>';
        } else {
            const labels = ['Entrada 1', 'Saída 1', 'Entrada 2', 'Saída 2'];
            todayEntries.forEach((entry, index) => {
                const entryDiv = document.createElement('div');
                entryDiv.className = 'entry-item';
                entryDiv.dataset.id = entry.id;
                const hasRemote = !!entry.comprovante_url;
                const hasLocal = !!entry.proof;
                const viewAction = hasRemote || hasLocal ? `<a class="entry-proof-link" href="#" data-action="view" title="Visualizar"><i class="fa-solid fa-eye"></i></a>` : `<i class="fa-solid fa-paperclip" data-action="attach" title="Anexar Comprovante"></i>`;
                const removeAction = (hasRemote || hasLocal) ? `<i class="fa-solid fa-xmark" data-action="remove-proof" title="Remover Comprovante"></i>` : '';
                entryDiv.innerHTML = `
                    <div class="entry-label">${labels[index] || 'Extra'}</div>
                    <div class="entry-time" data-action="time">${entry.time}</div>
                    <div class="entry-actions">
                        ${viewAction}
                        ${removeAction}
                        <i class="fa-solid fa-pencil" data-action="edit" title="Editar Horário"></i>
                        <i class="fa-solid fa-trash" data-action="delete" title="Excluir Batida"></i>
                    </div>`;
                todayEntriesList.appendChild(entryDiv);
            });
        }
        updateTodaySummary();
    };

    // helpers for report period 16->15
function buildPeriodFor(month, year){
  const from = new Date(year, month-2, 16, 0, 0, 0, 0);
  const to   = new Date(year, month-1, 15, 23, 59, 59, 999);
  return { from, to };
}

// cria select de períodos "16/MM/YYYY - 15/MM+1/YYYY" e sincroniza reportMonth/reportYear
function initPeriodSelect() {
  try {
    const container = document.createElement('div');
    container.style.display = 'inline-block';
    container.style.marginRight = '8px';
    const sel = document.createElement('select');
    sel.id = 'report-period';
    sel.style.minWidth = '220px';
    const now = new Date();
    // gerar últimos 18 períodos
    for (let i = 0; i < 18; i++) {
      const end = new Date(now.getFullYear(), now.getMonth() - i, 15);
      const start = new Date(end.getFullYear(), end.getMonth()-1, 16);
      const label = `${String(start.getDate()).padStart(2,'0')}/${String(start.getMonth()+1).padStart(2,'0')}/${start.getFullYear()} - ${String(end.getDate()).padStart(2,'0')}/${String(end.getMonth()+1).padStart(2,'0')}/${end.getFullYear()}`;
      const opt = document.createElement('option');
      opt.value = `${end.getMonth()+1}-${end.getFullYear()}`;
      opt.text = label;
      if (i === 0) opt.selected = true;
      sel.appendChild(opt);
    }
    container.appendChild(sel);
    const ref = document.getElementById('report-month');
    if (ref && ref.parentNode) {
      ref.parentNode.insertBefore(container, ref);
      ref.style.display = 'none';
      const ry = document.getElementById('report-year');
      if (ry) ry.style.display = 'none';
    }
    sel.addEventListener('change', () => {
      const [m,y] = sel.value.split('-').map(Number);
      if (reportMonth) reportMonth.value = m;
      if (reportYear) reportYear.value = y;
      renderizarRelatorio();
    });
    const [m0,y0] = sel.value.split('-').map(Number);
    if (reportMonth) reportMonth.value = m0;
    if (reportYear) reportYear.value = y0;
  }catch(err){ /* silencioso */ }
}

    const renderizarRelatorio = async () => {
        if (!requireLogin()) return;
        if (!pointListBody) return;
        pointListBody.innerHTML = '';

        const selMonth = parseInt(reportMonth.value, 10) || (new Date().getMonth()+1);
        const selYear = parseInt(reportYear.value, 10) || new Date().getFullYear();
        const period = buildPeriodFor(selMonth, selYear);

        let registros = [];
        try{
          registros = await listarBatidasServidor(`mes=${selMonth}&ano=${selYear}`);
        }catch(e){
          pointListBody.innerHTML = '<div class="point-list-row"><div class="col-date">Erro ao carregar espelho</div></div>';
          return;
        }

        // agrupa registros por dia (LOCAL)
        const byDate = {};

        for (const r of (registros || [])) {
            const horario = r.horario ?? r.data;
            if (!horario) continue;

            let dt;
            if (horario instanceof Date) {
              dt = horario;
            } else if (typeof horario === 'string') {
              const s = horario.includes('T') || horario.endsWith('Z')
                ? horario
                : horario.replace(' ', 'T');
              dt = new Date(s);
            } else {
              dt = new Date(horario);
            }
            if (Number.isNaN(dt.getTime())) continue;

            if (dt < period.from || dt > period.to) continue;

            const dayISO = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;

            byDate[dayISO] = byDate[dayISO] || { slots: { entrada: [], saida: [] }, raw: [] };
            byDate[dayISO].raw.push(r);

            const hh = String(dt.getHours()).padStart(2,'0');
            const mm = String(dt.getMinutes()).padStart(2,'0');
            const hhmm = `${hh}:${mm}`;

            const tipo = (r.tipo ?? (r.isEntrada ? 'entrada' : 'saida'));

            const comprovante = r.comprovante || r.comprovante_url || r.publicUrl || null;
            const alvo = (tipo === 'entrada') ? 'entrada' : 'saida';
            byDate[dayISO].slots[alvo].push({ time: hhmm, id: r.id, comprovante });
          }

        // expõe o último agrupamento para os handlers de clique resolverem ids "virtuais"
        lastByDate = byDate;

        // cria array de dias (LOCAL) entre period.from e period.to
        const days = [];
        const start = new Date(period.from.getFullYear(), period.from.getMonth(), period.from.getDate());
        const end = new Date(period.to.getFullYear(), period.to.getMonth(), period.to.getDate());
        for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
          days.push(new Date(cur));
        }

        days.reverse();

        days.forEach(d=>{
          const dateISO = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const dataObj = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          const dia = dataObj.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'});
          const diaSemana = dataObj.toLocaleDateString('pt-BR', {weekday:'short'});
          const row = document.createElement('div');
          row.className = 'point-list-row';

          const colDate = document.createElement('div');
          colDate.className = 'col-date';
          colDate.innerHTML = `<div class="date">${dia}</div><div class="day-of-week" style="font-size:12px;color:var(--text-secondary)">${diaSemana}</div>`;

          const colEntries = document.createElement('div'); colEntries.className='col-entries';
          const colExits = document.createElement('div'); colExits.className='col-exits';
          const colActions = document.createElement('div'); colActions.className='col-actions';

          const dayData = byDate[dateISO] || { slots: { entrada: [], saida: [] } };
          const entradas = (dayData.slots.entrada || []).sort((a,b)=> a.time.localeCompare(b.time)).slice(0,2);
          const saidas = (dayData.slots.saida || []).sort((a,b)=> a.time.localeCompare(b.time)).slice(0,2);

          const displaySlot = (slot, label) => {
            if (!slot) return `<div class="time-slot"><span class="label">${label}</span><span class="time">—</span></div>`;
            const safeId = slot.id ?? `${dateISO}#${slot.time}`;
            const proofBtn = slot.comprovante
              ? `<button type="button" class="proof-icon" data-action="view_report_proof" data-id="${safeId}" data-url="${slot.comprovante}" title="Visualizar"><i class="fa-solid fa-eye"></i></button>`
              : `<button type="button" class="proof-icon" data-action="attach_report_proof" data-id="${safeId}" title="Anexar"><i class="fa-solid fa-paperclip"></i></button>`;
            const removeBtn = slot.comprovante ? `<button type="button" class="proof-icon" data-action="remove_report_proof" data-id="${safeId}" title="Remover"><i class="fa-solid fa-xmark"></i></button>` : '';
            return `<div class="time-slot" data-id="${safeId}"><span class="label">${label}</span><div class="time-slot-info"><span class="time" data-id="${safeId}" data-time="${slot.time}">${slot.time}</span>${proofBtn}${removeBtn}</div></div>`;
          };

          colEntries.innerHTML = `${displaySlot(entradas[0], 'E1')}${displaySlot(entradas[1], 'E2')}`;
          colExits.innerHTML = `${displaySlot(saidas[0], 'S1')}${displaySlot(saidas[1], 'S2')}`;
          row.appendChild(colDate); row.appendChild(colEntries); row.appendChild(colExits); row.appendChild(colActions);
          pointListBody.appendChild(row);
        });
    };

    // resolve id helper: accepts "123" or "YYYY-MM-DD#HH:MM" or dd/mm/yyyy from DOM + time
    function resolveMappedId(keyOrDate, timePart){
      if (!lastByDate) return null;
      if (!keyOrDate) return null;
      // if numeric id
      if (/^\d+$/.test(String(keyOrDate))) return String(keyOrDate);
      // if virtual key "YYYY-MM-DD#HH:MM"
      if (String(keyOrDate).includes('#')) {
        const parts = String(keyOrDate).split('#');
        const dateKey = parts[0];
        const tp = parts[1] || timePart;
        const bucket = lastByDate[dateKey];
        if (!bucket) return null;
        const found = bucket.raw.find(rr=>{
          const dt = new Date(rr.horario || rr.data || rr.created_at);
          if (isNaN(dt)) return false;
          const hh = String(dt.getHours()).padStart(2,'0'), mm = String(dt.getMinutes()).padStart(2,'0');
          return `${hh}:${mm}` === tp;
        });
        return found ? String(found.id) : null;
      }
      // if date label dd/mm/yyyy provided as keyOrDate, convert
      if (String(keyOrDate).includes('/')) {
        const p = String(keyOrDate).split('/').map(s=>s.trim());
        if (p.length >= 3) {
          const key = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
          return resolveMappedId(key, timePart);
        }
      }
      return null;
    }

    if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    if (themeToggleBtn) themeToggleBtn.addEventListener('click', () => {
        const newTheme = body.classList.contains('dark-theme') ? 'light-theme' : 'dark-theme';
        applyTheme(newTheme);
    });

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navLinks.forEach(l=>l.classList.remove('active'));
            link.classList.add('active');
            const view = link.dataset.view;
            views.forEach(v=> v.classList.remove('active'));
            const target = document.getElementById(`${view}-view`);
            if (target) target.classList.add('active');
            if (view === 'relatorio') renderizarRelatorio();
        });
    });

    if (addEntryBtn) addEntryBtn.addEventListener('click', async () => {
        try{
          if (!requireLogin()) return;

          const tipo = (todayEntries.length % 2 === 0) ? 'entrada' : 'saida';
          const hhmm = timeInput.value;
          if (!hhmm) throw new Error('Informe o horário');
          const [hh, mm] = hhmm.split(':').map(Number);
          const d = new Date();
          d.setHours(hh, mm, 0, 0);
          const iso = localIsoString(d);

          const file = fileInputMain.files && fileInputMain.files[0] ? fileInputMain.files[0] : null;
          const url = file ? await uploadComprovante(file) : null;

          const resp = await salvarBatidaServidor(iso, tipo, url);
          const newId = resp && resp.id ? resp.id : (++entryIdCounter);
          const remoteUrl = resp && (resp.comprovante_url || resp.comprovante || resp.publicUrl) ? (resp.comprovante_url || resp.comprovante || resp.publicUrl) : url;

          todayEntries.push({ id: newId, time: hhmm, proof: null, comprovante_url: remoteUrl || null });
          if (file){ fileNameDisplay.textContent = file.name; fileInputMain.value=''; } else { fileNameDisplay.textContent = ''; }

          renderTodayEntries();
          if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio();
        }catch(err){
          alert('Erro ao salvar batida: ' + err.message);
        }
      });

    if (fileInputMain) fileInputMain.addEventListener('change', (e) => {
        if (e.target.files.length > 0) { fileNameDisplay.textContent = e.target.files[0].name; }
        else { fileNameDisplay.textContent = ''; }
    });

    if (todayEntriesList) todayEntriesList.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action || e.target.dataset.action;
        if (!action) return;
        const entryItem = e.target.closest('.entry-item');
        if (!entryItem) return;
        const entryId = parseInt(entryItem.dataset.id, 10);
        const entry = todayEntries.find(ev => ev.id === entryId);
        if (!entry) return;

        switch (action) {
            case 'edit':
                editingEntryId = entryId;
                editModalTimeInput.value = entry.time;
                if (editTimeModal) editTimeModal.classList.add('visible');
                break;
            case 'attach':
                fileInputList.dataset.entryId = entryId;
                fileInputList.click();
                break;
            case 'delete':
                showConfirmationModal('Tem certeza que deseja excluir esta batida?', async () => {
                    if (entry.id) {
                      try { await api(`/api/batidas/${entry.id}`, { method: 'DELETE' }); } catch(_) {}
                    }
                    todayEntries = todayEntries.filter(e => e.id !== entryId);
                    renderTodayEntries();
                    if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio();
                });
                break;
            case 'view':
                if (entry.comprovante_url) {
                    window.open(entry.comprovante_url, '_blank');
                } else if (entry.proof) {
                    const blobUrl = URL.createObjectURL(entry.proof);
                    window.open(blobUrl, '_blank');
                }
                break;
            case 'remove-proof':
                (async () => {
                    const hadRemote = !!entry.comprovante_url;
                    entry.proof = null;
                    entry.comprovante_url = null;
                    if (hadRemote && entry.id) {
                        try { await api(`/api/batidas/${entry.id}`, { method: 'PATCH', body: JSON.stringify({ comprovante: null }) }); } catch(_) {}
                    }
                    renderTodayEntries();
                    if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio();
                })();
                break;
        }
    });

    if (fileInputList) fileInputList.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            let entryId = fileInputList.dataset.entryId;
            const file = e.target.files[0];
            try {
              // se entryId for virtual (YYYY-MM-DD#HH:MM) tentamos resolver para id real
              if (entryId && entryId.includes('#')) {
                const mapped = resolveMappedId(entryId);
                if (mapped) entryId = mapped;
              }
              const url = await uploadComprovante(file);
              if (!entryId) {
                // sem id: recarrega e atualiza relatório
                await carregarDoServidor();
                if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') await renderizarRelatorio();
              } else {
                try { await api(`/api/batidas/${entryId}`, { method: 'PATCH', body: JSON.stringify({ comprovante: url }) }); } catch(_) {}
                // se item estiver na lista "hoje", atualiza localmente
                const entry = todayEntries.find(ev => String(ev.id) === String(entryId));
                if (entry) { entry.comprovante_url = url; entry.proof = null; renderTodayEntries(); }
                if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio();
              }
            } finally {
              fileInputList.value = '';
              delete fileInputList.dataset.entryId;
            }
        }
    });

    if (editModalSaveBtn) editModalSaveBtn.addEventListener('click', async () => {
        const newTime = editModalTimeInput.value;
        if (newTime && editingEntryId !== null) {
            const entry = todayEntries.find(e => e.id === editingEntryId);
            if (entry) {
                entry.time = newTime;
                if (entry.id) {
                  try {
                    const [hh, mm] = newTime.split(':').map(Number);
                    const d = new Date();
                    d.setHours(hh, mm, 0, 0);
                    const iso = localIsoString(d);
                    await api(`/api/batidas/${entry.id}`, { method: 'PATCH', body: JSON.stringify({ horario: iso }) });
                  } catch(_) {}
                }
                renderTodayEntries();
                if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio();
            }
        }
        if (editTimeModal) editTimeModal.classList.remove('visible');
        editingEntryId = null;
    });

    if (editModalCancelBtn) editModalCancelBtn.addEventListener('click', () => {
        if (editTimeModal) editTimeModal.classList.remove('visible');
        editingEntryId = null;
    });

    if (pointListBody) pointListBody.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;

        // try to get direct id or virtual id
        const rawId = btn.dataset.id || btn.getAttribute('data-id') || btn.closest('.time-slot')?.dataset.id || btn.closest('.time')?.dataset.id || btn.closest('[data-id]')?.dataset.id || '';

        // resolve id using lastByDate when needed
        let resolvedId = null;
        if (rawId) {
          resolvedId = resolveMappedId(rawId);
        }
        // if no id yet, try derive from DOM date/time
        if (!resolvedId) {
          const dateLabel = btn.closest('.point-list-row')?.querySelector('.date')?.textContent?.trim();
          const timeEl = btn.closest('.time') || btn.closest('.time-slot')?.querySelector('.time');
          const timeText = timeEl?.getAttribute('data-time') || timeEl?.textContent?.trim();
          if (dateLabel && timeText) {
            resolvedId = resolveMappedId(dateLabel, timeText);
          }
        }

        if (action === 'view_report_proof') {
            const url = btn.dataset.url;
            if (url) window.open(url, '_blank');
            return;
        }

        if (action === 'attach_report_proof') {
            // set dataset to resolved id if available, otherwise to rawId (server will be patched if numeric)
            fileInputList.dataset.entryId = resolvedId || rawId || '';
            fileInputList.click();
            return;
        }

        if (action === 'remove_report_proof') {
            const useId = resolvedId || rawId;
            if (!useId) return;
            showConfirmationModal('Remover comprovante deste registro?', async () => {
                // try mapping if virtual
                let idToUse = useId;
                if (String(useId).includes('#')) idToUse = resolveMappedId(useId);
                if (!idToUse) return;
                try { await api(`/api/batidas/${idToUse}`, { method: 'PATCH', body: JSON.stringify({ comprovante: null }) }); } catch(_) {}
                await renderizarRelatorio();
            });
            return;
        }
    });

    // double click edit time in report: delegate
    if (pointListBody) pointListBody.addEventListener('dblclick', async (e) => {
        const timeEl = e.target.closest('.time');
        if (!timeEl) return;
        const id = timeEl.dataset.id;
        const current = timeEl.textContent.trim();
        const input = document.createElement('input');
        input.type = 'time';
        input.value = current || '00:00';
        input.style.fontSize = '16px';
        timeEl.replaceWith(input);
        input.focus();

        const cancel = () => { input.replaceWith(timeEl); };
        const save = async () => {
            const newTime = input.value;
            try {
                if (id) {
                    // resolve id if virtual
                    const mapped = resolveMappedId(id);
                    const idToUse = mapped || id;
                    const [hh, mm] = newTime.split(':').map(Number);
                    const d = new Date();
                    d.setHours(hh, mm, 0, 0);
                    const iso = localIsoString(d);
                    await api(`/api/batidas/${idToUse}`, { method: 'PATCH', body: JSON.stringify({ horario: iso }) });
                }
            } catch(_) {}
            timeEl.textContent = newTime;
            input.replaceWith(timeEl);
            await carregarDoServidor();
            if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio();
        };

        input.addEventListener('keydown', (ev)=>{
            if (ev.key === 'Escape') { cancel(); }
            if (ev.key === 'Enter') { save(); }
        });
        input.addEventListener('blur', () => { cancel(); });
    });

    if (confirmationConfirmBtn) confirmationConfirmBtn.addEventListener('click', async () => {
        if (typeof confirmAction === 'function') {
            try { await confirmAction(); } catch(_) { /* silencioso */ }
        }
        hideConfirmationModal();
    });
    if (confirmationCancelBtn) confirmationCancelBtn.addEventListener('click', hideConfirmationModal);

    if (reportRefresh) reportRefresh.addEventListener('click', renderizarRelatorio);
    if (reportMonth) reportMonth.addEventListener('change', renderizarRelatorio);
    if (reportYear) reportYear.addEventListener('change', renderizarRelatorio);

    // --- INICIALIZAÇÃO ---
    setDefaultTime();
    renderTodayEntries();
    applyTheme(localStorage.getItem('theme') || 'dark-theme');
    ensureAuthElements();
    initPeriodSelect();
    if (getToken()) { if (authDialog && typeof authDialog.close === 'function') authDialog.close(); carregarDoServidor(); }
    else { if (authDialog && typeof authDialog.showModal === 'function') authDialog.showModal(); }

    // carregarDoServidor definition:
    async function carregarDoServidor(){
      try{
        if (!getToken()) return;
        const lista = await listarBatidasServidor();
        const hoje = new Date();
        hoje.setHours(0,0,0,0);
        const amanha = new Date(hoje.getTime()+24*60*60*1000);
        const deHoje = (lista||[]).filter(b=>{
          const dt = new Date(b.horario || b.data || b.created_at);
          return dt >= hoje && dt < amanha;
        }).sort((a,b)=> new Date(a.horario) - new Date(b.horario));

        todayEntries = deHoje.map((b,i)=>{
          const dt = new Date(b.horario);
          const hh = String(dt.getHours()).padStart(2,'0'), mm = String(dt.getMinutes()).padStart(2,'0');
          return { id: b.id || (++entryIdCounter), time: `${hh}:${mm}`, proof: null, comprovante_url: b.comprovante || b.comprovante_url || b.publicUrl || null };
        });
        renderTodayEntries();
      }catch(e){
        if (String(e).includes('401') || String(e).includes('403')) {
          clearToken();
          ensureAuthElements();
          if (authDialog && typeof authDialog.showModal === 'function') authDialog.showModal();
        }
      }
    }
});