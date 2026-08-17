const crypto = require('crypto');
const {
  assertPasswordValida,
  validatePasswordPolicy,
  checkPasswordPwned,
  PasswordPolicyError,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} = require('../../src/config/passwordPolicy');

// checkPasswordPwned llama a fetch() real (HIBP) — se mockea globalmente en
// todo este archivo para no depender de red en CI/local, y para poder
// forzar tanto el caso "comprometida" como el fail-open ante un error.
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function sha1Upper(value) {
  return crypto.createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();
}

function mockFetchOk(bodyLines) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(bodyLines.join('\r\n')),
  });
}

describe('passwordPolicy.validatePasswordPolicy (Decisión 24)', () => {
  it('AC: rechaza una contraseña con menos de 15 caracteres', () => {
    expect(() => validatePasswordPolicy('CortaPero14ch')).toThrow(PasswordPolicyError);
  });

  it('acepta una contraseña de exactamente 15 caracteres', () => {
    expect(() => validatePasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH))).not.toThrow();
  });

  it('acepta una passphrase de 64 caracteres (AC: debe permitir al menos 64)', () => {
    expect(() =>
      validatePasswordPolicy('correcto caballo batería grapadora '.repeat(2)),
    ).not.toThrow();
  });

  it('rechaza una contraseña de más de 72 caracteres (techo real de bcrypt)', () => {
    expect(() => validatePasswordPolicy('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toThrow(
      PasswordPolicyError,
    );
  });

  it('AC: rechaza contraseñas de la lista de comunes/predecibles, sin importar mayúsculas', () => {
    expect(() => validatePasswordPolicy('Pass123456789')).toThrow(PasswordPolicyError);
    expect(() => validatePasswordPolicy('CONTRASEÑA123')).toThrow(PasswordPolicyError);
    expect(() => validatePasswordPolicy('OmegaVet2026')).toThrow(PasswordPolicyError);
  });

  it('no rechaza por contener una palabra común como fragmento (solo por coincidencia completa)', () => {
    expect(() => validatePasswordPolicy('MiOmegaSuperSegura2026Real!')).not.toThrow();
  });
});

describe('passwordPolicy.checkPasswordPwned (HIBP, k-anonimato)', () => {
  it('manda solo el prefijo de 5 caracteres del hash SHA-1, nunca la contraseña completa', async () => {
    mockFetchOk(['0000000000000000000000000000000:1']);
    await checkPasswordPwned('cualquier-contraseña-de-prueba');

    const url = global.fetch.mock.calls[0][0];
    expect(url).toBe(
      'https://api.pwnedpasswords.com/range/' +
        sha1Upper('cualquier-contraseña-de-prueba').slice(0, 5),
    );
  });

  it('AC: detecta una contraseña comprometida cuando el sufijo aparece en la respuesta', async () => {
    const hash = sha1Upper('password-comprometida-de-prueba');
    const suffix = hash.slice(5);
    mockFetchOk([`${suffix}:12345`, 'OTROSUFIJOQUENOCOINCIDE:1']);

    await expect(checkPasswordPwned('password-comprometida-de-prueba')).resolves.toBe(true);
  });

  it('devuelve false cuando el sufijo no aparece en la respuesta', async () => {
    mockFetchOk(['SUFIJOQUENOCOINCIDEPARANADA1234567890AB:1']);
    await expect(checkPasswordPwned('otra-contraseña-cualquiera')).resolves.toBe(false);
  });

  it('fail-open: si HIBP responde con error HTTP, no bloquea (devuelve false)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(checkPasswordPwned('cualquiera')).resolves.toBe(false);
  });

  it('fail-open: si la petición a HIBP falla o no responde a tiempo, no bloquea (devuelve false)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    await expect(checkPasswordPwned('cualquiera')).resolves.toBe(false);
  });
});

describe('passwordPolicy.assertPasswordValida (punto de entrada combinado)', () => {
  beforeEach(() => {
    mockFetchOk(['NUNCACOINCIDEESTESUFIJO1234567890ABCDE:1']);
  });

  it('resuelve sin error para una contraseña válida y no comprometida', async () => {
    await expect(
      assertPasswordValida('una-contraseña-larga-y-valida-2026'),
    ).resolves.toBeUndefined();
  });

  it('rechaza antes de llamar a HIBP si la política síncrona ya falla (longitud)', async () => {
    await expect(assertPasswordValida('corta')).rejects.toBeInstanceOf(PasswordPolicyError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('AC (cambio voluntario): rechaza si la nueva contraseña es igual a la actual', async () => {
    const password = 'misma-contraseña-larga-de-prueba';
    await expect(assertPasswordValida(password, { currentPassword: password })).rejects.toThrow(
      'debe ser diferente a la contraseña actual',
    );
  });

  it('sin currentPassword (alta de usuario / cambio obligatorio) no aplica la regla "diferente a la actual"', async () => {
    const password = 'contraseña-larga-sin-comparacion-previa';
    await expect(assertPasswordValida(password)).resolves.toBeUndefined();
  });

  it('rechaza si HIBP marca la contraseña como comprometida', async () => {
    const password = 'contraseña-comprometida-para-la-prueba';
    const hash = sha1Upper(password);
    mockFetchOk([`${hash.slice(5)}:99`]);

    await expect(assertPasswordValida(password)).rejects.toThrow(
      'demasiado común o ha sido comprometida',
    );
  });
});
