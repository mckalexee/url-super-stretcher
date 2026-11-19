// Takes a stretched link down after an abuse report, or restores one. It rewrites the link's
// record in Workers KV through Wrangler, so it needs no credentials of its own and no admin
// route in the Worker. The key and the record come from `src/stretch/records.ts`, the same code
// that the Worker runs, so the two can't disagree about where a link lives. docs/abuse.md
// describes when to run it.
//
// Run it as `pnpm takedown '<long link URL>' [options]`. Node.js runs this file as TypeScript.
import { spawnSync } from "node:child_process";
import process from "node:process";

import { unstable_readConfig } from "wrangler";

import { LINK_PREFIX } from "#stretch/prefix.ts";
import {
  blockedHostKey,
  disableRecord,
  linkKey,
  normalizeHostname,
  parseRecord,
  restoreRecord,
} from "#stretch/records.ts";
import { parseTakedownArguments, TAKEDOWN_USAGE } from "#stretch/takedown.ts";
import type { TakedownOptions } from "#stretch/takedown.ts";

const WRANGLER_CONFIG = "./wrangler.jsonc";
const BINDING = "LINKS";

interface KvBinding {
  binding: string;
  id?: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// The IDs come from the same file that deploys the Worker, so this command always edits the
// namespace that the Worker reads. Wrangler doesn't publish the type of its config, so
// TypeScript sees `any` here, and the annotation names the fields that this file reads.
function namespaceId(target: TakedownOptions["target"]): string {
  const config: { kv_namespaces?: KvBinding[]; previews?: { kv_namespaces?: KvBinding[] } } =
    unstable_readConfig({ config: WRANGLER_CONFIG });
  const namespaces = target === "preview" ? config.previews?.kv_namespaces : config.kv_namespaces;
  const id = namespaces?.find((namespace) => namespace.binding === BINDING)?.id;
  if (id === undefined) {
    return fail(`${WRANGLER_CONFIG} has no ${BINDING} namespace ID for ${target}.`);
  }
  return id;
}

// What Wrangler prints, with exit status 0, for a key that local storage doesn't hold.
const NOT_FOUND = "Value not found";

/** Runs `wrangler kv key` commands against one namespace. */
class Namespace {
  readonly #flags: string[];

  constructor(id: string, local: boolean) {
    // `--local` is the storage that `pnpm dev` keeps on this machine. Without a flag, Wrangler
    // picks one for you, so the choice is always explicit here.
    this.#flags = ["--namespace-id", id, local ? "--local" : "--remote"];
  }

  #wrangler(args: string[], output: "pipe" | "inherit") {
    // No shell runs, so a key or a value can't be read as part of the command.
    return spawnSync("pnpm", ["exec", "wrangler", "kv", "key", ...args, ...this.#flags], {
      encoding: "utf8",
      stdio: ["ignore", output, output],
    });
  }

  /**
   * Returns the value of a key, or `null` when the namespace doesn't hold it. Wrangler reports a
   * missing key in the remote namespace as a failed command, the same as a failure to sign in,
   * so `onError` receives what Wrangler printed and decides what the failure means.
   */
  get(key: string, onError: (output: string) => null): string | null {
    const result = this.#wrangler(["get", key, "--text"], "pipe");
    if (result.status !== 0) {
      return onError(`${result.stdout}${result.stderr}`.trim());
    }
    return result.stdout.trim() === NOT_FOUND ? null : result.stdout;
  }

  /** Writes a value, and stops the command when Wrangler fails, so no later step runs. */
  put(key: string, value: string): void {
    if (this.#wrangler(["put", key, value], "inherit").status !== 0) {
      fail(`Wrangler couldn't write ${key}.`);
    }
  }

  /** Deletes a key, and stops the command when Wrangler fails. */
  delete(key: string): void {
    if (this.#wrangler(["delete", key], "inherit").status !== 0) {
      fail(`Wrangler couldn't delete ${key}.`);
    }
  }
}

const parsed = parseTakedownArguments(process.argv.slice(2));
if (!parsed.ok) {
  fail(`${parsed.message}\n\n${TAKEDOWN_USAGE}`);
}
const { options } = parsed;

const namespace = new Namespace(namespaceId(options.target), options.target === "local");
const path = LINK_PREFIX + options.stretch;
const key = await linkKey(options.stretch);
console.log(`Namespace: ${options.target}`);
console.log(`Key:       ${key}`);

const text = namespace.get(key, (output) =>
  fail(
    `Wrangler couldn't read the link's record. If the error says that the key wasn't found, check that you passed all of the long link.\n\n${output}`,
  ),
);
if (text === null) {
  fail("No link is stored under that key. Check that you passed all of the long link.");
}
const record = parseRecord(text, path);
if (record === null) {
  fail("The value under that key isn't a valid record for this link, so it's left as it is.");
}

const hostname = normalizeHostname(new URL(record.url).hostname);
console.log(`Leads to:  ${record.url}`);
console.log(`Created:   ${record.createdAt}`);
if (record.disabledAt !== undefined) {
  console.log(`Disabled:  ${record.disabledAt} (${record.disabledReason ?? "no reason given"})`);
}

if (options.restore) {
  namespace.put(key, JSON.stringify(restoreRecord(record)));
  console.log("Restored the link.");
  if (options.unblockHost) {
    namespace.delete(blockedHostKey(hostname));
    console.log(`Lifted the ban on ${hostname}.`);
  } else if (namespace.get(blockedHostKey(hostname), () => null) !== null) {
    console.log(
      `${hostname} is still banned, so the link stays removed. To lift the ban, add --unblock-host.`,
    );
  }
} else {
  const now = new Date();
  namespace.put(key, JSON.stringify(disableRecord(record, now, options.reason)));
  console.log("Took the link down.");
  if (options.blockHost) {
    const ban = { blockedAt: now.toISOString(), reason: options.reason };
    namespace.put(blockedHostKey(hostname), JSON.stringify(ban));
    console.log(`Banned ${hostname}. Every link to it is removed, and no new one can be made.`);
  }
}
