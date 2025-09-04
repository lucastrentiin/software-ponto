"use strict";

// Funções utilitárias -----------------------------

// Busca elemento único
const qs = (sel, ctx=document) => ctx.querySelector(sel);

// Busca lista de elementos
const qsa = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

// Adiciona zero à esquerda
const pad = n => String(n).padStart(2,'0');

// Gera string ISO local
const localIsoString = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

// Chamada à API com token JWT
async function api(caminho, {method='GET', headers={}, body=null} = {}){
  const token = localStorage.getItem('token');
  const h = {...headers};
  if(!(body instanceof FormData)) h['Content-Type']='application/json';
  if(token) h['Authorization']=`Bearer ${token}`;
  const res = await fetch(caminho,{method, headers:h, body});
  if(!res.ok) throw new Error(await res.text());
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

// Faz upload de arquivo e retorna URL pública
async function uploadArquivo(file){
  if(!file) return null;
  const nome = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
  const fd = new FormData();
  fd.append('file', new File([file], nome, {type:file.type}));
  const resp = await api('/api/files/upload',{method:'POST', body:fd});
  return resp.url || resp.publicUrl || resp.comprovante_url || null;
}

// Estado global ------------------------------------------------
const estado = {
  hoje: [],
  ultimoAgrupamento: {},
  editando: null,
  confirmar: null
};

const refs = {};

// Guarda referências dos elementos da interface
function capturarRefs(){
  refs.body = document.body;
  refs.sidebar = qs('.sidebar');
  refs.sidebarToggle = qs('#sidebar-toggle-btn');
  refs.navLinks = qsa('.nav-link');
  refs.views = qsa('.view');
  refs.themeBtn = qs('#theme-toggle-btn');
  refs.addEntryBtn = qs('#add-entry-btn');
  refs.timeInput = qs('#time-input');
  refs.fileInputMain = qs('#file-input-main');
  refs.fileNameDisplay = qs('#file-name-display');
  refs.todayList = qs('#today-entries-list');
  refs.summaryTrabalhadas = qs('#summary-trabalhadas');
  refs.summaryExtras = qs('#summary-extras');
  refs.fileInputList = qs('#file-input-list');
  refs.reportMonth = qs('#report-month');
  refs.reportYear = qs('#report-year');
  refs.reportRefresh = qs('#report-refresh');
  refs.reportBody = qs('#point-list-body');
  refs.editModal = qs('#edit-time-modal');
  refs.editModalTime = qs('#edit-modal-time-input');
  refs.editModalSave = qs('#edit-modal-save-btn');
  refs.editModalCancel = qs('#edit-modal-cancel-btn');
  refs.confirmModal = qs('#confirmation-modal');
  refs.confirmMessage = qs('#confirmation-message');
  refs.confirmConfirm = qs('#confirmation-confirm-btn');
  refs.confirmCancel = qs('#confirmation-cancel-btn');
  refs.authDialog = qs('#auth-dialog');
  refs.authEmail = qs('#auth-email');
  refs.authPass = qs('#auth-pass');
  refs.authLogin = qs('#auth-login');
  refs.authRegister = qs('#auth-register');
  refs.authMsg = qs('#auth-msg');
  refs.tplEntry = qs('#tpl-entry-item');
  refs.tplRow = qs('#tpl-report-row');
  refs.tplSlot = qs('#tpl-report-slot');
}

// Aplica tema claro ou escuro
function aplicarTema(tema){
  refs.body.classList.remove('dark-theme','light-theme');
  refs.body.classList.add(tema);
  const icone = refs.themeBtn.querySelector('i');
  if(icone) icone.className = `fa-solid ${tema==='dark-theme'?'fa-moon':'fa-sun'}`;
  localStorage.setItem('theme', tema);
}

// Solicita login caso não exista token
function exigirLogin(){
  if(!localStorage.getItem('token')){
    refs.authDialog.showModal();
    return false;
  }
  return true;
}

// Realiza login de usuário
async function login(email, senha){
  const resp = await api('/api/auth/login',{method:'POST', body:JSON.stringify({email, senha})});
  localStorage.setItem('token', resp.token);
  refs.authDialog.close();
  await carregarHoje();
}

// Registra novo usuário
async function registrar(nome, email, senha){
  await api('/api/auth/register',{method:'POST', body:JSON.stringify({nome, email, senha})});
  refs.authMsg.textContent = 'Conta criada! Faça login.';
}

// Função do botão de adicionar batida
async function baterPonto({time, file=null, tipo=null}){
  if(!exigirLogin()) return;
  const tipoEfetivo = tipo || (estado.hoje.length % 2 === 0 ? 'entrada' : 'saida');
  const [h,m] = time.split(':').map(Number);
  const d = new Date(); d.setHours(h,m,0,0);
  const iso = localIsoString(d);
  const url = await uploadArquivo(file);
  const novo = await api('/api/batidas',{method:'POST', body:JSON.stringify({horario:iso, tipo:tipoEfetivo, comprovante:url})});
  estado.hoje.push({id:novo.id, time, comprovante:url});
  renderHoje(estado.hoje);
  atualizarResumoDia();
  if(qs('#relatorio-view').classList.contains('active')) await renderRelatorio();
}

// Carrega batidas do dia atual
async function carregarHoje(){
  if(!exigirLogin()) return;
  const lista = await api('/api/batidas');
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1);
  estado.hoje = lista.filter(b=>{const dt=new Date(b.horario);return dt>=hoje && dt<amanha;})
                     .sort((a,b)=>a.horario.localeCompare(b.horario))
                     .map(b=>{ const dt=new Date(b.horario); return {id:b.id, time:`${pad(dt.getHours())}:${pad(dt.getMinutes())}`, comprovante:b.comprovante_url}; });
  renderHoje(estado.hoje);
  atualizarResumoDia();
}

