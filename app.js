
/* POC: Delegado -> Reportes en su colonia asignada (v2)
   Cambios:
   - Polígonos de colonias con color de relleno uniforme; la colonia seleccionada se resalta.
   - Arreglo: Leaflet iniciaba en contenedor oculto (Dashboard); ahora al abrir la pestaña "Mapa"
     se hace map.invalidateSize() y se enfoca Pachuca/colonia.
*/
const STATE = {
  map: null,
  layers: {
    colonias: null,
    irregular: null,
    reports: L.layerGroup(),
    highlight: null,
  },
  data: {
    colonias: null,
    coloniasIndexByName: new Map(),
    irregular: null,
  },
  users: {},
  currentUser: null,
  assignedFeature: null,
  reports: [],
};

const THEMES = {
  "Banquetas": {
    color: "#e11d48",
    variables: {
      "Existencia": ["No hay","Sí hay en malas condiciones","Sí hay en pésimas condiciones","Hacen falta"],
      "Accesibilidad": ["Sin rampas","Rampas dañadas","Rampas funcionales"]
    }
  },
  "Alumbrado público": {
    color: "#0ea5e9",
    variables: {
      "Funcionamiento": ["Apagado","Intermitente","Encendido insuficiente"],
      "Postes": ["No hay","Dañados","Robados"]
    }
  },
  "Seguridad vial": {
    color: "#22c55e",
    variables: {
      "Señalética": ["Ausente","Dañada","Confusa"],
      "Cruces peatonales": ["No hay","Desgastados","Peligrosos"]
    }
  },
  "Limpieza y residuos": {
    color: "#a855f7",
    variables: {
      "Contenedores": ["Insuficientes","Dañados","Inexistentes"],
      "Acumulación": ["Poca","Moderada","Alta"]
    }
  }
};

