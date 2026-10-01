# Privacy Policy

**Noah Engine · Last updated 31 July 2026**

| | |
|---|---|
| **Operator** | ⟦FILL: legal entity and jurisdiction⟧ |
| **Site** | noahengine.xyz |
| **Contact** | ⟦FILL: privacy contact address⟧ |

> **Read this first.** Noah Engine has no email signup, no password, and no identity check. You sign in with an EVM wallet, and that wallet's public address is your account. The most sensitive thing we hold is not information about you: it is the secret key of the trading wallet your agent signs with. Section 4 is about that key, and it is the section worth reading closely.

---

## 1. Scope

This policy covers noahengine.xyz and the Noah Engine platform behind it. It does not cover Robinhood Chain itself, the wallet software you sign in with, or any third-party site you reach from ours.

Fields marked ⟦FILL: …⟧ are values this document cannot assert until they are decided or reviewed. They are listed together in section 14.

## 2. The short version

- We identify you by your EVM wallet address, and nothing else. No email, no name, no document, no KYC.
- We never ask for, receive, or store the private key or seed phrase of **your own** wallet.
- We do generate and hold the key of a separate wallet belonging to your agent, encrypted at rest. You can export it or empty it at any time.
- Your agent's trading record is written to our database, and parts of it are public on the fleet by design.
- Losing trades are sent to a third-party language model for analysis. That means your trade data leaves our servers.
- Everything your agent does on-chain is public and permanent, and no policy of ours can change that.

## 3. What we collect

### 3.1 What you give us

| Data | Why | Where it lives |
|---|---|---|
| Your EVM wallet address | It is your account identifier and establishes who owns an agent | Our database |
| Agent name and appearance | It is displayed on the public fleet | Our database |
| Image or GIF URL, if you supply one | Rendered as your agent's face | Our database; the image is fetched from wherever you hosted it |
| Trading configuration | Position size, stop, target, limits: the rules your agent obeys | Our database |
| A private RPC endpoint, if you supply one | Your agent's own chain reads | Our database. These URLs usually carry an API key, so it is stored in its own column and every interface returns it masked |

Signing in is handled by Privy. We receive the resulting wallet address. We do not receive your keys.

### 3.2 What your agent generates

Positions, closed trades, execution logs, refusals with their reasons, price observations, post-mortems of losing trades, accepted lessons, and a record of model requests made on your behalf.

### 3.3 What we do not collect

No email address, legal name, postal address, phone number, date of birth, or identity document. No payment card details: fees are paid in ETH on-chain. We run no advertising or cross-site tracking, and we sell nothing to anyone.

## 4. Key material

This is the part that matters most, and it is stated plainly rather than reassuringly.

**Your own wallet.** Its private key and seed phrase are never requested, never transmitted to us, and never held by us. Noah will not ask for them under any circumstances, in any interface, under any encryption story. Anything that does is fraudulent and is not us.

**Your agent's wallet.** Deploying an agent generates a fresh Robinhood Chain (EVM) wallet belonging to that agent alone. Because an agent has to sign while you are asleep, **we hold that key**. It is:

- Encrypted at rest with AES-256-GCM.
- Encrypted under a key held in the server environment and never written to the database, so a database dump on its own is not enough to move funds.
- Per-agent. There is no shared, fleet-wide signing credential.
- Never returned by any API. Exporting it requires a signature from your own wallet, proving ownership.

**What that does and does not bound.** Only what you deposit into the agent wallet is ever at risk; there is no path from it to your own wallet, because we hold no authority over yours. But we can sign anything that agent key can sign. That constraint is operational, not cryptographic, and you should read it that way. See §7.1 and §7.2 of the whitepaper, which describe both this design and what it does not yet protect against.

**Decryption happens in application memory at signing time.** There is no HSM and no separate signing service today. A deep enough compromise of our servers reaches key material.

## 5. On-chain data is public and permanent

Every trade your agent makes is a public Robinhood Chain transaction. Amounts, timing, counterparties, and the agent wallet address are visible to anyone, forever, on any block explorer.

If you fund an agent wallet from your own wallet, that transfer is also public, and it links the two addresses permanently. Anyone who knows your main address can then follow your agent's activity, and the reverse. **We cannot undo this, delete it, or hide it.** If that linkage matters to you, fund the agent from an address you are willing to have publicly associated with it.

## 6. What is public on the fleet

Noah Engine is a public directory by design.

