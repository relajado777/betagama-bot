import dotenv from 'dotenv';

dotenv.config();

// Mapeo estándar de animalitos en Venezuela (Lotto Activo / La Granjita)
export const ANIMALITOS_MAP = {
  "00": "ballena",
  "0": "delfin",
  "01": "carnero",
  "02": "toro",
  "03": "ciempies",
  "04": "alacran",
  "05": "leon",
  "06": "rana",
  "07": "perico",
  "08": "raton",
  "09": "aguila",
  "10": "tigre",
  "11": "gato",
  "12": "caballo",
  "13": "mono",
  "14": "paloma",
  "15": "zorro",
  "16": "oso",
  "17": "pavo",
  "18": "burro",
  "19": "chivo",
  "20": "cochino",
  "21": "gallo",
  "22": "camello",
  "23": "cebra",
  "24": "iguana",
  "25": "gallina",
  "26": "vaca",
  "27": "perro",
  "28": "zamuro",
  "29": "elefante",
  "30": "caiman",
  "31": "lapa",
  "32": "ardilla",
  "33": "pescado",
  "34": "venado",
  "35": "jirafa",
  "36": "culebra"
};

// Mapeo completo de 77 animalitos para Guácharo Activo
export const GUACHARO_ANIMALITOS_MAP = {
  "00": "ballena",
  "0": "delfin",
  "01": "carnero",
  "02": "toro",
  "03": "ciempies",
  "04": "alacran",
  "05": "leon",
  "06": "rana",
  "07": "perico",
  "08": "raton",
  "09": "aguila",
  "10": "tigre",
  "11": "gato",
  "12": "caballo",
  "13": "mono",
  "14": "paloma",
  "15": "zorro",
  "16": "oso",
  "17": "pavo",
  "18": "burro",
  "19": "chivo",
  "20": "cochino",
  "21": "gallo",
  "22": "camello",
  "23": "cebra",
  "24": "iguana",
  "25": "gallina",
  "26": "vaca",
  "27": "perro",
  "28": "zamuro",
  "29": "elefante",
  "30": "caiman",
  "31": "lapa",
  "32": "ardilla",
  "33": "pescado",
  "34": "venado",
  "35": "jirafa",
  "36": "culebra",
  "37": "tortuga",
  "38": "bufalo",
  "39": "lechuza",
  "40": "avispa",
  "41": "canguro",
  "42": "tucan",
  "43": "mariposa",
  "44": "chiguire",
  "45": "garza",
  "46": "puma",
  "47": "pavo real",
  "48": "puercoespin",
  "49": "pereza",
  "50": "canario",
  "51": "pelicano",
  "52": "pulpo",
  "53": "caracol",
  "54": "grillo",
  "55": "oso hormiguero",
  "56": "tiburon",
  "57": "pato",
  "58": "hormiga",
  "59": "pantera",
  "60": "camaleon",
  "61": "panda",
  "62": "cachicamo",
  "63": "cangrejo",
  "64": "gavilan",
  "65": "arana",
  "66": "lobo",
  "67": "avestruz",
  "68": "jaguar",
  "69": "conejo",
  "70": "bisonte",
  "71": "guacamaya",
  "72": "gorila",
  "73": "hipopotamo",
  "74": "turpial",
  "75": "guacharo"
};


// Crear un mapa inverso para buscar por nombre
const ANIMALITOS_REVERSE = {};
Object.entries(ANIMALITOS_MAP).forEach(([num, name]) => {
  ANIMALITOS_REVERSE[name] = num;
  // Añadir sin acentos
  const cleanName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (cleanName !== name) {
    ANIMALITOS_REVERSE[cleanName] = num;
  }
});

// Sinónimos comunes de animalitos en Venezuela
const ANIMAL_SYNONYMS = {
  "cabra": "chivo",       // #19
  "cabrilla": "chivo",
  "puerco": "cochino",    // #20
  "cerdo": "cochino",
  "serpiente": "culebra", // #36
  "búho": "lechuza",      // #39
  "buho": "lechuza",
  "ciervo": "venado",     // #34
  "buitre": "zamuro"      // #28
};
Object.entries(ANIMAL_SYNONYMS).forEach(([alias, standard]) => {
  const standardNum = ANIMALITOS_REVERSE[standard];
  if (standardNum) {
    ANIMALITOS_REVERSE[alias] = standardNum;
  }
});