// Renderiza lista de batidas de hoje
function renderHoje(lista){
  refs.todayList.innerHTML='';
  const labels=['Entrada 1','Saída 1','Entrada 2','Saída 2'];
  lista.forEach((b,i)=>{
    const frag = refs.tplEntry.content.cloneNode(true);
    const item = frag.querySelector('.entry-item');
    item.dataset.id = b.id;
    frag.querySelector('.entry-label').textContent = labels[i] || 'Extra';
    frag.querySelector('.entry-time').textContent = b.time;
    const btnView = frag.querySelector('[data-action="view-proof"]');
    const btnAttach = frag.querySelector('[data-action="attach-proof"]');
    const btnRemove = frag.querySelector('[data-action="remove-proof"]');
    if(b.comprovante){
      btnView.dataset.url = b.comprovante;
      btnAttach.classList.add('hidden');
    }else{
      btnView.classList.add('hidden');
      btnRemove.classList.add('hidden');
    }
    refs.todayList.appendChild(frag);
  });
  if(lista.length===0){
    refs.todayList.textContent='Nenhuma batida registrada hoje.';
  }
}

// Atualiza horário de uma batida
async function editarBatida(id, time){
  const [h,m]=time.split(':').map(Number);
  const d=new Date(); d.setHours(h,m,0,0);
  const iso=localIsoString(d);
  await api(`/api/batidas/${id}`,{method:'PATCH', body:JSON.stringify({horario:iso})});
  const alvo=estado.hoje.find(e=>e.id==id);
  if(alvo) alvo.time=time;
  renderHoje(estado.hoje);
  atualizarResumoDia();
  if(qs('#relatorio-view').classList.contains('active')) await renderRelatorio();
}

// Exclui batida
async function excluirBatida(id){
  await api(`/api/batidas/${id}`,{method:'DELETE'});
  estado.hoje=estado.hoje.filter(e=>e.id!=id);
  renderHoje(estado.hoje);
  atualizarResumoDia();
  if(qs('#relatorio-view').classList.contains('active')) await renderRelatorio();
}

// Anexa comprovante a batida
async function anexarComprovante(id, file){
  const url = await uploadArquivo(file);
  await api(`/api/batidas/${id}`,{method:'PATCH', body:JSON.stringify({comprovante:url})});
  const alvo=estado.hoje.find(e=>e.id==id);
  if(alvo) alvo.comprovante=url;
  renderHoje(estado.hoje);
  if(qs('#relatorio-view').classList.contains('active')) await renderRelatorio();
}

