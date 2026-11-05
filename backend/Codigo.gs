/* ==================================================================
   ESPECIALISTAS — MS Universe · Dr. Miguel Soto
   Backend (Apps Script, cuenta miguelsotouniverse@gmail.com)

   Padrón de especialistas a recomendar, referencias enviadas a
   pacientes (con seguimiento preoperatorio) y pacientes recibidos
   de esos especialistas.

   Propiedades del script (Configuración del proyecto → Propiedades):
     CLIENT_ID        cliente OAuth del ecosistema (lo pone configurar())
     AUTORIZADOS      correos separados por coma (lo siembra configurar())
     HOJA_BASE_DATOS  ID del libro "Base de Datos" de pacientes
     LIBRO_ID         ID del libro EspecialistasDB (lo crea configurar())

   Primera vez: correr configurar() desde el editor, autorizar, y
   publicar como App web (Ejecutar como: yo · Acceso: Cualquiera).
   Ética: este sistema NO registra comisiones ni pagos por referencia.
   ================================================================== */

var VERSION = '1.0';

var DEF = {
  CLIENT_ID: '634352012698-b47t3ed3tvd4d1g7l30l68bd6e5s0ri4.apps.googleusercontent.com',
  HOJA_BASE_DATOS: '1y8go-wAMK_mCp59oQJ5TwsrvcdtfsxWAPo19H_1Mk1Q',
  PESTANA_BD: 'Base Datos',
  AUTORIZADOS: [
    'miguelsotomd@gmail.com', 'miguelitosotomd@gmail.com', 'miguelsotouniverse@gmail.com',
    'workspacemiguelsoto@gmail.com', 'sotoagenda@gmail.com', 'medicosmiguelsotomd@gmail.com'
  ].join(',')
};

var ESQUEMA = {
  Especialistas: ['Esp_ID','Activo','Tratamiento','Nombre','Especialidad','Subespecialidad',
    'Cedula_Profesional','Cedula_Especialidad','Consejo','Cedula_Verificada','Verificada_Por',
    'Verificada_El','Sede','Direccion','Zona','Telefono','WhatsApp','Correo','Web',
    'Honorario_Consulta','Seguros','Horario','Notas_Paciente','Notas_Internas',
    'Alta_Por','Alta_El','Actualizado_Por','Actualizado_El'],
  Referencias: ['Folio','Fecha','Creada_Por','ID_BD','Paciente_ID','Paciente','Telefono',
    'Esp_ID','Especialista','Especialidad','Motivo','Requisito_Preop','Fecha_Cirugia','Notas',
    'Estado','Fecha_Cita','Valoracion_Recibida_El','Calificacion','Comentario',
    'Actualizado_Por','Actualizado_El'],
  Recibidas: ['Folio','Fecha','Registrada_Por','Esp_ID','Especialista','ID_BD','Paciente',
    'Telefono','Interes','Notas'],
  Catalogos: ['Catalogo','Valor','Orden'],
  Bitacora: ['Fecha','Usuario','Accion','Detalle']
};

var CATALOGOS = {
  Especialidad: ['Medicina interna','Cardiología','Bariatría / control de peso','Cirugía bariátrica',
    'Endocrinología','Nutrición','Hematología','Neumología','Psiquiatría','Psicología',
    'Ginecología','Urología','Dermatología','Otorrinolaringología','Oftalmología',
    'Cirugía maxilofacial','Ortodoncia','Medicina del deporte','Fisioterapia / drenaje linfático',
    'Anestesiología','Radiología / imagen','Laboratorio clínico','Oncología','Otra'],
  Motivo: ['Valoración preoperatoria','Valoración cardiológica preoperatoria','Control de peso antes de cirugía',
    'Control metabólico (glucosa / tiroides)','Valoración psicológica','Valoración de vía aérea / nasal',
    'Estudios de imagen','Tratamiento complementario','Problema ajeno a cirugía plástica','Otro'],
  Estado: ['Enviada','Agendó','Acudió','Valoración recibida','No acudió','Cancelada']
};

var ESTADOS_ABIERTOS = { 'Enviada': 1, 'Agendó': 1, 'Acudió': 1 };

/* ------------------------------------------------------------------
   ENTRADA
   ------------------------------------------------------------------ */
function doGet(){
  return json_({ ok: true, servicio: 'Especialistas', version: VERSION,
                 nota: 'Este servicio solo responde por POST.' });
}

