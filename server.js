import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import { db, isMock } from './config/firebase.js';
import { interpretarMensaje, ANIMALITOS_MAP, GUACHARO_ANIMALITOS_MAP } from './services/interpreter.js';
import fs from 'fs';
import path from 'path';

const { Client, LocalAuth } = pkg;

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// --- CAPA DE CACHÉ EN MEMORIA (FASE 13) ---
const cache = {
  clientes: [],
  jugadas: [],
  sorteos: [],
  retiros: [],
  loterias: [],
  configuracion: {},
  riesgos: {}
};

// Guardar el caché actual en un archivo local en disco para persistencia ante reinicios
function guardarCacheEnDisco() {
  try {
    fs.writeFileSync('./cache_backup.json', JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Error al guardar backup de caché en disco:', err.message);
  }
}

// Helpers de escritura sincrónica en Firestore y caché
async function dbSet(coleccion, docId, data, merge = false) {
  try {
    await db.collection(coleccion).doc(docId).set(data, { merge });
  } catch (err) {
    console.warn(`[Firestore Error] set failed on ${coleccion}/${docId}:`, err.message);
  }

  if (coleccion === 'configuracion') {
    if (docId === 'general') {
      cache.configuracion = merge ? { ...cache.configuracion, ...data } : data;
    } else if (docId === 'riesgos') {
      cache.riesgos = merge ? { ...cache.riesgos, ...data } : data;
    }
    guardarCacheEnDisco();
    return;
  }

  const arr = cache[coleccion];
  if (arr) {
    const idx = arr.findIndex(item => item.id === docId);
    const updatedItem = merge && idx !== -1 ? { ...arr[idx], ...data } : { id: docId, ...data };
    if (idx !== -1) {
      arr[idx] = updatedItem;
    } else {
      arr.push(updatedItem);
    }
    guardarCacheEnDisco();
  }
}

async function dbUpdate(coleccion, docId, data) {
  try {
    await db.collection(coleccion).doc(docId).update(data);
  } catch (err) {
    console.warn(`[Firestore Error] update failed on ${coleccion}/${docId}:`, err.message);
  }

  if (coleccion === 'configuracion') {
    if (docId === 'general') {
      cache.configuracion = { ...cache.configuracion, ...data };
    } else if (docId === 'riesgos') {
      cache.riesgos = { ...cache.riesgos, ...data };
    }
    guardarCacheEnDisco();
    return;
  }

  const arr = cache[coleccion];
  if (arr) {
    const idx = arr.findIndex(item => item.id === docId);
    if (idx !== -1) {
      arr[idx] = { ...arr[idx], ...data };
    }
    guardarCacheEnDisco();
  }
}

async function dbDelete(coleccion, docId) {
  try {
    await db.collection(coleccion).doc(docId).delete();
  } catch (err) {
    console.warn(`[Firestore Error] delete failed on ${coleccion}/${docId}:`, err.message);
  }

  const arr = cache[coleccion];
  if (arr) {
    const idx = arr.findIndex(item => item.id === docId);
    if (idx !== -1) {
      arr.splice(idx, 1);
    }
    guardarCacheEnDisco();
  }
}

async function dbAdd(coleccion, data) {
  const docId = (coleccion.endsWith('s') ? coleccion.substring(0, coleccion.length - 1) : coleccion) + '_' + Math.random().toString(36).substring(2, 11);
  let actualId = docId;
  try {
    const docRef = await db.collection(coleccion).add(data);
    actualId = docRef.id;
  } catch (err) {
    console.warn(`[Firestore Error] add failed on ${coleccion}:`, err.message);
  }

  const arr = cache[coleccion];
  if (arr) {
    arr.push({ id: actualId, ...data });
    guardarCacheEnDisco();
  }
  return { id: actualId };
}

async function inicializarCache() {
  console.log('🔄 Inicializando caché en memoria...');
  try {
    const loteriasSnapshot = await db.collection('loterias').get();
    cache.loterias = [];
    loteriasSnapshot.forEach(doc => cache.loterias.push({ id: doc.id, ...doc.data() }));

    const configDoc = await db.collection('configuracion').doc('general').get();
    cache.configuracion = configDoc.exists ? configDoc.data() : {
      limiteMaxJugada: 10000,
      limitesPorLoteria: { "lotto activo": 5000, "la granjita": 4000, "guacharo": 3000 }
    };

    const riesgosDoc = await db.collection('configuracion').doc('riesgos').get();
    cache.riesgos = riesgosDoc.exists ? {
      porcentajeLimitaCalientes: 0.20,
      factorCupoColectivo: 3.0,
      ...riesgosDoc.data()
    } : {
      animalesBloqueados: [],
      porcentajesLimite: {},
      autoLimitarCalientes: true,
      porcentajeLimitaCalientes: 0.20,
      factorCupoColectivo: 3.0
    };

    const clientesSnapshot = await db.collection('clientes').get();
    cache.clientes = [];
    clientesSnapshot.forEach(doc => cache.clientes.push({ id: doc.id, ...doc.data() }));

    const retirosSnapshot = await db.collection('retiros').get();
    cache.retiros = [];
    retirosSnapshot.forEach(doc => cache.retiros.push({ id: doc.id, ...doc.data() }));

    const sorteosSnapshot = await db.collection('sorteos').orderBy('fecha', 'desc').get();
    cache.sorteos = [];
    sorteosSnapshot.forEach(doc => cache.sorteos.push({ id: doc.id, ...doc.data() }));

    const jugadasSnapshot = await db.collection('jugadas').get();
    cache.jugadas = [];
    jugadasSnapshot.forEach(doc => cache.jugadas.push({ id: doc.id, ...doc.data() }));

    console.log(`✅ Caché inicializado con éxito: ${cache.clientes.length} clientes, ${cache.jugadas.length} jugadas, ${cache.loterias.length} loterías, ${cache.sorteos.length} sorteos, ${cache.retiros.length} retiros.`);
    guardarCacheEnDisco();
  } catch (err) {
    console.error('❌ Error al inicializar caché desde Firestore:', err);
    if (err.message.includes('Quota exceeded') || err.message.includes('RESOURCE_EXHAUSTED')) {
      console.warn('⚠️ Cuota de Firestore excedida. Intentando cargar desde backup en disco...');
      
      // Intentar cargar el backup de disco
      let cargadoDesdeBackup = false;
      try {
        if (fs.existsSync('./cache_backup.json')) {
          const backupRaw = fs.readFileSync('./cache_backup.json', 'utf8');
          const backupData = JSON.parse(backupRaw);
          
          cache.clientes = backupData.clientes || [];
          cache.jugadas = backupData.jugadas || [];
          cache.sorteos = backupData.sorteos || [];
          cache.retiros = backupData.retiros || [];
          cache.loterias = backupData.loterias || [];
          cache.configuracion = backupData.configuracion || {};
          cache.riesgos = backupData.riesgos || {};
          
          console.log(`💾 Caché restaurado exitosamente desde backup en disco: ${cache.clientes.length} clientes, ${cache.jugadas.length} jugadas, ${cache.loterias.length} loterías.`);
          cargadoDesdeBackup = true;
        }
      } catch (backupErr) {
        console.error('❌ Error al cargar backup de caché desde disco:', backupErr.message);
      }

      // Si no hay backup en disco, cargar valores por defecto mínimos para que funcione
      if (!cargadoDesdeBackup) {
        console.warn('⚠️ No se encontró backup local en disco. Sembrando datos mínimos por defecto...');
        if (cache.loterias.length === 0) {
          cache.loterias = [
            {
              id: 'lotto_activo',
              nombre: 'Lotto Activo',
              multiplicador: 30,
              horarios: ['09:00am', '10:00am', '11:00am', '12:00pm', '01:00pm', '03:00pm', '04:00pm', '05:00pm', '06:00pm', '07:00pm'],
              limite: 5000,
              cierreAnticipado: 5,
              animales: ANIMALITOS_MAP,
              activa: true
            },
            {
              id: 'la_granjita',
              nombre: 'La Granjita',
              multiplicador: 30,
              horarios: ['09:00am', '10:00am', '11:00am', '12:00pm', '01:00pm', '03:00pm', '04:00pm', '05:00pm', '06:00pm', '07:00pm'],
              limite: 4000,
              cierreAnticipado: 5,
              animales: ANIMALITOS_MAP,
              activa: true
            },
            {
              id: 'guacharo',
              nombre: 'Guácharo',
              multiplicador: 30,
              horarios: ['10:00am', '11:00am', '12:00pm', '01:00pm', '03:00pm', '04:00pm', '05:00pm', '06:00pm'],
              limite: 3000,
              cierreAnticipado: 5,
              animales: GUACHARO_ANIMALITOS_MAP,
              activa: true
            }
          ];
        }
        if (Object.keys(cache.configuracion).length === 0) {
          cache.configuracion = {
            limiteMaxJugada: 10000,
            limitesPorLoteria: { "lotto activo": 5000, "la granjita": 4000, "guacharo": 3000 }
          };
        }
        if (Object.keys(cache.riesgos).length === 0) {
          cache.riesgos = {
            animalesBloqueados: [],
            porcentajesLimite: {},
            autoLimitarCalientes: true,
            porcentajeLimitaCalientes: 0.20,
            factorCupoColectivo: 3.0
          };
        }
      }
    }
  }

  // Asegurar que Guácharo tenga el mapa de 77 animales completo en caché/disco
  try {
    const guacharoLot = cache.loterias.find(l => l.id === 'guacharo');
    if (guacharoLot) {
      if (!guacharoLot.animales || Object.keys(guacharoLot.animales).length < 77) {
        console.log('🔄 Actualizando Guácharo con el mapa de 77 animales completo...');
        guacharoLot.animales = GUACHARO_ANIMALITOS_MAP;
        // Intentar guardar en Firestore (en segundo plano)
        dbSet('loterias', 'guacharo', guacharoLot).catch(err => {
          console.warn('[Firestore] No se pudo actualizar animales de guacharo:', err.message);
        });
        guardarCacheEnDisco();
      }
    }
  } catch (err) {
    console.error('Error al autosanar animales de Guácharo:', err.message);
  }
}

// Estado de sesión en memoria para los clientes que interactúan por WhatsApp
const sessions = {};

// Función utilitaria para calcular el sorteo activo según la hora actual en Venezuela (GMT-4)
function obtenerSorteoActivoDynamic(horarios, cierreMinutos = 5) {
  if (!horarios || horarios.length === 0) {
    return { hora: '09:00am', esManana: false };
  }
  
  const parseTimeToMinutes = (h) => {
    const matches = h.match(/(\d+):(\d+)(am|pm)/i);
    if (!matches) return 0;
    let hr = parseInt(matches[1], 10);
    const min = parseInt(matches[2], 10);
    const meridiano = matches[3].toLowerCase();
    if (meridiano === 'pm' && hr < 12) hr += 12;
    if (meridiano === 'am' && hr === 12) hr = 0;
    return hr * 60 + min;
  };
  
  const sortedHorarios = [...horarios].sort((a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b));

  // Obtener la hora actual en la zona horaria de Caracas
  const caracasTimeStr = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Caracas', hour12: false });
  const [horaActual, minActual] = caracasTimeStr.split(':').map(Number);
  const minutosAhora = horaActual * 60 + minActual;

  for (const h of sortedHorarios) {
    const minutosSorteoTotal = parseTimeToMinutes(h);
    if (minutosSorteoTotal - minutosAhora >= cierreMinutos) {
      return { hora: h, esManana: false };
    }
  }

  // Si no queda ningún sorteo hoy, es el primero de mañana
  return { hora: sortedHorarios[0], esManana: true };
}

async function obtenerSorteoActivo(loteria) {
  try {
    const lotNameClean = loteria.toLowerCase().trim().replace(/\s+/g, '_');
    let mappedId = lotNameClean;
    if (mappedId === 'lotto' || mappedId === 'lotto_activo') mappedId = 'lotto_activo';
    if (mappedId === 'granja' || mappedId === 'la_granjita') mappedId = 'la_granjita';
    if (mappedId === 'guacharo_activo') mappedId = 'guacharo';

    const cachedLot = cache.loterias.find(l => l.id === mappedId);
    if (cachedLot && cachedLot.horarios && cachedLot.horarios.length > 0) {
      const cierreMinutos = cachedLot.cierreAnticipado !== undefined ? parseInt(cachedLot.cierreAnticipado, 10) : 5;
      return obtenerSorteoActivoDynamic(cachedLot.horarios, cierreMinutos);
    }
  } catch (err) {
    console.error('Error al obtener horarios dinámicos:', err);
  }
  
  const defaultHorarios = ['09:00am', '10:00am', '11:00am', '12:00pm', '01:00pm', '03:00pm', '04:00pm', '05:00pm', '06:00pm', '07:00pm'];
  return obtenerSorteoActivoDynamic(defaultHorarios, 5);
}

// Funciones para notificar al cliente el estado de sus jugadas o tickets
async function notificarEstadoTicket(ticketNumero, estado, metodoPago = '', motivoAnulacion = '') {
  try {
    const matchingJugadas = cache.jugadas.filter(j => j.ticketNumero === ticketNumero);
    if (matchingJugadas.length === 0) return;

    const firstDoc = matchingJugadas[0];
    const clienteJid = firstDoc.clienteJid || `${firstDoc.clienteTelefono}@c.us`;
    const nombre = firstDoc.clienteNombre || 'Cliente';

    let total = 0;
    let listado = '';
    matchingJugadas.forEach((j, idx) => {
      const lotName = j.loteria ? j.loteria.toUpperCase() : 'LOTTO ACTIVO';
      const animalCapitalized = j.valor.toUpperCase();
      listado += `${idx + 1}. 🎰 *${lotName}* (Sorteo: ${j.sorteoHora}) ➔ ${animalCapitalized} — Bs. ${j.monto.toLocaleString('de-DE')}\n`;
      total += j.monto;
    });

    let msg = '';
    if (estado === 'jugada') {
      const modal = metodoPago === 'pagado' ? 'PAGADO (Confirmado) ✅' : 'CRÉDITO (Fiado) 📝';
      msg = `🔔 *¡Tu jugada ha sido Procesada!* 🔔\n\nHola *${nombre}*, te informamos que tu ticket *#${ticketNumero}* ha sido aprobado y registrado bajo la modalidad: *${modal}*.\n\n*Resumen de Jugadas:*\n${listado}\n💰 Total: *Bs. ${total.toLocaleString('de-DE')}*`;
    } else if (estado === 'anulada') {
      const motivo = motivoAnulacion || 'por decisión del operador o falta de pago';
      msg = `⚠️ *¡Tu ticket ha sido Anulado!* ⚠️\n\nHola *${nombre}*, te informamos que tu ticket *#${ticketNumero}* ha sido *ANULADO*.\n\n*Motivo:* ${motivo}.\n\n*Detalles del Ticket:* \n${listado}\n💰 Total reembolsado/descontado: *Bs. ${total.toLocaleString('de-DE')}*`;
    }

    if (msg) {
      await client.sendMessage(clienteJid, msg);
      console.log(`✉️ Notificación de estado de ticket #${ticketNumero} enviada a ${clienteJid} (${estado})`);
    }
  } catch (err) {
    console.error(`❌ Error al notificar estado de ticket #${ticketNumero}:`, err.message);
  }
}

async function notificarEstadoJugada(jugadaId, estado, metodoPago = '', motivoAnulacion = '') {
  try {
    const j = cache.jugadas.find(item => item.id === jugadaId);
    if (!j) return;
    const clienteJid = j.clienteJid || `${j.clienteTelefono}@c.us`;
    const nombre = j.clienteNombre || 'Cliente';
    const lotName = j.loteria ? j.loteria.toUpperCase() : 'LOTTO ACTIVO';
    const animalCapitalized = j.valor.toUpperCase();

    let msg = '';
    if (estado === 'jugada') {
      const modal = metodoPago === 'pagado' ? 'PAGADO (Confirmado) ✅' : 'CRÉDITO (Fiado) 📝';
      msg = `🔔 *¡Tu jugada ha sido Procesada!* 🔔\n\nHola *${nombre}*, tu jugada ha sido aprobada y registrada en el sistema.\n\n*Detalle:*\n🎰 Lotería: *${lotName}* (Sorteo: ${j.sorteoHora})\n🐾 Jugada: ${animalCapitalized}\n💰 Monto: *Bs. ${j.monto.toLocaleString('de-DE')}*\n⚙️ Modalidad: *${modal}*`;
    } else if (estado === 'anulada') {
      const motivo = motivoAnulacion || 'por no haber sido cancelada (pagada) a tiempo antes del sorteo';
      msg = `⚠️ *¡Tu jugada ha sido Anulada!* ⚠️\n\nHola *${nombre}*, te informamos que tu jugada ha sido *ANULADA*.\n\n*Detalle:*\n🎰 Lotería: *${lotName}* (Sorteo: ${j.sorteoHora})\n🐾 Jugada: ${animalCapitalized}\n💰 Monto: *Bs. ${j.monto.toLocaleString('de-DE')}*\n\n*Motivo:* ${motivo}.`;
    }

    if (msg) {
      await client.sendMessage(clienteJid, msg);
      console.log(`✉️ Notificación de estado de jugada ${jugadaId} enviada a ${clienteJid} (${estado})`);
    }
  } catch (err) {
    console.error(`❌ Error al notificar estado de jugada ${jugadaId}:`, err.message);
  }
}

// Inicializar cliente de WhatsApp
console.log('🤖 Inicializando cliente de WhatsApp...');

// Detectar automáticamente el ejecutable de Chrome/Chromium
// En la nube (Linux) usa el Chromium del sistema; en Windows usa Chrome local
const isCloud = process.platform === 'linux';
const chromiumArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--single-process',
  '--disable-gpu'
];

