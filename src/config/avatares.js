const AVATARES_VALIDOS = Object.freeze([
  'icon_hospvet',
  'icon_cat',
  'icon_dog',
  'img_doctor',
  'img_doctora',
]);
const AVATAR_PREDETERMINADO = 'icon_hospvet';

function resolverAvatar(avatar) {
  return AVATARES_VALIDOS.includes(avatar) ? avatar : AVATAR_PREDETERMINADO;
}

module.exports = { AVATARES_VALIDOS, AVATAR_PREDETERMINADO, resolverAvatar };
