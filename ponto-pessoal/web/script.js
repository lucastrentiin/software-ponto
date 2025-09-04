"use strict";
// Refactored script.js - same features, clearer structure.
const API_BASE = location.origin;
const JORNADA_MINUTOS = 6 * 60;

/* -------------------- helpers -------------------- */
// Formata número com zero à esquerda (helper de formatação)
const pad = (n) => String(n).padStart(2, "0");
// Converte um objeto Date para string ISO local (sem Z) para enviar ao backend
const localIsoString = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

// Token helpers: get/set/clear token no localStorage
function getToken(){ return localStorage.getItem('token'); }
function setToken(t){ localStorage.setItem('token', t); }
function clearToken(){ localStorage.removeItem('token'); }

// Função helper para chamadas HTTP ao backend.
// Faz attach do token quando presente e detecta JSON vs FormData automaticamente.
async function api(path, {method='GET', headers={}, body=null} = {}){
  const h = {...headers};
  const hasForm = (body instanceof FormData);
  if (!hasForm) h['Content-Type'] = h['Content-Type'] || 'application/json';
  const t = getToken(); if (t) h['Authorization'] = 'Bearer ' + t;
  const res = await fetch(API_BASE + path, { method, headers: h, body });
  if (!res.ok) throw new Error(await res.text().catch(()=>res.statusText));
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

/* -------------------- DOM refs & state -------------------- */
let refs = {};
let state = {
  todayEntries: [],
  entryIdCounter: 0,
  editingEntryId: null,
  confirmAction: null,
  lastByDate: {}
};

/* -------------------- Auth modal -------------------- */
// Inicializa elementos do modal de autenticação e liga handlers de login/registro.
function ensureAuthElements(){
  if (refs.authDialog) return;
  refs.authDialog = document.getElementById('auth-dialog');
  refs.authEmail = document.getElementById('auth-email');
  refs.authPass = document.getElementById('auth-pass');
  refs.authLoginBtn = document.getElementById('auth-login');
  refs.authRegisterBtn = document.getElementById('auth-register');
  refs.authMsg = document.getElementById('auth-msg');

  if (!refs.authDialog) return;

  refs.authDialog.addEventListener('close', ()=>{ if(refs.authMsg) refs.authMsg.textContent=''; });

  refs.authLoginBtn.addEventListener('click', async (e)=>{
    e.preventDefault();
    try{
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: refs.authEmail.value.trim(), senha: refs.authPass.value }) });
      if (data && data.token){
        setToken(data.token);
        refs.authMsg.textContent = '';
        if (typeof refs.authDialog.close === 'function') refs.authDialog.close();
        await carregarDoServidor();
      } else {
        refs.authMsg.textContent = 'Erro: resposta inválida do servidor';
      }
    }catch(err){ refs.authMsg.textContent = 'Erro: '+err.message; }
  });

  refs.authRegisterBtn.addEventListener('click', async ()=>{
    try{
      await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ nome: refs.authEmail.value.split('@')[0]||'Usuário', email: refs.authEmail.value.trim(), senha: refs.authPass.value }) });
      refs.authMsg.textContent = 'Conta criada! Agora clique em Entrar.';
    }catch(err){ refs.authMsg.textContent = 'Erro: '+err.message; }
  });
}

// Verifica se há token e, caso contrário, abre modal de login.
function requireLogin(){
  ensureAuthElements();
  if (!getToken()){
    if (refs.authDialog && typeof refs.authDialog.showModal === 'function') refs.authDialog.showModal();
    return false;
  }
  return true;
}

