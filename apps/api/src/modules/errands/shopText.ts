import { findPrivateData, redactPrivateData } from '../ai/index.js';

const MAX_CHARS = 60;

/**
 * Text a shop wrote (today only its name) as the model gets it: quoted data between marks the system
 * prompt names (ADR-0060). One line, control characters and the marks themselves removed, so it
 * cannot close its own quote and start giving orders; phones, emails and coordinates taken out, so
 * a shop cannot put a number in its name to reach a model, or to make the privacy guard block a
 * customer's errand; capped in length.
 */
export function shopText(raw: string): string {
  const clean = redactPrivateData(
    raw
      .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
      .replace(/<{2,}|>{2,}|SHOP(?=>>>)|(?<=<<<)SHOP/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CHARS),
  )
    .replace(/\s+/g, ' ')
    .trim();
  // A label that looks like a contact field is dropped whole: the guard would block it.
  return `<<<SHOP ${findPrivateData(clean) ? '[name removed]' : clean} SHOP>>>`;
}

/** A shop row as the model reads it: the name quoted, nothing else about the shop. */
export const shopForModel = <T extends { name: string }>(shop: T): T => ({
  ...shop,
  name: shopText(shop.name),
});
