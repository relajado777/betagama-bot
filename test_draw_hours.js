import dotenv from 'dotenv';

dotenv.config();

// Mapeo estándar de animalitos en Venezuela (Lotto Activo / La Granjita)
const ANIMALITOS_MAP = {
  "00": "ballena", "0": "delfin", "01": "carnero", "02": "toro", "03": "ciempies", "04": "alacran",
  "05": "leon", "06": "rana", "07": "perico", "08": "raton", "09": "aguila", "10": "tigre",
  "11": "gato", "12": "caballo", "13": "mono", "14": "paloma", "15": "zorro", "16": "oso",
  "17": "pavo", "18": "burro", "19": "chivo", "20": "cochino", "21": "gallo", "22": "camello",
  "23": "cebra", "24": "iguana", "25": "gallina", "26": "vaca", "27": "perro", "28": "zamuro",
  "29": "elefante", "30": "caiman", "31": "lapa", "32": "ardilla", "33": "pescado", "34": "venado",
  "35": "jirafa", "36": "culebra"
};

const ANIMALITOS_REVERSE = {};
Object.entries(ANIMALITOS_MAP).forEach(([num, name]) => {
  ANIMALITOS_REVERSE[name] = num;
  const cleanName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (cleanName !== name) {
    ANIMALITOS_REVERSE[cleanName] = num;
  }
});

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

function fallbackParseNew(text, loteriasList = []) {
  let { cleanText, hoursMap } = findAndReplaceHours(text);
  console.log(`[DEBUG] Text after hours replaced: "${cleanText}"`);

  // Detect default lottery in the entire text
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
  }

  const jugadas = [];

  // Helper to extract lottery for a specific substring
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

  // Helper to get animal map for a lottery
  const obtenerMapasAnimales = (lotName) => {
    let targetAnimalMap = ANIMALITOS_MAP;
    let targetReverseMap = ANIMALITOS_REVERSE;

    if (lotName && loteriasList && loteriasList.length > 0) {
      const matchedLot = loteriasList.find(l => l.nombre.toLowerCase() === lotName.toLowerCase());
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
      }
    }
    return { animalMap: targetAnimalMap, reverseMap: targetReverseMap };
  };

  // Helper to resolve hours placeholder
  const extraerHorasDeTexto = (subtext) => {
    const matchPlaceholder = subtext.match(/__hora_(\d+)__/i);
    if (matchPlaceholder) {
      const idx = parseInt(matchPlaceholder[1], 10);
      return hoursMap[idx];
    }
    return null;
  };

  // 1. Scan for Case A: Shorthands with "x", "*" or "por"
  // Example: "caballo y burro x 300 para las 4", "1.2.3 por 100 lotto"
  // Note: we allow digits in the trailing word pattern to catch __HORA_0__ completely.
  const regexShorthand = /\b((?:[a-z\s\.,\-\/_]+|\b\d{1,2}\b|__hora_\d+__)+?)\s*(?:[x\*]|\bpor\b)\s*(\d+)(?:\s*(?:[a-z0-9_]+|__hora_\d+__))*/gi;
  let matchX;
  const processedSegments = [];

  while ((matchX = regexShorthand.exec(cleanText)) !== null) {
    const fullMatchStr = matchX[0];
    const lhs = matchX[1];
    const monto = parseInt(matchX[2], 10);

    if (monto > 0) {
      // Record segment to remove later
      processedSegments.push({ start: matchX.index, end: matchX.index + fullMatchStr.length });

      const loteria = detectarLoteriaEnTexto(fullMatchStr) || detectarLoteriaEnTexto(lhs);
      const horas = extraerHorasDeTexto(fullMatchStr) || extraerHorasDeTexto(lhs);
      const { animalMap, reverseMap } = obtenerMapasAnimales(loteria);

      // Split LHS by spaces, dots, commas, and words "y", "o"
      const elementos = lhs.split(/[\s\.,\-]+|\by\b|\bo\b/gi);
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

  // Remove processed shorthand segments from cleanText to avoid double parsing in Case B
  processedSegments.sort((a, b) => b.start - a.start);
  for (const seg of processedSegments) {
    cleanText = cleanText.substring(0, seg.start) + " " + cleanText.substring(seg.end);
  }

  // 2. Scan for Case B: Traditional format "animal monto" or "numero monto"
  // Split remaining text by common parts/connectors first
  const partes = cleanText.split(/(?:\by\b|\bo\b|[\/\+\n,])/i);

  for (let parte of partes) {
    parte = parte.trim();
    if (!parte) continue;

    const loteria = detectarLoteriaEnTexto(parte);
    const horas = extraerHorasDeTexto(parte);
    const { reverseMap } = obtenerMapasAnimales(loteria);

    const animalNames = Object.keys(reverseMap).join("|");
    // Support optional __hora_X__ placeholder between animal and amount
    const regexEstandar = new RegExp(`\\b(${animalNames}|\\d{1,2})\\b\\s*(?:con|de|a|por|)?\\s*(?:__hora_\\d+__\\s*)?\\b(\\d+)\\b`, "gi");
    
    let matchEst;
    while ((matchEst = regexEstandar.exec(parte)) !== null) {
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
        // Resolve hours again specifically check if there was a placeholder inside the match
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
  return { valido: false, error: "No play detected", jugadas: [] };
}

async function run() {
  const loteriasList = [
    { id: 'lotto_activo', nombre: 'Lotto Activo', activa: true },
    { id: 'la_granjita', nombre: 'La Granjita', activa: true },
    { id: 'guacharo', nombre: 'Guácharo Activo', activa: true }
  ];

  const testTexts = [
    "Para el perro 4,5y 6 de la tarde guacharo x 500",
    "perro para las 12 y 1 x 500",
    "gato 10 am 500 y leon 3 de la tarde x 1000",
    "la granjita caballo y burro x 300 para las 4",
    "perro 5000 lotto activo y gato 3000 granjita"
  ];

  for (const t of testTexts) {
    console.log(`\n-------------------------------------`);
    console.log(`Original: "${t}"`);
    const res = fallbackParseNew(t, loteriasList);
    console.log("Result:", JSON.stringify(res, null, 2));
  }
}

run().catch(console.error);