function doPost(e){
  var cuerpo;
  try { cuerpo = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ error: 'Petición mal formada.' }); }
  try {
    var u = autenticar_(cuerpo.credential);
    var f = ACCIONES[cuerpo.accion];
    if (!f) return json_({ error: 'Acción desconocida: ' + cuerpo.accion });
    return json_(f(cuerpo, u));
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

var ACCIONES = {
  sesion: function(c, u){
    return { ok: true, correo: u.correo, nombre: u.nombre, catalogos: catalogos_(), version: VERSION };
  },
  listarEspecialistas: function(c, u){ return { ok: true, especialistas: especialistasConMetricas_() }; },
  guardarEspecialista: function(c, u){ return guardarEspecialista_(c.especialista || {}, u); },
  buscarPaciente: function(c, u){ return { ok: true, pacientes: buscarPaciente_(c.q) }; },
  crearReferencia: function(c, u){ return crearReferencia_(c.referencia || {}, u); },
  listarReferencias: function(c, u){ return { ok: true, referencias: filas_('Referencias').reverse() }; },
  actualizarReferencia: function(c, u){ return actualizarReferencia_(c.folio, c.cambios || {}, u); },
  registrarRecibida: function(c, u){ return registrarRecibida_(c.recibida || {}, u); },
  listarRecibidas: function(c, u){ return { ok: true, recibidas: filas_('Recibidas').reverse() }; },
  agregarCatalogo: function(c, u){ return agregarCatalogo_(c.catalogo, c.valor, u); }
};

/* ------------------------------------------------------------------
   IDENTIDAD — ID token de Google verificado contra Google,
   audiencia = nuestro cliente, correo en la lista de autorizados.
   ------------------------------------------------------------------ */
function autenticar_(cred){
  if (!cred) throw new Error('Falta identificarse con Google.');
  var cache = CacheService.getScriptCache();
  var clave = 'tok_' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, cred)).slice(0, 40);
  var guardado = cache.get(clave);
  var info;
  if (guardado) info = JSON.parse(guardado);
  else {
    var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred),
                              { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('La sesión expiró. Vuelva a identificarse.');
    info = JSON.parse(r.getContentText());
    if (info.aud !== prop_('CLIENT_ID')) throw new Error('Credencial no emitida para esta aplicación.');
    if (String(info.email_verified) !== 'true') throw new Error('Correo de Google no verificado.');
    var resta = Number(info.exp) - Math.floor(Date.now() / 1000);
    if (resta > 60) cache.put(clave, JSON.stringify({ email: info.email, name: info.name || '' }),
                              Math.min(resta - 30, 3000));
  }
  var correo = String(info.email || '').toLowerCase();
  var lista = prop_('AUTORIZADOS').toLowerCase().split(/[\s,;]+/).filter(String);
  if (lista.indexOf(correo) < 0) throw new Error('La cuenta ' + correo + ' no tiene acceso a Especialistas.');
  return { correo: correo, nombre: info.name || info.email || correo };
}

/* ------------------------------------------------------------------
   ESPECIALISTAS
   ------------------------------------------------------------------ */
function especialistasConMetricas_(){
  var esp = filas_('Especialistas');
  var refs = filas_('Referencias');
  var rec = filas_('Recibidas');
  var m = {};
  esp.forEach(function(e){ m[e.Esp_ID] = { enviadas: 0, acudieron: 0, abiertas: 0, recibidas: 0, sumaCal: 0, nCal: 0 }; });
  refs.forEach(function(r){
    var x = m[r.Esp_ID]; if (!x) return;
    x.enviadas++;
    if (r.Estado === 'Acudió' || r.Estado === 'Valoración recibida') x.acudieron++;
    if (ESTADOS_ABIERTOS[r.Estado]) x.abiertas++;
    var cal = Number(r.Calificacion);
    if (cal >= 1 && cal <= 5) { x.sumaCal += cal; x.nCal++; }
  });
  rec.forEach(function(r){ var x = m[r.Esp_ID]; if (x) x.recibidas++; });
  return esp.map(function(e){
    var x = m[e.Esp_ID];
    e.metricas = { enviadas: x.enviadas, acudieron: x.acudieron, abiertas: x.abiertas, recibidas: x.recibidas,
                   calificacion: x.nCal ? Math.round(x.sumaCal / x.nCal * 10) / 10 : null, nCalificaciones: x.nCal };
    return e;
  });
}