// Inicializar cliente Gemini si la clave de API existe
let ai = null;
if (process.env.GEMINI_API_KEY) {
  try {
    // Nota: en @google/generative-ai el constructor suele ser new GoogleGenAI({apiKey}) o importar GoogleGenAI y usarla.
    // Usamos la importación recomendada oficial: import { GoogleGenAI } de '@google/generative-ai' o similar.
    // Para compatibilidad con la SDK de google:
    // import { GoogleGenerativeAI } from '@google/generative-ai';
    // let genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Para evitar errores si la estructura varía, crearemos una inicialización limpia:
  } catch (e) {
    console.error("Error al inicializar cliente de Gemini:", e);
  }
}

// Prompt del sistema para la IA
const SYSTEM_PROMPT = `
Eres el interpretador inteligente de una agencia de lotería de "Animalitos" en Venezuela.
Tu tarea es analizar el mensaje de texto de un cliente y extraer las jugadas estructuradas en formato JSON.

- Si el usuario usa sinónimos comunes, asócialos al animal estándar:
  * "cerdo", "puerco", "marrano" -> "cochino" (20)
  * "cabra" -> "chivo" (19)
  * "serpiente", "vibora" -> "culebra" (36)
  * "buho", "búho" -> "lechuza" (39)
  * "ciervo" -> "venado" (34)
  * "buitre" -> "zamuro" (28)

La tabla oficial de animales y números es la siguiente:
- 00: ballena
- 0: delfin
- 01: carnero
- 02: toro
- 03: ciempies
- 04: alacran
- 05: leon
- 06: rana
- 07: perico
- 08: raton
- 09: aguila
- 10: tigre
- 11: gato
- 12: caballo
- 13: mono
- 14: paloma
- 15: zorro
- 16: oso
- 17: pavo
- 18: burro
- 19: chivo
- 20: cochino
- 21: gallo
- 22: camello
- 23: cebra
- 24: iguana
- 25: gallina
- 26: vaca
- 27: perro
- 28: zamuro
- 29: elefante
- 30: caiman
- 31: lapa
- 32: ardilla
- 33: pescado
- 34: venado
- 35: jirafa
- 36: culebra

Las loterías más populares son: "lotto activo" (o "lotto"), "la granjita" (o "granjita") y "guacharo".
Los clientes pueden referirse a montos usando expresiones venezolanas como:
- "5 palos", "5 mil", "5 bolitas", "5k" o simplemente "5000" para Bs 5.000.
- "1000", "un luca", "1 bolivar" (dependiendo de la denominación local, asume siempre montos numéricos limpios). Si dicen "5 palos" en el contexto actual, asume 5.000 Bs. Si dicen "500" es 500 Bs.

Formato Shorthand con "x" o "*":
Si un cliente envía "27.12.11.30 x 150 lotto", significa que juega a los animalitos correspondientes a los números 27, 12, 11 y 30, cada uno por un monto de Bs 150 en la lotería "lotto activo". De forma similar, "15.20.31x100 granja" significa que juega al 15, 20 y 31 por un monto de Bs 100 cada uno en "la granjita". También pueden escribir "juegame el 27x300 lotto", que significa jugar al perro (27) por Bs 300 en Lotto Activo.

INSTRUCCIONES DE RETORNO:
Debes responder ÚNICAMENTE con un objeto JSON válido. No incluyas explicaciones, no incluyas markdown (no uses triple comillas de código \`\`\`json), solo el JSON plano.

El formato del JSON debe ser:
{
  "valido": true, // true si se pudo interpretar al menos una jugada, false de lo contrario
  "error": null,  // mensaje de error si no es válido
  "jugadas": [
    {
      "animal": "perro", // nombre del animal en minúsculas y sin acentos
      "numero": "27",    // número de dos dígitos correspondiente (ej. "07" para perico, "27" para perro)
      "monto": 5000,     // monto numérico entero en Bolívares
      "loteria": "lotto activo", // nombre de la lotería en minúsculas ("lotto activo", "la granjita", etc.). Si no se especifica, usa null.
      "sorteoHora": "04:00pm" // Horario del sorteo normalizado en formato de 12 horas (ej: "04:00pm", "10:00am", "12:00pm", "01:00pm"). Si el cliente especifica múltiples sorteos (ej: "para las 4, 5 y 6 de la tarde", "a las 12 y a la 1"), debes duplicar/generar un objeto de jugada independiente para cada uno de esos horarios. Si no se indica horario en el texto, usa null.
    }
  ]
}

Ejemplo de Entrada: "perro 5000 lotto activo y gato 3000 granjita"
Ejemplo de Salida:
{
  "valido": true,
  "error": null,
  "jugadas": [
    {"animal": "perro", "numero": "27", "monto": 5000, "loteria": "lotto activo", "sorteoHora": null},
    {"animal": "gato", "numero": "11", "monto": 3000, "loteria": "la granjita", "sorteoHora": null}
  ]
}

Ejemplo de Entrada: "perro 4,5 y 6 de la tarde guacharo x 500"
Ejemplo de Salida:
{
  "valido": true,
  "error": null,
  "jugadas": [
    {"animal": "perro", "numero": "27", "monto": 500, "loteria": "guacharo", "sorteoHora": "04:00pm"},
    {"animal": "perro", "numero": "27", "monto": 500, "loteria": "guacharo", "sorteoHora": "05:00pm"},
    {"animal": "perro", "numero": "27", "monto": 500, "loteria": "guacharo", "sorteoHora": "06:00pm"}
  ]
}

Ejemplo de Entrada: "hola bot"
Ejemplo de Salida:
{
  "valido": false,
  "error": "No se detectaron jugadas en el mensaje",
  "jugadas": []
}
`;