// Remove comprovante
async function removerComprovante(id){
  await api(`/api/batidas/${id}`,{method:'PATCH', body:JSON.stringify({comprovante:null})});
  const alvo=estado.hoje.find(e=>e.id==id);
  if(alvo) alvo.comprovante=null;
  renderHoje(estado.hoje);
  if(qs('#relatorio-view').classList.contains('active')) await renderRelatorio();
}

// Abre comprovante em nova aba
function visualizarComprovante(url){
  window.open(url,'_blank');
}

// Calcula resumo diário de horas
function calcularResumoDia(batidas){
  const ord=[...batidas].sort((a,b)=>a.time.localeCompare(b.time));
  let minutos=0;
  for(let i=0;i<ord.length;i+=2){
    const a=ord[i], b=ord[i+1];
    if(a && b){
      const [ha,ma]=a.time.split(':').map(Number);
      const [hb,mb]=b.time.split(':').map(Number);
      minutos += (hb*60+mb)-(ha*60+ma);
    }
  }
  const primeira=ord[0], ultima=ord[ord.length-1];
  let jornada=0;
  if(primeira && ultima){
    const [hp,mp]=primeira.time.split(':').map(Number);
    const [hu,mu]=ultima.time.split(':').map(Number);
    jornada=(hu*60+mu)-(hp*60+mp);
  }
  const extras=Math.max(0,jornada-360);
  return {trabalhadas:minutos, extras};
}

// Atualiza resumo na tela
function atualizarResumoDia(){
  const {trabalhadas, extras}=calcularResumoDia(estado.hoje);
  refs.summaryTrabalhadas.textContent=`${pad(Math.floor(trabalhadas/60))}h ${pad(trabalhadas%60)}m`;
  refs.summaryExtras.textContent=`${pad(Math.floor(extras/60))}h ${pad(extras%60)}m`;
}

// Carrega batidas do servidor para relatório
async function carregarRelatorioMensal(mes, ano){
  if(!exigirLogin()) return [];
  return api(`/api/batidas?mes=${mes}&ano=${ano}`);
}

// Renderiza relatório mensal
async function renderRelatorio(){
  const mes=parseInt(refs.reportMonth.value,10);
  const ano=parseInt(refs.reportYear.value,10);
  const registros=await carregarRelatorioMensal(mes, ano);
  const agrupado={};
  registros.forEach(r=>{
    const dt=new Date(r.horario);
    const chave=`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
    if(!agrupado[chave]) agrupado[chave]={entrada:[],saida:[],raw:[]};
    agrupado[chave].raw.push(r);
    const slot={time:`${pad(dt.getHours())}:${pad(dt.getMinutes())}`, id:r.id, comprovante:r.comprovante_url};
    (r.tipo==='entrada'?agrupado[chave].entrada:agrupado[chave].saida).push(slot);
  });
  estado.ultimoAgrupamento=agrupado;
  refs.reportBody.innerHTML='';
  Object.keys(agrupado).sort().reverse().forEach(chave=>{
    const rowFrag=refs.tplRow.content.cloneNode(true);
    const data=new Date(chave);
    rowFrag.querySelector('.date').textContent=data.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    rowFrag.querySelector('.day-of-week').textContent=data.toLocaleDateString('pt-BR',{weekday:'short'});
    const colE=rowFrag.querySelector('.col-entries');
    const colS=rowFrag.querySelector('.col-exits');
    ['entrada','saida'].forEach(tipo=>{
      const alvo=tipo==='entrada'?colE:colS;
      const lista=agrupado[chave][tipo].sort((a,b)=>a.time.localeCompare(b.time)).slice(0,2);
      const labels=tipo==='entrada'?['E1','E2']:['S1','S2'];
      labels.forEach((lab,i)=>{
        const slot=lista[i];
        const frag=refs.tplSlot.content.cloneNode(true);
        const slotDiv=frag.querySelector('.time-slot');
        if(slot){
          slotDiv.dataset.id=slot.id;
          frag.querySelector('.label').textContent=lab;
          const t=frag.querySelector('.time');
          t.textContent=slot.time;
          t.dataset.id=slot.id;
          t.dataset.time=slot.time;
          const btnView=frag.querySelector('[data-action="view-proof"]');
          const btnAttach=frag.querySelector('[data-action="attach-proof"]');
          const btnRemove=frag.querySelector('[data-action="remove-proof"]');
          if(slot.comprovante){
            btnView.dataset.url=slot.comprovante;
            btnAttach.classList.add('hidden');
          }else{
            btnView.classList.add('hidden');
            btnRemove.classList.add('hidden');
          }
        }else{
          slotDiv.dataset.id=`${chave}#${lab}`;
          frag.querySelector('.label').textContent=lab;
          const t=frag.querySelector('.time');
          t.textContent='--:--';
          frag.querySelectorAll('button').forEach(b=>b.classList.add('hidden'));
        }
        alvo.appendChild(frag);
      });
    });
    refs.reportBody.appendChild(rowFrag);
  });
}

