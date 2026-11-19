# Abuse protections

A public, anonymous redirector attracts phishing and spam. This page covers the four protections
that the site has, what each one catches and misses, and what to do when a report arrives.

## The protections

| Protection        | Where                                         | What it does                                                                                                                                                 | What it doesn't catch                                                                                                                          |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Interstitial page | `src/web/routes/to.tsx`                       | A stretched link never redirects. Its page shows the destination's hostname and full URL, and the visitor chooses **Continue**.                              | A visitor who doesn't read the name. A look-alike name that the visitor accepts.                                                               |
| Reputation check  | `src/stretch/reputation.ts`                   | Asks Cloudflare's malware-blocking DNS resolver about the hostname, when a link is created and on every view. A flagged name is rejected or gets a 403 page. | A name that the resolver hasn't listed yet. A harmful page on a hostname that is otherwise legitimate, because the check judges names only.    |
| Takedown          | `scripts/takedown.ts`, `src/stretch/links.ts` | Disables one link, or bans a hostname and with it every link to that hostname. A removed link answers 410 and names no destination.                          | Anything that nobody reports. A subdomain or a second domain of a banned hostname, because a ban matches one exact hostname.                   |
| Rate limit        | `src/web/routes/home.tsx`                     | Allows a client five new links a minute, keyed on its IP address.                                                                                            | A sender spread over many addresses. The count is approximate and separate in each Cloudflare location, so a burst can pass a few extra links. |

Target validation in `parseTarget` also rejects IP addresses, `localhost`, and names that end in
`.localhost`, `.local`, or `.internal`. The resolver can't judge them, and they cover private
networks.

### When the resolver fails

A timeout after two seconds, a network error, a status other than 2xx, or an unexpected body
counts as no objection: the link is created, or its page renders. The Worker logs
`reputation.check_failed` each time, without the hostname. An outage of the resolver turns the
check off, and it doesn't take the site down. If that event appears often in the logs, the check
isn't protecting anyone.

### Records and keys

Everything lives in the `LINKS` namespace:

- `link:<sha256>` holds a link's record. A takedown adds `disabledAt` and, with a reason,
  `disabledReason`. The reason is for you, and no page shows it.
- `blocked-host:<hostname>` bans a hostname. Only the key's existence matters. The hostname is
  lowercase, without a trailing dot, and in its ASCII form (`xn--...`) for an internationalized
  name. The match is exact: `blocked-host:example.com` doesn't ban `www.example.com`.

The link's page reads both keys on every view and sends `Cache-Control: no-store`, so a takedown
shows as soon as KV serves the new value. KV is eventually consistent: a Cloudflare location
that read the key recently can serve the earlier value for 60 seconds or more.

## When a report arrives

The **Report this link** link on a stretched link's page, the **Report abuse** link on a blocked
page, and the **Report abuse** link in the footer are `mailto:` links to the address in the
`ABUSE_EMAIL` var. A report from a link's page has the subject "Report a stretched link" and the
long link in its body. A report from the footer has neither, so ask the sender for the whole long
link when it's missing.

1. Copy the whole long link from the report. A link that lost a character names another key.
2. Open the link in a browser. Its page shows the destination without loading it.
3. Decide whether to take the link down, and whether its hostname serves anything legitimate. If
   it doesn't, ban the hostname too.

## Take a link down

The command needs Node.js 24 and a Wrangler that is signed in to the account, with `wrangler
login` or `CLOUDFLARE_API_TOKEN`. It reads the namespace IDs from `wrangler.jsonc`.

```sh
pnpm takedown '<long link URL>' --reason 'phishing page'
```

Put the link in single quotes. A tracking link holds `&`, which the shell otherwise reads as the
end of the command.

The command prints the key, the destination, and the creation time, then writes the record back
with `disabledAt` and `disabledReason`. `--reason` is optional. From then on, the link answers
410 with "This link was removed after a report."

| Option            | Effect                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| `--reason <text>` | Stores why, in the record and with a ban.                                               |
| `--block-host`    | Also bans the destination's hostname.                                                   |
| `--restore`       | Removes the disabled fields, so the link works again.                                   |
| `--unblock-host`  | With `--restore`, also lifts the ban on the destination's hostname.                     |
| `--preview`       | Acts on the Preview namespace instead of production.                                    |
| `--local`         | Acts on the local storage that `pnpm dev` uses, to try the command without the account. |

## Block a hostname

```sh
pnpm takedown '<long link URL>' --reason 'malware host' --block-host
```

This disables the link and writes `blocked-host:<hostname>` for its destination. Every link to
that hostname then answers 410, and the home page refuses to create a new one.

To ban a hostname without a link in hand, write the key yourself. Use the namespace ID of the
`LINKS` binding from `wrangler.jsonc`:

```sh
pnpm exec wrangler kv key put 'blocked-host:bad.example' '{}' --namespace-id <id> --remote
```

## Restore a link

```sh
pnpm takedown '<long link URL>' --restore
```

A link whose hostname is banned stays removed after a restore, and the command says so. To lift
the ban as well, add `--unblock-host`. Other links to that hostname that were disabled one at a
time stay disabled until you restore each of them.
