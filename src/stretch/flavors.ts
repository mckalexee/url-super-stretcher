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
 * The flavors that a visitor can pick, in the order that the picker shows them. `name` and
 * `description` are the copy for the picker.
 */
export const FLAVORS = [
  {
    id: "jargon",
    name: "Corporate synergy",
    description:
      "Leverages best-in-class paradigms to operationalize your link. Take any questions offline.",
  },
  {
    id: "legalese",
    name: "Terms and conditions",
    description:
      "Whereas you wanted a link, now therefore you get a contract. Nobody reads it. Everybody agrees.",
  },
  {
    id: "ooo",
    name: "Looooooong",
    description: "The classic. One word, several hundred o's, no further ideas.",
  },
  {
    id: "tracking",
    name: "Fully tracked",
    description:
      "Every tracking parameter that marketing ever asked for, and a few they haven't thought of yet.",
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
  "and-per-my-last-email",
  "and-from-thirty-thousand-feet",
];

const JARGON_CLOSERS = [
  "so-let-us-take-this-offline",
  "but-let-us-put-a-pin-in-that",
  "pending-a-quick-sync-after-the-offsite",
  "assuming-we-have-the-bandwidth",
  "once-all-our-ducks-are-in-a-row",
  "as-discussed-in-the-meeting-about-meetings",
  "per-the-slide-deck-that-nobody-opened",
  "subject-to-alignment-with-leadership",
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

// Legalese. One contract with a fixed skeleton: two recitals that define "the clicker" and "the
// link", the consideration, two covenants, two provisos, and an attestation. Each list fills one
// slot, and every entry in a list has the same grammatical shape, so any combination reads as a
// sentence.

const LEGAL_CLICKERS = [
  "the-party-of-the-first-part",
  "the-undersigned-natural-person-of-sound-mind-and-idle-cursor",
  "the-individual-presently-operating-this-browser-whether-knowingly-or-otherwise",
  "the-reader-together-with-any-heirs-successors-and-persons-looking-over-the-shoulder-thereof",
  "the-recipient-of-this-link-howsoever-received",
  "the-person-or-persons-whose-finger-rests-upon-the-pointing-device",
  "the-visitor-acting-in-an-individual-capacity-and-not-as-agent-for-any-household-pet",
  "the-aforementioned-yet-previously-unmentioned-end-user",
];

const LEGAL_CLICKER_RECITALS = [
  "desires-to-be-conveyed-to-a-destination-not-disclosed-herein",
  "wishes-to-visit-a-certain-web-page-without-first-reading-its-address",
  "has-expressed-by-conduct-an-unmistakable-intent-to-click",
  "seeks-passage-to-another-page-by-the-least-direct-wording-available",
  "is-ready-willing-and-able-to-be-redirected",
  "has-nothing-better-to-do-at-the-time-of-execution",
  "intends-to-follow-this-link-to-its-conclusion-be-it-bitter-or-otherwise",
  "requires-transport-to-a-page-the-identity-of-which-is-set-forth-nowhere-in-this-instrument",
];

const LEGAL_LINKS = [
  "the-party-of-the-second-part",
  "this-uniform-resource-locator-together-with-its-successors-and-assigns",
  "the-string-of-characters-presently-occupying-the-address-bar",
  "the-hyperlink-including-all-riders-schedules-and-hyphens-attached-hereto",
  "the-within-address-in-its-entirety-and-no-shorter-portion-thereof",
  "the-instrument-now-before-the-clicker",
  "the-web-address-set-forth-herein-and-continuing-well-past-the-edge-of-the-screen",
  "this-locator-being-uniform-in-name-only",
];

const LEGAL_LINK_RECITALS = [
  "has-been-lengthened-beyond-any-reasonable-commercial-purpose",
  "is-of-a-length-that-no-court-of-competent-jurisdiction-would-read-in-full",
  "was-at-all-times-relevant-hereto-considerably-shorter",
  "stands-ready-to-perform-a-redirect-and-no-other-service-whatsoever",
  "cannot-in-good-faith-be-described-as-brief",
  "exceeds-the-width-of-every-display-known-to-the-parties",
  "has-been-drafted-reviewed-and-padded-by-nobody-admitted-to-practice-in-any-jurisdiction",
  "contains-more-hyphens-than-the-parties-care-to-count",
];

const LEGAL_CONSIDERATIONS = [
  "in-consideration-of-one-click-and-other-good-and-valuable-consideration-the-receipt-and-sufficiency-of-which-are-hereby-acknowledged",
  "for-good-and-valuable-consideration-including-but-not-limited-to-mild-curiosity",
  "in-consideration-of-the-mutual-covenants-contained-herein-and-a-few-seconds-of-undivided-attention",
  "in-exchange-for-the-sum-of-zero-dollars-payable-in-advance",
  "the-parties-intending-to-be-legally-bound-or-at-least-mildly-inconvenienced",
  "upon-the-terms-and-subject-to-the-conditions-set-forth-at-considerable-length-herein",
  "for-reasons-that-seemed-sufficient-at-the-time",
  "in-reliance-upon-the-representations-of-nobody-in-particular",
];

const LEGAL_COVENANTS = [
  "agrees-to-be-redirected-forthwith",
  "waives-any-and-all-rights-to-a-shorter-link",
  "represents-and-warrants-that-the-clicker-has-not-read-and-does-not-intend-to-read-this-address",
  "irrevocably-consents-to-the-scroll-bar-becoming-very-small",
  "acknowledges-that-the-address-bar-is-provided-as-is-and-without-warranty-of-brevity",
  "releases-the-link-from-all-claims-of-excessive-length-whether-known-or-unknown",
  "accepts-these-terms-by-clicking-hovering-or-merely-glancing",
  "grants-the-link-a-perpetual-worldwide-royalty-free-license-to-be-this-long",
];

const LEGAL_FURTHER_COVENANTS = [
  "covenants-not-to-read-this-link-aloud-in-whole-or-in-part",
  "agrees-not-to-paste-the-link-into-any-spreadsheet-cell-text-message-or-wedding-invitation",
  "undertakes-to-arrive-at-the-destination-in-substantially-the-same-condition-as-at-departure",
  "forgoes-the-right-to-trial-by-jury-in-any-dispute-concerning-hyphens",
  "stipulates-that-time-is-of-the-essence-notwithstanding-all-evidence-to-the-contrary",
  "consents-to-the-exclusive-jurisdiction-of-wherever-the-server-happens-to-be",
  "assumes-all-risk-of-eye-strain-arising-out-of-or-relating-to-this-address",
  "declines-to-seek-independent-legal-advice-on-the-ground-that-it-is-only-a-link",
];

const LEGAL_PROVISOS = [
  "nothing-herein-shall-be-construed-as-a-promise-of-brevity",
  "any-hyphen-held-to-be-unenforceable-shall-be-severed-and-the-remaining-hyphens-shall-continue-in-full-force-and-effect",
  "the-headings-hereof-are-for-convenience-only-and-there-are-no-headings",
  "this-link-constitutes-the-entire-agreement-and-supersedes-all-prior-and-shorter-links",
  "no-waiver-of-any-character-shall-be-deemed-a-waiver-of-any-other-character",
  "the-singular-shall-include-the-plural-and-the-short-shall-include-the-long",
  "the-foregoing-recitals-are-incorporated-herein-by-reference-and-may-be-skipped",
  "words-importing-brevity-shall-be-given-no-effect-whatsoever",
];

const LEGAL_FURTHER_PROVISOS = [
  "the-destination-shall-remain-exactly-where-it-was-before-all-of-this",
  "the-link-may-be-executed-in-any-number-of-browser-tabs-each-of-which-shall-be-deemed-an-original",
  "no-amendment-hereto-shall-be-valid-unless-it-makes-the-link-longer",
  "force-majeure-shall-include-acts-of-nature-loss-of-signal-and-closing-the-laptop",
  "this-clause-shall-survive-the-termination-of-the-redirect",
  "the-clicker-shall-be-entitled-to-no-remedy-other-than-arriving-at-the-page",
  "all-notices-hereunder-shall-be-given-in-writing-and-ignored",
  "the-prevailing-party-shall-recover-nothing-there-being-nothing-to-recover",
];

const LEGAL_ATTESTATIONS = [
  "in-witness-whereof-the-parties-have-executed-this-link-by-a-single-click",
  "in-witness-whereof-this-link-is-executed-as-of-the-date-first-clicked",
  "signed-sealed-and-delivered-in-the-presence-of-one-blinking-cursor",
  "so-ordered-so-agreed-and-so-very-long",
  "the-foregoing-having-been-read-and-approved-by-no-one",
  "executed-in-counterparts-none-of-which-anybody-kept",
  "witnessed-by-the-browser-history-and-by-nobody-else",
  "acknowledged-before-a-notary-who-wishes-to-remain-uninvolved",
];

function legalese(id: Uint8Array, choices: Choices): string {
  return [
    "whereas",
    choices.pick(LEGAL_CLICKERS),
    "hereinafter-the-clicker",
    choices.pick(LEGAL_CLICKER_RECITALS),
    "and-whereas",
    choices.pick(LEGAL_LINKS),
    "hereinafter-the-link",
    choices.pick(LEGAL_LINK_RECITALS),
    "now-therefore",
    choices.pick(LEGAL_CONSIDERATIONS),
    "the-clicker-hereby",
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

// Tracking. A landing page with one of every parameter. The click IDs are random noise, as the
// real ones appear to be, and the rest report on the visitor in more detail than anyone asked for.

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const TRACKING_SOURCES = [
  "newsletter-you-never-subscribed-to",
  "group-chat-you-muted",
  "forwarded-by-a-distant-relative",
  "sponsored-post-you-scrolled-past",
  "qr-code-on-a-lamp-post",
  "popup-you-closed-immediately",
  "email-signature-of-a-stranger",
  "podcast-ad-you-skipped",
];

const TRACKING_MEDIUMS = [
  "carrier-pigeon",
  "interpretive-dance",
  "skywriting",
  "fax",
  "word-of-mouth-but-monetized",
  "billboard-in-an-empty-field",
  "smoke-signal",
  "sandwich-board",
];

const TRACKING_CAMPAIGNS = [
  "q3-engagement-push-final-v2-really-final",
  "spring-reactivation-of-lapsed-clickers",
  "operation-know-your-customer-too-well",
  "brand-awareness-awareness-week",
  "win-back-the-unsubscribers",
  "always-on-evergreen-forever-sale",
  "last-chance-number-fourteen",
  "we-miss-you-and-your-data",
];

const TRACKING_TERMS = [
  "words-you-said-near-your-phone",
  "shoes-you-looked-at-once",
  "that-thing-you-searched-for-at-3am",
  "gift-for-someone-you-barely-know",
  "how-to-unsubscribe",
  "is-this-link-safe",
  "cheap-flights-to-anywhere-else",
  "why-is-this-url-so-long",
];

const TRACKING_CONTENTS = [
  "big-red-button-variant-b",
  "banner-nobody-saw",
  "footer-link-in-six-point-type",
  "stock-photo-of-people-laughing-at-salad",
  "popup-on-top-of-the-popup",
  "the-one-with-the-countdown-timer",
  "carousel-slide-nine-of-nine",
  "unsubscribe-link-disguised-as-a-period",
];

const TRACKING_SEGMENTS = [
  "likely-to-churn",
  "window-shoppers-with-commitment-issues",
  "opens-emails-but-feels-nothing",
  "high-intent-low-budget",
  "people-who-read-the-terms",
  "accidental-clickers",
  "cart-abandoners-anonymous",
  "probably-a-bot-but-a-loyal-one",
];

const TRACKING_DEVICES = [
  "phone-held-too-close-to-the-face",
  "work-laptop-on-company-time",
  "tablet-with-a-cracked-screen",
  "smart-fridge",
  "library-computer-with-nine-toolbars",
  "watch-being-squinted-at",
  "television-operated-by-remote",
  "a-borrowed-phone",
];

const TRACKING_BUCKETS = [
  "control-group-of-one",
  "variant-q",
  "the-placebo",
  "both-somehow",
  "whichever-one-wins",
  "the-button-is-slightly-bluer",
  "holdout-we-forgot-about",
  "experiment-ended-in-2019",
];

const TRACKING_CONSENTS = [
  "assumed",
  "implied-by-your-continued-existence",
  "pending-your-seventh-reminder",
  "yes-probably",
  "banner-still-loading",
  "you-clicked-near-the-button",
  "granted-by-a-previous-tenant",
  "see-our-other-forty-partners",
];

const TRACKING_DO_NOT_TRACK = [
  "noted",
  "noted-and-ignored",
  "respected-in-spirit",
  "under-review-by-committee",
  "1-but-we-saw-nothing",
  "adorable",
  "forwarded-to-the-tracking-team",
  "tracked",
];

const TRACKING_ATTRIBUTIONS = [
  "last-click-takes-all",
  "whoever-shouts-loudest",
  "astrology",
  "first-touch-finders-keepers",
  "a-dartboard",
  "everyone-gets-full-credit",
  "the-intern-decides",
  "vibes-weighted-linear",
];

const TRACKING_FUNNEL_STAGES = [
  "mildly-curious",
  "aware-of-being-made-aware",
  "considering-reconsidering",
  "fell-out-of-the-funnel-and-climbed-back-in",
  "stuck-in-the-middle",
  "converted-against-all-odds",
  "top-of-funnel-bottom-of-priorities",
  "retargeted-into-submission",
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
    ["fbclid", token(72)],
    ["gclid", token(64)],
    ["click_id", toHex(id)],
    ["session_id", token(40)],
    ["impression_id", token(32)],
    ["device_guess", choices.pick(TRACKING_DEVICES)],
    ["visitor_segment", choices.pick(TRACKING_SEGMENTS)],
    ["ab_test_bucket", choices.pick(TRACKING_BUCKETS)],
    ["attribution_model", choices.pick(TRACKING_ATTRIBUTIONS)],
    ["funnel_stage", choices.pick(TRACKING_FUNNEL_STAGES)],
    ["cookie_consent", choices.pick(TRACKING_CONSENTS)],
    ["do_not_track", choices.pick(TRACKING_DO_NOT_TRACK)],
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