/* -------------------- Upload helpers -------------------- */
// Faz upload do arquivo do comprovante ao backend e retorna URL pública (ou null).
async function uploadComprovante(file){
  if (!file) return null;
  const parts = file.name.split('.');
  const ext = parts.length>1?'.'+parts.pop():'';
  const base = parts.join('.') || 'file';
  const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${base}${ext}`;
  const fileToSend = new File([file], uniqueName, { type: file.type });
  const fd = new FormData(); fd.append('file', fileToSend);
  const out = await api('/api/files/upload', { method:'POST', body: fd });
  return out?.url || out?.publicUrl || out?.fileUrl || null;
}

// Reutilizável: anexa um comprovante a um registro (por id) ou recarrega quando não há id.
async function attachComprovanteToEntry(entryId, file){
  if (!file) return;
  let useId = entryId;
  if (useId && String(useId).includes('#')){
    const mapped = resolveMappedId(useId);
    if (mapped) useId = mapped;
  }
  const url = await uploadComprovante(file);
  if (!useId){
    // sem id: recarrega do servidor (comprovante talvez seja novo registro remoto)
    await carregarDoServidor();
    if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') await renderizarRelatorio();
    return;
  }
  try{
    await api(`/api/batidas/${useId}`, { method: 'PATCH', body: JSON.stringify({ comprovante: url }) });
  }catch(_){/* ignore */}
  const entry = state.todayEntries.find(ev => String(ev.id) === String(useId));
  if (entry){ entry.comprovante_url = url; entry.proof = null; }
  renderTodayEntries();
  if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio();
}

// Envia uma nova batida (registro de ponto) ao backend.
async function salvarBatidaServidor(isoString, tipo, comprovanteUrl){
  return api('/api/batidas', { method:'POST', body: JSON.stringify({ horario: isoString, tipo, comprovante: comprovanteUrl||null }) });
}

// Lista batidas do backend (opcionalmente com query params)
async function listarBatidasServidor(params=''){ return api('/api/batidas' + (params? ('?'+params):'')); }

/* -------------------- UI helpers -------------------- */
// Aplica tema (altera classe no body e atualiza ícone do botão de tema).
function applyTheme(theme){
  refs.body.className = theme;
  const icon = refs.themeToggleBtn.querySelector('i');
  if (icon) icon.className = `fa-solid ${theme === 'dark-theme' ? 'fa-moon' : 'fa-sun'}`;
  localStorage.setItem('theme', theme);
}

// Exibe modal de confirmação com mensagem e callback a ser executado ao confirmar.
function showConfirmationModal(message, onConfirm){
  if (refs.confirmationMessage) refs.confirmationMessage.textContent = message;
  state.confirmAction = onConfirm;
  if (refs.confirmationModal) refs.confirmationModal.classList.add('visible');
}
// Oculta o modal de confirmação.
function hideConfirmationModal(){ if (refs.confirmationModal) refs.confirmationModal.classList.remove('visible'); state.confirmAction = null; }

// Define o valor padrão do input de horário com o horário atual.
function setDefaultTime(){
  const now = new Date(); if (refs.timeInput) refs.timeInput.value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

// Calcula e atualiza o resumo das horas trabalhadas e horas extras do dia.
function updateTodaySummary(){
  const { todayEntries } = state;
  if (!refs.summaryTrabalhadas || !refs.summaryExtras) return;
  let totalMinutosEfetivos = 0;
  const batidas = [...todayEntries].sort((a,b)=> a.time.localeCompare(b.time));
  for (let i=0;i<batidas.length-1;i+=2){ const a=batidas[i], b=batidas[i+1]; if (a && b){ const [ha,ma]=a.time.split(':').map(Number); const [hb,mb]=b.time.split(':').map(Number); totalMinutosEfetivos += (hb*60+mb)-(ha*60+ma); } }
  refs.summaryTrabalhadas.textContent = `${String(Math.floor(totalMinutosEfetivos / 60)).padStart(2,'0')}h ${String(totalMinutosEfetivos % 60).padStart(2,'0')}m`;
  let totalMinutosJornadaCompleta = 0;
  if (batidas.length >= 2){ const [hPrimeira] = batidas[0].time.split(':').map(Number); const [hUltima] = batidas[batidas.length-1].time.split(':').map(Number); const [ , mPrimeira] = batidas[0].time.split(':').map(Number); const [ , mUltima] = batidas[batidas.length-1].time.split(':').map(Number); totalMinutosJornadaCompleta = (hUltima*60 + mUltima) - (hPrimeira*60 + mPrimeira); }
  const minutosExtras = Math.max(0, totalMinutosJornadaCompleta - JORNADA_MINUTOS);
  refs.summaryExtras.textContent = `${String(Math.floor(minutosExtras / 60)).padStart(2,'0')}h ${String(minutosExtras % 60).padStart(2,'0')}m`;
}

// Renderiza a lista de batidas do dia na área principal (view 'hoje').
function renderTodayEntries(){
  const { todayEntries } = state;
  if (!refs.todayEntriesList) return;
  refs.todayEntriesList.innerHTML = '';
  todayEntries.sort((a,b)=> a.time.localeCompare(b.time));
  if (todayEntries.length === 0){ refs.todayEntriesList.innerHTML = '<p style="padding: 16px; color: var(--text-secondary);">Nenhuma batida registrada hoje.</p>'; }
  else{
    const labels = ['Entrada 1','Saída 1','Entrada 2','Saída 2'];
    todayEntries.forEach((entry, index)=>{
      const entryDiv = document.createElement('div'); entryDiv.className='entry-item'; entryDiv.dataset.id = entry.id;
      const hasRemote = !!entry.comprovante_url; const hasLocal = !!entry.proof;
      const viewAction = hasRemote || hasLocal ? `<button type="button" class="proof-icon" data-action="view" title="Visualizar"><i class="fa-solid fa-eye"></i></button>` : `<button type="button" class="proof-icon" data-action="attach" title="Anexar Comprovante"><i class="fa-solid fa-paperclip"></i></button>`;
      const removeAction = (hasRemote || hasLocal) ? `<button type="button" class="proof-icon" data-action="remove-proof" title="Remover Comprovante"><i class="fa-solid fa-xmark"></i></button>` : '';
      entryDiv.innerHTML = `\n        <div class="entry-label">${labels[index] || 'Extra'}</div>\n        <div class="entry-time" data-action="time">${entry.time}</div>\n        <div class="entry-actions">\n          ${viewAction}\n          ${removeAction}\n          <button type="button" class="proof-icon" data-action="edit" title="Editar Horário"><i class="fa-solid fa-pencil"></i></button>\n          <button type="button" class="proof-icon" data-action="delete" title="Excluir Batida"><i class="fa-solid fa-trash"></i></button>\n        </div>`;
      refs.todayEntriesList.appendChild(entryDiv);
    });
  }
  updateTodaySummary();
}

/* -------------------- report period helpers -------------------- */
// Gera o período do dia 16 do mês anterior até 15 do mês selecionado para o relatório.
function buildPeriodFor(month, year){
  const from = new Date(year, month-2, 16, 0,0,0,0);
  const to = new Date(year, month-1, 15, 23,59,59,999);
  return { from, to };
}

// Cria e inicializa o select de período (16/MM - 15/MM+1) usado no relatório.
function initPeriodSelect(){
  try{
    const container = document.createElement('div'); container.style.display='inline-block'; container.style.marginRight='8px';
    const sel = document.createElement('select'); sel.id = 'report-period'; sel.style.minWidth='220px';
    const now = new Date();
    for (let i=0;i<18;i++){ const end = new Date(now.getFullYear(), now.getMonth()-i, 15); const start = new Date(end.getFullYear(), end.getMonth()-1, 16); const label = `${String(start.getDate()).padStart(2,'0')}/${String(start.getMonth()+1).padStart(2,'0')}/${start.getFullYear()} - ${String(end.getDate()).padStart(2,'0')}/${String(end.getMonth()+1).padStart(2,'0')}/${end.getFullYear()}`; const opt = document.createElement('option'); opt.value = `${end.getMonth()+1}-${end.getFullYear()}`; opt.text = label; if (i===0) opt.selected=true; sel.appendChild(opt); }
    container.appendChild(sel);
    const ref = document.getElementById('report-month'); if (ref && ref.parentNode){ ref.parentNode.insertBefore(container, ref); ref.style.display='none'; const ry = document.getElementById('report-year'); if (ry) ry.style.display='none'; }
    sel.addEventListener('change', ()=>{ const [m,y] = sel.value.split('-').map(Number); if (refs.reportMonth) refs.reportMonth.value = m; if (refs.reportYear) refs.reportYear.value = y; renderizarRelatorio(); });
    const [m0,y0] = sel.value.split('-').map(Number); if (refs.reportMonth) refs.reportMonth.value = m0; if (refs.reportYear) refs.reportYear.value = y0;
  }catch(_){ /* silent */ }
}

/* -------------------- ID mapping -------------------- */
// Resolve ids "virtuais" do relatório (ex: "YYYY-MM-DD#HH:MM" ou "dd/mm/yyyy") para ids numéricos reais usando o último agrupamento carregado.
function resolveMappedId(keyOrDate, timePart){
  const lastByDate = state.lastByDate || {};
  if (!keyOrDate) return null;
  if (/^\d+$/.test(String(keyOrDate))) return String(keyOrDate);
  if (String(keyOrDate).includes('#')){
    const parts = String(keyOrDate).split('#'); const dateKey = parts[0]; const tp = parts[1] || timePart; const bucket = lastByDate[dateKey]; if (!bucket) return null; const found = bucket.raw.find(rr=>{ const dt = new Date(rr.horario || rr.data || rr.created_at); if (isNaN(dt)) return false; const hh = String(dt.getHours()).padStart(2,'0'), mm = String(dt.getMinutes()).padStart(2,'0'); return `${hh}:${mm}` === tp; }); return found ? String(found.id) : null;
  }
  if (String(keyOrDate).includes('/')){ const p = String(keyOrDate).split('/').map(s=>s.trim()); if (p.length>=3){ const key = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; return resolveMappedId(key, timePart); } }
  return null;
}

/* -------------------- Events: handlers (named) -------------------- */
// Agrupa referências DOM em um objeto `refs` para uso centralizado no script.
function setupUIRefs(){
  refs.body = document.body;
  refs.sidebar = document.querySelector('.sidebar');
  refs.sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  refs.navLinks = document.querySelectorAll('.nav-link');
  refs.views = document.querySelectorAll('.view');
  refs.themeToggleBtn = document.getElementById('theme-toggle-btn');
  refs.pointListBody = document.getElementById('point-list-body');
  refs.addEntryBtn = document.getElementById('add-entry-btn');
  refs.timeInput = document.getElementById('time-input');
  refs.todayEntriesList = document.getElementById('today-entries-list');
  refs.fileInputMain = document.getElementById('file-input-main');
  refs.fileNameDisplay = document.getElementById('file-name-display');
  refs.fileInputList = document.getElementById('file-input-list');
  refs.summaryTrabalhadas = document.getElementById('summary-trabalhadas');
  refs.summaryExtras = document.getElementById('summary-extras');
  refs.editTimeModal = document.getElementById('edit-time-modal');
  refs.editModalTimeInput = document.getElementById('edit-modal-time-input');
  refs.editModalSaveBtn = document.getElementById('edit-modal-save-btn');
  refs.editModalCancelBtn = document.getElementById('edit-modal-cancel-btn');
  refs.confirmationModal = document.getElementById('confirmation-modal');
  refs.confirmationMessage = document.getElementById('confirmation-message');
  refs.confirmationConfirmBtn = document.getElementById('confirmation-confirm-btn');
  refs.confirmationCancelBtn = document.getElementById('confirmation-cancel-btn');
  refs.reportMonth = document.getElementById('report-month');
  refs.reportYear = document.getElementById('report-year');
  refs.reportRefresh = document.getElementById('report-refresh');
}

// Handler: alterna estado de colapso da sidebar.
function handleSidebarToggle(){ if (refs.sidebar && refs.sidebarToggleBtn) refs.sidebarToggleBtn.addEventListener('click', ()=> refs.sidebar.classList.toggle('collapsed')); }
// Handler: alterna tema claro/escuro.
function handleThemeToggle(){ if (refs.themeToggleBtn) refs.themeToggleBtn.addEventListener('click', ()=> applyTheme(refs.body.classList.contains('dark-theme') ? 'light-theme' : 'dark-theme')); }

// Handler: troca entre views (hoje / relatorio) e dispara render do relatório quando necessário.
function handleNavLinks(){ refs.navLinks.forEach(link=>{ link.addEventListener('click', (e)=>{ e.preventDefault(); refs.navLinks.forEach(l=>l.classList.remove('active')); link.classList.add('active'); const view = link.dataset.view; refs.views.forEach(v=>v.classList.remove('active')); const target = document.getElementById(`${view}-view`); if (target) target.classList.add('active'); if (view === 'relatorio') renderizarRelatorio(); }); }); }

// Handler acionado pelo botão "Adicionar Batida" na UI.
// Lê o horário, faz upload do comprovante (opcional) e salva a batida no backend.
async function handleAddEntryClick(){
  if (!requireLogin()) return;
  try{
    const tipo = (state.todayEntries.length % 2 === 0) ? 'entrada' : 'saida';
    const hhmm = refs.timeInput.value; if (!hhmm) throw new Error('Informe o horário');
    const [hh,mm] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(hh,mm,0,0); const iso = localIsoString(d);
    const file = refs.fileInputMain.files && refs.fileInputMain.files[0] ? refs.fileInputMain.files[0] : null;
    const url = file ? await uploadComprovante(file) : null;
    const resp = await salvarBatidaServidor(iso, tipo, url);
    const newId = resp && resp.id ? resp.id : (++state.entryIdCounter);
    const remoteUrl = resp && (resp.comprovante_url || resp.comprovante || resp.publicUrl) ? (resp.comprovante_url || resp.comprovante || resp.publicUrl) : url;
    state.todayEntries.push({ id: newId, time: hhmm, proof: null, comprovante_url: remoteUrl || null });
    if (file){ refs.fileNameDisplay.textContent = file.name; refs.fileInputMain.value=''; } else { refs.fileNameDisplay.textContent = ''; }
    renderTodayEntries(); if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio();
  }catch(err){ alert('Erro ao salvar batida: ' + err.message); }
}

// Handler: atualiza exibição do nome do arquivo selecionado no formulário principal.
function attachFileMainChange(){ if (refs.fileInputMain) refs.fileInputMain.addEventListener('change', (e)=>{ if (e.target.files.length > 0) { refs.fileNameDisplay.textContent = e.target.files[0].name; } else { refs.fileNameDisplay.textContent = ''; } }); }

// Handler delegado para ações na lista de batidas do dia (editar, anexar, excluir, visualizar, remover comprovante).
function handleTodayListClick(){
  if (!refs.todayEntriesList) return;
  refs.todayEntriesList.addEventListener('click', (e)=>{
    const action = e.target.closest('[data-action]')?.dataset.action || e.target.dataset.action;
    if (!action) return; const entryItem = e.target.closest('.entry-item'); if (!entryItem) return; const entryId = parseInt(entryItem.dataset.id, 10); const entry = state.todayEntries.find(ev => ev.id === entryId); if (!entry) return;
    if (action === 'edit'){ state.editingEntryId = entryId; refs.editModalTimeInput.value = entry.time; if (refs.editTimeModal) refs.editTimeModal.classList.add('visible'); return; }
    if (action === 'attach'){ refs.fileInputList.dataset.entryId = entryId; refs.fileInputList.click(); return; }
    if (action === 'delete'){ showConfirmationModal('Tem certeza que deseja excluir esta batida?', async ()=>{ if (entry.id){ try{ await api(`/api/batidas/${entry.id}`, { method: 'DELETE' }); }catch(_){} } state.todayEntries = state.todayEntries.filter(e => e.id !== entryId); renderTodayEntries(); if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio(); }); return; }
    if (action === 'view'){ if (entry.comprovante_url) window.open(entry.comprovante_url, '_blank'); else if (entry.proof){ const blobUrl = URL.createObjectURL(entry.proof); window.open(blobUrl, '_blank'); } return; }
    if (action === 'remove-proof'){ (async ()=>{ const hadRemote = !!entry.comprovante_url; entry.proof = null; entry.comprovante_url = null; if (hadRemote && entry.id){ try{ await api(`/api/batidas/${entry.id}`, { method: 'PATCH', body: JSON.stringify({ comprovante: null }) }); }catch(_){} } renderTodayEntries(); if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio(); })(); return; }
  });
}

// Handler: ao escolher arquivo no input oculto ligado à lista/relatório, faz upload e atualiza registro correspondente.
function handleFileInputListChange(){
  if (!refs.fileInputList) return;
  refs.fileInputList.addEventListener('change', async (e)=>{
    if (e.target.files.length === 0) return;
    let entryId = refs.fileInputList.dataset.entryId;
    const file = e.target.files[0];
    try{
      await attachComprovanteToEntry(entryId, file);
    }finally{
      refs.fileInputList.value = '';
      delete refs.fileInputList.dataset.entryId;
    }
  });
}

// Handler: salva alteração de horário feita dentro do modal de edição.
function handleEditModalSave(){ if (!refs.editModalSaveBtn) return; refs.editModalSaveBtn.addEventListener('click', async ()=>{ const newTime = refs.editModalTimeInput.value; if (newTime && state.editingEntryId !== null){ let targetId = state.editingEntryId; if (String(targetId).includes('#')){ const mapped = resolveMappedId(targetId, newTime); if (mapped) targetId = mapped; } const entry = state.todayEntries.find(e => String(e.id) === String(targetId)); if (entry) entry.time = newTime; if (targetId && /^\d+$/.test(String(targetId))){ try{ const [hh, mm] = newTime.split(':').map(Number); const d = new Date(); d.setHours(hh, mm, 0, 0); const iso = localIsoString(d); await api(`/api/batidas/${targetId}`, { method: 'PATCH', body: JSON.stringify({ horario: iso }) }); }catch(_){} } renderTodayEntries(); if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio(); }
  if (refs.editTimeModal) refs.editTimeModal.classList.remove('visible'); state.editingEntryId = null; }); }

// Handler: cancela a edição de horário (fecha o modal e limpa estado).
function handleEditModalCancel(){ if (!refs.editModalCancelBtn) return; refs.editModalCancelBtn.addEventListener('click', ()=>{ if (refs.editTimeModal) refs.editTimeModal.classList.remove('visible'); state.editingEntryId = null; }); }

// Handler delegado para cliques no corpo do espelho (relatório): visualizar, anexar, remover comprovante, editar, excluir.
function handlePointListClicks(){ if (!refs.pointListBody) return; refs.pointListBody.addEventListener('click', async (e)=>{ const btn = e.target.closest('[data-action]'); if (!btn) return; const action = btn.dataset.action; const rawId = btn.dataset.id || btn.getAttribute('data-id') || btn.closest('.time-slot')?.dataset.id || btn.closest('.time')?.dataset.id || btn.closest('[data-id]')?.dataset.id || ''; let resolvedId = rawId ? resolveMappedId(rawId) : null; if (!resolvedId){ const dateLabel = btn.closest('.point-list-row')?.querySelector('.date')?.textContent?.trim(); const timeEl = btn.closest('.time') || btn.closest('.time-slot')?.querySelector('.time'); const timeText = timeEl?.getAttribute('data-time') || timeEl?.textContent?.trim(); if (dateLabel && timeText) resolvedId = resolveMappedId(dateLabel, timeText); }
  if (action === 'view_report_proof' || action === 'view'){ const url = btn.dataset.url; if (url) window.open(url, '_blank'); return; }
  if (action === 'attach_report_proof' || action === 'attach'){ refs.fileInputList.dataset.entryId = resolvedId || rawId || ''; refs.fileInputList.click(); return; }
  if (action === 'remove_report_proof' || action === 'remove-proof'){ const useId = resolvedId || rawId; if (!useId) return; showConfirmationModal('Remover comprovante deste registro?', async ()=>{ let idToUse = useId; if (String(useId).includes('#')) idToUse = resolveMappedId(useId); if (!idToUse) return; try{ await api(`/api/batidas/${idToUse}`, { method: 'PATCH', body: JSON.stringify({ comprovante: null }) }); }catch(_){} await renderizarRelatorio(); }); return; }
}); }

// fallback global handler for report buttons (keeps the behavior tolerant of DOM differences)
// Fallback global: garante que clicks em elementos do relatório sejam tratados corretamente mesmo fora da delegação local.
function handleGlobalDocClicks(){ document.addEventListener('click', (e)=>{ const btn = e.target.closest('[data-action]'); if (!btn) return; if (!btn.closest('#point-list-body')) return; const action = btn.dataset.action; if (!action) return; const rawId = btn.dataset.id || btn.getAttribute('data-id') || btn.closest('.time-slot')?.dataset.id || btn.closest('.time')?.dataset.id || btn.closest('[data-id]')?.dataset.id || '';
  if (action === 'view' || action === 'view_report_proof'){ const url = btn.dataset.url; if (url){ e.preventDefault(); window.open(url, '_blank'); } return; }
  if (action === 'attach' || action === 'attach_report_proof'){ e.preventDefault(); let resolved = rawId; if (resolved && String(resolved).includes('#')){ const mapped = resolveMappedId(resolved); if (mapped) resolved = mapped; } refs.fileInputList.dataset.entryId = resolved || rawId || ''; refs.fileInputList.click(); return; }
  if (action === 'remove-proof' || action === 'remove_report_proof'){ e.preventDefault(); const useId = rawId; if (!useId) return; showConfirmationModal('Remover comprovante deste registro?', async ()=>{ let idToUse = useId; if (String(idToUse).includes('#')) idToUse = resolveMappedId(idToUse); if (!idToUse) return; try{ await api(`/api/batidas/${idToUse}`, { method: 'PATCH', body: JSON.stringify({ comprovante: null }) }); }catch(_){} await renderizarRelatorio(); }); return; }
  if (action === 'edit'){ const rawId2 = rawId; const timeEl = btn.closest('.time') || btn.closest('.time-slot')?.querySelector('.time'); const timeText = timeEl?.getAttribute('data-time') || timeEl?.textContent?.trim() || ''; let idToEdit = rawId2; if (idToEdit && String(idToEdit).includes('#')){ const mapped = resolveMappedId(idToEdit, timeText); if (mapped) idToEdit = mapped; } state.editingEntryId = idToEdit || (timeText ? timeText : null); if (refs.editModalTimeInput) refs.editModalTimeInput.value = timeText || ''; if (refs.editTimeModal) refs.editTimeModal.classList.add('visible'); return; }
  if (action === 'delete'){ let idToUse = rawId; if (String(idToUse).includes('#')) idToUse = resolveMappedId(idToUse); if (!idToUse) return; showConfirmationModal('Tem certeza que deseja excluir esta batida?', async ()=>{ try{ await api(`/api/batidas/${idToUse}`, { method: 'DELETE' }); }catch(_){} state.todayEntries = state.todayEntries.filter(e => String(e.id) !== String(idToUse)); renderTodayEntries(); await renderizarRelatorio(); }); return; }
}); }

// Handler: edição rápida de horário ao dar duplo clique sobre o horário no relatório.
function handlePointListDblClick(){ if (!refs.pointListBody) return; refs.pointListBody.addEventListener('dblclick', async (e)=>{ const timeEl = e.target.closest('.time'); if (!timeEl) return; const id = timeEl.dataset.id; const current = timeEl.textContent.trim(); const input = document.createElement('input'); input.type = 'time'; input.value = current || '00:00'; input.style.fontSize = '16px'; timeEl.replaceWith(input); input.focus(); const cancel = ()=>{ input.replaceWith(timeEl); };
  const save = async ()=>{ const newTime = input.value; try{ if (id){ const mapped = resolveMappedId(id); const idToUse = mapped || id; const [hh, mm] = newTime.split(':').map(Number); const d = new Date(); d.setHours(hh, mm, 0, 0); const iso = localIsoString(d); await api(`/api/batidas/${idToUse}`, { method: 'PATCH', body: JSON.stringify({ horario: iso }) }); } }catch(_){} timeEl.textContent = newTime; input.replaceWith(timeEl); await carregarDoServidor(); if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio(); };
  input.addEventListener('keydown', (ev)=>{ if (ev.key === 'Escape') { cancel(); } if (ev.key === 'Enter') { save(); } }); input.addEventListener('blur', ()=>{ cancel(); }); }); }

// Liga handlers dos botões do modal de confirmação (confirmar / cancelar).
function handleConfirmationButtons(){ if (refs.confirmationConfirmBtn) refs.confirmationConfirmBtn.addEventListener('click', async ()=>{ if (typeof state.confirmAction === 'function'){ try{ await state.confirmAction(); }catch(_){} } hideConfirmationModal(); }); if (refs.confirmationCancelBtn) refs.confirmationCancelBtn.addEventListener('click', hideConfirmationModal); }

// Liga os controles do relatório (refresh, selects de mês/ano).
function handleReportControls(){ if (refs.reportRefresh) refs.reportRefresh.addEventListener('click', renderizarRelatorio); if (refs.reportMonth) refs.reportMonth.addEventListener('change', renderizarRelatorio); if (refs.reportYear) refs.reportYear.addEventListener('change', renderizarRelatorio); }

/* -------------------- Report rendering -------------------- */
// Renderiza o espelho de ponto para o período selecionado (constrói linhas e botões).
async function renderizarRelatorio(){
  if (!requireLogin()) return; if (!refs.pointListBody) return; refs.pointListBody.innerHTML = '';
  const selMonth = parseInt(refs.reportMonth?.value, 10) || (new Date().getMonth()+1);
  const selYear = parseInt(refs.reportYear?.value, 10) || new Date().getFullYear();
  const period = buildPeriodFor(selMonth, selYear);
  let registros = [];
  try{ registros = await listarBatidasServidor(`mes=${selMonth}&ano=${selYear}`); }catch(e){ refs.pointListBody.innerHTML = '<div class="point-list-row"><div class="col-date">Erro ao carregar espelho</div></div>'; return; }
  const byDate = {};
  for (const r of (registros || [])){
    const horario = r.horario ?? r.data; if (!horario) continue; let dt; if (horario instanceof Date) dt = horario; else if (typeof horario === 'string'){ const s = horario.includes('T') || horario.endsWith('Z') ? horario : horario.replace(' ', 'T'); dt = new Date(s); } else dt = new Date(horario); if (Number.isNaN(dt.getTime())) continue; if (dt < period.from || dt > period.to) continue; const dayISO = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`; byDate[dayISO] = byDate[dayISO] || { slots: { entrada: [], saida: [] }, raw: [] }; byDate[dayISO].raw.push(r); const hh = String(dt.getHours()).padStart(2,'0'); const mm = String(dt.getMinutes()).padStart(2,'0'); const hhmm = `${hh}:${mm}`; const tipo = (r.tipo ?? (r.isEntrada ? 'entrada' : 'saida')); const comprovante = r.comprovante || r.comprovante_url || r.publicUrl || null; const alvo = (tipo === 'entrada') ? 'entrada' : 'saida'; byDate[dayISO].slots[alvo].push({ time: hhmm, id: r.id, comprovante });
  }
  state.lastByDate = byDate;
  const days = []; const start = new Date(period.from.getFullYear(), period.from.getMonth(), period.from.getDate()); const end = new Date(period.to.getFullYear(), period.to.getMonth(), period.to.getDate()); for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) days.push(new Date(cur)); days.reverse();
  days.forEach(d=>{
    const dateISO = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const dataObj = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dia = dataObj.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'});
    const diaSemana = dataObj.toLocaleDateString('pt-BR', {weekday:'short'});
    const row = document.createElement('div'); row.className = 'point-list-row';
    const colDate = document.createElement('div'); colDate.className='col-date'; colDate.innerHTML = `<div class="date">${dia}</div><div class="day-of-week" style="font-size:12px;color:var(--text-secondary)">${diaSemana}</div>`;
    const colEntries = document.createElement('div'); colEntries.className='col-entries'; const colExits = document.createElement('div'); colExits.className='col-exits'; const colActions = document.createElement('div'); colActions.className='col-actions';
    const dayData = byDate[dateISO] || { slots: { entrada: [], saida: [] } };
    const entradas = (dayData.slots.entrada || []).sort((a,b)=> a.time.localeCompare(b.time)).slice(0,2);
    const saidas = (dayData.slots.saida || []).sort((a,b)=> a.time.localeCompare(b.time)).slice(0,2);
    const displaySlot = (slot, label) => {
      if (!slot) return `<div class="time-slot"><span class="label">${label}</span><span class="time">—</span></div>`;
      const safeId = slot.id ?? `${dateISO}#${slot.time}`;
      const proofBtn = slot.comprovante ? `<button type="button" class="proof-icon" data-action="view" data-id="${safeId}" data-url="${slot.comprovante}" title="Visualizar"><i class="fa-solid fa-eye"></i></button>` : `<button type="button" class="proof-icon" data-action="attach" data-id="${safeId}" title="Anexar"><i class="fa-solid fa-paperclip"></i></button>`;
      const removeBtn = slot.comprovante ? `<button type="button" class="proof-icon" data-action="remove-proof" data-id="${safeId}" title="Remover"><i class="fa-solid fa-xmark"></i></button>` : '';
      const editBtn = `<button type="button" class="proof-icon" data-action="edit" data-id="${safeId}" title="Editar"><i class="fa-solid fa-pencil"></i></button>`;
      const deleteBtn = `<button type="button" class="proof-icon" data-action="delete" data-id="${safeId}" title="Excluir"><i class="fa-solid fa-trash"></i></button>`;
      return `<div class="time-slot" data-id="${safeId}"><span class="label">${label}</span><div class="time-slot-info"><span class="time" data-id="${safeId}" data-time="${slot.time}">${slot.time}</span>${proofBtn}${removeBtn}${editBtn}${deleteBtn}</div></div>`;
    };
    colEntries.innerHTML = `${displaySlot(entradas[0], 'E1')}${displaySlot(entradas[1], 'E2')}`;
    colExits.innerHTML = `${displaySlot(saidas[0], 'S1')}${displaySlot(saidas[1], 'S2')}`;
    row.appendChild(colDate); row.appendChild(colEntries); row.appendChild(colExits); row.appendChild(colActions); refs.pointListBody.appendChild(row);
  });
}

