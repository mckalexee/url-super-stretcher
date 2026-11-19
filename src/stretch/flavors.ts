// The flavors of stretched link, and the generator that writes one. Each flavor is a different joke
// about what makes a URL long. The generator turns random bytes into the part of a link that
// follows the `/to/` prefix, and it has no storage and no knowledge of HTTP, so the same bytes
// always give the same text.

/**
 * Fills the given array with random bytes. `generateStretch` calls it once per link. Tests pass a
 * fixed source to get the same link every time.
 */
export type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => void;

/**
 * The flavors that a visitor can pick, in the order that the picker shows them. The page calls
 * them finishes. `name` and `description` are the copy for the picker, and docs/copy.md says how
 * to write them.
 */
export const FLAVORS = [
  { id: "jargon", name: "Executive", description: "Language that signals seniority." },
  { id: "legalese", name: "Legal", description: "Discourages casual clicking." },
  { id: "ooo", name: "Extended", description: "A single word that fills the address bar." },
  {
    id: "tracking",
    name: "Fully loaded",
    description: "Lets the recipient know they are being measured.",
  },
] as const satisfies readonly { id: string; name: string; description: string }[];

/** The ID of a flavor in `FLAVORS`. */
export type FlavorId = (typeof FLAVORS)[number]["id"];

/** Reports whether a string, such as a form field, names a flavor. */
export function isFlavorId(value: string): value is FlavorId {
  return FLAVORS.some((flavor) => flavor.id === value);
}

// Every link carries these bytes in full, so two links collide only if their IDs do. At 128 bits,
// that doesn't happen in practice.
const ID_BYTES = 16;

// The bytes after the ID choose the words. Each choice reads one byte, and no flavor makes more
// choices than this.
const CHOICE_BYTES = 240;

const defaultRandom: RandomSource = (bytes) => {
  // `getRandomValues` fails when it's called without `crypto` as its receiver, so the default
  // can't be the bare method.
  crypto.getRandomValues(bytes);
};

/** Hands out the choice bytes one at a time. */
interface Choices {
  /** Picks one entry of a list. */
  pick(list: readonly string[]): string;
  /** Picks a position below `limit`. */
  below(limit: number): number;
}

