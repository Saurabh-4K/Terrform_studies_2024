/*
 * Languages: English, Marathi and Hindi.
 *
 * The English text is the key: t('You saved {amount} today', { amount: '₹58' })
 * looks the sentence up in the current language's dictionary (i18n-mr.js,
 * i18n-hi.js) and fills in the values. Anything not translated stays in
 * English, so a missing entry never breaks a screen.
 */
(function (root) {
  'use strict';

  const DICTS = root.I18N_DICTS || (root.I18N_DICTS = {});
  const LANGS = [['en', 'English'], ['mr', 'मराठी'], ['hi', 'हिंदी']];
  // Dates in the language, digits stay 0–9 like the amounts.
  const LOCALES = { en: 'en-IN', mr: 'mr-IN-u-nu-latn', hi: 'hi-IN-u-nu-latn' };
  let lang = 'en';

  function fill(s, vars) {
    return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m)) : s;
  }

  function t(s, vars) {
    const d = DICTS[lang];
    return fill((d && d[s]) || s, vars);
  }

  function setLang(l) { lang = l === 'mr' || l === 'hi' ? l : 'en'; }

  // The phone's language, the first time the app opens.
  function detect(navLang) {
    const l = String(navLang || '').toLowerCase().slice(0, 2);
    return l === 'mr' || l === 'hi' ? l : 'en';
  }

  const I18N = { t, fill, setLang, detect, LANGS, getLang: () => lang, locale: () => LOCALES[lang] };
  if (typeof module !== 'undefined' && module.exports) module.exports = I18N;
  else root.I18N = I18N;
})(typeof self !== 'undefined' ? self : this);