const puppeteerConfig = isCloud
  ? {
      executablePath: '/usr/bin/chromium',
      args: chromiumArgs
    }
  : {
      executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: chromiumArgs
    };

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './.wwebjs_auth'
  }),
  puppeteer: puppeteerConfig
});

let botState = 'disconnected';
let botPaused = false; // Si es true, el bot ignora todos los mensajes entrantes
let latestQr = null; // Guardar el último código QR generado para mostrarlo en el panel

client.on('qr', (qr) => {
  botState = 'qr';
  latestQr = qr;
  console.log('⚠️ SE REQUIERE ESCANEAR EL CÓDIGO QR PARA INICIAR EL BOT:');
  qrcodeTerminal.generate(qr, { small: true });
  console.log('📷 Por favor, escanea el código QR de arriba con la aplicación de WhatsApp en tu teléfono.');
});

client.on('ready', () => {
  botState = 'connected';
  latestQr = null;
  console.log('🚀 ¡El Bot de WhatsApp está conectado y listo para procesar mensajes!');
});

client.on('auth_failure', (msg) => {
  botState = 'auth_failure';
  latestQr = null;
  console.error('❌ Fallo de autenticación en WhatsApp:', msg);
});

client.on('disconnected', (reason) => {
  botState = 'disconnected';
  latestQr = null;
  console.log('❌ El Bot de WhatsApp se ha desconectado:', reason);
});

