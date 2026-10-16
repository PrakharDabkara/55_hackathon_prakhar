/**
 * Text that reads like an instruction to a model rather than a search for a product. A real item
 * search never contains these phrases, so such a query skips the AI steps and is answered by the
 * free steps only (ADR-0021). This is a cheap first line of defence: the shortlist check is the
 * hard guard, and a miss here costs at most a wrong catalog item.
 */
const PATTERNS: RegExp[] = [
  // English
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|rules?|prompt|above|previous|earlier|shortlist|list)\b/i,
  /\b(previous|above|earlier|prior)\s+(instructions?|prompts?|rules?)\b/i,
  /\bnew\s+instructions?\b/i,
  /(?:^|[^a-z])system\s*:|#{2,}\s*system|\bsystem\s+prompt\b/i,
  /\b(developer|admin|god|jailbreak|dan)\s+mode\b|\bjailbreak\b/i,
  /\byou\s+are\s+(now|an?|the)\b|\bact\s+as\b|\bpretend\s+(to\s+be|you)\b/i,
  /\b(reveal|show|print|output|return|respond\s+with|answer\s+with|list)\b.{0,30}\b(prompt|item\s*id|uuid|instructions?|admin|phone\s+numbers?)\b/i,
  /\b(answer|respond|reply)\b\s+(with\s+)?\w+/i,
  // Hinglish
  /\b(ignore|nazarandaz|andekha)\s+(karo|kar\s*do|kijiye)\b/i,
  /\b(bhool\s+jao|bhul\s+jao|bhool\s+ja)\b/i,
  /\bpichle\s+(nirdesh|instructions?|aadesh)\b/i,
  /\bupar\s+(ke|ka|wale)\s+.{0,20}\b(instructions?|nirdesh|ignore)\b/i,
  /\b(tum|aap)\s+ab\b|\bab\s+(tum|aap)\b/i,
  // Devanagari
  /निर्देश|अनदेखा|भूल\s*जाओ|सिस्टम\s*प्रॉम्प्ट/,
];

export const looksLikeInstruction = (text: string): boolean => PATTERNS.some((p) => p.test(text));
