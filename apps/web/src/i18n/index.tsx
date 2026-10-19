import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { readLang, saveLang } from '../lib/session.js';
import { en, hi, type Strings } from './strings.js';

export type Lang = 'hi' | 'en';

interface LangValue {
  lang: Lang;
  t: Strings;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangValue | null>(null);

/** English unless the shopkeeper chose otherwise before (or `initial` says so). No i18n library. */
export function LangProvider({ initial, children }: { initial?: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? readLang() ?? 'en');

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveLang(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => ({ lang, t: lang === 'hi' ? hi : en, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useT(): LangValue {
  const value = useContext(LangContext);
  if (!value) throw new Error('useT must be used inside <LangProvider>');
  return value;
}