// Función para procesar y validar límites, riesgos y horarios de jugadas
async function procesarLimitesYSorteosDeJugadas(jugadas, loteriasList, message, session, clienteData, nombreCliente) {
  let limiteMax = 10000;
  if (cache.configuracion && cache.configuracion.limiteMaxJugada !== undefined) {
    limiteMax = cache.configuracion.limiteMaxJugada;
  }
  
  let animalesBloqueados = [];
  let porcentajesLimite = {};
  let autoLimitarCalientes = true;
  let pctCalientes = 0.20;
  let factorColectivo = 3.0;

  if (cache.riesgos) {
    if (cache.riesgos.animalesBloqueados !== undefined) animalesBloqueados = cache.riesgos.animalesBloqueados;
    if (cache.riesgos.porcentajesLimite !== undefined) porcentajesLimite = cache.riesgos.porcentajesLimite;
    if (cache.riesgos.autoLimitarCalientes !== undefined) autoLimitarCalientes = cache.riesgos.autoLimitarCalientes;
    if (cache.riesgos.porcentajeLimitaCalientes !== undefined) pctCalientes = parseFloat(cache.riesgos.porcentajeLimitaCalientes);
    if (cache.riesgos.factorCupoColectivo !== undefined) factorColectivo = parseFloat(cache.riesgos.factorCupoColectivo);
  }

  const montosValidadosEnLote = {};

  for (let i = 0; i < jugadas.length; i++) {
    const j = jugadas[i];
    const animalNum = j.numero;
    
    if (animalesBloqueados.includes(animalNum)) {
      session.estado = 'idle';
      session.jugadasPendientes = [];
      const animalCapitalized = j.animal.toUpperCase();
      
      session.ultimaJugadaRechazada = {
        jugada: j,
        limiteDisponible: 0,
        indexRechazado: i,
        todasLasJugadas: jugadas
      };
      
      await message.reply(`El ${animalCapitalized} (#${animalNum}) está disponible por el monto máximo de hasta Bs. 0.`);
      return false;
    }

    let lotName = (j.loteria || 'lotto activo').toLowerCase().trim();
    if (lotName === 'lotto') lotName = 'lotto activo';
    if (lotName === 'granja') lotName = 'la granjita';
    if (lotName === 'guacharo activo') lotName = 'guacharo';
    j.loteria = lotName;

    const configLoteria = loteriasList.find(l => {
      const cleanLName = l.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const cleanLId = l.id.toLowerCase().replace(/_/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const cleanLotName = lotName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      return cleanLName === cleanLotName || cleanLId === cleanLotName;
    });
    let limiteLoteria = configLoteria ? (configLoteria.limite || limiteMax) : limiteMax;

    // Calcular sorteo hora y fecha primero
    let activeSorteoInfo = null;
    if (!j.sorteoHora) {
      if (configLoteria && configLoteria.horarios && configLoteria.horarios.length > 0) {
        const cierreMinutos = configLoteria.cierreAnticipado !== undefined ? parseInt(configLoteria.cierreAnticipado, 10) : 5;
        activeSorteoInfo = obtenerSorteoActivoDynamic(configLoteria.horarios, cierreMinutos);
      } else {
        activeSorteoInfo = await obtenerSorteoActivo(j.loteria);
      }
      j.sorteoHora = activeSorteoInfo.hora;
    }

    // Calcular sorteoFecha
    if (!j.sorteoFecha) {
      const caracasDateStr = new Date().toLocaleDateString('sv', { timeZone: 'America/Caracas' });
      let esManana = false;
      if (activeSorteoInfo) {
        esManana = activeSorteoInfo.esManana;
      } else if (j.sorteoHora) {
        // Verificar si la hora de sorteo especificada ya pasó/cerró hoy en Caracas
        const parseTimeToMinutes = (h) => {
          const matches = h.match(/(\d+):(\d+)(am|pm)/i);
          if (!matches) return 0;
          let hr = parseInt(matches[1], 10);
          const min = parseInt(matches[2], 10);
          const meridiano = matches[3].toLowerCase();
          if (meridiano === 'pm' && hr < 12) hr += 12;
          if (meridiano === 'am' && hr === 12) hr = 0;
          return hr * 60 + min;
        };

        const caracasTimeStr = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Caracas', hour12: false });
        const [horaActual, minActual] = caracasTimeStr.split(':').map(Number);
        const minutosAhora = horaActual * 60 + minActual;
        const cierreMinutos = configLoteria && configLoteria.cierreAnticipado !== undefined ? parseInt(configLoteria.cierreAnticipado, 10) : 5;

        const minutosSorteoTotal = parseTimeToMinutes(j.sorteoHora);
        if (minutosSorteoTotal - minutosAhora < cierreMinutos) {
          esManana = true;
        }
      }

      if (esManana) {
        const hoyCaracas = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Caracas' }));
        hoyCaracas.setDate(hoyCaracas.getDate() + 1);
        j.sorteoFecha = hoyCaracas.toLocaleDateString('sv', { timeZone: 'America/Caracas' });
      } else {
        j.sorteoFecha = caracasDateStr;
      }
    }

    let calientes = [];
    let atrasados = [];
    if (autoLimitarCalientes) {
      const stats = await obtenerEstadisticasRiesgo(lotName);
      calientes = stats.calientes;
      atrasados = stats.atrasados || [];
    }

    let factorReduccion = 1.0;
    let esCaliente = false;
    let esAtrasado = false;

    if (autoLimitarCalientes && calientes.includes(animalNum)) {
      factorReduccion = pctCalientes;
      esCaliente = true;
    }

    if (autoLimitarCalientes && atrasados.includes(animalNum)) {
      factorReduccion = pctCalientes;
      esAtrasado = true;
    }

    if (porcentajesLimite && porcentajesLimite[animalNum] !== undefined) {
      const pct = parseFloat(porcentajesLimite[animalNum]);
      if (pct < factorReduccion) {
        factorReduccion = pct;
        esCaliente = false;
        esAtrasado = false;
      }
    }

    const limiteIndividual = limiteLoteria * factorReduccion;

    // 1. Validación de Límite Individual Acumulativo
    const matchingJugadasCliente = cache.jugadas.filter(existingPlay =>
      (existingPlay.clienteTelefono === (clienteData.telefono || telefonoReal) || existingPlay.clienteJid === telefono) &&
      existingPlay.loteria === lotName &&
      existingPlay.sorteoHora === j.sorteoHora &&
      (existingPlay.sorteoFecha ? existingPlay.sorteoFecha === j.sorteoFecha : existingPlay.fecha.split('T')[0] === j.sorteoFecha) &&
      existingPlay.estado !== 'anulada' &&
      existingPlay.valor.includes(`(#${animalNum})`)
    );
    const totalApostadoClienteCache = matchingJugadasCliente.reduce((sum, existingPlay) => sum + existingPlay.monto, 0);

    const loteKey = `${lotName}_${j.sorteoHora}_${animalNum}`;
    const totalApostadoClienteLote = montosValidadosEnLote[loteKey] || 0;
    
    const totalApostadoClienteTotal = totalApostadoClienteCache + totalApostadoClienteLote;
    const cupoIndividualDisponible = Math.max(0, limiteIndividual - totalApostadoClienteTotal);

    if (j.monto > cupoIndividualDisponible) {
      session.estado = 'idle';
      session.jugadasPendientes = [];
      const animalCapitalized = j.animal.toUpperCase();
      
      session.ultimaJugadaRechazada = {
        jugada: j,
        limiteDisponible: cupoIndividualDisponible,
        indexRechazado: i,
        todasLasJugadas: jugadas
      };

      await message.reply(`El ${animalCapitalized} (#${animalNum}) está disponible por el monto máximo de hasta Bs. ${cupoIndividualDisponible.toLocaleString('de-DE')}.`);
      return false;
    }

    // 2. Validación de Límite Colectivo Acumulativo (Cupo General de la Agencia por Animal para este Sorteo)
    const limiteColectivo = limiteIndividual * factorColectivo;

    const matchingJugadasColectivo = cache.jugadas.filter(existingPlay =>
      existingPlay.loteria === lotName &&
      existingPlay.sorteoHora === j.sorteoHora &&
      (existingPlay.sorteoFecha ? existingPlay.sorteoFecha === j.sorteoFecha : existingPlay.fecha.split('T')[0] === j.sorteoFecha) &&
      existingPlay.estado !== 'anulada' &&
      existingPlay.valor.includes(`(#${animalNum})`)
    );
    const totalApostadoColectivoCache = matchingJugadasColectivo.reduce((sum, existingPlay) => sum + existingPlay.monto, 0);
    const totalApostadoColectivoLote = montosValidadosEnLote[loteKey] || 0;
    const totalApostadoColectivoTotal = totalApostadoColectivoCache + totalApostadoColectivoLote;
    
    const cupoColectivoDisponible = Math.max(0, limiteColectivo - totalApostadoColectivoTotal);

    if (j.monto > cupoColectivoDisponible) {
      session.estado = 'idle';
      session.jugadasPendientes = [];
      const animalCapitalized = j.animal.toUpperCase();

      session.ultimaJugadaRechazada = {
        jugada: j,
        limiteDisponible: cupoColectivoDisponible,
        indexRechazado: i,
        todasLasJugadas: jugadas
      };
      
      await message.reply(`El ${animalCapitalized} (#${animalNum}) está disponible por el monto máximo de hasta Bs. ${cupoColectivoDisponible.toLocaleString('de-DE')}.`);
      return false;
    }

    // Registrar monto validado para esta jugada
    montosValidadosEnLote[loteKey] = (montosValidadosEnLote[loteKey] || 0) + j.monto;
  }

  session.jugadasPendientes = jugadas;
  session.estado = 'esperando_confirmacion';

  let msgConfirmacion = `📋 *Confirma tus jugadas, ${nombreCliente}:*\n\n`;
  let total = 0;
  jugadas.forEach((j, index) => {
    const lot = j.loteria ? j.loteria.toUpperCase() : 'LOTTO ACTIVO';
    const animalCapitalized = j.animal.charAt(0).toUpperCase() + j.animal.slice(1);
    msgConfirmacion += `${index + 1}. 🎰 *${lot}* (Sorteo: *${j.sorteoHora}*)\n   🐾 ${animalCapitalized} (#${j.numero})\n   💰 *Bs. ${j.monto.toLocaleString('de-DE')}*\n\n`;
    total += j.monto;
  });

  msgConfirmacion += `💵 *Total a jugar: Bs. ${total.toLocaleString('de-DE')}*\n\n¿Deseas confirmar la jugada? Responde *SI* o *NO*`;
  await message.reply(msgConfirmacion);
  return true;
}

// Manejo del Flujo del Bot
client.on('message', async (message) => {
  try {
    const telefono = message.from; // Identificador único (ej: 584121234567@c.us)
    const texto = (message.body || '').trim();

    // Ignorar si el mensaje no contiene texto (como imágenes sin leyenda, stickers, audios o mensajes del sistema)
    if (!texto) {
      return;
    }
    
    // Sobrescribir message.reply para evitar caídas en JIDs especiales (como @lid) o cambios en WA Web,
    // e introducir simulación de escritura humana (typing delay) para prevenir bloqueos por spam.
    const originalReply = message.reply.bind(message);
    message.reply = async (content, options) => {
      try {
        // Simular que el bot está escribiendo
        try {
          const chat = await message.getChat();
          await chat.sendStateTyping();
          
          // Retraso dinámico según la longitud del mensaje (aprox. 12ms por caracter, min 1000ms, max 3000ms)
          const charCount = typeof content === 'string' ? content.length : 100;
          const delayMs = Math.min(3000, Math.max(1000, charCount * 12));
          await new Promise(resolve => setTimeout(resolve, delayMs));
          
          await chat.clearState();
        } catch (stateErr) {
          console.warn("⚠️ No se pudo simular el estado Escribiendo:", stateErr.message);
        }

        return await originalReply(content, options);
      } catch (err) {
        console.warn("⚠️ Falló message.reply original, intentando con client.sendMessage como respaldo:", err.message);
        try {
          return await client.sendMessage(message.from, content, options);
        } catch (sendErr) {
          console.error("❌ Falló también client.sendMessage de respaldo:", sendErr);
        }
      }
    };
    
    // Ignorar mensajes si el bot está en pausa
    if (botPaused) {
      console.log(`⏸️ [Bot Pausado] Mensaje de [${telefono}] ignorado.`);
      return;
    }

    // Ignorar mensajes de grupos, boletines (canales) y difusiones
    if (!telefono.endsWith('@c.us') && !telefono.endsWith('@lid')) {
      console.log(`🚫 Mensaje de JID no soportado [${telefono}] ignorado.`);
      return;
    }

    // Obtener contacto y resolver número de teléfono real
    const contact = await message.getContact();
    const obtenerTelefonoReal = () => {
      if (message.senderPn) return message.senderPn.replace(/\D/g, '');
      if (message._data && message._data.senderPn) return message._data.senderPn.replace(/\D/g, '');
      if (contact && contact.number) return contact.number.replace(/\D/g, '');
      return telefono.split('@')[0];
    };
    const telefonoReal = obtenerTelefonoReal();

    console.log(`📩 Mensaje recibido de [${telefono}] (${telefonoReal}): "${texto}"`);

    // Obtener o crear sesión en memoria para este cliente
    if (!sessions[telefono]) {
      sessions[telefono] = {
        estado: 'idle', // idle, esperando_nombre, esperando_confirmacion
        jugadasPendientes: []
      };
    }
    const session = sessions[telefono];

    // 1. Verificar si el cliente existe en la Base de Datos Caché (usando telefonoReal como ID único)
    let clienteData = cache.clientes.find(c => c.id === telefonoReal || c.telefono === telefonoReal);

    // Si no existe con el ID único telefonoReal, buscar en el JID anterior para migrarlo
    if (!clienteData) {
      const oldClienteIndex = cache.clientes.findIndex(c => c.id === telefono || c.clienteJid === telefono);
      if (oldClienteIndex !== -1) {
        console.log(`🔄 Migrando cliente antiguo JID [${telefono}] a ID único [${telefonoReal}]`);
        const oldData = cache.clientes[oldClienteIndex];
        
        // Crear el nuevo documento con los datos y JID actualizados
        clienteData = {
          ...oldData,
          telefono: telefonoReal,
          clienteJid: telefono,
          id: telefonoReal
        };

        // Actualizar en base de datos física y local
        await dbDelete('clientes', oldData.id);
        await dbSet('clientes', telefonoReal, clienteData);
      }
    }

    // FLUJO 1: Cliente nuevo (no registrado)
    if (!clienteData) {
      if (session.estado === 'esperando_nombre') {
        const nombreCliente = texto;
        
        // Registrar en Firestore con telefonoReal como ID
        const nuevoCliente = {
          nombre: nombreCliente,
          telefono: telefonoReal, // Número de teléfono real
          clienteJid: telefono,   // JID actual de WhatsApp
          deuda: 0,
          totalJugado: 0,
          fechaRegistro: new Date().toISOString()
        };
        await dbSet('clientes', telefonoReal, nuevoCliente);
        
        session.estado = 'idle';
        const activeLoteriasNames = cache.loterias
          .filter(l => l.activa !== false)
          .map(l => `*${l.nombre}*`)
          .join(', ');

        await message.reply(`✅ Registrado con éxito, *${nombreCliente}*.\nYa puedes enviar tus jugadas.\n\n🎰 *Loterías disponibles hoy:* ${activeLoteriasNames || 'Ninguna por el momento'}\n\n_Ejemplo: "perro 5000 lotto activo y gato 3000 granjita"_`);
        console.log(`👤 Nuevo cliente registrado: ${nombreCliente} (${telefonoReal})`);
        return;
      } else {
        session.estado = 'esperando_nombre';
        await message.reply(`🍀 *¡Bienvenido a Agencia de lotería betagama!* 🍀\n\nNo estás registrado en nuestro sistema.\n\n*¿Cómo te llamas?* (Responde solo con tu nombre para registrarte)`);
        return;
      }
    }

    const nombreCliente = clienteData.nombre;

    // Mantener actualizado el JID de contacto en Firestore
    if (clienteData.clienteJid !== telefono) {
      clienteData.clienteJid = telefono;
      await dbUpdate('clientes', telefonoReal, { clienteJid: telefono });
    }

    // FLUJO: Si está esperando confirmación de una jugada
    if (session.estado === 'esperando_confirmacion') {
      const respuesta = texto.toUpperCase();
      if (respuesta === 'SI' || respuesta === 'SÍ' || respuesta === 'CONFIRMAR') {
        // Guardar las jugadas confirmadas en Firestore
        const batch = isMock ? null : db.batch();
        const jugadasGuardadas = [];
        const timestamp = new Date().toISOString();
        const ticketNum = Math.floor(100000 + Math.random() * 900000).toString(); // Ticket de 6 dígitos

        for (const jugada of session.jugadasPendientes) {
          const jugadaId = 'jugada_' + Math.random().toString(36).substring(2, 11);
          const nuevaJugada = {
            clienteTelefono: clienteData.telefono || telefonoReal,
            clienteJid: telefono, // Guardamos el JID completo
            clienteNombre: nombreCliente,
            loteria: jugada.loteria || 'lotto activo', // por defecto
            tipo: 'animalito',
            valor: `${jugada.animal} (#${jugada.numero})`,
            monto: jugada.monto,
            estado: 'pendiente', // pendiente, jugada, ganadora, pagada, anulada
            estadoPago: 'deuda', // deuda, pagado
            empleado: 'bot',
            fecha: timestamp,
            ticketNumero: ticketNum,
            sorteoHora: jugada.sorteoHora || '09:00am', // Asignar el horario calculado
            sorteoFecha: jugada.sorteoFecha || timestamp.split('T')[0]
          };

          if (isMock) {
            // Se insertará de manera directa al cache local
          } else {
            const docRef = db.collection('jugadas').doc(jugadaId);
            batch.set(docRef, nuevaJugada);
          }
          
          // Guardar localmente en el cache
          cache.jugadas.push({ id: jugadaId, ...nuevaJugada });
          jugadasGuardadas.push(nuevaJugada);
        }

        // Actualizar deuda acumulada del cliente en Firestore
        const totalMonto = session.jugadasPendientes.reduce((sum, j) => sum + j.monto, 0);
        const nuevaDeuda = (clienteData.deuda || 0) + totalMonto;
        const nuevoTotalJugado = (clienteData.totalJugado || 0) + totalMonto;
        
        clienteData.deuda = nuevaDeuda;
        clienteData.totalJugado = nuevoTotalJugado;

        await dbUpdate('clientes', telefonoReal, {
          deuda: nuevaDeuda,
          totalJugado: nuevoTotalJugado
        });

        if (!isMock && batch) {
          await batch.commit();
        }

        // Responder confirmación con resumen
        let msgConfirm = `✅ *Jugadas registradas con éxito!*\n🎟️ Ticket: *#${ticketNum}*\n\n`;
        session.jugadasPendientes.forEach((j, i) => {
          const horaS = j.sorteoHora || '09:00am';
          msgConfirm += `${i + 1}. *${(j.loteria || 'Lotto Activo').toUpperCase()}* (${horaS}) ➔ ${j.animal.toUpperCase()} (#${j.numero}) — Bs. ${j.monto.toLocaleString('de-DE')}\n`;
        });
        msgConfirm += `\n💰 Total acumulado a tu deuda: *Bs. ${totalMonto.toLocaleString('de-DE')}*`;
        msgConfirm += `\n⏳ Las jugadas han sido enviadas al operador del panel. ¡Mucha suerte! 🍀`;

        await message.reply(msgConfirm);

        // Enviar instrucciones de pago móvil si están configuradas
        const pm = cache.configuracion.pagoMovil;
        if (pm && pm.telefono && pm.banco) {
          const msgPago = `💳 *Instrucciones de Pago*\n\nPara procesar tu jugada debes realizar el pago móvil por *Bs. ${totalMonto.toLocaleString('de-DE')}* a los siguientes datos:\n\n🏦 *Banco:* ${pm.banco}\n📱 *Teléfono:* ${pm.telefono}\n🪪 *Cédula/RIF:* ${pm.cedula || 'N/A'}\n👤 *Nombre:* ${pm.nombre || 'N/A'}\n\n📸 *Envía el capture del comprobante de pago* a este mismo chat.\n\n⚠️ _De no poder verificarse el pago, la jugada será anulada automáticamente._`;
          await message.reply(msgPago);
        }
        
        // Limpiar estado
        session.estado = 'idle';
        session.jugadasPendientes = [];
        return;
      } else if (respuesta === 'NO' || respuesta === 'CANCELAR') {
        session.estado = 'idle';
        session.jugadasPendientes = [];
        await message.reply(`❌ *Jugada cancelada.*\n\nSi deseas hacer otra jugada, puedes enviarla ahora.`);
        return;
      } else {
        await message.reply(`⚠️ Por favor responde *SI* para registrar tus jugadas o *NO* para cancelarlas.`);
        return;
      }
    }

    // FLUJO: Esperando que el cliente complete la lotería faltante
    if (session.estado === 'esperando_loteria') {
      const resp = cleanText(texto);
      if (resp === 'cancelar' || resp === 'salir') {
        session.estado = 'idle';
        session.jugadasPendientes = [];
        await message.reply(`❌ *Jugada cancelada.*\n\nSi deseas hacer otra jugada, puedes enviarla ahora.`);
        return;
      }

      let loteriasList = cache.loterias.filter(l => l.activa !== false);

      let matchedLottery = null;
      
      const numMatch = resp.match(/^(\d+)$/);
      if (numMatch) {
        const index = parseInt(numMatch[1], 10) - 1;
        if (index >= 0 && index < loteriasList.length) {
          matchedLottery = loteriasList[index];
        }
      }

      if (!matchedLottery) {
        matchedLottery = loteriasList.find(l => {
          const lotNameClean = l.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const lotIdClean = l.id.toLowerCase().replace(/_/g, " ");
          return resp.includes(lotNameClean) || resp.includes(lotIdClean) || lotNameClean.includes(resp);
        });
      }

      if (!matchedLottery) {
        const listadoOpciones = loteriasList.map((l, index) => `${index + 1}️⃣ *${l.nombre}*`).join('\n');
        await message.reply(`⚠️ *Lotería no reconocida.*\n\nPor favor, responde con el número o el nombre de una de las siguientes loterías activas:\n\n${listadoOpciones}\n\nEscribe *cancelar* si deseas abortar.`);
        return;
      }

      const lotNameNormalizado = matchedLottery.nombre.toLowerCase();
      session.jugadasPendientes.forEach(j => {
        if (!j.loteria) {
          j.loteria = lotNameNormalizado;
        }
      });

      await procesarLimitesYSorteosDeJugadas(session.jugadasPendientes, loteriasList, message, session, clienteData, nombreCliente);
      return;
    }

    // FLUJO RETIRO: Esperando monto
    if (session.estado === 'esperando_monto_retiro') {
      const resp = cleanText(texto);
      if (resp === 'cancelar' || resp === 'salir') {
        session.estado = 'idle';
        await message.reply(`❌ *Retiro cancelado.*`);
        return;
      }

      // Parsear monto ingresado
      let cleaned = texto.replace(/[^\d.,]/g, '');
      if (cleaned.includes('.') && cleaned.includes(',')) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else if (cleaned.includes(',')) {
        cleaned = cleaned.replace(',', '.');
      } else if (cleaned.includes('.')) {
        const parts = cleaned.split('.');
        if (parts.length === 2 && parts[1].length === 3) {
          cleaned = cleaned.replace(/\./g, '');
        }
      }
      const monto = parseFloat(cleaned);
      const saldoFavor = clienteData.deuda < 0 ? Math.abs(clienteData.deuda) : 0;

      if (isNaN(monto) || monto <= 0) {
        await message.reply(`⚠️ *Monto inválido.*\n\nPor favor ingresa un monto numérico válido en Bolívares (ej: 5000).\nSi deseas cancelar, escribe *cancelar*.`);
        return;
      }

      if (monto > saldoFavor) {
        await message.reply(`⚠️ *Saldo insuficiente.*\n\nTu saldo a favor es de *Bs. ${saldoFavor.toLocaleString('de-DE')}*. No puedes retirar más de esa cantidad.\n\nPor favor ingresa un monto menor o escribe *cancelar*.`);
        return;
      }

      session.montoRetiro = monto;
      session.estado = 'esperando_datos_retiro';
      await message.reply(`💰 *Datos de Pago Móvil*\n\nPor favor ingresa los datos de tu Pago Móvil en el siguiente formato:\n\n*Banco, Cédula, Teléfono*\n\n_Ejemplo: Banesco, V-12345678, 04125555555_\n\nSi deseas cancelar, escribe *cancelar*.`);
      return;
    }

    // FLUJO RETIRO: Esperando datos de Pago Móvil
    if (session.estado === 'esperando_datos_retiro') {
      const resp = cleanText(texto);
      if (resp === 'cancelar' || resp === 'salir') {
        session.estado = 'idle';
        delete session.montoRetiro;
        await message.reply(`❌ *Retiro cancelado.*`);
        return;
      }

      session.datosRetiro = texto;
      session.estado = 'esperando_confirmacion_retiro';
      await message.reply(`❓ *Confirmación de Retiro*\n\nPor favor confirma los datos de tu solicitud:\n\n*Monto:* Bs. ${session.montoRetiro.toLocaleString('de-DE')}\n*Pago Móvil:* ${texto}\n\nResponde *SI* para confirmar o *NO* para cancelar.`);
      return;
    }

    // FLUJO RETIRO: Esperando confirmación
    if (session.estado === 'esperando_confirmacion_retiro') {
      const respuesta = texto.toUpperCase();
      if (respuesta === 'SI' || respuesta === 'SÍ' || respuesta === 'CONFIRMAR') {
        const monto = session.montoRetiro;
        const datos = session.datosRetiro;

        // Registrar en retiros
        const retiroId = 'retiro_' + Math.random().toString(36).substring(2, 11);
        const timestamp = new Date().toISOString();

        const nuevoRetiro = {
          id: retiroId,
          clienteTelefono: clienteData.telefono,
          clienteNombre: clienteData.nombre,
          clienteJid: telefono,
          monto: monto,
          datosPagoMovil: datos,
          estado: 'pendiente', // pendiente, completado, rechazado
          fecha: timestamp,
          referencia: '',
          comentario: ''
        };

        await dbSet('retiros', retiroId, nuevoRetiro);

        // Actualizar balance del cliente
        const nuevaDeuda = (clienteData.deuda || 0) + monto;
        clienteData.deuda = nuevaDeuda;
        await dbUpdate('clientes', telefonoReal, {
          deuda: nuevaDeuda
        });

        await message.reply(`✅ *Solicitud de retiro registrada con éxito!*\n\nTu retiro de *Bs. ${monto.toLocaleString('de-DE')}* ha sido registrado. Te notificaremos cuando tu Pago Móvil haya sido procesado por administración.`);
        
        session.estado = 'idle';
        delete session.montoRetiro;
        delete session.datosRetiro;
        return;
      } else if (respuesta === 'NO' || respuesta === 'CANCELAR') {
        session.estado = 'idle';
        delete session.montoRetiro;
        delete session.datosRetiro;
        await message.reply(`❌ *Retiro cancelado.*`);
        return;
      } else {
        await message.reply(`⚠️ Por favor responde *SI* para confirmar tu retiro o *NO* para cancelarlo.`);
        return;
      }
    }

    // FLUJO CONTEXTUAL: Ajustar jugada rechazada ("ponlo por X", "ponlo en X", "entonces ponlo por X", "ponlo por")
    const cleanedText = cleanText(texto).replace(/[.,;:!?]/g, '').trim();
    const matchPonloPor = cleanedText.match(/^(?:entonces\s+)?ponlo(?:\s+(?:por|en))?(?:\s+(\d+|el\s+maximo|el\s+max|maximo|max))?\s*$/i);
    if (matchPonloPor) {
      if (!session.ultimaJugadaRechazada) {
        await message.reply(`⚠️ No tengo registro de ninguna jugada rechazada reciente para ajustar en esta conversación.`);
        return;
      }

      let montoAjustado = 0;
      const param = matchPonloPor[1] ? matchPonloPor[1].trim() : null;
      const limiteDisponible = session.ultimaJugadaRechazada.limiteDisponible;

      if (!param || param === 'el maximo' || param === 'el max' || param === 'maximo' || param === 'max') {
        montoAjustado = limiteDisponible;
      } else {
        montoAjustado = parseFloat(param);
      }

      if (isNaN(montoAjustado) || montoAjustado <= 0) {
        await message.reply(`⚠️ El monto ingresado no es válido.`);
        return;
      }

      if (montoAjustado > limiteDisponible) {
        await message.reply(`⚠️ El monto solicitado de Bs. ${montoAjustado.toLocaleString('de-DE')} excede el límite permitido de Bs. ${limiteDisponible.toLocaleString('de-DE')}. Por favor responde con un monto menor o igual.`);
        return;
      }

      // Re-construir lote completo
      let loteCompleto = [];
      let idxAdjusted = -1;
      
      if (session.ultimaJugadaRechazada.todasLasJugadas) {
        loteCompleto = [...session.ultimaJugadaRechazada.todasLasJugadas];
        idxAdjusted = session.ultimaJugadaRechazada.indexRechazado !== undefined ? session.ultimaJugadaRechazada.indexRechazado : -1;
        if (idxAdjusted >= 0 && idxAdjusted < loteCompleto.length) {
          loteCompleto[idxAdjusted] = {
            ...loteCompleto[idxAdjusted],
            monto: montoAjustado
          };
        }
      } else {
        const jugadaOriginal = session.ultimaJugadaRechazada.jugada;
        loteCompleto = [{
          ...jugadaOriginal,
          monto: montoAjustado
        }];
        idxAdjusted = 0;
      }

      // Limpiar el contexto para evitar ejecuciones repetidas
      delete session.ultimaJugadaRechazada;

      // Colocar en jugadas pendientes y cambiar a esperando confirmación
      session.jugadasPendientes = loteCompleto;
      session.estado = 'esperando_confirmacion';

      let msgConfirmacion = `📋 *Confirma tus jugadas, ${nombreCliente}:*\n\n`;
      let total = 0;
      loteCompleto.forEach((j, index) => {
        const lot = j.loteria ? j.loteria.toUpperCase() : 'LOTTO ACTIVO';
        const isAdjusted = index === idxAdjusted;
        msgConfirmacion += `${index + 1}. *${lot}* (${j.sorteoHora}) ➔ ${j.animal.toUpperCase()} (#${j.numero}) — Bs. ${j.monto.toLocaleString('de-DE')}${isAdjusted ? ' ⚠️ _(Ajustado)_' : ''}\n`;
        total += j.monto;
      });
      msgConfirmacion += `\n💰 Total a pagar: *Bs. ${total.toLocaleString('de-DE')}*\n\n`;
      msgConfirmacion += `Responde *SI* para registrar tus jugadas o *NO* para cancelarlas.`;

      await message.reply(msgConfirmacion);
      return;
    }

    // OBTENER LOTERIAS DINÁMICAS DESDE CACHÉ
    let loteriasList = cache.loterias.filter(l => l.activa !== false);

    // FLUJO 2 Y 3: Jugada Simple o Múltiple (Interpretación del mensaje)
    const interpretacion = await interpretarMensaje(texto, loteriasList);

    if (interpretacion.valido && interpretacion.jugadas && interpretacion.jugadas.length > 0) {
      // Verificar si alguna jugada no tiene la lotería especificada
      const jugadasSinLoteria = interpretacion.jugadas.filter(j => !j.loteria);
      if (jugadasSinLoteria.length > 0) {
        session.jugadasPendientes = interpretacion.jugadas;
        session.estado = 'esperando_loteria';

        const listadoOpciones = loteriasList.map((l, idx) => `${idx + 1}️⃣ *${l.nombre}*`).join('\n');
        
        let msgSinLoteria = `¡Hola *${nombreCliente}*! 😊\n\nEntendido, deseas registrar una jugada:\n\n`;
        interpretacion.jugadas.forEach((j) => {
          const animalCapitalized = j.animal ? j.animal.charAt(0).toUpperCase() + j.animal.slice(1) : `Número ${j.numero}`;
          const lotInfo = j.loteria ? `en *${j.loteria.toUpperCase()}*` : `(Lotería pendiente ❓)`;
          msgSinLoteria += `🐾 *${animalCapitalized}* (#${j.numero}) ➔ *Bs. ${j.monto.toLocaleString('de-DE')}* ${lotInfo}\n`;
        });
        msgSinLoteria += `\nPara completar tu apuesta, por favor dime para cuál de nuestras loterías activas deseas jugar:\n\n${listadoOpciones}\n\n_Responde con el número de la opción o el nombre de la lotería (ej. "1" o "Lotto Activo"). Si deseas cancelar, escribe *cancelar*._`;
        
        await message.reply(msgSinLoteria);
        return;
      }

      await procesarLimitesYSorteosDeJugadas(interpretacion.jugadas, loteriasList, message, session, clienteData, nombreCliente);
    } else {
      // Si el mensaje no se entendió como una jugada válida, comprobamos palabras clave

      // FLUJO: Consulta de Loterías Disponibles
      const palabrasClaveLoterias = ['cuales loterias', 'loterias disponibles', 'loterias activas', 'que loterias hay', 'loterias hay', 'lista de loterias', 'loterias', 'loteria'];
      if (palabrasClaveLoterias.some(pc => cleanedText.includes(pc))) {
        const activeLoteriasNames = cache.loterias
          .filter(l => l.activa !== false)
          .map(l => `🔸 *${l.nombre}* (Premio: ${l.multiplicador}x, Límite: Bs. ${l.limite.toLocaleString('de-DE')})`)
          .join('\n');
        
        await message.reply(`🎰 *Loterías Disponibles hoy:*\n\n${activeLoteriasNames || 'No hay loterías activas por el momento.'}\n\n_Para realizar una jugada, escribe el nombre del animalito, monto y la lotería. Ejemplo: "mono 2000 granjita"_`);
        return;
      }

      // FLUJO: Consulta de Deuda ("cuanto debo", "deuda", "saldo")
      const palabrasClaveDeuda = ['cuanto debo', 'mi deuda', 'deuda', 'saldo', 'pagar'];
      if (palabrasClaveDeuda.some(pc => cleanedText.includes(pc))) {
        const jugadasQuery = cache.jugadas.filter(j => j.clienteTelefono === clienteData.telefono && j.estadoPago === 'deuda');
        const totalDeuda = clienteData.deuda || 0;

        if (jugadasQuery.length === 0 || totalDeuda === 0) {
          await message.reply(`💳 *Saldo Pendiente:* Bs. 0\n\nNo tienes jugadas pendientes de pago. ¡Estás al día! 👍`);
        } else {
          let msgDeuda = `💳 *Tu saldo pendiente:* Bs. *${totalDeuda.toLocaleString('de-DE')}*\n\n*Jugadas sin pagar:* \n`;
          let counter = 1;
          jugadasQuery.forEach(j => {
            const fechaFormateada = new Date(j.fecha).toLocaleDateString('es-VE', {hour: '2-digit', minute:'2-digit'});
            msgDeuda += `${counter}. #${j.ticketNumero || 'Ticket'} (${fechaFormateada}) - *${j.valor}* en *${j.loteria}* - Bs. ${j.monto.toLocaleString('de-DE')}\n`;
            counter++;
          });
          msgDeuda += `\nPara registrar un pago, comunícate con el administrador o reporta tu transferencia.`;
          await message.reply(msgDeuda);
        }
        return;
      }

      // FLUJO: Solicitud de Retiro ("retirar", "retiro", "pago movil", "cobrar premio")
      const palabrasClaveRetiro = ['retirar', 'retiro', 'pago movil', 'cobrar premio', 'cobrar mi premio'];
      if (palabrasClaveRetiro.some(pc => cleanedText.includes(pc)) && session.estado === 'idle') {
        const saldoFavor = clienteData.deuda < 0 ? Math.abs(clienteData.deuda) : 0;
        
        if (saldoFavor <= 0) {
          await message.reply(`⚠️ *Retiro no disponible*\n\nActualmente no posees saldo a favor disponible para retirar. Tu balance es de Bs. ${clienteData.deuda.toLocaleString('de-DE')} (pendiente de pago).`);
          return;
        }
        
        session.estado = 'esperando_monto_retiro';
        await message.reply(`💰 *Solicitud de Retiro*\n\nPosees un saldo a favor de *Bs. ${saldoFavor.toLocaleString('de-DE')}*.\n\n*¿Cuánto deseas retirar?* (Responde solo con el número del monto en Bolívares)`);
        return;
      }

      // El mensaje no se entendió como una jugada válida y no coincide con palabras clave
      const activeLoteriasNames = cache.loterias
        .filter(l => l.activa !== false)
        .map(l => `*${l.nombre}*`)
        .join(', ');

      const saludoHumano = `¡Hola *${nombreCliente}*! 😊 ¿Cómo estás?\n\nNo logré entender tu mensaje como una jugada o comando.\n\n🎰 *Loterías disponibles hoy:* ${activeLoteriasNames || 'Ninguna por el momento'}\n\n✍️ *Si deseas jugar*, indícame el animalito, el monto y la lotería. Por ejemplo:\n👉 "perro 5000 lotto activo"\n👉 "mono 3000 la granjita y delfin 5000 guacharo"\n\n💰 *Si deseas retirar tu saldo*, escribe *retirar* o *pago movil*.\n\n📊 *Si deseas consultar tu deuda*, escribe *deuda* o *saldo*.\n\n¿En qué te puedo ayudar hoy?`;
      await message.reply(saludoHumano);
    }

  } catch (error) {
    console.error('❌ Error en flujo del mensaje de WhatsApp:', error);
  }
});

// Función utilitaria para limpiar acentos y mayúsculas
function cleanText(text) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Inicializar el cliente de WhatsApp
try {
  client.initialize();
} catch (initErr) {
  console.error('❌ Error al inicializar el cliente de WhatsApp:', initErr.message);
}

async function obtenerEstadisticasRiesgo(loteriaId) {
  try {
    let rawSorteos = [...cache.sorteos];
    let targetAnimalMap = ANIMALITOS_MAP;
    
    if (loteriaId) {
      const normInput = loteriaId.toLowerCase().trim().replace(/\s+/g, '_');
      rawSorteos = rawSorteos.filter(s => {
        const normSorteo = s.loteria.toLowerCase().trim().replace(/\s+/g, '_');
        return normSorteo === normInput || 
               (normSorteo === 'lotto' && normInput === 'lotto_activo') || 
               (normSorteo === 'lotto_activo' && normInput === 'lotto') ||
               (normSorteo === 'granja' && normInput === 'la_granjita') ||
               (normSorteo === 'la_granjita' && normInput === 'granja') ||
               (normSorteo === 'guacharo_activo' && normInput === 'guacharo') ||
               (normSorteo === 'guacharo' && normInput === 'guacharo_activo');
      });

      // Buscar el mapa de animales dinámico en caché para esta lotería
      const matchedLot = cache.loterias.find(l => {
        const normName = l.nombre.toLowerCase().trim().replace(/\s+/g, '_');
        const normId = l.id.toLowerCase().trim().replace(/\s+/g, '_');
        return normName === normInput || normId === normInput ||
               (normName === 'lotto_activo' && normInput === 'lotto') ||
               (normName === 'la_granjita' && normInput === 'granja') ||
               (normName === 'guacharo' && normInput === 'guacharo_activo');
      });
      if (matchedLot && matchedLot.animales && Object.keys(matchedLot.animales).length > 0) {
        targetAnimalMap = matchedLot.animales;
      }
    }
    
    const parseTimeToMinutes = (h) => {
      const matches = h.match(/(\d+):(\d+)(am|pm)/i);
      if (!matches) return 0;
      let hr = parseInt(matches[1], 10);
      const min = parseInt(matches[2], 10);
      const meridiano = matches[3].toLowerCase();
      if (meridiano === 'pm' && hr < 12) hr += 12;
      if (meridiano === 'am' && hr === 12) hr = 0;
      return hr * 60 + min;
    };

    const obtenerCodigoResultado = (resStr) => {
      if (!resStr) return '';
      const match = resStr.match(/\(#(\d+)\)/);
      if (match) return match[1];
      return resStr.trim();
    };

    // Ordenar sorteos del más reciente al más antiguo
    const sortedByRecency = [...rawSorteos].sort((a, b) => {
      const dateCompare = b.fecha.localeCompare(a.fecha);
      if (dateCompare !== 0) return dateCompare;
      return parseTimeToMinutes(b.hora) - parseTimeToMinutes(a.hora);
    });

    const freq = {};
    for (const num of Object.keys(targetAnimalMap)) {
      freq[num] = 0;
    }

    rawSorteos.forEach(s => {
      const num = obtenerCodigoResultado(s.resultado);
      if (num && freq[num] !== undefined) {
        freq[num]++;
      }
    });

    const listaFrecuencias = Object.entries(freq).map(([num, count]) => ({
      numero: num,
      animal: targetAnimalMap[num],
      frecuencia: count
    })).sort((a, b) => b.frecuencia - a.frecuencia);

    // Obtener el último ganador del sorteo más reciente para excluirlo de la lista caliente (Opción 1)
    let ultimoResultado = null;
    if (sortedByRecency.length > 0) {
      ultimoResultado = obtenerCodigoResultado(sortedByRecency[0].resultado);
    }

    const listaFrecuenciasFiltradas = ultimoResultado 
      ? listaFrecuencias.filter(f => f.numero !== ultimoResultado)
      : listaFrecuencias;

    // Los 3 animales más calientes (excluyendo el último ganador)
    const calientes = listaFrecuenciasFiltradas.slice(0, 3).map(f => f.numero);

    // Calcular atrasados (Opción 2): cantidad de sorteos transcurridos desde su última aparición
    const coldScores = {};
    for (const num of Object.keys(targetAnimalMap)) {
      coldScores[num] = 9999; // Por defecto si nunca ha salido en el rango
    }

    sortedByRecency.forEach((s, idx) => {
      const code = obtenerCodigoResultado(s.resultado);
      if (code && coldScores[code] === 9999) {
        coldScores[code] = idx;
      }
    });

    const listaAtrasados = Object.entries(coldScores).map(([num, score]) => ({
      numero: num,
      animal: targetAnimalMap[num],
      atraso: score
    })).sort((a, b) => b.atraso - a.atraso);

    // Los 3 animales más atrasados (fríos)
    const atrasados = listaAtrasados.slice(0, 3).map(f => f.numero);

    return {
      listaFrecuencias,
      calientes,
      atrasados
    };
  } catch (error) {
    console.error("Error al calcular estadísticas de riesgo:", error);
    const listaFrecuencias = Object.entries(ANIMALITOS_MAP).map(([num, name]) => ({
      numero: num,
      animal: name,
      frecuencia: 0
    }));
    return {
      listaFrecuencias,
      calientes: [],
      atrasados: []
    };
  }
}


// Obtener estado del Bot de WhatsApp y API
app.get('/api/status', (req, res) => {
  res.json({ whatsapp: botState, paused: botPaused, qr: latestQr });
});

// Activar / Pausar el bot sin desconectar WhatsApp
app.post('/api/bot/toggle', (req, res) => {
  const { paused } = req.body;
  if (typeof paused === 'boolean') {
    botPaused = paused;
  } else {
    botPaused = !botPaused; // Alternar si no se especifica
  }
  const estado = botPaused ? '⏸️ PAUSADO' : '▶️ ACTIVO';
  console.log(`🤖 Bot ${estado} manualmente desde el panel.`);
  res.json({ success: true, paused: botPaused, message: `Bot ${estado}` });
});

// Resetear sesión del bot (borrar credenciales y pedir QR nuevo)
app.post('/api/bot/reset', async (req, res) => {
  try {
    console.log('🔄 Petición de reinicio de sesión de WhatsApp recibida...');
    
    // Detener el cliente si está activo
    try {
      await client.destroy();
    } catch (destroyErr) {
      console.warn('Advertencia al destruir cliente:', destroyErr.message);
    }
    
    // Dar 1.5 segundos para que Puppeteer se cierre por completo y libere los archivos
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Borrar el contenido de la carpeta de autenticación (sin borrar la carpeta en sí porque es un volumen montado)
    const authPath = path.resolve('./.wwebjs_auth');
    if (fs.existsSync(authPath)) {
      const files = fs.readdirSync(authPath);
      for (const file of files) {
        const curPath = path.join(authPath, file);
        try {
          fs.rmSync(curPath, { recursive: true, force: true });
        } catch (rmErr) {
          console.warn(`No se pudo borrar el archivo/directorio ${file}:`, rmErr.message);
        }
      }
      console.log('🗑️ Contenido de .wwebjs_auth eliminado con éxito.');
    }
    
    // Reiniciar el estado
    botState = 'disconnected';
    latestQr = null;
    
    // Inicializar el cliente de nuevo en segundo plano
    client.initialize().catch(err => {
      console.error('Error al re-inicializar el cliente:', err.message);
    });
    
    res.json({ success: true, message: 'Sesión de WhatsApp reseteada. Generando nuevo código QR...' });
  } catch (error) {
    console.error('Error al resetear la sesión del bot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener configuración general (Límites)
app.get('/api/configuracion', (req, res) => {
  res.json({
    limiteMaxJugada: cache.configuracion.limiteMaxJugada || 10000,
    limitesPorLoteria: cache.configuracion.limitesPorLoteria || {
      "lotto activo": 5000,
      "la granjita": 4000,
      "guacharo": 3000
    },
    pagoMovil: cache.configuracion.pagoMovil || {}
  });
});

// Guardar configuración general
app.post('/api/configuracion', async (req, res) => {
  const { limiteMaxJugada, limitesPorLoteria, pagoMovil } = req.body;
  try {
    const updateData = { limiteMaxJugada: parseFloat(limiteMaxJugada) || 10000 };
    if (limitesPorLoteria) {
      updateData.limitesPorLoteria = {
        "lotto activo": parseFloat(limitesPorLoteria["lotto activo"]) || 5000,
        "la granjita": parseFloat(limitesPorLoteria["la granjita"]) || 4000,
        "guacharo": parseFloat(limitesPorLoteria["guacharo"]) || 3000
      };
    }
    // Guardar datos de Pago Móvil si vienen en el body
    if (pagoMovil) {
      updateData.pagoMovil = {
        telefono: pagoMovil.telefono || '',
        banco: pagoMovil.banco || '',
        cedula: pagoMovil.cedula || '',
        nombre: pagoMovil.nombre || ''
      };
    }
    await dbSet('configuracion', 'general', updateData, true);
    res.json({ success: true, message: 'Configuración guardada.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener configuración de riesgos
app.get('/api/configuracion/riesgos', async (req, res) => {
  const { loteria } = req.query;
  try {
    const data = {
      animalesBloqueados: cache.riesgos.animalesBloqueados || [],
      porcentajesLimite: cache.riesgos.porcentajesLimite || {},
      autoLimitarCalientes: cache.riesgos.autoLimitarCalientes !== undefined ? cache.riesgos.autoLimitarCalientes : true,
      porcentajeLimitaCalientes: cache.riesgos.porcentajeLimitaCalientes !== undefined ? cache.riesgos.porcentajeLimitaCalientes : 0.20,
      factorCupoColectivo: cache.riesgos.factorCupoColectivo !== undefined ? cache.riesgos.factorCupoColectivo : 3.0
    };
    const stats = await obtenerEstadisticasRiesgo(loteria);
    res.json({
      ...data,
      listaFrecuencias: stats.listaFrecuencias,
      calientes: stats.calientes,
      atrasados: stats.atrasados || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Guardar configuración de riesgos
app.post('/api/configuracion/riesgos', async (req, res) => {
  const { animalesBloqueados, porcentajesLimite, autoLimitarCalientes, porcentajeLimitaCalientes, factorCupoColectivo } = req.body;
  try {
    const updateData = {
      animalesBloqueados: Array.isArray(animalesBloqueados) ? animalesBloqueados : [],
      porcentajesLimite: porcentajesLimite || {},
      autoLimitarCalientes: autoLimitarCalientes !== undefined ? !!autoLimitarCalientes : true,
      porcentajeLimitaCalientes: porcentajeLimitaCalientes !== undefined ? parseFloat(porcentajeLimitaCalientes) : 0.20,
      factorCupoColectivo: factorCupoColectivo !== undefined ? parseFloat(factorCupoColectivo) : 3.0
    };
    await dbSet('configuracion', 'riesgos', updateData, true);
    res.json({ success: true, message: 'Configuración de riesgos guardada.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener todos los clientes
app.get('/api/clientes', (req, res) => {
  res.json(cache.clientes);
});

// Obtener todas las jugadas
app.get('/api/jugadas', (req, res) => {
  res.json(cache.jugadas);
});

// Modificar datos de cliente (Nombre, Teléfono, Deuda) con re-keying
app.put('/api/clientes/:oldTelefono', async (req, res) => {
  const { oldTelefono } = req.params;
  const { nombre, telefono: newTelefono, deuda } = req.body;
  
  try {
    const oldData = cache.clientes.find(c => c.id === oldTelefono || c.telefono === oldTelefono);
    if (!oldData) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    const parsedDeuda = parseFloat(deuda) || 0;
    
    if (newTelefono && newTelefono !== oldTelefono) {
      const exists = cache.clientes.some(c => c.id === newTelefono || c.telefono === newTelefono);
      if (exists) {
        return res.status(400).json({ error: 'Ya existe un cliente con ese número de teléfono.' });
      }
      
      const updatedData = {
        ...oldData,
        nombre: nombre || oldData.nombre,
        telefono: newTelefono,
        deuda: parsedDeuda,
        clienteJid: `${newTelefono}@c.us`
      };
      
      await dbSet('clientes', newTelefono, updatedData);
      await dbDelete('clientes', oldTelefono);
      
      const batch = isMock ? null : db.batch();
      let jugadasCount = 0;
      
      cache.jugadas.forEach(j => {
        if (j.clienteTelefono === oldTelefono) {
          j.clienteTelefono = newTelefono;
          j.clienteJid = `${newTelefono}@c.us`;
          if (!isMock && batch) {
            batch.update(db.collection('jugadas').doc(j.id), {
              clienteTelefono: newTelefono,
              clienteJid: `${newTelefono}@c.us`
            });
          }
          jugadasCount++;
        }
      });
      if (!isMock && batch && jugadasCount > 0) {
        await batch.commit();
      }
      
      const premiosQuery = await db.collection('premios').where('clienteTelefono', '==', oldTelefono).get();
      const batchPremios = isMock ? null : db.batch();
      let premiosCount = 0;
      
      for (const doc of premiosQuery.docs) {
        if (!isMock && batchPremios) {
          batchPremios.update(db.collection('premios').doc(doc.id), {
            clienteTelefono: newTelefono,
            clienteJid: `${newTelefono}@c.us`
          });
        }
        premiosCount++;
      }
      if (!isMock && batchPremios && premiosCount > 0) {
        await batchPremios.commit();
      }
      
      console.log(`🔄 Re-keying de cliente completado de ${oldTelefono} a ${newTelefono}. Actualizadas ${jugadasCount} jugadas y ${premiosCount} premios.`);
    } else {
      oldData.nombre = nombre || oldData.nombre;
      oldData.deuda = parsedDeuda;
      await dbUpdate('clientes', oldTelefono, {
        nombre: oldData.nombre,
        deuda: parsedDeuda
      });
    }
    
    res.json({ success: true, message: 'Cliente actualizado correctamente.' });
  } catch (error) {
    console.error('Error al actualizar cliente:', error);
    res.status(500).json({ error: error.message });
  }
});

// Eliminar cliente
app.delete('/api/clientes/:telefono', async (req, res) => {
  const { telefono } = req.params;
  try {
    const clienteIdx = cache.clientes.findIndex(c => c.id === telefono || c.telefono === telefono);
    if (clienteIdx === -1) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const cliente = cache.clientes[clienteIdx];

    // Eliminar del cache
    cache.clientes.splice(clienteIdx, 1);

    // Eliminar de Firestore en background
    dbDelete('clientes', cliente.id || telefono);

    console.log(`🗑️ Cliente eliminado: ${cliente.nombre} (${telefono})`);
    res.json({ success: true, message: `Cliente ${cliente.nombre} eliminado correctamente.` });
  } catch (error) {
    console.error('Error al eliminar cliente:', error);
    res.status(500).json({ error: error.message });
  }
});

// Registrar pago / abono de deuda de un cliente
app.post('/api/clientes/:telefono/pago', async (req, res) => {
  const { telefono } = req.params;
  const { monto } = req.body;
  try {
    const clienteData = cache.clientes.find(c => c.telefono === telefono);
    if (!clienteData) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    const nuevaDeuda = Math.max(0, (clienteData.deuda || 0) - parseFloat(monto));
    clienteData.deuda = nuevaDeuda;
    await dbUpdate('clientes', clienteData.id, { deuda: nuevaDeuda });
    
    let restante = parseFloat(monto);
    const jugadasQuery = cache.jugadas.filter(j => j.clienteTelefono === telefono && j.estadoPago === 'deuda');
    
    for (const j of jugadasQuery) {
      if (restante >= j.monto) {
        j.estadoPago = 'pagado';
        await dbUpdate('jugadas', j.id, { estadoPago: 'pagado' });
        restante -= j.monto;
      } else {
        break;
      }
    }

    res.json({ success: true, message: 'Pago registrado con éxito y deuda actualizada.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Aprobación: Marcar como PAGADA
app.post('/api/jugadas/:id/procesar-pagada', async (req, res) => {
  const { id } = req.params;
  const { empleado } = req.body;
  try {
    const jugada = cache.jugadas.find(j => j.id === id);
    if (!jugada) {
      return res.status(404).json({ error: 'Jugada no encontrada' });
    }
    if (jugada.estado !== 'pendiente') {
      return res.status(400).json({ error: 'La jugada ya no está en estado pendiente' });
    }

    jugada.estado = 'jugada';
    jugada.estadoPago = 'pagado';
    jugada.empleado = empleado || 'panel';
    await dbUpdate('jugadas', id, {
      estado: 'jugada',
      estadoPago: 'pagado',
      empleado: jugada.empleado
    });

    const clienteData = cache.clientes.find(c => c.telefono === jugada.clienteTelefono || c.clienteJid === jugada.clienteJid);
    if (clienteData) {
      const nuevaDeuda = Math.max(0, (clienteData.deuda || 0) - jugada.monto);
      clienteData.deuda = nuevaDeuda;
      await dbUpdate('clientes', clienteData.id, { deuda: nuevaDeuda });
    }

    await notificarEstadoJugada(id, 'jugada', 'pagado');
    res.json({ success: true, message: 'Jugada marcada como pagada.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Aprobación: Marcar como FIADA
app.post('/api/jugadas/:id/procesar-fiada', async (req, res) => {
  const { id } = req.params;
  const { empleado } = req.body;
  try {
    const jugada = cache.jugadas.find(j => j.id === id);
    if (!jugada) {
      return res.status(404).json({ error: 'Jugada no encontrada' });
    }
    if (jugada.estado !== 'pendiente') {
      return res.status(400).json({ error: 'La jugada ya no está en estado pendiente' });
    }

    jugada.estado = 'jugada';
    jugada.estadoPago = 'deuda';
    jugada.empleado = empleado || 'panel';
    await dbUpdate('jugadas', id, {
      estado: 'jugada',
      estadoPago: 'deuda',
      empleado: jugada.empleado
    });

    await notificarEstadoJugada(id, 'jugada', 'deuda');
    res.json({ success: true, message: 'Jugada marcada como fiada.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Aprobación: ANULAR
app.post('/api/jugadas/:id/anular', async (req, res) => {
  const { id } = req.params;
  const { empleado } = req.body;
  try {
    const jugada = cache.jugadas.find(j => j.id === id);
    if (!jugada) {
      return res.status(404).json({ error: 'Jugada no encontrada' });
    }
    if (jugada.estado !== 'pendiente') {
      return res.status(400).json({ error: 'La jugada ya no está en estado pendiente' });
    }

    jugada.estado = 'anulada';
    jugada.empleado = empleado || 'panel';
    await dbUpdate('jugadas', id, {
      estado: 'anulada',
      empleado: jugada.empleado
    });

    const clienteData = cache.clientes.find(c => c.telefono === jugada.clienteTelefono || c.clienteJid === jugada.clienteJid);
    if (clienteData) {
      const nuevaDeuda = Math.max(0, (clienteData.deuda || 0) - jugada.monto);
      clienteData.deuda = nuevaDeuda;
      await dbUpdate('clientes', clienteData.id, { deuda: nuevaDeuda });
    }

    await notificarEstadoJugada(id, 'anulada', '', 'por cancelación del operador');
    res.json({ success: true, message: 'Jugada anulada con éxito.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Aprobación de Ticket: Marcar todo el ticket como PAGADO
app.post('/api/tickets/:ticketNumero/procesar-pagada', async (req, res) => {
  const { ticketNumero } = req.params;
  const { empleado } = req.body;
  try {
    const matchingJugadas = cache.jugadas.filter(j => j.ticketNumero === ticketNumero && j.estado === 'pendiente');
    if (matchingJugadas.length === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado o sin jugadas pendientes' });
    }

    const batch = isMock ? null : db.batch();
    let totalMonto = 0;
    let clienteJid = null;
    let clienteTelefono = null;

    matchingJugadas.forEach(j => {
      j.estado = 'jugada';
      j.estadoPago = 'pagado';
      j.empleado = empleado || 'panel';
      
      if (!isMock && batch) {
        batch.update(db.collection('jugadas').doc(j.id), {
          estado: 'jugada',
          estadoPago: 'pagado',
          empleado: j.empleado
        });
      }
      totalMonto += j.monto;
      clienteJid = j.clienteJid;
      clienteTelefono = j.clienteTelefono;
    });

    if (totalMonto > 0) {
      if (!isMock && batch) await batch.commit();

      const clienteData = cache.clientes.find(c => c.telefono === clienteTelefono || c.clienteJid === clienteJid);
      if (clienteData) {
        const nuevaDeuda = Math.max(0, (clienteData.deuda || 0) - totalMonto);
        clienteData.deuda = nuevaDeuda;
        await dbUpdate('clientes', clienteData.id, { deuda: nuevaDeuda });
      }
    }

    await notificarEstadoTicket(ticketNumero, 'jugada', 'pagado');
    res.json({ success: true, message: 'Ticket procesado como pagado.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Aprobación de Ticket: Marcar todo el ticket como FIADO
app.post('/api/tickets/:ticketNumero/procesar-fiada', async (req, res) => {
  const { ticketNumero } = req.params;
  const { empleado } = req.body;
  try {
    const matchingJugadas = cache.jugadas.filter(j => j.ticketNumero === ticketNumero && j.estado === 'pendiente');
    if (matchingJugadas.length === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    const batch = isMock ? null : db.batch();
    matchingJugadas.forEach(j => {
      j.estado = 'jugada';
      j.estadoPago = 'deuda';
      j.empleado = empleado || 'panel';

      if (!isMock && batch) {
        batch.update(db.collection('jugadas').doc(j.id), {
          estado: 'jugada',
          estadoPago: 'deuda',
          empleado: j.empleado
        });
      }
    });

    if (!isMock && batch) {
      await batch.commit();
    }

    await notificarEstadoTicket(ticketNumero, 'jugada', 'deuda');
    res.json({ success: true, message: 'Ticket procesado como fiado.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Aprobación de Ticket: ANULAR todo el ticket
app.post('/api/tickets/:ticketNumero/anular', async (req, res) => {
  const { ticketNumero } = req.params;
  const { empleado } = req.body;
  try {
    const matchingJugadas = cache.jugadas.filter(j => j.ticketNumero === ticketNumero && j.estado === 'pendiente');
    if (matchingJugadas.length === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    const batch = isMock ? null : db.batch();
    let totalMonto = 0;
    let clienteJid = null;
    let clienteTelefono = null;

    matchingJugadas.forEach(j => {
      j.estado = 'anulada';
      j.empleado = empleado || 'panel';

      if (!isMock && batch) {
        batch.update(db.collection('jugadas').doc(j.id), {
          estado: 'anulada',
          empleado: j.empleado
        });
      }
      totalMonto += j.monto;
      clienteJid = j.clienteJid;
      clienteTelefono = j.clienteTelefono;
    });

    if (totalMonto > 0) {
      if (!isMock && batch) await batch.commit();

      const clienteData = cache.clientes.find(c => c.telefono === clienteTelefono || c.clienteJid === clienteJid);
      if (clienteData) {
        const nuevaDeuda = Math.max(0, (clienteData.deuda || 0) - totalMonto);
        clienteData.deuda = nuevaDeuda;
        await dbUpdate('clientes', clienteData.id, { deuda: nuevaDeuda });
      }
    }

    await notificarEstadoTicket(ticketNumero, 'anulada', '', 'por cancelación del operador');
    res.json({ success: true, message: 'Ticket anulado.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Función interna para registrar el resultado y premiar/descontar deuda automáticamente
async function registrarResultadoSorteoInternal(loteria, hora, resultado, fecha) {
  try {
    const sorteoId = `${loteria}_${fecha}_${hora}`.replace(/\s+/g, '_');
    const nuevoSorteo = {
      loteria,
      hora,
      resultado,
      fecha,
      cerrado: true
    };
    await dbSet('sorteos', sorteoId, nuevoSorteo);

    // Filtrar jugadas correspondientes en memoria caché
    const matchingJugadas = cache.jugadas.filter(j => 
      j.loteria === loteria && 
      j.sorteoHora === hora && 
      (j.sorteoFecha ? j.sorteoFecha === fecha : j.fecha.split('T')[0] === fecha)
    );

    let ganadoresCount = 0;
    let noGanadorasCount = 0;
    let anuladasCount = 0;

    for (const j of matchingJugadas) {
      if (j.estado === 'pendiente') {
        j.estado = 'anulada';
        await dbUpdate('jugadas', j.id, { estado: 'anulada' });
        
        const clienteData = cache.clientes.find(c => c.telefono === j.clienteTelefono || c.clienteJid === j.clienteJid);
        if (clienteData) {
          const nuevaDeuda = Math.max(0, (clienteData.deuda || 0) - j.monto);
          clienteData.deuda = nuevaDeuda;
          await dbUpdate('clientes', clienteData.id, { deuda: nuevaDeuda });
        }
        await notificarEstadoJugada(j.id, 'anulada', '', 'por no haber sido cancelada (pagada) a tiempo antes del sorteo');
        anuladasCount++;
      } else if (j.estado === 'jugada') {
        const valorJugado = j.valor.toLowerCase();
        const resultadoClean = resultado.toLowerCase().trim();
        
        let coincide = false;
        const matchNumber = valorJugado.match(/#(00|\d+)/);
        if (matchNumber) {
          const numeroJugado = matchNumber[1];
          const normJugado = (numeroJugado === '00' || numeroJugado === '0') ? numeroJugado : parseInt(numeroJugado, 10).toString();
          const normResultado = (resultadoClean === '00' || resultadoClean === '0') ? resultadoClean : parseInt(resultadoClean, 10).toString();
          coincide = (normJugado === normResultado);
        } else {
          coincide = valorJugado.includes(resultadoClean);
        }

        if (coincide) {
          let multiplicador = 30;
          const cachedLot = cache.loterias.find(l => {
            const cleanLName = l.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            const cleanLId = l.id.toLowerCase().replace(/_/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            const cleanQuery = loteria.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            return cleanLName === cleanQuery || cleanLId === cleanQuery || cleanLId === cleanQuery.replace(/\s+/g, '_');
          });
          if (cachedLot && cachedLot.multiplicador !== undefined) {
            multiplicador = parseFloat(cachedLot.multiplicador) || 30;
          }

          // Si es la lotería Guácharo y el resultado es el comodín 75, el multiplicador es 120x
          const isGuacharo = loteria.toLowerCase().includes('guacharo');
          const isComodin75 = resultadoClean === '75' || (matchNumber && parseInt(matchNumber[1], 10) === 75);
          if (isGuacharo && isComodin75) {
            multiplicador = 120;
          }

          const premioMonto = j.monto * multiplicador;
          j.estado = 'ganadora';
          await dbUpdate('jugadas', j.id, { estado: 'ganadora' });
          
          const nuevoPremio = {
            jugadaId: j.id,
            clienteTelefono: j.clienteTelefono,
            clienteJid: j.clienteJid || `${j.clienteTelefono}@c.us`,
            monto: premioMonto,
            estado: 'abonado',
            fecha: new Date().toISOString()
          };
          
          try {
            await db.collection('premios').add(nuevoPremio);
          } catch (err) {
            console.warn('[Firestore Error] Failed to write premio:', err.message);
          }

          const clienteData = cache.clientes.find(c => c.telefono === j.clienteTelefono || c.clienteJid === j.clienteJid);
          if (clienteData) {
            const nuevaDeuda = (clienteData.deuda || 0) - premioMonto;
            clienteData.deuda = nuevaDeuda;
            await dbUpdate('clientes', clienteData.id, { deuda: nuevaDeuda });
          }
          
          try {
            const actualJid = clienteData ? clienteData.clienteJid : (j.clienteJid || `${j.clienteTelefono}@c.us`);
            await client.sendMessage(actualJid, `🏆 *¡FELICIDADES, ${j.clienteNombre}!* 🏆\n\nTu jugada en *${loteria.toUpperCase()}* de *${j.valor}* para el sorteo de las ${hora} ha resultado *GANADORA*.\n\n💰 *Premio:* Bs. *${premioMonto.toLocaleString('de-DE')}*\n_El premio ha sido abonado automáticamente a tu saldo de deudas._`);
          } catch (err) {
            console.error(`No se pudo enviar notificación de premio a ${j.clienteTelefono}:`, err);
          }

          ganadoresCount++;
        } else {
          j.estado = 'no_ganadora';
          await dbUpdate('jugadas', j.id, { estado: 'no_ganadora' });
          noGanadorasCount++;
        }
      }
    }

    console.log(`✅ [Premiación] Sorteo ${loteria} - ${hora}: ${ganadoresCount} ganadores, ${noGanadorasCount} no ganadores, y ${anuladasCount} anuladas.`);
    return { ganadoresCount, noGanadorasCount, anuladasCount };
  } catch (error) {
    console.error(`❌ [Premiación] Error en procesamiento sorteo ${loteria} - ${hora}:`, error);
    throw error;
  }
}

// Scraper automático de resultados de lotería
async function ejecutarScraperResultados() {
  console.log('🔍 [Scraper] Consultando resultados en lotoven.com...');
  try {
    const res = await fetch('https://lotoven.com/animalitos/');
    if (!res.ok) {
      console.warn(`[Scraper] Error en petición HTTP: ${res.status}`);
      return;
    }
    const html = await res.text();

    const obtenerBloque = (loteriaId) => {
      const startTag = `<div id="${loteriaId}"`;
      const startIndex = html.indexOf(startTag);
      if (startIndex === -1) return '';
      let endIndex = html.indexOf('<div id="', startIndex + startTag.length);
      if (endIndex === -1) endIndex = html.indexOf('</section>', startIndex);
      if (endIndex === -1) endIndex = html.length;
      return html.substring(startIndex, endIndex);
    };

    const loterias = [
      { id: 'lottoactivo', name: 'lotto activo' },
      { id: 'lagranjita', name: 'la granjita' },
      { id: 'guacharoactivo', name: 'guacharo' }
    ];

    const regexItem = /<span class="info[^>]*>\s*(\d+)\s+([a-zA-ZáéíóúüñÉÓÚ\s]+)\s*<\/span>\s*<span class="info2\s+horario"[^>]*>\s*(\d{2}:\d{2})\s*([AP]M)\s*<\/span>/gi;
    const fechaHoy = new Date().toLocaleDateString('sv', { timeZone: 'America/Caracas' });

    for (const lot of loterias) {
      const block = obtenerBloque(lot.id);
      if (!block) continue;

      let match;
      regexItem.lastIndex = 0;
      while ((match = regexItem.exec(block)) !== null) {
        const numero = match[1];
        const animal = match[2].trim().toLowerCase();
        const horaStr = match[3];
        const meridiano = match[4].toLowerCase();
        const horaFormateada = `${horaStr}${meridiano}`; // Ej: "09:00am"

        // Verificar si este sorteo ya se registró en el Caché
        const sorteoId = `${lot.name}_${fechaHoy}_${horaFormateada}`.replace(/\s+/g, '_');
        const sorteoExiste = cache.sorteos.some(s => s.id === sorteoId);

        if (!sorteoExiste) {
          console.log(`✨ [Scraper] ¡NUEVO SORTEO DETECTADO! ${lot.name} (${horaFormateada}) ➔ ${animal} (#${numero})`);
          await registrarResultadoSorteoInternal(lot.name, horaFormateada, numero, fechaHoy);
        }
      }
    }
  } catch (error) {
    console.error('❌ [Scraper] Error en ejecución:', error);
  }
}

// Iniciar el scraper automático cada 5 minutos, solo entre 08:00 AM y 08:00 PM (hora Caracas)
function iniciarScraperResultados() {
  const ejecutarSiEnHorario = async () => {
    const horaCaracas = parseInt(
      new Date().toLocaleTimeString('en-US', { timeZone: 'America/Caracas', hour: 'numeric', hour12: false })
    );
    if (horaCaracas >= 8 && horaCaracas < 20) {
      await ejecutarScraperResultados();
    } else {
      console.log(`🌙 [Scraper] Fuera de horario (${horaCaracas}:xx). Solo opera entre 08:00 AM y 08:00 PM.`);
    }
  };

  ejecutarSiEnHorario(); // Ejecutar inmediatamente al iniciar
  setInterval(ejecutarSiEnHorario, 5 * 60 * 1000); // Cada 5 minutos
}

// Obtener todos los sorteos cargados
app.get('/api/sorteos', (req, res) => {
  res.json(cache.sorteos);
});

// Registrar resultado de un sorteo y marcar ganadores
app.post('/api/sorteos/resultado', async (req, res) => {
  const { loteria, hora, resultado, fecha } = req.body;
  try {
    const stats = await registrarResultadoSorteoInternal(loteria, hora, resultado, fecha);
    res.json({ 
      success: true, 
      message: `Resultado registrado. Sorteados: ${stats.ganadoresCount} ganadores, ${stats.noGanadorasCount} no ganadores, y ${stats.anuladasCount} jugadas pendientes anuladas.` 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Función para sembrar loterías por defecto si no existen
async function seedLoteriasIfNeeded() {
  try {
    if (cache.loterias.length === 0) {
      console.log('🌱 Inicializando colección de loterías con valores por defecto...');
      const defaultLoterias = [
        {
          id: 'lotto_activo',
          nombre: 'Lotto Activo',
          multiplicador: 30,
          horarios: ['09:00am', '10:00am', '11:00am', '12:00pm', '01:00pm', '03:00pm', '04:00pm', '05:00pm', '06:00pm', '07:00pm'],
          limite: 5000,
          cierreAnticipado: 5,
          animales: ANIMALITOS_MAP,
          activa: true
        },
        {
          id: 'la_granjita',
          nombre: 'La Granjita',
          multiplicador: 30,
          horarios: ['09:00am', '10:00am', '11:00am', '12:00pm', '01:00pm', '03:00pm', '04:00pm', '05:00pm', '06:00pm', '07:00pm'],
          limite: 4000,
          cierreAnticipado: 5,
          animales: ANIMALITOS_MAP,
          activa: true
        },
        {
          id: 'guacharo',
          nombre: 'Guácharo',
          multiplicador: 30,
          horarios: ['10:00am', '11:00am', '12:00pm', '01:00pm', '03:00pm', '04:00pm', '05:00pm', '06:00pm'],
          limite: 3000,
          cierreAnticipado: 5,
          animales: GUACHARO_ANIMALITOS_MAP,
          activa: true
        }
      ];

      for (const lot of defaultLoterias) {
        await dbSet('loterias', lot.id, lot);
      }
      console.log('🌱 Colección de loterías inicializada con éxito.');
    }
  } catch (error) {
    console.error('❌ Error al sembrar loterías:', error);
  }
}

// Obtener todas las loterías configuradas
app.get('/api/configuracion/loterias', (req, res) => {
  res.json(cache.loterias);
});

// Guardar y sincronizar loterías configuradas
app.post('/api/configuracion/loterias', async (req, res) => {
  const { loterias } = req.body;
  try {
    if (!Array.isArray(loterias)) {
      return res.status(400).json({ error: 'El cuerpo debe contener un array de loterías.' });
    }
    
    const currentIds = cache.loterias.map(l => l.id);
    const newIds = loterias.map(l => l.id);
    
    for (const id of currentIds) {
      if (!newIds.includes(id)) {
        await dbDelete('loterias', id);
      }
    }
    
    for (const lot of loterias) {
      if (!lot.id || !lot.nombre) continue;
      const updated = {
        id: lot.id,
        nombre: lot.nombre,
        multiplicador: parseFloat(lot.multiplicador) || 30,
        horarios: Array.isArray(lot.horarios) ? lot.horarios : [],
        limite: parseFloat(lot.limite) || 5000,
        cierreAnticipado: parseInt(lot.cierreAnticipado, 10) !== undefined && !isNaN(parseInt(lot.cierreAnticipado, 10)) ? parseInt(lot.cierreAnticipado, 10) : 5,
        animales: lot.animales || {},
        activa: lot.activa !== undefined ? !!lot.activa : true
      };
      await dbSet('loterias', lot.id, updated);
    }
    
    res.json({ success: true, message: 'Loterías configuradas actualizadas correctamente.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener todos los retiros
app.get('/api/retiros', (req, res) => {
  res.json(cache.retiros);
});

// Eliminar un retiro
app.delete('/api/retiros/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const exists = cache.retiros.some(r => r.id === id);
    if (!exists) {
      return res.status(404).json({ error: 'Retiro no encontrado.' });
    }
    await dbDelete('retiros', id);
    res.json({ success: true, message: 'Retiro eliminado correctamente.' });
  } catch (error) {
    console.error('Error al eliminar retiro:', error);
    res.status(500).json({ error: error.message });
  }
});

// Completar un retiro
app.post('/api/retiros/:id/completar', async (req, res) => {
  const { id } = req.params;
  const { referencia, comentario } = req.body;
  try {
    const rData = cache.retiros.find(r => r.id === id);
    if (!rData) {
      return res.status(404).json({ error: 'Retiro no encontrado.' });
    }
    if (rData.estado !== 'pendiente') {
      return res.status(400).json({ error: 'El retiro ya no está en estado pendiente.' });
    }

    rData.estado = 'completado';
    rData.referencia = referencia || '';
    rData.comentario = comentario || '';
    rData.fechaProcesado = new Date().toISOString();

    await dbUpdate('retiros', id, {
      estado: 'completado',
      referencia: rData.referencia,
      comentario: rData.comentario,
      fechaProcesado: rData.fechaProcesado
    });

    // Enviar notificación por WhatsApp al cliente
    const msg = `✅ *Retiro Procesado con éxito!*\n\nTu solicitud de retiro por *Bs. ${rData.monto.toLocaleString('de-DE')}* ha sido completada.\n\n*Referencia:* ${referencia || 'N/A'}${comentario ? `\n*Nota:* ${comentario}` : ''}\n\n¡Gracias por tu confianza! 🍀`;
    try {
      if (client && rData.clienteJid) {
        await client.sendMessage(rData.clienteJid, msg);
      }
    } catch (waErr) {
      console.error("Error al notificar al cliente vía WhatsApp:", waErr);
    }

    res.json({ success: true, message: 'Retiro completado y notificado con éxito.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rechazar un retiro (con reembolso)
app.post('/api/retiros/:id/rechazar', async (req, res) => {
  const { id } = req.params;
  const { comentario } = req.body;
  try {
    const rData = cache.retiros.find(r => r.id === id);
    if (!rData) {
      return res.status(404).json({ error: 'Retiro no encontrado.' });
    }
    if (rData.estado !== 'pendiente') {
      return res.status(400).json({ error: 'El retiro ya no está en estado pendiente.' });
    }

    const clienteData = cache.clientes.find(c => c.telefono === rData.clienteTelefono);
    if (clienteData) {
      const nuevaDeuda = (clienteData.deuda || 0) - rData.monto;
      clienteData.deuda = nuevaDeuda;
      await dbUpdate('clientes', clienteData.id, {
        deuda: nuevaDeuda
      });
    }

    rData.estado = 'rechazado';
    rData.comentario = comentario || 'Rechazado por administration';
    rData.fechaProcesado = new Date().toISOString();

    await dbUpdate('retiros', id, {
      estado: 'rechazado',
      comentario: rData.comentario,
      fechaProcesado: rData.fechaProcesado
    });

    // Enviar notificación por WhatsApp al cliente
    const msg = `❌ *Retiro Rechazado*\n\nTu solicitud de retiro por *Bs. ${rData.monto.toLocaleString('de-DE')}* ha sido rechazada.\n\n*Motivo:* ${comentario || 'Rechazado por administración'}\n\nEl monto ha sido reembolsado a tu saldo a favor. Puedes consultar tu saldo enviando *saldo*.`;
    try {
      if (client && rData.clienteJid) {
        await client.sendMessage(rData.clienteJid, msg);
      }
    } catch (waErr) {
      console.error("Error al notificar al cliente vía WhatsApp:", waErr);
    }

    res.json({ success: true, message: 'Retiro rechazado y monto reembolsado.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, async () => {
  console.log(`📡 Servidor API escuchando en http://localhost:${PORT}`);
  await inicializarCache();
  await seedLoteriasIfNeeded();
  iniciarScraperResultados();
});

process.on('unhandledRejection', (reason, promise) => {
  // Registrar error completo para depuración, pero no tirar el servidor
  console.error('⚠️ [Promesa No Manejada] Ignorada para evitar crash:', reason);
});