/* -------------------- Initialization -------------------- */
// Conecta referências e handlers da UI (inicialização de listeners).
function wireUp(){
  setupUIRefs();
  ensureAuthElements();
  handleSidebarToggle(); handleThemeToggle(); handleNavLinks(); attachFileMainChange(); handleTodayListClick(); handleFileInputListChange(); handleEditModalSave(); handleEditModalCancel(); handlePointListClicks(); handleGlobalDocClicks(); handlePointListDblClick(); handleConfirmationButtons(); handleReportControls();
}

// Carrega batidas do servidor e popula `state.todayEntries` com as batidas do dia.
async function carregarDoServidor(){
  try{
    if (!getToken()) return;
    const lista = await listarBatidasServidor();
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const amanha = new Date(hoje.getTime() + 24*60*60*1000);
    const deHoje = (lista||[]).filter(b=>{ const dt = new Date(b.horario || b.data || b.created_at); return dt >= hoje && dt < amanha; }).sort((a,b)=> new Date(a.horario) - new Date(b.horario));
    state.todayEntries = deHoje.map((b,i)=>{ const dt = new Date(b.horario); const hh = String(dt.getHours()).padStart(2,'0'), mm = String(dt.getMinutes()).padStart(2,'0'); return { id: b.id || (++state.entryIdCounter), time: `${hh}:${mm}`, proof: null, comprovante_url: b.comprovante || b.comprovante_url || b.publicUrl || null }; });
    renderTodayEntries();
  }catch(e){ if (String(e).includes('401') || String(e).includes('403')){ clearToken(); ensureAuthElements(); if (refs.authDialog && typeof refs.authDialog.showModal === 'function') refs.authDialog.showModal(); } }
}

