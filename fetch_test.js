async function testFetch() {
  try {
    const res = await fetch('https://lotoven.com/animalitos/');
    const html = await res.text();
    
    // Función para extraer bloque de resultados por ID de lotería
    const obtenerBloque = (loteriaId) => {
      const startTag = `<div id="${loteriaId}"`;
      const startIndex = html.indexOf(startTag);
      if (startIndex === -1) return '';
      
      // Encontrar el final del bloque (por ejemplo, el siguiente div id o section)
      let endIndex = html.indexOf('<div id="', startIndex + startTag.length);
      if (endIndex === -1) {
        endIndex = html.indexOf('</section>', startIndex);
      }
      if (endIndex === -1) {
        endIndex = html.length;
      }
      return html.substring(startIndex, endIndex);
    };

    const loterias = [
      { id: 'lottoactivo', name: 'Lotto Activo' },
      { id: 'lagranjita', name: 'La Granjita' },
      { id: 'guacharoactivo', name: 'Guácharo Activo' }
    ];

    const regexItem = /<span class="info[^>]*>\s*(\d+)\s+([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+)\s*<\/span>\s*<span class="info2\s+horario"[^>]*>\s*(\d{2}:\d{2})\s*([AP]M)\s*<\/span>/gi;

    for (const lot of loterias) {
      console.log(`\n=== RESULTADOS: ${lot.name} ===`);
      const block = obtenerBloque(lot.id);
      if (!block) {
        console.log('Bloque no encontrado.');
        continue;
      }
      
      let match;
      let count = 0;
      // Resetear lastIndex del regex
      regexItem.lastIndex = 0;
      while ((match = regexItem.exec(block)) !== null) {
        const numero = match[1];
        const animal = match[2];
        const horaStr = match[3];
        const meridiano = match[4].toLowerCase();
        
        // Estandarizar hora a formato "09:00am"
        const horaFormateada = `${horaStr}${meridiano}`;
        
        console.log(`Hora: ${horaFormateada} -> Animal: ${animal.toUpperCase()} (#${numero})`);
        count++;
      }
      if (count === 0) {
        console.log('No se parsearon elementos en el bloque.');
      }
    }
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

testFetch();
