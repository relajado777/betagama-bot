import { interpretarMensaje } from './services/interpreter.js';

async function runTests() {
  console.log("=== INICIANDO PRUEBAS DEL INTERPRETADOR (REGEXP FALLBACK) ===");

  const testCases = [
    "perro 5000 lotto activo",
    "gato 3000 granjita",
    "0 con 10000 guacharo", // Delfin
    "00 5000 granjita", // Ballena
    "son las 12:24\nperro 5000 lotto activo\ngato 3000 granjita\n21 10000 guacharo", // Gallo
    "2000 al leon y 5000 al toro", // Sin lotería explícita
    "hola bot, quiero jugar", // Sin jugadas
    "el 05 con 3000 la granjita" // Alacrán
  ];

  for (const text of testCases) {
    console.log(`\n--- ENTRADA: "${text.replace(/\n/g, ' | ')}" ---`);
    const result = await interpretarMensaje(text);
    console.log("SALIDA:", JSON.stringify(result, null, 2));
  }
  
  console.log("\n=== PRUEBAS COMPLETADAS ===");
}

runTests().catch(console.error);
