import { useT } from '../i18n/index.js';

/** One button, always visible, always in the language you would switch to. */
export function LangToggle() {
  const { lang, setLang, t } = useT();
  return (
    <button
      type="button"
      className="sh-btn sh-btn--quiet"
      onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
    >
      {t.switchLanguage}
    </button>
  );
}
