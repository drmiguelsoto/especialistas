/* ==================================================================
   FINANZAS — Dr. Miguel Soto · finanzas personales
   Backend (Apps Script, cuenta miguelsotouniverse@gmail.com)

   Registro diario de gastos (efectivo, tarjeta, transferencia…) y de
   ingresos activos y pasivos/portafolio, para medir la COBERTURA:
   ingreso pasivo ÷ gasto. Meta: que el ingreso pasivo pague todo el
   gasto y el ingreso activo se reinvierta íntegro en activos.

   Propiedades del script (Configuración del proyecto → Propiedades):
     CLIENT_ID    cliente OAuth del ecosistema (lo pone configurar())
     AUTORIZADOS  correos separados por coma (lo siembra configurar())
     LIBRO_ID     ID del libro FinanzasDB (lo crea configurar())

   Primera vez: correr configurar() desde el editor, autorizar, y
   publicar como App web (Ejecutar como: yo · Acceso: Cualquiera).
   El acceso real lo decide AUTORIZADOS: sólo las cuentas del Dr. Soto.
   ================================================================== */

var VERSION = '1.0';

var DEF = {
  CLIENT_ID: '634352012698-b47t3ed3tvd4d1g7l30l68bd6e5s0ri4.apps.googleusercontent.com',
  AUTORIZADOS: ['miguelitosotomd@gmail.com', 'miguelsotomd@gmail.com'].join(',')
};

var TIPOS = ['Gasto', 'Ingreso activo', 'Ingreso pasivo'];

var ESQUEMA = {
  Movimientos: ['ID','Fecha','Tipo','Monto','Forma_Pago','Categoria','Concepto','Notas',
    'Alta_Por','Alta_El','Actualizado_Por','Actualizado_El','Borrado'],
  Catalogos: ['Catalogo','Valor','Orden'],
  Bitacora: ['Fecha','Usuario','Accion','Detalle']
};

var CATALOGOS = {
  Forma_Pago: ['Efectivo','Tarjeta de crédito','Tarjeta de débito','Transferencia','Domiciliación','Otro'],
  Cat_Gasto: ['Súper y despensa','Restaurantes','Casa','Servicios (luz, agua, internet, celular)',
    'Colegiaturas y escuela','Hijos','Autos y gasolina','Viajes','Salud','Ropa y cuidado personal',
    'Entretenimiento','Suscripciones','Seguros','Impuestos','Inmuebles en renta (predial, mantenimiento)',
    'Regalos','Donativos','Otro'],
  Cat_Activo: ['Consultorio y cirugías','Zorvix','Renasté','Docencia','Otro'],
  Cat_Pasivo: ['Rentas de inmuebles','Inversiones — rendimientos','Dividendos','Intereses','Otro']
};

/* ------------------------------------------------------------------
   ENTRADA
   ------------------------------------------------------------------ */
