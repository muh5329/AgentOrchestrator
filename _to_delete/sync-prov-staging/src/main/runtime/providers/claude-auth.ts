/**
 * Which account pays for a Claude Code run.
 *
 * The CLI decides this from its environment, and its documented precedence puts
 * an API key *above* the subscription you signed in with - in headless mode the
 * key is always used when present. So a process that spawns the CLI with its own
 * environment inherited wholesale will quietly bill pay-as-you-go credits to a
 * person who is paying for a plan, and the first they hear of it is "credit
 * balance is too low" in the middle of a run.
 *
 * That is a decision about someone's money, so it is made deliberately here
 * rather than by whatever happens to be exported in the shell that launched the
 * app: subscription unless you say otherwise, and either way the interface can
 * say which one before you spend anything.
 *
 * Precedence and variable names per Claude Code's authentication documentation:
 * https://code.claude.com/docs/en/authentication
 */

export type BillingAccount = 'subscription' | 'api-key' | 'gateway'

/**
 * Variables that route the CLI away from subscription credentials.
 *
 * Ordered as the CLI reads them, most significant first, so the reason we give
 * names the variable that actually decided it.
 */
export const REDIRECTING_VARS: Array<{ name: string; account: BillingAccount; why: string }> = [
  { name: 'CLAUDE_CODE_USE_BEDROCK', account: 'gateway', why: 'routes through AWS Bedrock' },
  { name: 'CLAUDE_CODE_USE_VERTEX', account: 'gateway', why: 'routes through Google Vertex' },
  { name: 'CLAUDE_CODE_USE_FOUNDRY', account: 'gateway', why: 'routes through Azure Foundry' },
  {
    name: 'CLAUDE_CODE_USE_ANTHROPIC_AWS',
    account: 'gateway',
    why: 'routes through Anthropic on AWS'
  },
  { name: 'ANTHROPIC_AUTH_TOKEN', account: 'api-key', why: 'authenticates with a bearer token' },
  { name: 'ANTHROPIC_API_KEY', account: 'api-key', why: 'bills pay-as-you-go API credits' },
  { name: 'ANTHROPIC_BASE_URL', account: 'gateway', why: 'sends requests to another endpoint' },
  { name: 'ANTHROPIC_CUSTOM_HEADERS', account: 'gateway', why: 'adds gateway routing headers' },
  { name: 'ANTHROPIC_PROFILE', account: 'gateway', why: 'selects a federated profile' },
  { name: 'ANTHROPIC_FEDERATION_RULE_ID', account: 'gateway', why: 'selects a federation rule' }
]

export interface BillingVerdict {
  account: BillingAccount
  /** One sentence a person can act on. */
  detail: string
  /** The variable that decided it, when one did. */
  cause?: string
}

/** Reads an environment and says who would pay for a run started with it. */
export function billingFor(env: NodeJS.ProcessEnv): BillingVerdict {
  for (const variable of REDIRECTING_VARS) {
    const value = env[variable.name]
    if (value === undefined || value === '') continue
    return {
      account: variable.account,
      cause: variable.name,
      detail:
        `${variable.name} is set in this environment, which ${variable.why}. ` +
        `Runs will not draw on your Claude subscription.`
    }
  }
  return {
    account: 'subscription',
    detail: 'Runs use the Claude subscription you signed in to the CLI with.'
  }
}

/**
 * The environment to spawn the CLI with.
 *
 * On `subscription` the redirecting variables are removed, which is the only
 * way to get the documented precedence to fall through to the credentials
 * `claude login` stored. On `api-key` they are left alone and the key we hold is
 * supplied when the environment has none of its own, so choosing API billing in
 * the interface actually works rather than depending on the user's shell.
 */
export function environmentFor(
  mode: 'subscription' | 'api-key',
  env: NodeJS.ProcessEnv,
  apiKey: string | null
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env }

  if (mode === 'subscription') {
    for (const variable of REDIRECTING_VARS) delete next[variable.name]
    return next
  }

  if (apiKey && !next.ANTHROPIC_API_KEY && !next.ANTHROPIC_AUTH_TOKEN) {
    next.ANTHROPIC_API_KEY = apiKey
  }
  return next
}

/** Matches the provider's own billing failures, whatever wrapped them. */
export function isBillingFailure(message: string): boolean {
  const text = message.toLowerCase()
  return (
    text.includes('credit balance') ||
    text.includes('insufficient credit') ||
    text.includes('billing') ||
    text.includes('quota') ||
    (text.includes('payment') && text.includes('required'))
  )
}

/**
 * Turns a billing failure into something worth reading.
 *
 * "Credit balance is too low" is true and useless: it does not say which
 * account it means, and a person with an active plan will reasonably conclude
 * the application is broken. This says which credential was used and what to
 * change.
 */
export function explainBillingFailure(original: string, verdict: BillingVerdict): string {
  if (verdict.account === 'subscription') {
    return (
      `${original.trim()}\n\n` +
      'This run used the Claude subscription signed in to the CLI, so this is a limit on that ' +
      'plan rather than a missing API balance. Wait for the usage window to reset, or switch ' +
      'this project to another provider in Settings → Providers.'
    )
  }

  return (
    `${original.trim()}\n\n` +
    `This run was billed to ${verdict.cause ?? 'an API credential'}, not to your Claude ` +
    'subscription — the CLI prefers a key over a plan whenever one is present. Set the billing ' +
    'account to "Claude subscription" in Settings → Providers and the key will be kept out of ' +
    'the run.'
  )
}