// Resolve id real a partir de chave data#hora
function resolverIdPorDataHora(chave){
  const [data, hora] = chave.split('#');
  const bucket = estado.ultimoAgrupamento[data];
  if(!bucket) return null;
  const todos=[...bucket.entrada,...bucket.saida];
  const achado=todos.find(s=>s.time===hora);
  return achado ? achado.id : null;
}

// Abre modal de edição de horário
function abrirModalEdicao(id, time){
  estado.editando=id;
  refs.editModalTime.value=time;
  refs.editModal.classList.add('visible');
}

// Salva o horário editado
async function salvarEdicaoHora(){
  const time=refs.editModalTime.value;
  const id=estado.editando;
  refs.editModal.classList.remove('visible');
  estado.editando=null;
  if(id && time){
    try{
      await editarBatida(id, time);
    }catch(err){
      console.error(err);
    }
  }
}

// Fecha modal de edição sem salvar
function fecharModalEdicao(){
  estado.editando=null;
  refs.editModal.classList.remove('visible');
}

// Exibe modal de confirmação
function mostrarConfirmacao(msg, onConfirm){
  refs.confirmMessage.textContent=msg;
  estado.confirmar=onConfirm;
  refs.confirmModal.classList.add('visible');
}

// Executa ação confirmada
async function confirmarAcao(){
  try{
    if(typeof estado.confirmar==='function') await estado.confirmar();
  }catch(err){
    console.error(err);
  }finally{
    estado.confirmar=null;
    refs.confirmModal.classList.remove('visible');
  }
}

// Cancela confirmação
function cancelarConfirmacao(){
  estado.confirmar=null;
  refs.confirmModal.classList.remove('visible');
}

// Trata ações da lista de hoje
function handleAcaoHoje(e){
  const btn=e.target.closest('[data-action]');
  if(!btn) return;
  const item=btn.closest('.entry-item');
  const id=item.dataset.id;
  const acao=btn.dataset.action;
  if(acao==='edit-entry'){
    const time=item.querySelector('.entry-time').textContent;
    abrirModalEdicao(id, time);
  }else if(acao==='delete-entry'){
    mostrarConfirmacao('Excluir esta batida?', ()=>excluirBatida(id));
  }else if(acao==='attach-proof'){
    refs.fileInputList.dataset.targetId=id;
    refs.fileInputList.click();
  }else if(acao==='remove-proof'){
    mostrarConfirmacao('Remover comprovante?', ()=>removerComprovante(id));
  }else if(acao==='view-proof'){
    visualizarComprovante(btn.dataset.url);
  }
}

// Trata ações do relatório
function handleAcaoRelatorio(e){
  const btn=e.target.closest('[data-action]');
  if(!btn) return;
  const slot=btn.closest('.time-slot');
  let id=slot.dataset.id;
  if(id.includes('#')) id=resolverIdPorDataHora(id);
  const acao=btn.dataset.action;
  const hora=slot.querySelector('.time').dataset.time;
  if(acao==='edit-entry') abrirModalEdicao(id, hora);
  else if(acao==='delete-entry') mostrarConfirmacao('Excluir esta batida?', ()=>excluirBatida(id));
  else if(acao==='attach-proof'){ refs.fileInputList.dataset.targetId=id; refs.fileInputList.click(); }
  else if(acao==='remove-proof') mostrarConfirmacao('Remover comprovante?', ()=>removerComprovante(id));
  else if(acao==='view-proof') visualizarComprovante(btn.dataset.url);
}

