# Terms of Service

**Noah Engine · Last updated 31 July 2026**

| | |
|---|---|
| **Operator** | ⟦FILL: legal entity and jurisdiction⟧ |
| **Site** | noahengine.xyz |
| **Contact** | ⟦FILL: official contact address⟧ |

> **Read this first.** Noah Engine is trading software. It is not a fund, not a broker, and not a promise. It does not guarantee profit and it can lose money, including all of it. Memecoin trading is among the highest-risk activities in crypto. Nothing here is financial advice.

---

## 1. Agreement

By deploying an agent or otherwise using Noah Engine, you agree to these terms. If you do not agree, do not use it. Fields marked ⟦FILL: …⟧ are values this document cannot assert until they are decided or reviewed; they are listed in section 19.

## 2. What Noah Engine is, and is not

**It is** software that runs autonomous trading agents against Solana memecoin markets on your instruction, inside limits you configure.

**It is not** an investment adviser, a broker-dealer, a fund, a managed account, a custodian in the regulated sense, an exchange, or a money transmitter. We do not manage your money, exercise discretion over your strategy, or give advice. Your agent executes the rules you set; you chose them.

Nothing on this site, in an agent's post-mortems, in an accepted lesson, or in a conversation with an agent is financial, legal, or tax advice.

## 3. Eligibility

You must be at least 18 and legally able to enter this agreement. You are solely responsible for whether using this service is lawful where you are, including under securities, commodities, tax, and money-transmission law. That we are reachable from your country is not a representation that your use of it is lawful there.

You may not use Noah Engine if you are subject to sanctions, or are located in a jurisdiction subject to comprehensive sanctions.

## 4. Your account

Your Solana wallet is your account. There is no password to recover and no support channel that can restore access, because we hold nothing that would let us do so. If you lose access to your wallet, you lose access to the agents it owns.

We will never ask for your seed phrase or private key, never message you first, and never ask you to send funds to an address. Anything that does is fraudulent and is not us.

## 5. Agent wallets and custody

This section is the one that decides whether you should fund an agent. Read it before you deposit.

**a. A separate wallet.** Deploying an agent generates a fresh Solana keypair belonging to that agent alone. Your own wallet is used only to establish ownership; its keys are never requested, held, or delegated.

**b. We hold the agent's key.** An agent must sign while you are absent, so we hold its key, encrypted at rest under a key kept in the server environment. This means **we can technically sign anything that key can sign, including a transfer out**. Nothing in program logic prevents it. The constraint is operational, not cryptographic. Any claim that funds in an agent wallet "cannot be taken" would be false, and we do not make it.

**c. What is bounded.** Only the balance you deposit into an agent wallet is ever at risk. There is no path from an agent wallet to your own wallet, because we hold no authority over yours.

**d. What you keep.** The agent wallet's balance is withdrawable to any address at any time, and its private key is exportable, so you are never locked into our custody of it.

**e. Deposit accordingly.** Deposit only what you are prepared to lose outright, independently of trading outcome.

## 6. Trading risk, and what is not guaranteed

**a. You can lose everything.** Memecoins are extremely volatile, frequently worthless, and often adversarial by construction. Total loss of a deposited balance is a realistic outcome, not a remote one.

**b. There are no stop orders on an AMM.** What we call a stop is the engine observing price and submitting a sell. Exits are therefore **rule-based and best-effort, never guaranteed**, and they can fail to protect you when the engine is unavailable, the chain is congested past the exit's fee ceiling, liquidity is removed inside a single block, or price gaps past the level between observations. These are frequent events in this market, not edge cases. **No mechanism in this system places a floor under your losses.**

**c. The safety gate is not a guarantee.** Agents refuse the large majority of what they see, and that refusal is the product. It does not make what passes safe. Novel traps outside the gate exist, and unknown unknowns remain.

**d. No performance is promised.** We publish methodology and outcomes; we do not publish projections and we do not promise returns. Past behaviour of any agent, live or simulated, does not indicate future results.

**e. No language model makes trading decisions.** Models are used only to analyse positions after they close. Analysis can be confidently wrong, and any lesson it proposes is a suggestion you accept or decline, never something applied silently.

## 7. Paper mode

Paper mode runs the full decision pipeline with simulated fills and no capital.

**Paper results systematically overstate live results.** Paper does not model the slippage your own order would cause, your position within the block, priority-fee competition, partial fills, or failed transactions. A paper record accumulated while the executor was intermittently running is a record of uptime as much as of strategy. Do not read paper P&L as a forecast.

## 8. Fees

Paper mode is free. A live agent is priced at a one-time fee of 0.5 SOL per deployed agent. Desk arrangements are priced separately.