function guardarEspecialista_(d, u){
  if (!limpia_(d.Nombre)) throw new Error('Falta el nombre del especialista.');
  if (!limpia_(d.Especialidad)) throw new Error('Falta la especialidad.');
  var permitidas = ESQUEMA.Especialistas.filter(function(c){
    return ['Esp_ID','Alta_Por','Alta_El','Actualizado_Por','Actualizado_El','Verificada_Por','Verificada_El'].indexOf(c) < 0;
  });
  return conCandado_(function(){
    var h = hoja_('Especialistas');
    var ahora = ahora_();
    var limpio = {};
    permitidas.forEach(function(c){ if (d.hasOwnProperty(c)) limpio[c] = limpia_(d[c]); });
    if (limpio.Activo === undefined || limpio.Activo === '') limpio.Activo = 'Sí';
    if (d.Esp_ID){
      var fila = buscaFila_(h, 'Esp_ID', d.Esp_ID);
      if (!fila) throw new Error('No encontré al especialista ' + d.Esp_ID + '.');
      var previo = leeFila_(h, fila);
      if (limpio.Cedula_Verificada === 'Sí' && previo.Cedula_Verificada !== 'Sí'){
        limpio.Verificada_Por = u.correo; limpio.Verificada_El = ahora;
      }
      limpio.Actualizado_Por = u.correo; limpio.Actualizado_El = ahora;
      escribeFila_(h, fila, limpio);
      bitacora_(u, 'editarEspecialista', d.Esp_ID + ' ' + limpio.Nombre);
      return { ok: true, Esp_ID: d.Esp_ID };
    }
    var id = siguienteFolio_('ESP');
    limpio.Esp_ID = id;
    limpio.Alta_Por = u.correo; limpio.Alta_El = ahora;
    if (limpio.Cedula_Verificada === 'Sí'){ limpio.Verificada_Por = u.correo; limpio.Verificada_El = ahora; }
    agregaFila_(h, limpio);
    if (limpio.Especialidad && catalogos_().Especialidad.indexOf(limpio.Especialidad) < 0)
      agregaCatalogoSinCandado_('Especialidad', limpio.Especialidad);
    bitacora_(u, 'altaEspecialista', id + ' ' + limpio.Nombre);
    return { ok: true, Esp_ID: id };
  });
}

/* ------------------------------------------------------------------
   PACIENTES — lectura de la Base de Datos del consultorio.
   Solo se leen las columnas necesarias; nunca se escribe ahí.
   ------------------------------------------------------------------ */
function columnasBD_(h){
  var enc = h.getRange(1, 1, 1, h.getLastColumn()).getDisplayValues()[0];
  var norm = enc.map(function(t){ return sinAcento_(t).toLowerCase().trim(); });
  function exacta(n){ var i = norm.indexOf(n); return i < 0 ? -1 : i; }
  function primera(re, excluye){
    for (var i = 0; i < norm.length; i++) if (re.test(norm[i]) && !(excluye && excluye.test(norm[i]))) return i;
    return -1;
  }
  var c = {
    id: exacta('id'),
    pacienteId: exacta('paciente_id'),
    nombre: primera(/^nombre( completo| del paciente| paciente)?$/),
    apellidos: primera(/^apellidos?$/),
    paterno: primera(/apellido paterno/),
    materno: primera(/apellido materno/),
    telNorm: exacta('telefono_norm'),
    tel: primera(/^(telefono|celular|tel|whatsapp)/, /norm|_2|2$/),
    correo: primera(/^(correo|email|e-mail)/, /limpio|estado|nota|alterno/),
    correoLimpio: exacta('correo_limpio')
  };
  if (c.nombre < 0) c.nombre = primera(/nombre/, /medico|asesor|contacto/);
  return { enc: enc, c: c };
}