// Atualiza nome do arquivo no formulário principal
function aoSelecionarArquivoPrincipal(){
  const file=refs.fileInputMain.files[0];
  refs.fileNameDisplay.textContent=file?file.name:'';
}

// Anexa comprovante selecionado na lista
function aoSelecionarArquivoLista(){
  const file=refs.fileInputList.files[0];
  const id=refs.fileInputList.dataset.targetId;
  if(file && id) anexarComprovante(id, file);
  refs.fileInputList.value='';
  delete refs.fileInputList.dataset.targetId;
}

// Define hora atual no input
function definirHoraAtual(){
  const d=new Date();
  refs.timeInput.value=`${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Preenche selects de mês e ano
function preencherFiltrosRelatorio(){
  for(let m=1;m<=12;m++){
    const opt=document.createElement('option');
    opt.value=m; opt.textContent=pad(m);
    refs.reportMonth.appendChild(opt);
  }
  const anoAtual=new Date().getFullYear();
  for(let a=anoAtual-5;a<=anoAtual;a++){
    const opt=document.createElement('option');
    opt.value=a; opt.textContent=a;
    refs.reportYear.appendChild(opt);
  }
  refs.reportMonth.value=new Date().getMonth()+1;
  refs.reportYear.value=anoAtual;
}

// Liga todos os eventos da interface
function ligarEventos(){
  refs.sidebarToggle.addEventListener('click', ()=>refs.sidebar.classList.toggle('collapsed'));
  refs.themeBtn.addEventListener('click', ()=>aplicarTema(refs.body.classList.contains('dark-theme')?'light-theme':'dark-theme'));
  refs.navLinks.forEach(l=>l.addEventListener('click', e=>{
    e.preventDefault();
    refs.navLinks.forEach(n=>n.classList.remove('active'));
    l.classList.add('active');
    refs.views.forEach(v=>v.classList.remove('active'));
    qs(`#${l.dataset.view}-view`).classList.add('active');
    if(l.dataset.view==='relatorio') renderRelatorio();
  }));
  refs.addEntryBtn.addEventListener('click', ()=>{
    const time=refs.timeInput.value;
    const file=refs.fileInputMain.files[0]||null;
    baterPonto({time,file});
    refs.fileInputMain.value='';
    refs.fileNameDisplay.textContent='';
  });
  refs.fileInputMain.addEventListener('change', aoSelecionarArquivoPrincipal);
  refs.todayList.addEventListener('click', handleAcaoHoje);
  refs.fileInputList.addEventListener('change', aoSelecionarArquivoLista);
  refs.editModalSave.addEventListener('click', salvarEdicaoHora);
  refs.editModalCancel.addEventListener('click', fecharModalEdicao);
  refs.confirmConfirm.addEventListener('click', confirmarAcao);
  refs.confirmCancel.addEventListener('click', cancelarConfirmacao);
  refs.reportRefresh.addEventListener('click', renderRelatorio);
  refs.reportMonth.addEventListener('change', renderRelatorio);
  refs.reportYear.addEventListener('change', renderRelatorio);
  refs.reportBody.addEventListener('click', handleAcaoRelatorio);
  refs.authLogin.addEventListener('click', e=>{
    e.preventDefault();
    login(refs.authEmail.value, refs.authPass.value).catch(err=>refs.authMsg.textContent=err.message);
  });
  refs.authRegister.addEventListener('click', e=>{
    e.preventDefault();
    registrar(refs.authEmail.value.split('@')[0]||'Usuário', refs.authEmail.value, refs.authPass.value).catch(err=>refs.authMsg.textContent=err.message);
  });
}

// Inicializa a aplicação
async function iniciarApp(){
  capturarRefs();
  ligarEventos();
  preencherFiltrosRelatorio();
  definirHoraAtual();
  aplicarTema(localStorage.getItem('theme')||'dark-theme');
  if(exigirLogin()) await carregarHoje();
}

document.addEventListener('DOMContentLoaded', iniciarApp);