// Helpers
const STORAGE_KEY = "pdc_delegados_reports_v1";
function loadReports(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    STATE.reports = raw ? JSON.parse(raw) : [];
  }catch(e){ STATE.reports = []; }
}
function saveReports(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE.reports)); }
function toast(msg){
  const t = document.querySelector(".toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), 2800);
}
function byId(id){ return document.getElementById(id); }
function fmtDate(ts){ return new Date(ts).toLocaleString(); }

// Map init
function initMap(){
  STATE.map = L.map('map').setView([20.119, -98.734], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(STATE.map);
  STATE.layers.reports.addTo(STATE.map);
}

// Load GeoJSONs
async function loadGeo(){
  const [colResp, irrResp] = await Promise.all([
    fetch('data/col_pachuca.json'),
    fetch('data/col_irreg.json')
  ]);
  STATE.data.colonias = await colResp.json();
  try { STATE.data.irregular = await irrResp.json(); } catch(e){ STATE.data.irregular = null; }

  // Index colonias by name
  if(STATE.data.colonias && STATE.data.colonias.features){
    STATE.data.colonias.features.forEach((f, idx) => {
      const name = (f.properties?.NOMBRE || "").trim();
      if(name) STATE.data.coloniasIndexByName.set(name, idx);
    });
  }

  // Render layers (todas con estilo uniforme)
  const styleBase = { color:"#9ca3af", weight:1, fillColor:"#c7d2fe", fillOpacity:0.25 };
  STATE.layers.colonias = L.geoJSON(STATE.data.colonias, {
    style: styleBase,
    onEachFeature: (feature, layer) => {
      const colName = feature.properties?.NOMBRE || "Colonia";
      layer.bindTooltip(colName, {sticky:true});
      layer.on('click', () => {
        byId('filterColonia').value = colName;
        focusColonia(colName);
      });
      layer.on('mouseover', () => layer.setStyle({weight:2}));
      layer.on('mouseout',  () => layer.setStyle({weight:1}));
    }
  }).addTo(STATE.map);

  // Opcional irregular
  if(STATE.data.irregular && STATE.data.irregular.features && STATE.data.irregular.features.length){
    STATE.layers.irregular = L.geoJSON(STATE.data.irregular, {style:{color:"#f59e0b",weight:1,fillOpacity:0.04}});
    // .addTo(STATE.map);
  }

  // Ajuste inicial de vista (aunque esté oculto, centraremos después al mostrar pestaña)
  STATE.map.fitBounds(STATE.layers.colonias.getBounds());

  // Populate colonia select
  const sel = byId('filterColonia');
  sel.innerHTML = '<option value="">— Todas —</option>';
  const names = Array.from(STATE.data.coloniasIndexByName.keys()).sort((a,b)=>a.localeCompare(b,'es'));
  for(const n of names){
    const opt = document.createElement('option'); opt.value=n; opt.textContent=n; sel.appendChild(opt);
  }

  // Usuarios demo
  const pick = (i) => names[Math.min(i, names.length-1)];
  STATE.users = {
    "ana":    { password:"demo", nombre:"Ana",    colonia: pick(0) },
    "bruno":  { password:"demo", nombre:"Bruno",  colonia: pick(50) },
    "carla":  { password:"demo", nombre:"Carla",  colonia: pick(100) },
    "diego":  { password:"demo", nombre:"Diego",  colonia: pick(150) },
  };
  document.querySelector("#demoCreds").innerHTML =
    `<div class="help">Usuarios demo: <code>ana</code>, <code>bruno</code>, <code>carla</code>, <code>diego</code>. Contraseña: <code>demo</code>.</div>`;

  // Render reports existentes
  renderReportsOnMap();
  refreshDashboard();
}

// Resalta/enfoca colonia
function focusColonia(name){
  clearColoniaHighlight();
  if(!name){
    STATE.map.fitBounds(STATE.layers.colonias.getBounds());
    return;
  }
  const idx = STATE.data.coloniasIndexByName.get(name);
  if(idx==null) return;
  const feature = STATE.data.colonias.features[idx];
  // Capa de realce (relleno/contorno distinto)
  STATE.layers.highlight = L.geoJSON(feature, {
    style:{ color:"#1f2937", weight:3, fillColor:"#3b82f6", fillOpacity:.18 }
  }).addTo(STATE.map);
  STATE.layers.highlight._isHighlight = true;
  STATE.map.fitBounds(STATE.layers.highlight.getBounds(), {maxZoom:16});
}

function clearColoniaHighlight(){
  if(STATE.layers.highlight){
    STATE.map.removeLayer(STATE.layers.highlight);
    STATE.layers.highlight = null;
  }
}

// Verifica si el click está dentro de la colonia asignada
function isInsideAssigned(latlng){
  if(!STATE.currentUser || !STATE.assignedFeature) return false;
  const pt = turf.point([latlng.lng, latlng.lat]);
  return turf.booleanPointInPolygon(pt, STATE.assignedFeature);
}

// Prepara UI e interacciones
function setupUI(){
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(t=>t.addEventListener("click", ()=>{
    tabs.forEach(x=>x.classList.remove("active"));
    t.classList.add("active");
    const target = t.dataset.target;
    document.querySelectorAll(".view").forEach(v=>v.style.display="none");
    document.getElementById(target).style.display = "block";

    // FIX: Cuando la pestaña Mapa se hace visible, invalidar tamaño y centrar Pachuca
    if(target === "viewMapa"){
      setTimeout(()=>{
        STATE.map.invalidateSize();
        if(STATE.layers.colonias){
          const col = byId('filterColonia').value;
          if(col) focusColonia(col);
          else STATE.map.fitBounds(STATE.layers.colonias.getBounds());
        }
      }, 50);
    }
  }));

  // Por defecto Dashboard visible
  document.querySelector('.tab[data-target="viewDashboard"]').classList.add('active');
  byId('viewDashboard').style.display='block';

  // Filtros
  byId('filterColonia').addEventListener('change', e=>{ focusColonia(e.target.value); });
  byId('toggleMine').addEventListener('change', e=>{
    if(e.target.checked && STATE.currentUser){
      focusColonia(STATE.currentUser.colonia);
      byId('filterColonia').value = STATE.currentUser.colonia;
    }
  });

  // Click en mapa -> formulario de reporte (si es dentro de colonia asignada)
  STATE.map.on('click', (ev)=>{
    if(!STATE.currentUser){ toast("Inicia sesión para reportar."); return; }
    const latlng = ev.latlng;
    if(!isInsideAssigned(latlng)){ toast("Solo puedes reportar dentro de tu colonia asignada."); return; }
    openReportForm(latlng);
  });

  // Catálogo tema/variable/estado
  const selTema = byId('tema');
  selTema.innerHTML = `<option value="">Selecciona un tema…</option>`;
  Object.keys(THEMES).forEach(t=>{
    const o=document.createElement('option'); o.value=t; o.textContent=t; selTema.appendChild(o);
  });
  selTema.addEventListener('change', e=>{
    const tema = e.target.value;
    const selVar = byId('variable');
    const selEstado = byId('estadoVar');
    selVar.innerHTML = `<option value="">Variable…</option>`;
    selEstado.innerHTML = `<option value="">Estado…</option>`;
    if(tema){
      for(const v of Object.keys(THEMES[tema].variables)){
        const o=document.createElement('option'); o.value=v; o.textContent=v; selVar.appendChild(o);
      }
    }
  });
  byId('variable').addEventListener('change', e=>{
    const tema = byId('tema').value;
    const variable = e.target.value;
    const selEstado = byId('estadoVar');
    selEstado.innerHTML = `<option value="">Estado…</option>`;
    if(tema && variable){
      for(const est of THEMES[tema].variables[variable]){
        const o=document.createElement('option'); o.value=est; o.textContent=est; selEstado.appendChild(o);
      }
    }
  });

  // Guardar reporte
  byId('saveReport').addEventListener('click', ()=>{
    const tema = byId('tema').value;
    const variable = byId('variable').value;
    const estadoVar = byId('estadoVar').value;
    const comentario = byId('comentario').value.trim();
    const lat = parseFloat(byId('lat').value);
    const lng = parseFloat(byId('lng').value);
    const fotosInput = byId('fotos');
    if(!tema || !variable || !estadoVar){
      toast("Completa tema, variable y estado."); return;
    }
    const id = "r_" + Date.now();
    const fotos = [];
    const files = fotosInput.files || [];
    const readPromises = [];
    for(const f of files){
      readPromises.push(new Promise(res=>{
        const reader=new FileReader(); reader.onload = () => res(reader.result); reader.readAsDataURL(f);
      }));
    }
    Promise.all(readPromises).then(results=>{
      fotos.push(...results);
      const report = {
        id, user: STATE.currentUser.username, userNombre: STATE.currentUser.nombre,
        colonia: STATE.currentUser.colonia, tema, variable, estadoVar, comentario,
        status: "informado", coords: {lat, lng}, fotos, ts: Date.now()
      };
      STATE.reports.push(report);
      saveReports(); addReportMarker(report); renderReportList(); refreshDashboard();
      toast("Reporte guardado."); closeReportForm();
    });
  });
  byId('cancelReport').addEventListener('click', closeReportForm);

  // Export CSV
  byId('exportCsv').addEventListener('click', ()=>{
    const headers = ["id","user","userNombre","colonia","tema","variable","estadoVar","status","lat","lng","comentario","ts"];
    const rows = [headers.join(",")];
    for(const r of STATE.reports){
      const row = [
        r.id, r.user, r.userNombre, r.colonia, r.tema, r.variable, r.estadoVar, r.status,
        r.coords.lat, r.coords.lng, JSON.stringify(r.comentario).replace(/,/g,";"), r.ts
      ].join(",");
      rows.push(row);
    }
    const blob = new Blob([rows.join("\n")], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = "reportes.csv"; a.click();
    URL.revokeObjectURL(url);
  });
}

// Formulario de reporte
function openReportForm(latlng){
  byId('lat').value = latlng.lat.toFixed(6);
  byId('lng').value = latlng.lng.toFixed(6);
  byId('reportForm').style.display = 'block';
  document.querySelector('[data-target="viewMapa"]').click(); // cambiar a Mapa
}
function closeReportForm(){
  byId('reportForm').style.display = 'none';
  byId('tema').value = ""; byId('variable').value=""; byId('estadoVar').value="";
  byId('comentario').value = ""; byId('fotos').value="";
}

// Marcadores de reportes
function addReportMarker(r){
  const color = THEMES[r.tema]?.color || "#111827";
  const marker = L.circleMarker([r.coords.lat, r.coords.lng], {radius:7, color, fillColor:color, fillOpacity:.85})
    .bindPopup(renderReportPopupHTML(r));
  marker._reportId = r.id;
  STATE.layers.reports.addLayer(marker);
}
function renderReportsOnMap(){
  STATE.layers.reports.clearLayers();
  for(const r of STATE.reports){ addReportMarker(r); }
  renderReportList();
  updateChoropleth();
}
function renderReportPopupHTML(r){
  const imgs = (r.fotos||[]).slice(0,3).map(src=>`<img src="${src}" alt="foto" style="width:64px;height:64px;object-fit:cover;border-radius:.25rem;border:1px solid #e5e7eb;margin-right:.25rem" />`).join("");
  return `
    <div style="min-width:260px">
      <div class="badge-theme"><span class="dot" style="background:${THEMES[r.tema]?.color||"#111"}"></span>${r.tema} • ${r.variable}</div>
      <div style="margin:.35rem 0 .25rem 0"><strong>Estado:</strong> ${r.estadoVar}</div>
      <div style="font-size:.9rem;color:#374151">${r.comentario? r.comentario : "<em>Sin comentario</em>"}</div>
      <div style="margin:.35rem 0"><span class="status ${r.status==='informado'?'info':'done'}">${r.status.toUpperCase()}</span> · <small>${fmtDate(r.ts)}</small></div>
      <div style="display:flex;gap:.25rem;margin:.25rem 0">${imgs}</div>
      <div style="display:flex;gap:.4rem;margin-top:.35rem">
        ${r.status==='informado' ? `<button class="btn primary" onclick="markAsAtendido('${r.id}')">Marcar como atendido</button>` : ''}
        <button class="btn ghost" onclick="deleteReport('${r.id}')">Eliminar</button>
      </div>
    </div>`;
}
window.markAsAtendido = function(id){
  const r = STATE.reports.find(x=>x.id===id); if(!r) return;
  r.status = "atendido"; saveReports(); renderReportsOnMap(); refreshDashboard(); toast("Reporte marcado como atendido.");
}
window.deleteReport = function(id){
  STATE.reports = STATE.reports.filter(x=>x.id!==id);
  saveReports(); renderReportsOnMap(); refreshDashboard(); toast("Reporte eliminado.");
}

// Listado lateral
function renderReportList(){
  const list = byId('reportList');
  list.innerHTML = "";
  const filtered = STATE.reports.filter(r => !STATE.currentUser || r.colonia===STATE.currentUser.colonia);
  for(const r of filtered.slice().sort((a,b)=>b.ts-a.ts)){
    const div = document.createElement('div');
    div.className = "report-item";
    div.innerHTML = `<strong>${r.tema}</strong> · ${r.variable} → <em>${r.estadoVar}</em><br>
                     <small>${r.colonia}</small> · <span class="status ${r.status==='informado'?'info':'done'}">${r.status}</span> · <small>${fmtDate(r.ts)}</small>`;
    list.appendChild(div);
  }
}

// Dashboard
let chartRef = null;
function refreshDashboard(){
  const mine = STATE.currentUser ? STATE.reports.filter(r=>r.user===STATE.currentUser.username) : STATE.reports;
  const total = mine.length;
  const atendidos = mine.filter(r=>r.status==='atendido').length;
  const informados = mine.filter(r=>r.status==='informado').length;
  const unicosTemas = new Set(mine.map(r=>r.tema)).size;
  byId('k_total').textContent = total;
  byId('k_info').textContent = informados;
  byId('k_done').textContent = atendidos;
  byId('k_topics').textContent = unicosTemas;

  const counts = {};
  for(const r of mine){ counts[r.tema] = (counts[r.tema]||0)+1; }
  const labels = Object.keys(counts);
  const values = labels.map(k=>counts[k]);
  const colors = labels.map(k=>THEMES[k]?.color || "#111827");
  const ctx = document.getElementById('chartTema').getContext('2d');
  if(chartRef){ chartRef.destroy(); }
  chartRef = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Reportes por tema', data: values, backgroundColor: colors }]},
    options: { responsive:true, scales:{ y:{ beginAtZero:true } } }
  });

  updateChoropleth();
}

// Choropleth (desactivado: estilo uniforme)
function updateChoropleth(){
  if(!STATE.layers.colonias) return;
  // Estilo base uniforme (sin sombrear por conteo)
  STATE.layers.colonias.setStyle({ color:"#9ca3af", weight:1, fillColor:"#c7d2fe", fillOpacity:0.25 });
}

// LOGIN
function setupLogin(){
  const form = byId('loginForm');
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const u = byId('username').value.trim().toLowerCase();
    const p = byId('password').value;
    const user = STATE.users[u];
    if(!user || user.password !== p){
      toast("Usuario o contraseña inválidos."); return;
    }
    STATE.currentUser = { username:u, ...user };
    // Find assigned feature
    const idx = STATE.data.coloniasIndexByName.get(user.colonia);
    STATE.assignedFeature = STATE.data.colonias.features[idx];
    // Greeting
    byId('loginModal').style.display='none';
    byId('welcomeBox').innerHTML = `Bienvenido/a, <strong>${user.nombre}</strong>. Tu colonia asignada es <strong>${user.colonia}</strong>. 
      Usa el mapa para hacer clic dentro de tu colonia y generar reportes. Solo podrás reportar dentro de tu polígono.`;
    byId('welcomeBox').style.display='block';
    byId('userPill').textContent = `${user.nombre} · ${user.colonia}`;
    // Default to "Solo mi colonia"
    byId('toggleMine').checked = true;
    byId('filterColonia').value = user.colonia;
    focusColonia(user.colonia);
    // Asegurar render correcto si la pestaña Mapa está abierta
    setTimeout(()=>{ STATE.map.invalidateSize(); }, 50);
  });
}

// Leyenda
function renderLegend(){
  const box = byId('legendBox');
  box.innerHTML = "";
  for(const [tema, cfg] of Object.entries(THEMES)){
    const row = document.createElement('div');
    row.className="row";
    row.innerHTML = `<span class="swatch" style="background:${cfg.color}"></span> ${tema}`;
    box.appendChild(row);
  }
  const row2 = document.createElement('div');
  row2.className="row";
  row2.innerHTML = `<span class="swatch" style="background:#3b82f6"></span> Colonia seleccionada`;
  box.appendChild(row2);
}

document.addEventListener('DOMContentLoaded', async ()=>{
  initMap();
  setupUI();
  setupLogin();
  renderLegend();
  loadReports();
  await loadGeo();
});
