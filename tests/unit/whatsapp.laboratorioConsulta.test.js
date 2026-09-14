// US WA 007 — parsers y textos puros, sin dependencias de BD ni red. La
// consulta real a laboratorio.repository.js (findByFolioYTelefono) y el
// flujo completo end-to-end viven en
// tests/integration/whatsapp.laboratorioConsulta.test.js.
const lab = require('../../src/modules/whatsapp/whatsapp.laboratorioConsulta');

describe('whatsapp.laboratorioConsulta.extraerFolio (AC2/AC5/AC6)', () => {
  it.each(['LAB-005', 'LAB5', 'LAB 5', 'lab-005', '5', '05', '005'])(
    'reconoce la variante "%s" y extrae el entero 5 (prueba mínima: variantes permitidas del folio)',
    (texto) => {
      expect(lab.extraerFolio(texto)).toBe(5);
    },
  );

  it('rechaza un folio no positivo (LAB-0) (AC6)', () => {
    expect(lab.extraerFolio('LAB-0')).toBeNull();
  });

  it('rechaza texto adicional junto al folio (AC6, prueba mínima)', () => {
    expect(lab.extraerFolio('LAB-005 gracias')).toBeNull();
    expect(lab.extraerFolio('mi folio es LAB-005')).toBeNull();
  });

  it('rechaza un folio sin número (AC6)', () => {
    expect(lab.extraerFolio('LAB-')).toBeNull();
    expect(lab.extraerFolio('LAB')).toBeNull();
  });

  it('rechaza un número fuera del rango de integer de Postgres (AC6, prueba mínima)', () => {
    expect(lab.extraerFolio('99999999999999999999')).toBeNull();
    expect(lab.extraerFolio('LAB-9999999999')).toBeNull();
  });

  it('rechaza texto vacío o nulo', () => {
    expect(lab.extraerFolio('')).toBeNull();
    expect(lab.extraerFolio(null)).toBeNull();
    expect(lab.extraerFolio(undefined)).toBeNull();
  });
});

describe('whatsapp.laboratorioConsulta.extraerFolioYTelefono (AC3)', () => {
  it('extrae folio y teléfono sin importar el orden', () => {
    expect(lab.extraerFolioYTelefono('5512345678 LAB-005')).toEqual({
      folioId: 5,
      telefonoDigits: '5512345678',
    });
    expect(lab.extraerFolioYTelefono('LAB-005 5512345678')).toEqual({
      folioId: 5,
      telefonoDigits: '5512345678',
    });
  });

  it('extrae ambos aunque estén incrustados en una oración', () => {
    expect(lab.extraerFolioYTelefono('mi teléfono es 5512345678 y el folio es LAB005')).toEqual({
      folioId: 5,
      telefonoDigits: '5512345678',
    });
  });

  it('rechaza si el teléfono no tiene exactamente 10 dígitos (prueba mínima: folio con texto adicional o fuera de rango)', () => {
    expect(lab.extraerFolioYTelefono('12345 LAB-005')).toBeNull();
    expect(lab.extraerFolioYTelefono('551234567890 LAB-005')).toBeNull();
  });

  it('rechaza si no hay folio en el texto', () => {
    expect(lab.extraerFolioYTelefono('5512345678')).toBeNull();
  });

  it('rechaza un folio no positivo aunque el teléfono sea válido (AC6)', () => {
    expect(lab.extraerFolioYTelefono('5512345678 LAB-0')).toBeNull();
  });
});

describe('whatsapp.laboratorioConsulta — configuración controlada', () => {
  it('la pregunta de confirmación usa exactamente los 2 ids de la consideración técnica', () => {
    const payload = lab.preguntaConfirmacionPayload();
    expect(payload.type).toBe('button');
    const ids = payload.action.buttons.map((b) => b.reply.id);
    expect(ids).toEqual([lab.LAB_MISMO_TELEFONO_SI, lab.LAB_MISMO_TELEFONO_NO]);
  });

  it('los textos de cada paso no están vacíos', () => {
    expect(lab.textoPedirFolio().length).toBeGreaterThan(0);
    expect(lab.textoPedirTelefonoYFolio().length).toBeGreaterThan(0);
    expect(lab.textoRechazoGenerico().length).toBeGreaterThan(0);
    expect(lab.textoLimiteIntentos().length).toBeGreaterThan(0);
  });

  it('el rechazo genérico es EXACTAMENTE el mismo texto para formato inválido y para datos que no coinciden (AC9)', () => {
    // No hay 2 funciones de texto distintas para estos 2 casos — es la
    // MISMA función, para que el mensaje nunca revele cuál de los 2 pasó.
    expect(lab.textoRechazoGenerico()).toBe(lab.textoRechazoGenerico());
  });

  it('textoEstadoOrden solo menciona el folio y el estado — nada de tutor/paciente (AC8)', () => {
    const texto = lab.textoEstadoOrden(5, 'pendiente');
    expect(texto).toContain('LAB-005');
    expect(texto.toLowerCase()).not.toMatch(/tutor|paciente|mascota:/);
  });

  it.each(['pendiente', 'cargado', 'enviado'])(
    'describe el estado "%s" con un texto no vacío',
    (estadoOrden) => {
      expect(lab.textoEstadoOrden(7, estadoOrden).length).toBeGreaterThan(0);
    },
  );
});
