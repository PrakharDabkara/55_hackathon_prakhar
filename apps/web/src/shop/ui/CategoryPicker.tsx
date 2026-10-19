import { CATEGORIES, type Category } from '@kahanmilega/shared';
import { useT } from '../../i18n/index.js';
import { Chip } from './Chip.js';

export const MAX_CATEGORIES = 3;

interface Props {
  title: string;
  value: Category[];
  onChange: (next: Category[]) => void;
}

/** Up to three kinds of goods. At three, the rest are switched off and the helper says why. */
export function CategoryPicker({ title, value, onChange }: Props) {
  const { t } = useT();
  const full = value.length >= MAX_CATEGORIES;
  return (
    <fieldset className="sh-fieldset">
      <legend className="sh-label">{title}</legend>
      <div className="sh-chips">
        {CATEGORIES.map((category) => {
          const chosen = value.includes(category);
          return (
            <Chip
              key={category}
              pressed={chosen}
              disabled={full && !chosen}
              onClick={() =>
                onChange(chosen ? value.filter((c) => c !== category) : [...value, category])
              }
            >
              {t.categories[category]}
            </Chip>
          );
        })}
      </div>
      {full && <p className="sh-helper">{t.shop.sellLimit}</p>}
    </fieldset>
  );
}