function doGet(){
  return json_({ ok: true, servicio: 'Finanzas', version: VERSION,
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
  listarMovimientos: function(c, u){ return { ok: true, movimientos: movimientos_() }; },
  guardarMovimiento: function(c, u){ return guardarMovimiento_(c.movimiento || {}, u); },
  borrarMovimiento: function(c, u){ return borrarMovimiento_(c.id, u); },
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
  if (lista.indexOf(correo) < 0) throw new Error('La cuenta ' + correo + ' no tiene acceso a Finanzas.');
  return { correo: correo, nombre: info.name || info.email || correo };
}

/* ------------------------------------------------------------------
   MOVIMIENTOS
   ------------------------------------------------------------------ */
function movimientos_(){
  return filas_('Movimientos')
    .filter(function(m){ return m.Borrado !== 'Sí'; })
    .map(function(m){
      return { ID: m.ID, Fecha: m.Fecha, Tipo: m.Tipo, Monto: num_(m.Monto), Forma_Pago: m.Forma_Pago,
               Categoria: m.Categoria, Concepto: m.Concepto, Notas: m.Notas, Alta_El: m.Alta_El };
    });
}

function guardarMovimiento_(d, u){
  var tipo = limpia_(d.Tipo);
  if (TIPOS.indexOf(tipo) < 0) throw new Error('Tipo de movimiento no válido.');
  var monto = num_(d.Monto);
  if (!(monto > 0)) throw new Error('Falta el monto.');
  monto = Math.round(monto * 100) / 100;
  var fecha = limpia_(d.Fecha);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha no válida.');
  var cat = limpia_(d.Categoria);
  if (!cat) throw new Error('Falta la categoría.');
  var limpio = {
    Fecha: fecha, Tipo: tipo, Monto: monto, Forma_Pago: limpia_(d.Forma_Pago),
    Categoria: cat, Concepto: limpia_(d.Concepto), Notas: limpia_(d.Notas)
  };
  return conCandado_(function(){
    var h = hoja_('Movimientos');
    var ahora = ahora_();
    if (d.ID){
      var fila = buscaFila_(h, 'ID', d.ID);
      if (!fila) throw new Error('No encontré el movimiento ' + d.ID + '.');
      limpio.Actualizado_Por = u.correo; limpio.Actualizado_El = ahora;
      escribeFila_(h, fila, limpio);
      bitacora_(u, 'editar', d.ID + ' · ' + tipo + ' ' + monto);
      return { ok: true, ID: d.ID };
    }
    limpio.ID = siguienteFolio_('M');
    limpio.Alta_Por = u.correo; limpio.Alta_El = ahora; limpio.Borrado = 'No';
    agregaFila_(h, limpio);
    bitacora_(u, 'alta', limpio.ID + ' · ' + tipo + ' ' + monto);
    return { ok: true, ID: limpio.ID };
  });
}

function borrarMovimiento_(id, u){
  if (!id) throw new Error('Falta el movimiento.');
  return conCandado_(function(){
    var h = hoja_('Movimientos');
    var fila = buscaFila_(h, 'ID', id);
    if (!fila) throw new Error('No encontré el movimiento ' + id + '.');
    escribeFila_(h, fila, { Borrado: 'Sí', Actualizado_Por: u.correo, Actualizado_El: ahora_() });
    bitacora_(u, 'borrar', id);
    return { ok: true };
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
    .forEach(function(r){ if (out[r.Catalogo] && out[r.Catalogo].indexOf(r.Valor) < 0) out[r.Catalogo].push(r.Valor); });
  return out;
}

function agregarCatalogo_(cat, valor, u){
  cat = limpia_(cat); valor = limpia_(valor);
  if (!CATALOGOS[cat]) throw new Error('Catálogo no válido.');
  if (!valor) throw new Error('Falta el nombre.');
  return conCandado_(function(){
    var actuales = catalogos_()[cat];
    if (actuales.indexOf(valor) < 0){
      var orden = 0;
      filas_('Catalogos').forEach(function(r){ if (r.Catalogo === cat) orden = Math.max(orden, Number(r.Orden) || 0); });
      agregaFila_(hoja_('Catalogos'), { Catalogo: cat, Valor: valor, Orden: String(orden + 10) });
      bitacora_(u, 'catalogo', cat + ' + ' + valor);
    }
    return { ok: true, catalogos: catalogos_() };
  });
}

/* ------------------------------------------------------------------
   CONFIGURACIÓN (correr una vez desde el editor)
   ------------------------------------------------------------------ */
function configurar(){
  var p = PropertiesService.getScriptProperties();
  ['CLIENT_ID','AUTORIZADOS'].forEach(function(k){
    if (!p.getProperty(k)) p.setProperty(k, DEF[k]);
  });
  var id = p.getProperty('LIBRO_ID'), libro = null;
  if (id) { try { libro = SpreadsheetApp.openById(id); } catch (e) { libro = null; } }
  if (!libro){
    libro = SpreadsheetApp.create('FinanzasDB — Dr. Miguel Soto (personal)');
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
  });
  var mov = libro.getSheetByName('Movimientos');
  var cMonto = ESQUEMA.Movimientos.indexOf('Monto') + 1;
  mov.getRange(2, cMonto, mov.getMaxRows() - 1, 1).setNumberFormat('$#,##0.00');
  var sobra = libro.getSheetByName('Hoja 1') || libro.getSheetByName('Sheet1');
  if (sobra && libro.getSheets().length > 1) libro.deleteSheet(sobra);
  if (!filas_('Catalogos').length){
    var h = libro.getSheetByName('Catalogos'), rows = [];
    Object.keys(CATALOGOS).forEach(function(cat){
      CATALOGOS[cat].forEach(function(v, i){ rows.push([cat, v, String((i + 1) * 10)]); });
    });
    h.getRange(2, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
  }
  var msg = 'Finanzas ' + VERSION + ' listo. Libro: ' + libro.getUrl();
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
  return h.getRange(2, 1, ult - 1, enc.length).getValues()
    .filter(function(r){ return r.join('') !== ''; })
    .map(function(r){
      var o = {};
      enc.forEach(function(c, i){
        var v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, 'America/Mexico_City', "yyyy-MM-dd");
        o[c] = (c === 'Monto') ? v : String(v);
      });
      return o;
    });
}
function buscaFila_(h, col, valor){
  var enc = encabezado_(h), i = enc.indexOf(col);
  if (i < 0 || h.getLastRow() < 2) return 0;
  var vals = h.getRange(2, i + 1, h.getLastRow() - 1, 1).getDisplayValues();
  for (var k = 0; k < vals.length; k++) if (vals[k][0] === String(valor)) return k + 2;
  return 0;
}
/* Todas las celdas van como texto salvo Monto, que va como número
   para que el libro se pueda sumar y filtrar directamente. */
function valorCelda_(c, v){ return c === 'Monto' ? Number(v) : String(v); }
function escribeFila_(h, fila, obj){
  var enc = encabezado_(h);
  enc.forEach(function(c, i){
    if (!obj.hasOwnProperty(c)) return;
    var celda = h.getRange(fila, i + 1);
    if (c !== 'Monto') celda.setNumberFormat('@');
    celda.setValue(valorCelda_(c, obj[c]));
  });
}
function agregaFila_(h, obj){
  var enc = encabezado_(h);
  var fila = h.getLastRow() + 1;
  var rango = h.getRange(fila, 1, 1, enc.length);
  rango.setNumberFormats([enc.map(function(c){ return c === 'Monto' ? '$#,##0.00' : '@'; })]);
  rango.setValues([enc.map(function(c){ return obj[c] === undefined ? '' : valorCelda_(c, obj[c]); })]);
}
function siguienteFolio_(serie){
  var p = PropertiesService.getScriptProperties();
  var n = Number(p.getProperty('FOLIO_' + serie) || 0) + 1;
  p.setProperty('FOLIO_' + serie, String(n));
  return serie + '-' + ('00000' + n).slice(-5);
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
function num_(v){
  if (typeof v === 'number') return v;
  var n = Number(String(v || '').replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function json_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