**Public.** Your agent's name and face, how long it has run, its refusals and their reasons, its positions and closed trades, its open positions, and its post-mortems where you permit them. Paper agents are public by default.

**Live-agent visibility is meant to be opt-in, and isn't yet.** The design intends for a live agent's owner to choose whether it appears on the public fleet at all. That choice doesn't exist in the product today: every deployed agent, live or paper, is currently shown on the fleet page regardless of trading mode. If that matters to you, treat any live agent you deploy as public until this is built, not just after.

**Not public.** Your identity, your wallet balances, and your exact configuration parameters. An agent is never given its own configuration numbers, so a visitor asking it cannot be told them.

**One residual we disclose rather than describe as solved:** publishing both a trade history and a pause state lets a careful reader infer roughly where one of your limits sits, without the agent ever stating it. Closing that would mean concealing one or the other, and both are the point of the fleet.

## 7. Who we send data to

We are not the only party that sees this data. Each of these has its own privacy policy, which governs what it does with what it receives.

| Recipient | What it receives | Why |
|---|---|---|
| Privy | Wallet sign-in | Authentication |
| Robinhood Chain RPC providers | Addresses, transactions, balance queries | Reading the chain and submitting trades |
| Lighter | Your agent's address, perpetuals orders and API key registration | Perpetuals trading |
| GMGN, DexScreener | Token addresses being evaluated | Token discovery, market and safety data |
| A language-model provider (OpenAI, OpenRouter, or Anthropic, depending on configuration) | The full context of a **losing** trade: entry conditions, safety verdicts, execution quality, exit trigger, subsequent price path | Post-mortem analysis |
| Our hosting and database providers | Everything stored | Running the service |

**On the model provider specifically.** No model participates in any trading decision; models are used only after a position has closed. But post-mortem analysis means your trade data is transmitted to that provider. If you would rather that never happen, do not deploy an agent, because the loop cannot be switched off per-agent today: ⟦FILL: whether a per-agent opt-out will ship⟧.

## 8. Cookies and local storage

We use what the site needs to work: a session for wallet sign-in, and local storage for interface preferences. No advertising cookies, no analytics that follow you across other sites, and no third-party trackers embedded for marketing.

A conversation with a public agent is not retained at all. There is no visitor login on a public profile, so a stored thread would be one transcript shared by every visitor. It lives only in your browser session and ends when you close it.

## 9. How long we keep things

| Data | Kept |
|---|---|
| Agent configuration and wallet | Until you delete the agent |
| Trades, positions, logs | ⟦FILL: retention period⟧ |
| Post-mortems and accepted lessons | ⟦FILL: retention period⟧ |
| Encrypted agent key | Until you delete the agent; deleted with it |
| On-chain records | Forever, and not by us |

## 10. Your controls

- **Export your record.** Your agent's memory and post-mortems are exportable in a machine-readable format at any time, independently of any fee. The record belongs to you.
- **Export the key.** The agent wallet's private key is exportable, so you are never locked into our custody of it. This requires a signature from your own wallet.
- **Empty the wallet.** The balance is withdrawable to any address at any time.
- **Stop the agent.** It opens nothing further. Existing positions continue to be watched and exited by their own rules rather than abandoned.
- **Delete the agent.** This removes its configuration and its encrypted key from our database. It does not and cannot remove anything already recorded on-chain, and ⟦FILL: whether public fleet history is removed or anonymised on deletion⟧.

To exercise anything not available in the interface, contact ⟦FILL: privacy contact address⟧.

## 11. Security

We encrypt agent keys at rest, keep the encryption key out of the database, scope signing authority per agent, and refuse to create an agent wallet at all when the encryption key is absent rather than falling back to storing anything in plaintext.

We do not claim the system is secure against every adversary. §7.2 and §17 of the whitepaper set out what is not yet in place, including the absence of a hardware security module and of an append-only signature log. We publish that rather than describing the problem as solved.

If you believe you have found a vulnerability, report it to ⟦FILL: security contact address⟧.

## 12. Children

This service is not directed at, and may not be used by, anyone under 18.

## 13. Changes

We will post any change here with a new date at the top. A change that materially affects how key material or trading data is handled will be announced in the interface, not only by editing this page.

## 14. Open items

The following are unresolved and marked in the text above: legal entity and jurisdiction; privacy and security contact addresses; retention periods; whether a per-agent opt-out from model analysis will ship; and what happens to public fleet history when an agent is deleted.

**Legal review of this document is outstanding.** It describes the system accurately as built, but it has not been reviewed by counsel in any jurisdiction.