document.addEventListener('DOMContentLoaded', ()=>{
  wireUp();
  setDefaultTime(); renderTodayEntries(); applyTheme(localStorage.getItem('theme') || 'dark-theme'); initPeriodSelect();
  if (getToken()){ if (refs.authDialog && typeof refs.authDialog.close === 'function') refs.authDialog.close(); carregarDoServidor(); }
  else { if (refs.authDialog && typeof refs.authDialog.showModal === 'function') refs.authDialog.showModal(); }
  // wire up add button after DOM ready
  if (refs.addEntryBtn) refs.addEntryBtn.addEventListener('click', ()=> handleAddEntryClick());
});

// --- Public API (programmatic) -------------------------------------------------
// Funções públicas reutilizáveis que podem ser chamadas por outros scripts ou pelo console.
// Adiciona uma batida programaticamente (utiliza upload quando `file` for fornecido).
async function addEntryProgram({ time, file } = {}){
  // time: string 'HH:MM' (optional, defaults to refs.timeInput value)
  // file: File or Blob (optional) - will be uploaded via uploadComprovante
  if (!requireLogin()) throw new Error('login-required');
  const hhmm = time || refs.timeInput && refs.timeInput.value;
  if (!hhmm) throw new Error('Informe o horário');
  const tipo = (state.todayEntries.length % 2 === 0) ? 'entrada' : 'saida';
  const [hh, mm] = hhmm.split(':').map(Number);
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  const iso = localIsoString(d);
  const url = file ? await uploadComprovante(file) : null;
  const resp = await salvarBatidaServidor(iso, tipo, url);
  const newId = resp && resp.id ? resp.id : (++state.entryIdCounter);
  const remoteUrl = resp && (resp.comprovante_url || resp.comprovante || resp.publicUrl) ? (resp.comprovante_url || resp.comprovante || resp.publicUrl) : url;
  state.todayEntries.push({ id: newId, time: hhmm, proof: null, comprovante_url: remoteUrl || null });
  renderTodayEntries();
  if (document.querySelector('.nav-link.active')?.dataset.view === 'relatorio') renderizarRelatorio();
  return resp;
}

// Login programático: faz login e, em caso de sucesso, salva token e recarrega batidas.
async function loginProgram(email, senha){
  ensureAuthElements();
  const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: (email||'').trim(), senha }) });
  if (data && data.token){ setToken(data.token); if (refs.authDialog && typeof refs.authDialog.close === 'function') refs.authDialog.close(); await carregarDoServidor(); }
  return data;
}

// Registro programático de usuário.
async function registerProgram(email, senha, nome){
  ensureAuthElements();
  const n = nome || (email? email.split('@')[0] : 'Usuário');
  return api('/api/auth/register', { method: 'POST', body: JSON.stringify({ nome: n, email: (email||'').trim(), senha }) });
}

// Exposição pública: anexa as funções úteis em `window.App` para reuso.
window.App = Object.assign(window.App || {}, {
  addEntry: addEntryProgram,
  carregarDoServidor,
  renderizarRelatorio,
  uploadComprovante,
  requireLogin,
  applyTheme,
  login: loginProgram,
  register: registerProgram,
  api,
  getToken,
  setToken,
  clearToken
});