function findAndReplaceHours(text) {
  let cleanText = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const hoursMap = [];
  const matches = [];

  // Define regexes
  const regexP1 = /\b(\d{1,2}(?:\s*,\s*\d{1,2})*(?:\s*(?:y|o)\s*\d{1,2})?)\s*(?:de la\s*)?(tarde|manana|am|pm|a\.m\.|p\.m\.)\b/gi;
  const regexP2 = /\b(?:sorteo[s]?\s+(?:de\s+|a\s+)?las|para\s+las|de\s+las|a\s+las|las)\s+(\d{1,2}(?:\s*,\s*\d{1,2})*(?:\s*(?:y|o)\s*\d{1,2})?)\b/gi;
  const regexP3 = /\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/gi;

  function scan(regex, type) {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(cleanText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      
      const overlap = matches.some(m => (start >= m.start && start < m.end) || (end > m.start && end <= m.end));
      if (overlap) continue;

      let numbersStr = '';
      let meridian = '';
      if (type === 'P1') {
        numbersStr = match[1];
        meridian = match[2];
      } else if (type === 'P2') {
        numbersStr = match[1];
      } else if (type === 'P3') {
        numbersStr = match[1];
        meridian = match[2];
      }

      const numbers = numbersStr.match(/\d+/g).map(Number);
      if (numbers.every(n => n >= 1 && n <= 12)) {
        matches.push({ start, end, matchedStr: match[0], numbers, meridian, type });
      }
    }
  }

  scan(regexP1, 'P1');
  scan(regexP2, 'P2');
  scan(regexP3, 'P3');

  matches.sort((a, b) => b.start - a.start);

  for (const m of matches) {
    const normalized = m.numbers.map(hr => {
      let meridiano = 'am';
      if (m.type === 'P1' || m.type === 'P3') {
        const meridianClean = m.meridian.toLowerCase().replace(/\./g, '');
        if (['tarde', 'pm'].includes(meridianClean)) {
          if (hr === 12 || hr <= 8) meridiano = 'pm';
        } else if (['manana', 'am'].includes(meridianClean)) {
          meridiano = 'am';
        }
      } else if (m.type === 'P2') {
        meridiano = (hr >= 9 && hr <= 11) ? 'am' : 'pm';
      }
      return `${hr.toString().padStart(2, '0')}:00${meridiano}`;
    });

    const placeholder = `__HORA_${hoursMap.length}__`;
    hoursMap.push(normalized);

    cleanText = cleanText.substring(0, m.start) + ` ${placeholder} ` + cleanText.substring(m.end);
  }

  return { cleanText, hoursMap };
}

