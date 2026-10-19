import { useT } from '../../i18n/index.js';
import { Button } from '../../ui/Button.js';

/** One button, always in the language you would switch to. */
export function LangSwitch() {
  const { lang, setLang, t } = useT();
  return (
    <Button variant="quiet" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}>
      {t.switchLanguage}
    </Button>
  );
}
