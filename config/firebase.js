import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './config/firebase-service-account.json';
const resolvedPath = path.resolve(serviceAccountPath);

let db;
let isMock = false;

try {
  let serviceAccount = null;

  // En la nube (Railway): leer credenciales desde variable de entorno
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    console.log('☁️ Firebase: cargando credenciales desde variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON');
  } else if (fs.existsSync(resolvedPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    console.log('💾 Firebase: cargando credenciales desde archivo local:', resolvedPath);
  }

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('✅ Firebase Firestore inicializado con éxito mediante cuenta de servicio.');
  } else {
    console.warn('⚠️ Archivo de cuenta de servicio Firebase no encontrado en:', resolvedPath);
    console.warn('⚠️ Se inicializará un modo mock de base de datos para pruebas locales.');
    isMock = true;
    
    // Mock básico de Firestore en memoria para pruebas rápidas
    const mockStorage = {};
    
    class MockQuery {
      constructor(colName, docs = null) {
        this.colName = colName;
        if (docs === null) {
          const rawDocs = mockStorage[colName] || {};
          this.docsList = Object.entries(rawDocs).map(([id, data]) => ({
            id,
            data: JSON.parse(JSON.stringify(data))
          }));
        } else {
          this.docsList = docs;
        }
      }

      where(field, op, value) {
        const filtered = this.docsList.filter(d => {
          const val = d.data[field];
          if (op === '==') return val === value;
          if (op === '>=') return val >= value;
          if (op === '<=') return val <= value;
          return false;
        });
        return new MockQuery(this.colName, filtered);
      }

      orderBy(field, direction = 'asc') {
        const sorted = [...this.docsList].sort((a, b) => {
          const valA = a.data[field];
          const valB = b.data[field];
          if (valA === valB) return 0;
          if (valA === undefined) return 1;
          if (valB === undefined) return -1;
          
          let res = 0;
          if (typeof valA === 'string' && typeof valB === 'string') {
            res = valA.localeCompare(valB);
          } else {
            res = valA < valB ? -1 : 1;
          }
          return direction === 'desc' ? -res : res;
        });
        return new MockQuery(this.colName, sorted);
      }

      limit(n) {
        return new MockQuery(this.colName, this.docsList.slice(0, n));
      }

      async get() {
        const mappedDocs = this.docsList.map(d => ({
          id: d.id,
          exists: true,
          data: () => JSON.parse(JSON.stringify(d.data))
        }));
        return {
          empty: mappedDocs.length === 0,
          docs: mappedDocs,
          forEach: (callback) => mappedDocs.forEach(callback)
        };
      }
    }

    db = {
      collection: (colName) => {
        if (!mockStorage[colName]) mockStorage[colName] = {};
        
        const colRef = {
          doc: (docId) => {
            const docRef = {
              get: async () => {
                const data = mockStorage[colName][docId];
                return {
                  exists: !!data,
                  data: () => data ? JSON.parse(JSON.stringify(data)) : null,
                  id: docId
                };
              },
              set: async (data, options) => {
                if (options && options.merge && mockStorage[colName][docId]) {
                  mockStorage[colName][docId] = { ...mockStorage[colName][docId], ...data };
                } else {
                  mockStorage[colName][docId] = data;
                }
                console.log(`[Mock DB] Guardar en ${colName}/${docId}:`, data);
                return { writeTime: new Date() };
              },
              update: async (data) => {
                if (!mockStorage[colName][docId]) {
                  throw new Error(`Documento ${docId} no existe en la colección ${colName}`);
                }
                mockStorage[colName][docId] = { ...mockStorage[colName][docId], ...data };
                console.log(`[Mock DB] Actualizar en ${colName}/${docId}:`, data);
                return { writeTime: new Date() };
              },
              delete: async () => {
                delete mockStorage[colName][docId];
                console.log(`[Mock DB] Eliminar ${colName}/${docId}`);
                return { writeTime: new Date() };
              }
            };
            return docRef;
          },
          add: async (data) => {
            const docId = 'mock-id-' + Math.random().toString(36).substring(2, 11);
            mockStorage[colName][docId] = data;
            console.log(`[Mock DB] Agregar a ${colName} con ID ${docId}:`, data);
            return {
              id: docId,
              get: async () => ({
                exists: true,
                data: () => JSON.parse(JSON.stringify(data)),
                id: docId
              })
            };
          },
          where: (field, op, value) => {
            return new MockQuery(colName).where(field, op, value);
          },
          orderBy: (field, direction) => {
            return new MockQuery(colName).orderBy(field, direction);
          },
          limit: (n) => {
            return new MockQuery(colName).limit(n);
          },
          get: async () => {
            return new MockQuery(colName).get();
          }
        };
        return colRef;
      }
    };
  }
} catch (error) {
  console.error('❌ Error crítico al inicializar Firebase:', error);
}

export { db, admin, isMock };