function choicesFrom(bytes: Uint8Array): Choices {
  let cursor = 0;
  // The modulo favors the early entries of a list slightly. That's fine for choosing words, and
  // the ID is what keeps links apart.
  const below = (limit: number): number => {
    const byte = bytes[cursor];
    if (byte === undefined || limit < 1) {
      throw new Error("A flavor made more choices than there are random bytes.");
    }
    cursor += 1;
    return byte % limit;
  };
  return {
    below,
    pick: (list) => list[below(list.length)] ?? "",
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Jargon. A chain of clauses in the shape "<doing> <adjective> <things> to <verb> <adjective>
// <outcomes>", joined by connectors that each lead into the next "<doing>". The two adjective
// lists and the two noun lists don't overlap, so a clause never repeats a word.

const JARGON_CLAUSES = 9;

const JARGON_DOING = [
  "leveraging",
  "socializing",
  "operationalizing",
  "right-sizing",
  "double-clicking-on",
  "future-proofing",
  "whiteboarding",
  "stress-testing",
  "cross-pollinating",
  "workshopping",
  "evangelizing",
  "productizing",
  "incentivizing",
  "ideating-around",
  "benchmarking",
  "onboarding",
];

const JARGON_ADJECTIVES = [
  "synergistic",
  "mission-critical",
  "cross-functional",
  "customer-centric",
  "next-generation",
  "enterprise-grade",
  "results-driven",
  "bleeding-edge",
  "value-added",
  "client-facing",
  "outside-the-box",
  "high-impact",
  "data-driven",
  "frictionless",
  "holistic",
  "scalable",
];

const JARGON_THINGS = [
  "paradigm-shifts",
  "core-competencies",
  "low-hanging-fruit",
  "key-learnings",
  "thought-leadership",
  "stakeholder-touchpoints",
  "action-items",
  "deliverables",
  "value-streams",
  "growth-levers",
  "swim-lanes",
  "strategic-pillars",
  "north-star-metrics",
  "quick-wins",
  "moving-parts",
  "mindshare",
];

const JARGON_VERBS = [
  "operationalize",
  "incentivize",
  "streamline",
  "monetize",
  "empower",
  "disintermediate",
  "recontextualize",
  "move-the-needle-on",
  "drill-down-into",
  "circle-back-on",
  "accelerate",
  "reimagine",
  "level-set",
  "unlock",
  "champion",
  "synergize",
];

const JARGON_OUTCOME_ADJECTIVES = [
  "best-in-class",
  "best-of-breed",
  "world-class",
  "game-changing",
  "forward-looking",
  "end-to-end",
  "blue-sky",
  "win-win",
  "top-down",
  "bottom-line",
  "seamless",
  "disruptive",
  "impactful",
  "granular",
  "actionable",
  "organic",
];

const JARGON_OUTCOMES = [
  "synergies",
  "outcomes",
  "efficiencies",
  "alignment",
  "bandwidth",
  "stakeholder-buy-in",
  "shareholder-value",
  "verticals",
  "ecosystems",
  "roadmaps",
  "engagement",
  "value-propositions",
  "mission-statements",
  "pain-points",
  "takeaways",
  "headwinds",
];

const JARGON_CONNECTORS = [
  "while",
  "thereby",
  "while-simultaneously",
  "with-a-view-to",
  "as-a-first-step-toward",
  "in-the-interest-of",
  "all-without",
  "before-circling-back-and",
  "and-at-the-end-of-the-day",
  "and-going-forward",
  "which-in-turn-means",
  "by-way-of",
  "on-the-critical-path-to",
  "in-lieu-of",
  "and-as-a-matter-of-priority",
  "and-from-thirty-thousand-feet",
];

const JARGON_CLOSERS = [
  "as-approved-at-the-executive-level",
  "pending-sign-off-from-the-board",
  "subject-to-alignment-with-leadership",
  "per-the-office-of-the-chief-executive",
  "as-presented-to-the-senior-leadership-team",
  "with-full-visibility-at-the-highest-level",
  "for-the-immediate-attention-of-all-direct-reports",
  "as-mandated-by-the-executive-committee",
];

function jargon(id: Uint8Array, choices: Choices): string {
  const clauses: string[] = [];
  for (let index = 0; index < JARGON_CLAUSES; index += 1) {
    const clause = [
      choices.pick(JARGON_DOING),
      choices.pick(JARGON_ADJECTIVES),
      choices.pick(JARGON_THINGS),
      "to",
      choices.pick(JARGON_VERBS),
      choices.pick(JARGON_OUTCOME_ADJECTIVES),
      choices.pick(JARGON_OUTCOMES),
    ];
    if (index > 0) {
      clause.unshift(choices.pick(JARGON_CONNECTORS));
    }
    clauses.push(clause.join("-"));
  }
  return [...clauses, choices.pick(JARGON_CLOSERS), "tracked-as-action-item", toHex(id)].join("-");
}

// Legalese. One notice with a fixed skeleton: two recitals that define "the recipient" and "the
// link", the basis, two covenants, two provisos, and an attestation. It reads as a document from
// a sender who expects to be obeyed. Each list fills one slot, and every entry in a list has the
// same grammatical shape, so any combination reads as a sentence.

const LEGAL_CLICKERS = [
  "the-party-of-the-first-part",
  "the-recipient-of-this-link-howsoever-received",
  "the-individual-presently-in-possession-of-this-link",
  "the-natural-or-legal-person-to-whom-this-link-has-been-directed",
  "the-addressee-together-with-all-agents-employees-and-assigns-thereof",
  "any-person-who-has-opened-viewed-or-otherwise-accessed-this-link",
  "the-above-referenced-party-in-receipt-of-this-communication",
  "the-user-of-the-device-upon-which-this-link-is-displayed",
];

const LEGAL_CLICKER_RECITALS = [
  "has-received-this-link-from-a-party-of-considerable-standing",
  "is-hereby-placed-on-formal-notice-of-the-contents-hereof",
  "is-deemed-to-have-read-understood-and-accepted-this-link-in-full",
  "has-been-selected-to-receive-this-link-at-the-sole-discretion-of-the-sender",
  "is-required-to-give-this-link-prompt-and-undivided-attention",
  "acknowledges-the-seniority-of-the-party-from-whom-this-link-originates",
  "has-no-authority-to-alter-abbreviate-or-otherwise-diminish-this-link",
  "is-advised-that-this-link-has-been-prepared-with-the-benefit-of-counsel",
];

const LEGAL_LINKS = [
  "the-party-of-the-second-part",
  "this-uniform-resource-locator-together-with-its-successors-and-assigns",
  "the-within-address-in-its-entirety-and-no-lesser-portion-thereof",
  "the-instrument-now-before-the-recipient",
  "the-hyperlink-including-all-schedules-exhibits-and-annexes-hereto",
  "this-proprietary-and-confidential-web-address",
  "the-communication-of-which-this-link-forms-the-whole",
  "the-address-set-forth-herein-and-each-and-every-character-thereof",
];

const LEGAL_LINK_RECITALS = [
  "is-the-sole-and-exclusive-property-of-the-sender",
  "is-protected-under-all-applicable-laws-treaties-and-conventions",
  "has-been-issued-under-the-full-authority-of-the-sender",
  "is-confidential-privileged-and-intended-solely-for-the-recipient",
  "carries-the-full-weight-and-standing-of-the-party-who-sent-it",
  "is-furnished-subject-to-the-terms-conditions-and-reservations-herein",
  "may-not-be-reproduced-forwarded-or-summarized-without-prior-written-consent",
  "constitutes-a-formal-communication-for-all-purposes-whatsoever",
];

const LEGAL_CONSIDERATIONS = [
  "in-consideration-of-one-click-and-other-good-and-valuable-consideration-the-receipt-and-sufficiency-of-which-are-hereby-acknowledged",
  "in-consideration-of-the-mutual-covenants-contained-herein",
  "upon-the-terms-and-subject-to-the-conditions-set-forth-herein",
  "the-sender-expressly-reserving-all-rights-remedies-and-privileges",
  "without-prejudice-to-any-right-of-the-sender-whether-at-law-or-in-equity",
  "time-being-of-the-essence-in-all-respects",
  "in-reliance-upon-the-representations-and-warranties-of-the-recipient",
  "the-parties-intending-to-be-legally-bound-hereby",
];

const LEGAL_COVENANTS = [
  "agrees-to-proceed-to-the-destination-without-delay",
  "waives-any-and-all-rights-to-a-shorter-link",
  "acknowledges-receipt-of-this-link-in-its-entirety",
  "undertakes-to-treat-this-link-with-the-deference-due-to-its-sender",
  "releases-the-sender-from-all-claims-demands-and-causes-of-action-whatsoever",
  "consents-to-the-exclusive-jurisdiction-of-the-courts-selected-by-the-sender",
  "represents-and-warrants-that-the-recipient-is-authorized-to-click",
  "accepts-these-terms-by-clicking-hovering-or-otherwise-interacting-herewith",
];

const LEGAL_FURTHER_COVENANTS = [
  "covenants-not-to-contest-the-validity-or-enforceability-of-this-link",
  "agrees-not-to-shorten-truncate-or-abridge-this-link-by-any-means",
  "undertakes-to-indemnify-and-hold-harmless-the-sender-and-its-affiliates",
  "forgoes-the-right-to-trial-by-jury-in-any-dispute-arising-hereunder",
  "agrees-that-any-breach-hereof-would-cause-the-sender-irreparable-harm",
  "acknowledges-that-the-sender-may-seek-injunctive-relief-without-posting-bond",
  "stipulates-that-this-link-was-negotiated-at-arms-length",
  "confirms-that-no-reliance-has-been-placed-on-any-shorter-version-hereof",
];

const LEGAL_PROVISOS = [
  "nothing-herein-shall-be-construed-as-a-waiver-of-any-right-of-the-sender",
  "this-link-constitutes-the-entire-agreement-and-supersedes-all-prior-and-shorter-links",
  "any-provision-held-unenforceable-shall-be-severed-and-the-remainder-shall-continue-in-full-force-and-effect",
  "no-failure-or-delay-in-clicking-shall-operate-as-a-waiver-hereof",
  "the-headings-hereof-are-for-convenience-only-and-shall-not-affect-interpretation",
  "words-in-the-singular-shall-include-the-plural-and-vice-versa",
  "this-link-shall-be-governed-by-the-laws-of-the-jurisdiction-of-the-sender",
  "the-foregoing-recitals-are-incorporated-herein-by-this-reference",
];

const LEGAL_FURTHER_PROVISOS = [
  "no-amendment-hereto-shall-be-valid-unless-it-makes-the-link-longer",
  "this-clause-shall-survive-the-termination-of-the-redirect",
  "the-link-may-be-executed-in-any-number-of-browser-tabs-each-of-which-shall-be-deemed-an-original",
  "the-recipient-shall-be-entitled-to-no-remedy-other-than-arrival-at-the-destination",
  "all-notices-hereunder-shall-be-given-in-writing-to-the-sender",
  "the-rights-of-the-sender-hereunder-are-cumulative-and-not-exclusive",
  "the-obligations-of-the-recipient-shall-bind-all-successors-and-permitted-assigns",
  "the-sender-may-assign-this-link-without-the-consent-of-the-recipient",
];

const LEGAL_ATTESTATIONS = [
  "in-witness-whereof-the-parties-have-executed-this-link-by-a-single-click",
  "in-witness-whereof-this-link-is-executed-as-of-the-date-first-clicked",
  "signed-sealed-and-delivered-by-the-sender",
  "given-under-the-hand-and-seal-of-the-sender",
  "all-rights-reserved-without-limitation",
  "executed-in-counterparts-each-of-which-shall-constitute-an-original",
  "so-ordered-and-so-agreed",
  "duly-authorized-and-issued-by-the-office-of-the-sender",
];

function legalese(id: Uint8Array, choices: Choices): string {
  return [
    "whereas",
    choices.pick(LEGAL_CLICKERS),
    "hereinafter-the-recipient",
    choices.pick(LEGAL_CLICKER_RECITALS),
    "and-whereas",
    choices.pick(LEGAL_LINKS),
    "hereinafter-the-link",
    choices.pick(LEGAL_LINK_RECITALS),
    "now-therefore",
    choices.pick(LEGAL_CONSIDERATIONS),
    "the-recipient-hereby",
    choices.pick(LEGAL_COVENANTS),
    "and-further",
    choices.pick(LEGAL_FURTHER_COVENANTS),
    "provided-however-that",
    choices.pick(LEGAL_PROVISOS),
    "and-provided-further-that",
    choices.pick(LEGAL_FURTHER_PROVISOS),
    choices.pick(LEGAL_ATTESTATIONS),
    "and-recorded-as-instrument-number",
    toHex(id),
  ].join("-");
}

// Ooo. The word "long" with the ID hidden in its o's. The ID is written in base 3, and each digit
// becomes a run of lowercase o's in which one letter is `o`, `O`, or `0`. From a distance, it's
// all o's.

const OOO_DIGITS = ["o", "O", "0"];

// 3^81 is the first power of 3 above 2^128, so 81 digits hold every ID.
const OOO_DIGIT_COUNT = 81;

const OOO_RUN_LENGTH = 9;

function ooo(id: Uint8Array, choices: Choices): string {
  let rest = BigInt(`0x${toHex(id)}`);
  let runs = "";
  for (let index = 0; index < OOO_DIGIT_COUNT; index += 1) {
    const digit = OOO_DIGITS[Number(rest % 3n)] ?? "o";
    rest /= 3n;
    // The digit's place in its run varies, so the capitals and zeros don't line up in a visible
    // rhythm. The runs keep a fixed length, so the digits stay readable in order.
    const place = choices.below(OOO_RUN_LENGTH);
    runs += "o".repeat(place) + digit + "o".repeat(OOO_RUN_LENGTH - 1 - place);
  }
  return `l${runs}ng`;
}

// Tracking. A landing page with every campaign parameter, then parameters that tell the
// recipient how they rank, what is expected of them, and that the sender is watching. The click
// IDs are random noise, as the real ones appear to be.

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const TRACKING_SOURCES = [
  "executive-office",
  "direct-outreach",
  "priority-distribution-list",
  "senior-leadership-briefing",
  "private-client-desk",
  "board-communication",
  "office-of-the-principal",
  "confidential-memorandum",
];

const TRACKING_MEDIUMS = [
  "personal-correspondence",
  "secure-channel",
  "direct-message",
  "executive-briefing",
  "priority-email",
  "hand-delivered",
  "encrypted-transfer",
  "private-line",
];

const TRACKING_CAMPAIGNS = [
  "q4-strategic-outreach",
  "key-relationship-development",
  "high-value-recipient-program",
  "principal-level-engagement",
  "fy26-influence-initiative",
  "tier-one-contact-strategy",
  "executive-visibility-program",
  "preferred-recipient-review",
];

const TRACKING_TERMS = [
  "authority",
  "market-leadership",
  "decisive-action",
  "premium-positioning",
  "competitive-dominance",
  "executive-presence",
  "strategic-advantage",
  "industry-standing",
];

const TRACKING_CONTENTS = [
  "full-length-edition",
  "principal-signature-version",
  "unabridged",
  "executive-summary-omitted",
  "long-form-variant-a",
  "complete-and-unedited",
  "director-level-draft",
  "final-approved-copy",
];

const TRACKING_TIERS = [
  "under-review",
  "provisional",
  "tier-two-pending-upgrade",
  "standard",
  "unverified",
  "watchlist",
  "candidate",
  "probationary",
];

const TRACKING_PRIORITIES = [
  "executive",
  "urgent",
  "immediate",
  "critical",
  "highest",
  "time-sensitive",
  "escalated",
  "principal",
];

const TRACKING_CLEARANCES = [
  "restricted",
  "confidential",
  "need-to-know",
  "principals-only",
  "internal",
  "privileged",
  "eyes-only",
  "level-four",
];

const TRACKING_RESPONSES = [
  "within-the-hour",
  "same-day",
  "before-close-of-business",
  "immediately",
  "promptly",
  "without-delay",
  "by-return",
  "on-receipt",
];

const TRACKING_RECEIPTS = [
  "required",
  "requested",
  "logged",
  "enabled",
  "mandatory",
  "recorded",
  "confirmed-on-open",
  "active",
];

const TRACKING_ENGAGEMENTS = [
  "being-calculated",
  "below-expectation",
  "pending",
  "under-observation",
  "recorded",
  "benchmarked-against-peers",
  "to-be-discussed",
  "noted",
];

const TRACKING_RANKS = [
  "principal",
  "managing-director",
  "senior-partner",
  "chairman",
  "founder",
  "executive-vice-president",
  "chief-executive",
  "owner",
];

const TRACKING_FOLLOW_UPS = [
  "scheduled",
  "escalated-if-unopened",
  "automatic",
  "in-48-hours",
  "by-assistant",
  "pending-response",
  "guaranteed",
  "arranged",
];

function tracking(id: Uint8Array, choices: Choices): string {
  const token = (length: number): string => {
    let text = "";
    for (let index = 0; index < length; index += 1) {
      text += TOKEN_ALPHABET.charAt(choices.below(TOKEN_ALPHABET.length));
    }
    return text;
  };
  const parameters = [
    ["utm_source", choices.pick(TRACKING_SOURCES)],
    ["utm_medium", choices.pick(TRACKING_MEDIUMS)],
    ["utm_campaign", choices.pick(TRACKING_CAMPAIGNS)],
    ["utm_term", choices.pick(TRACKING_TERMS)],
    ["utm_content", choices.pick(TRACKING_CONTENTS)],
    ["fbclid", token(64)],
    ["gclid", token(64)],
    ["msclkid", token(20)],
    ["click_id", toHex(id)],
    ["session_id", token(40)],
    ["impression_id", token(32)],
    ["sender_rank", choices.pick(TRACKING_RANKS)],
    ["recipient_tier", choices.pick(TRACKING_TIERS)],
    ["priority", choices.pick(TRACKING_PRIORITIES)],
    ["clearance", choices.pick(TRACKING_CLEARANCES)],
    ["response_expected", choices.pick(TRACKING_RESPONSES)],
    ["read_receipt", choices.pick(TRACKING_RECEIPTS)],
    ["engagement_score", choices.pick(TRACKING_ENGAGEMENTS)],
    ["follow_up", choices.pick(TRACKING_FOLLOW_UPS)],
  ];
  return `landing?${parameters.map(([key, value]) => `${key}=${value}`).join("&")}`;
}

// Each writer takes the ID bytes, which it must put into its text in full, and the choices.
const WRITERS: Record<FlavorId, (id: Uint8Array, choices: Choices) => string> = {
  jargon,
  legalese,
  ooo,
  tracking,
};

/**
 * Writes the part of a stretched link that follows the `/to/` prefix: a path, plus a query string
 * for the `tracking` flavor. The text is 600 to 1,500 characters long, and it uses only characters
 * that browsers and URL parsers leave alone, so the link that comes back in a request is the link
 * that went out. Each result carries a 128-bit random ID, and the same flavor and random bytes
 * always give the same text.
 */
export function generateStretch(flavor: FlavorId, random: RandomSource = defaultRandom): string {
  const bytes = new Uint8Array(ID_BYTES + CHOICE_BYTES);
  random(bytes);
  return WRITERS[flavor](bytes.subarray(0, ID_BYTES), choicesFrom(bytes.subarray(ID_BYTES)));
}