function buscarPaciente_(q){
  q = sinAcento_(String(q || '')).toLowerCase().trim();
  if (q.length < 3) return [];
  var libro = SpreadsheetApp.openById(prop_('HOJA_BASE_DATOS'));
  var h = libro.getSheetByName(DEF.PESTANA_BD);
  if (!h) throw new Error('No encontré la pestaña "' + DEF.PESTANA_BD + '" en la Base de Datos.');
  var info = columnasBD_(h), c = info.c;
  var n = h.getLastRow() - 1;
  if (n < 1) return [];
  function col(i){ return i < 0 ? null : h.getRange(2, i + 1, n, 1).getDisplayValues(); }
  var cols = { id: col(c.id), pid: col(c.pacienteId), nom: col(c.nombre), ape: col(c.apellidos),
               pat: col(c.paterno), mat: col(c.materno), tn: col(c.telNorm), tel: col(c.tel),
               cor: col(c.correoLimpio >= 0 ? c.correoLimpio : c.correo) };
  function v(k, i){ return cols[k] ? String(cols[k][i][0] || '').trim() : ''; }
  var qDig = q.replace(/\D/g, '');
  var palabras = q.split(/\s+/).filter(String);
  var res = [];
  for (var i = 0; i < n && res.length < 20; i++){
    var nombre = [v('nom', i), v('ape', i), v('pat', i), v('mat', i)].filter(String).join(' ').replace(/\s+/g, ' ');
    if (!nombre) continue;
    var tel = (v('tn', i) || v('tel', i)).replace(/\D/g, '');
    var id = v('id', i).replace(/,/g, '');
    var texto = sinAcento_(nombre).toLowerCase();
    var ok = palabras.every(function(p){ return texto.indexOf(p) >= 0; });
    if (!ok && qDig.length >= 4) ok = tel.indexOf(qDig) >= 0 || id === qDig;
    if (ok) res.push({ idBD: id, pacienteId: v('pid', i), nombre: nombre, telefono: tel.slice(-10), correo: v('cor', i) });
  }
  return res;
}

/* ------------------------------------------------------------------
   REFERENCIAS
   ------------------------------------------------------------------ */
function crearReferencia_(d, u){
  if (!limpia_(d.Paciente)) throw new Error('Falta la paciente.');
  if (!d.Esp_ID) throw new Error('Falta elegir al especialista.');
  return conCandado_(function(){
    var he = hoja_('Especialistas');
    var fe = buscaFila_(he, 'Esp_ID', d.Esp_ID);
    if (!fe) throw new Error('El especialista ya no existe en el padrón.');
    var esp = leeFila_(he, fe);
    if (esp.Activo !== 'Sí') throw new Error('Ese especialista está dado de baja del padrón.');
    var folio = siguienteFolio_('REF');
    var ahora = ahora_();
    agregaFila_(hoja_('Referencias'), {
      Folio: folio, Fecha: ahora, Creada_Por: u.correo,
      ID_BD: limpia_(d.ID_BD), Paciente_ID: limpia_(d.Paciente_ID), Paciente: limpia_(d.Paciente),
      Telefono: String(d.Telefono || '').replace(/\D/g, '').slice(-10),
      Esp_ID: esp.Esp_ID, Especialista: ((esp.Tratamiento ? esp.Tratamiento + ' ' : '') + esp.Nombre).trim(),
      Especialidad: esp.Especialidad, Motivo: limpia_(d.Motivo),
      Requisito_Preop: d.Requisito_Preop === 'Sí' ? 'Sí' : 'No',
      Fecha_Cirugia: limpia_(d.Fecha_Cirugia), Notas: limpia_(d.Notas),
      Estado: 'Enviada', Actualizado_Por: u.correo, Actualizado_El: ahora
    });
    bitacora_(u, 'crearReferencia', folio + ' ' + d.Paciente + ' → ' + esp.Nombre);
    return { ok: true, Folio: folio };
  });
}

function actualizarReferencia_(folio, cambios, u){
  if (!folio) throw new Error('Falta el folio.');
  var permitidos = ['Estado','Fecha_Cita','Calificacion','Comentario','Fecha_Cirugia','Notas','Requisito_Preop'];
  return conCandado_(function(){
    var h = hoja_('Referencias');
    var fila = buscaFila_(h, 'Folio', folio);
    if (!fila) throw new Error('No encontré la referencia ' + folio + '.');
    var previo = leeFila_(h, fila);
    var limpio = {};
    permitidos.forEach(function(c){ if (cambios.hasOwnProperty(c)) limpio[c] = limpia_(cambios[c]); });
    if (limpio.Estado && CATALOGOS.Estado.indexOf(limpio.Estado) < 0) throw new Error('Estado no válido.');
    if (limpio.Calificacion && !/^[1-5]$/.test(limpio.Calificacion)) throw new Error('La calificación va de 1 a 5.');
    if (limpio.Estado === 'Valoración recibida' && previo.Estado !== 'Valoración recibida')
      limpio.Valoracion_Recibida_El = ahora_();
    limpio.Actualizado_Por = u.correo; limpio.Actualizado_El = ahora_();
    escribeFila_(h, fila, limpio);
    bitacora_(u, 'actualizarReferencia', folio + ' ' + JSON.stringify(cambios));
    return { ok: true };
  });
}