**This fee is not currently collected.** There is no billing step in the product today, and switching an agent to live trading does not require or trigger any payment. The terms below describe the fee as designed, for when collection exists, not a charge you should expect right now. Once it is collected: it is charged once at deploy, denominated in SOL, and **non-refundable**, including if your agent loses money, if you stop it, or if you delete it. It buys the ability to deploy a live agent, not a result.

Fees may change with notice; a change does not apply retroactively to an agent already deployed.

## 9. The Noah Engine token

Noah Engine has launched an official token. The contract address is published on the Deploy page and in the Pricing section. Any other token, sale, or allocation claiming association with Noah Engine is fraudulent.

## 10. The public fleet

Deploying an agent means it appears in a public directory. Paper agents are public by default. Live-agent visibility is intended to be opt-in; that choice is not built yet, so a live agent is shown publicly the same as a paper one, regardless of what its owner would prefer.

What is shown, and what is withheld, is set out in the Privacy Policy. The fleet is a directory and not a competition: there is no profit leaderboard, and presence in the fleet is not an endorsement of any agent or configuration.

**Agents do not coordinate.** There is no agent-to-agent signalling, no shared entry trigger, and no feature whose effect is many agents entering the same token in the same window. We commit to keeping it that way.

## 11. Acceptable use

You may not:

- Use Noah Engine to manipulate any market, including wash trading, spoofing, or coordinated entry designed to move a price.
- Impersonate Noah Engine, another operator, or another agent, or register a name intended to be mistaken for one.
- Attempt to access another operator's agent, configuration, key material, or data.
- Probe, scan, or attack the service, or attempt to circumvent its risk limits, rate limits, or isolation between accounts.
- Use the service where doing so is unlawful for you.
- Resell, sublicense, or present the service as your own.

Security research is welcome; report findings to ⟦FILL: security contact address⟧ rather than exploiting them.

## 12. Availability

We do not guarantee uptime. The service may be interrupted for maintenance, provider failure, chain congestion, or reasons outside our control.

**An outage has consequences for open positions.** Positions are only evaluated while the engine is running: if it stops, exits are not attempted, and an open position is unguarded until it resumes. We publish restart behaviour and aim to alert on outages, but you accept this risk when you deploy a live agent.

Stopping an agent, or its circuit breaker tripping, halts new entries immediately. Existing positions continue to be watched and exited by their own rules rather than being abandoned.

## 13. Intellectual property

The service, its interface, and its documentation are ours. These terms grant you a limited, revocable, non-transferable right to use the service and nothing more.

Anything you supply, such as an agent name, an image, or a configuration, remains yours, and you grant us the right to display it as part of the public fleet. You are responsible for having the rights to what you upload.

Your trading record, memory, and post-mortems belong to you and are exportable at any time.

## 14. Disclaimers

The service is provided **"as is" and "as available", without warranty of any kind**, express or implied, including merchantability, fitness for a particular purpose, non-infringement, accuracy, or uninterrupted operation.

We do not warrant that the service will be profitable, that it will avoid losses, that safety checks will identify every hostile token, that exits will execute, or that data displayed is accurate or current.

**Audit status: ⟦FILL: state accurately⟧.**

## 15. Limitation of liability

To the maximum extent permitted by law, we are not liable for trading losses, lost profits, lost opportunity, missed exits, failed or delayed transactions, chain congestion, liquidity removal, third-party failure, or any indirect, incidental, special, consequential, or punitive damages.

To the maximum extent permitted by law, our total aggregate liability arising out of or relating to the service is limited to the fees you paid us in the twelve months before the claim.

Some jurisdictions do not permit these exclusions, in which case they apply to the greatest extent permitted.

## 16. Indemnity

You agree to indemnify us against claims, losses, and costs arising from your use of the service, your breach of these terms, or your violation of any law or third-party right.

## 17. Suspension and termination

You may stop and delete an agent at any time. Deleting it does not refund the deploy fee and does not remove anything already recorded on-chain.

We may suspend or terminate access for breach of section 11, for legal or regulatory reasons, or where continuing would create risk for other operators. Where practical we will give notice. On termination, your right to withdraw an agent wallet's balance and export its key survives.

Sections 5, 6, 13, 14, 15, 16 and 19 survive termination.

## 18. Changes to these terms

We may amend these terms. Material changes will be announced in the interface, not only by editing this page. Continuing to use the service after a change means you accept it.

## 19. Governing law and open items

Governing law and venue: ⟦FILL: governing law and dispute forum⟧.

Also unresolved: legal entity and jurisdiction; official and security contact addresses; audit status.

**Legal review of this document is outstanding.** It describes the service accurately as built, but it has not been reviewed by counsel in any jurisdiction, and three features in particular need that review: a hosted service executing trades for paying users, the custody model in section 5, and public display of trading outcomes.

## 20. Contact

⟦FILL: official contact address⟧
