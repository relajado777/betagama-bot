import { db, isMock } from './firebase.js';
import { ANIMALITOS_MAP } from '../services/interpreter.js';

async function seed() {
  console.log('🌱 Iniciando siembra de base de datos (seeding)...');

  if (isMock) {
    console.log('⚠️ Ejecutando en modo MOCK. No se escribirá en Firestore real, pero se simula el guardado.');
  }

  // 1. Sembrar configuración de animalitos
  console.log('🐾 Sembrando lista de animalitos...');
  const configRef = db.collection('configuracion').doc('animalitos');
  await configRef.set({ data: ANIMALITOS_MAP });
  console.log('✅ Lista de animalitos guardada.');

  // 2. Sembrar loterías iniciales
  console.log('🎰 Sembrando loterías activas...');
  const loteriasRef = db.collection('configuracion').doc('loterias');
  await loteriasRef.set({
    lista: [
      { id: 'lotto_activo', nombre: 'Lotto Activo', activa: true },
      { id: 'la_granjita', nombre: 'La Granjita', activa: true },
      { id: 'guacharo', nombre: 'Guácharo Activo', activa: true }
    ]
  });
  console.log('✅ Loterías activas guardadas.');

  // 3. Sembrar horarios de sorteos
  console.log('🕒 Sembrando horarios de sorteo...');
  const horariosRef = db.collection('configuracion').doc('horarios');
  await horariosRef.set({
    lista: [
      '09:00am', '10:00am', '11:00am', '12:00pm', 
      '01:00pm', '03:00pm', '04:00pm', '05:00pm', 
      '06:00pm', '07:00pm'
    ]
  });
  console.log('✅ Horarios guardados.');

  console.log('🌱 Siembra de base de datos completada con éxito.');
}

seed().catch(console.error);