function registrarRecibida_(d, u){
  if (!d.Esp_ID) throw new Error('Falta el especialista que refirió.');
  if (!limpia_(d.Paciente)) throw new Error('Falta el nombre de la paciente.');
  return conCandado_(function(){
    var he = hoja_('Especialistas');
    var fe = buscaFila_(he, 'Esp_ID', d.Esp_ID);
    if (!fe) throw new Error('El especialista no existe en el padrón.');
    var esp = leeFila_(he, fe);
    var folio = siguienteFolio_('RCB');
    agregaFila_(hoja_('Recibidas'), {
      Folio: folio, Fecha: ahora_(), Registrada_Por: u.correo, Esp_ID: esp.Esp_ID,
      Especialista: ((esp.Tratamiento ? esp.Tratamiento + ' ' : '') + esp.Nombre).trim(),
      ID_BD: limpia_(d.ID_BD), Paciente: limpia_(d.Paciente),
      Telefono: String(d.Telefono || '').replace(/\D/g, '').slice(-10),
      Interes: limpia_(d.Interes), Notas: limpia_(d.Notas)
    });
    bitacora_(u, 'registrarRecibida', folio + ' ' + d.Paciente + ' ← ' + esp.Nombre);
    return { ok: true, Folio: folio };
  });
}

/* ------------------------------------------------------------------
   CATÁLOGOS
   ------------------------------------------------------------------ */
function catalogos_(){
  var out = {};
  Object.keys(CATALOGOS).forEach(function(k){ out[k] = []; });
  filas_('Catalogos')
    .sort(function(a, b){ return Number(a.Orden) - Number(b.Orden); })
    .forEach(function(r){ if (!out[r.Catalogo]) out[r.Catalogo] = []; out[r.Catalogo].push(r.Valor); });
  out.Estado = CATALOGOS.Estado.slice();
  return out;
}

function agregarCatalogo_(cat, valor, u){
  valor = limpia_(valor);
  if (['Especialidad','Motivo'].indexOf(cat) < 0) throw new Error('Catálogo no editable.');
  if (!valor) throw new Error('Falta el valor.');
  return conCandado_(function(){
    agregaCatalogoSinCandado_(cat, valor);
    bitacora_(u, 'agregarCatalogo', cat + ': ' + valor);
    return { ok: true, catalogos: catalogos_() };
  });
}

function agregaCatalogoSinCandado_(cat, valor){
  var ya = filas_('Catalogos').some(function(r){ return r.Catalogo === cat && r.Valor === valor; });
  if (ya) return;
  var n = filas_('Catalogos').filter(function(r){ return r.Catalogo === cat; }).length;
  agregaFila_(hoja_('Catalogos'), { Catalogo: cat, Valor: valor, Orden: (n + 1) * 10 });
}

/* ------------------------------------------------------------------
   CONFIGURACIÓN (correr a mano desde el editor). Idempotente.
   ------------------------------------------------------------------ */
function configurar(){
  var p = PropertiesService.getScriptProperties();
  ['CLIENT_ID','HOJA_BASE_DATOS','AUTORIZADOS'].forEach(function(k){
    if (!p.getProperty(k)) p.setProperty(k, DEF[k]);
  });
  var id = p.getProperty('LIBRO_ID'), libro = null;
  if (id) { try { libro = SpreadsheetApp.openById(id); } catch (e) { libro = null; } }
  if (!libro){
    libro = SpreadsheetApp.create('EspecialistasDB — MS Universe');
    p.setProperty('LIBRO_ID', libro.getId());
  }
  Object.keys(ESQUEMA).forEach(function(nombre){
    var h = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
    var enc = ESQUEMA[nombre];
    var actuales = h.getLastColumn() ? h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0] : [];
    var faltan = enc.filter(function(c){ return actuales.indexOf(c) < 0; });
    if (faltan.length){
      var desde = actuales.filter(String).length + 1;
      h.getRange(1, desde, 1, faltan.length).setValues([faltan]);
    }
    h.getRange(1, 1, 1, h.getLastColumn()).setFontWeight('bold').setBackground('#030707').setFontColor('#F4F2F1');
    h.setFrozenRows(1);
    h.getRange(2, 1, h.getMaxRows() - 1, h.getLastColumn()).setNumberFormat('@');
  });
  var sobra = libro.getSheetByName('Hoja 1') || libro.getSheetByName('Sheet1');
  if (sobra && libro.getSheets().length > 1) libro.deleteSheet(sobra);
  if (!filas_('Catalogos').length){
    var h = libro.getSheetByName('Catalogos'), rows = [];
    ['Especialidad','Motivo'].forEach(function(cat){
      CATALOGOS[cat].forEach(function(v, i){ rows.push([cat, v, String((i + 1) * 10)]); });
    });
    h.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  var bd = SpreadsheetApp.openById(p.getProperty('HOJA_BASE_DATOS')).getSheetByName(DEF.PESTANA_BD);
  var c = columnasBD_(bd).c, enc = columnasBD_(bd).enc;
  var mapa = Object.keys(c).map(function(k){ return k + '=' + (c[k] < 0 ? '—' : enc[c[k]]); }).join(' · ');
  var msg = 'Especialistas ' + VERSION + ' listo. Libro: ' + libro.getUrl() + '\nColumnas de pacientes: ' + mapa;
  Logger.log(msg);
  return msg;
}