function limpiarNombreLoteriaDeTexto(texto, lotName) {
  if (!lotName) return texto;
  let clean = texto;
  const normLot = lotName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  
  let patterns = [];
  if (normLot.includes("lotto") || normLot.includes("activo")) {
    patterns = [/\b(para|en|de|a)?\s*lotto\s*activo\b/gi, /\b(para|en|de|a)?\s*lotto\b/gi, /\b(para|en|de|a)?\s*activo\b/gi];
  } else if (normLot.includes("granjita") || normLot.includes("granja")) {
    patterns = [/\b(para|en|de|a)?\s*la\s*granjita\b/gi, /\b(para|en|de|a)?\s*granjita\b/gi, /\b(para|en|de|a)?\s*granja\b/gi];
  } else if (normLot.includes("guacharo")) {
    // Solo remover si va acompañado de preposición o la palabra "activo" para no pisar el animal 75 "guacharo"
    patterns = [
      /\b(para|en|de|a|sorteo|loteria)\s+guacharo\s*activo\b/gi, 
      /\b(para|en|de|a|sorteo|loteria)\s+guacharo\b/gi,
      /\bguacharo\s+activo\b/gi
    ];
  } else {
    const escapedName = normLot.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    patterns = [new RegExp(`\\b(para|en|de|a)?\\s*${escapedName}\\b`, 'gi')];
  }
  
  for (const pat of patterns) {
    clean = clean.replace(pat, "");
  }
  return clean;
}