/* ------------------------------------------------------------------
   UTILERÍAS
   ------------------------------------------------------------------ */
function prop_(k){
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v && DEF[k]) v = DEF[k];
  if (!v) throw new Error('Falta configurar ' + k + '. Corra configurar() en el editor.');
  return v;
}
function libro_(){ return SpreadsheetApp.openById(prop_('LIBRO_ID')); }
function hoja_(n){
  var h = libro_().getSheetByName(n);
  if (!h) throw new Error('Falta la hoja ' + n + '. Corra configurar().');
  return h;
}
function encabezado_(h){ return h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String); }
function filas_(n){
  var h = hoja_(n);
  var ult = h.getLastRow();
  if (ult < 2) return [];
  var enc = encabezado_(h);
  return h.getRange(2, 1, ult - 1, enc.length).getDisplayValues()
    .filter(function(r){ return r.join('') !== ''; })
    .map(function(r){ var o = {}; enc.forEach(function(c, i){ o[c] = r[i]; }); return o; });
}
function buscaFila_(h, col, valor){
  var enc = encabezado_(h), i = enc.indexOf(col);
  if (i < 0 || h.getLastRow() < 2) return 0;
  var vals = h.getRange(2, i + 1, h.getLastRow() - 1, 1).getDisplayValues();
  for (var k = 0; k < vals.length; k++) if (vals[k][0] === String(valor)) return k + 2;
  return 0;
}
function leeFila_(h, fila){
  var enc = encabezado_(h);
  var r = h.getRange(fila, 1, 1, enc.length).getDisplayValues()[0];
  var o = {}; enc.forEach(function(c, i){ o[c] = r[i]; }); return o;
}
function escribeFila_(h, fila, obj){
  var enc = encabezado_(h);
  var r = h.getRange(fila, 1, 1, enc.length);
  var actual = r.getValues()[0];
  enc.forEach(function(c, i){ if (obj.hasOwnProperty(c)) actual[i] = obj[c]; });
  r.setNumberFormat('@').setValues([actual.map(String)]);
}
function agregaFila_(h, obj){
  var enc = encabezado_(h);
  var fila = h.getLastRow() + 1;
  h.getRange(fila, 1, 1, enc.length).setNumberFormat('@')
   .setValues([enc.map(function(c){ return obj[c] === undefined ? '' : String(obj[c]); })]);
}
function siguienteFolio_(serie){
  var p = PropertiesService.getScriptProperties();
  var n = Number(p.getProperty('FOLIO_' + serie) || 0) + 1;
  p.setProperty('FOLIO_' + serie, String(n));
  return serie + '-' + ('0000' + n).slice(-4);
}
function conCandado_(fn){
  var l = LockService.getScriptLock();
  if (!l.tryLock(20000)) throw new Error('El sistema está ocupado; intente de nuevo en unos segundos.');
  try { return fn(); } finally { l.releaseLock(); }
}
function bitacora_(u, accion, detalle){
  try { agregaFila_(hoja_('Bitacora'), { Fecha: ahora_(), Usuario: u.correo, Accion: accion, Detalle: detalle }); }
  catch (e) {}
}
function ahora_(){ return Utilities.formatDate(new Date(), 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ss"); }
function limpia_(v){ return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim(); }
function sinAcento_(t){ return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function json_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