function fallbackParse(text, loteriasList = []) {
  let { cleanText, hoursMap } = findAndReplaceHours(text);

  // Buscar lotería por defecto en el texto completo
  let defaultLoteria = null;
  if (loteriasList && loteriasList.length > 0) {
    for (const lot of loteriasList) {
      const lotNameClean = lot.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const lotIdClean = lot.id.toLowerCase().replace(/_/g, " ");
      
      const isLotto = lotNameClean.includes("lotto") && (cleanText.includes("lotto") || cleanText.includes("activo"));
      const isGranja = lotNameClean.includes("granjita") && (cleanText.includes("granjita") || cleanText.includes("granja"));
      const isGuacharo = lotNameClean.includes("guacharo") && cleanText.includes("guacharo");
      
      if (cleanText.includes(lotNameClean) || (lotIdClean && cleanText.includes(lotIdClean)) || isLotto || isGranja || isGuacharo) {
        defaultLoteria = lot.nombre.toLowerCase();
        break;
      }
    }
  } else {
    if (cleanText.includes("lotto") || cleanText.includes("activo")) {
      defaultLoteria = "lotto activo";
    } else if (cleanText.includes("granjita") || cleanText.includes("la granjita") || cleanText.includes("granja")) {
      defaultLoteria = "la granjita";
    } else if (cleanText.includes("guacharo")) {
      defaultLoteria = "guacharo";
    }
  }

  const jugadas = [];

  const detectarLoteriaEnTexto = (subtext) => {
    if (loteriasList && loteriasList.length > 0) {
      for (const lot of loteriasList) {
        const lotNameClean = lot.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const lotIdClean = lot.id.toLowerCase().replace(/_/g, " ");
        
        const isLotto = lotNameClean.includes("lotto") && (subtext.includes("lotto") || subtext.includes("activo"));
        const isGranja = lotNameClean.includes("granjita") && (subtext.includes("granjita") || subtext.includes("granja"));
        const isGuacharo = lotNameClean.includes("guacharo") && subtext.includes("guacharo");
        
        if (subtext.includes(lotNameClean) || (lotIdClean && subtext.includes(lotIdClean)) || isLotto || isGranja || isGuacharo) {
          return lot.nombre.toLowerCase();
        }
      }
    }
    return defaultLoteria;
  };

  const obtenerMapasAnimales = (lotName) => {
    let targetAnimalMap = ANIMALITOS_MAP;
    let targetReverseMap = ANIMALITOS_REVERSE;

    if (lotName && loteriasList && loteriasList.length > 0) {
      const cleanLotName = lotName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const matchedLot = loteriasList.find(l => {
        const cleanLName = l.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const cleanLId = l.id.toLowerCase().replace(/_/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        return cleanLName === cleanLotName || cleanLId === cleanLotName;
      });
      if (matchedLot && matchedLot.animales && Object.keys(matchedLot.animales).length > 0) {
        targetAnimalMap = matchedLot.animales;
        targetReverseMap = {};
        Object.entries(targetAnimalMap).forEach(([num, name]) => {
          targetReverseMap[name.toLowerCase()] = num;
          const cleanName = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (cleanName !== name) {
            targetReverseMap[cleanName] = num;
          }
        });
        
        // Agregar sinónimos comunes al mapa inverso de la lotería
        const sinonimos = {
          "cabra": "chivo",
          "cabrilla": "chivo",
          "puerco": "cochino",
          "cerdo": "cochino",
          "serpiente": "culebra",
          "buho": "lechuza",
          "búho": "lechuza",
          "ciervo": "venado",
          "buitre": "zamuro"
        };
        Object.entries(sinonimos).forEach(([alias, standard]) => {
          const standardNum = targetReverseMap[standard];
          if (standardNum) {
            targetReverseMap[alias] = standardNum;
          }
        });
      }
    }
    return { animalMap: targetAnimalMap, reverseMap: targetReverseMap };
  };

  const extraerHorasDeTexto = (subtext) => {
    const matchPlaceholder = subtext.match(/__hora_(\d+)__/i);
    if (matchPlaceholder) {
      const idx = parseInt(matchPlaceholder[1], 10);
      return hoursMap[idx];
    }
    return null;
  };

  // 1. Shorthand x/por/star
  const regexShorthand = /\b((?:[a-z\s\.,\-\/_]+|\b\d{1,2}\b|__hora_\d+__)+?)\s*(?:[x\*]|\bpor\b)\s*(\d+)(?:\s*(?:[a-z0-9_]+|__hora_\d+__))*/gi;
  let matchX;
  const processedSegments = [];

  while ((matchX = regexShorthand.exec(cleanText)) !== null) {
    const fullMatchStr = matchX[0];
    const lhs = matchX[1];
    const monto = parseInt(matchX[2], 10);

    if (monto > 0) {
      processedSegments.push({ start: matchX.index, end: matchX.index + fullMatchStr.length });

      const loteria = detectarLoteriaEnTexto(fullMatchStr) || detectarLoteriaEnTexto(lhs);
      const horas = extraerHorasDeTexto(fullMatchStr) || extraerHorasDeTexto(lhs);
      const { animalMap, reverseMap } = obtenerMapasAnimales(loteria);

      const lhsLimpio = limpiarNombreLoteriaDeTexto(lhs, loteria);
      const elementos = lhsLimpio.split(/[\s\.,\-]+|\by\b|\bo\b/gi);
      for (const elem of elementos) {
        const limpio = elem.trim();
        if (!limpio || limpio.startsWith('__hora_')) continue;

        let animal = null;
        let numero = null;

        if (/^\d+$/.test(limpio)) {
          let padded = limpio.padStart(2, '0');
          if (limpio === "0" || limpio === "00") padded = limpio;
          if (animalMap[padded]) {
            numero = padded;
            animal = animalMap[padded];
          }
        } else if (reverseMap[limpio]) {
          animal = limpio;
          numero = reverseMap[limpio];
        }

        if (animal && numero) {
          if (horas && horas.length > 0) {
            for (const hr of horas) {
              jugadas.push({ animal, numero, monto, loteria, sorteoHora: hr });
            }
          } else {
            jugadas.push({ animal, numero, monto, loteria });
          }
        }
      }
    }
  }

  processedSegments.sort((a, b) => b.start - a.start);
  for (const seg of processedSegments) {
    cleanText = cleanText.substring(0, seg.start) + " " + cleanText.substring(seg.end);
  }

  // 2. Traditional animal + amount
  const partes = cleanText.split(/(?:\by\b|\bo\b|[\/\+\n,])/i);

  for (let parte of partes) {
    parte = parte.trim();
    if (!parte) continue;

    const loteria = detectarLoteriaEnTexto(parte);
    const horas = extraerHorasDeTexto(parte);
    const { reverseMap } = obtenerMapasAnimales(loteria);

    const parteLimpia = limpiarNombreLoteriaDeTexto(parte, loteria);
    const animalNames = Object.keys(reverseMap).join("|");
    const regexEstandar = new RegExp(`\\b(${animalNames}|\\d{1,2})\\b\\s*(?:con|de|a|por|)?\\s*(?:__hora_\\d+__\\s*)?\\b(\\d+)\\b`, "gi");
    
    let matchEst;
    while ((matchEst = regexEstandar.exec(parteLimpia)) !== null) {
      const target = matchEst[1];
      const monto = parseInt(matchEst[2], 10);
      
      let animal = null;
      let numero = null;
      const { animalMap } = obtenerMapasAnimales(loteria);

      if (/^\d+$/.test(target)) {
        let padded = target.padStart(2, '0');
        if (target === "0" || target === "00") padded = target;
        if (animalMap[padded]) {
          numero = padded;
          animal = animalMap[padded];
        }
      } else if (reverseMap[target]) {
        animal = target;
        numero = reverseMap[target];
      }

      if (animal && numero && monto > 0) {
        let localHoras = horas;
        const matchLocalPlaceholder = matchEst[0].match(/__hora_(\d+)__/i);
        if (matchLocalPlaceholder) {
          const idx = parseInt(matchLocalPlaceholder[1], 10);
          localHoras = hoursMap[idx];
        }

        if (localHoras && localHoras.length > 0) {
          for (const hr of localHoras) {
            jugadas.push({ animal, numero, monto, loteria, sorteoHora: hr });
          }
        } else {
          jugadas.push({ animal, numero, monto, loteria });
        }
      }
    }
  }

  if (jugadas.length > 0) {
    return { valido: true, error: null, jugadas };
  }

  return {
    valido: false,
    error: "No se pudieron interpretar las jugadas automáticamente (Modo Respaldo)",
    jugadas: []
  };
}

/**
 * Interpreta el mensaje del cliente para extraer las jugadas estructuradas.
 * @param {string} text - El mensaje recibido por WhatsApp
 * @param {Array} loteriasList - Lista de loterías configuradas en Firestore
 * @returns {Promise<Object>} - Las jugadas estructuradas en formato JSON
 */
export async function interpretarMensaje(text, loteriasList = []) {
  if (!text || text.trim() === '') {
    return { valido: false, error: "Mensaje vacío", jugadas: [] };
  }

  // Si no hay API Key de Gemini configurada, usar el parseador de respaldo
  if (!process.env.GEMINI_API_KEY) {
    console.log("ℹ️ Usando parseador de respaldo por falta de GEMINI_API_KEY.");
    return fallbackParse(text, loteriasList);
  }

  try {
    // Importamos dinámicamente para evitar problemas si la instalación difiere
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Usamos el modelo rápido y optimizado para tareas de extracción JSON
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash",
      generationConfig: { responseMimeType: "application/json" } // Forzar respuesta en JSON
    });

    let promptAdditions = '';
    if (loteriasList && loteriasList.length > 0) {
      promptAdditions = `
Las loterías configuradas actualmente son:
${loteriasList.map(l => `- "${l.nombre}" (ID: "${l.id}") con los siguientes animales:
${Object.entries(l.animales || {}).map(([num, name]) => `  * ${num}: ${name}`).join('\n')}`).join('\n')}

Por favor, asocia las jugadas del cliente con la lotería correspondiente basándote en la lista anterior. Si el cliente no especifica la lotería, pon null o infiérela si solo hay una activa. El nombre de la lotería devuelto en el JSON debe ser exactamente el "nombre" o "id" en minúsculas de la lista de loterías anterior (por ejemplo, si coincide con "Lotto Activo", el campo "loteria" debe ser "lotto activo").
`;
    }

    const prompt = `${SYSTEM_PROMPT}\n\nMensaje del Cliente:\n"${text}"\n\n${promptAdditions}`;
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    
    // Limpiar posibles etiquetas markdown si el modelo las incluyó a pesar de la instrucción
    let cleanJSON = responseText;
    if (cleanJSON.startsWith("```")) {
      cleanJSON = cleanJSON.replace(/^```json\s*/i, "").replace(/```$/, "");
    }
    
    const parsedResult = JSON.parse(cleanJSON);
    console.log("🧠 Respuesta del Parseador Gemini:", JSON.stringify(parsedResult));
    return parsedResult;
  } catch (error) {
    console.error("❌ Error en el interpretador Gemini AI:", error);
    // Si falla la IA por conexión, cuotas u otro error, caemos en el fallback de regex
    console.log("⚠️ Cayendo en parseador de respaldo tras error de IA.");
    return fallbackParse(text, loteriasList);
  }
}
