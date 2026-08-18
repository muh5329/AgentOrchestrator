import { describe, expect, it } from 'vitest'
import {
  billingFor,
  environmentFor,
  explainBillingFailure,
  isBillingFailure
} from '../src/main/runtime/providers/claude-auth'
import { normaliseBaseUrl } from '../src/main/runtime/providers/local-openai'

/**
 * Whose money gets spent.
 *
 * The Claude Code CLI's documented precedence puts an API key above the
 * subscription, and in headless mode the key is always used when present. So an
 * ANTHROPIC_API_KEY exported in the shell that happened to launch this app would
 * bill pay-as-you-go credits to somebody already paying for a plan, and the
 * first they would hear of it is "credit balance is too low" mid-run.
 *
 * These are about a real cost to a real person, so they are exact.
 */
describe('the billing account', () => {
  it('reads a clean environment as the subscription', () => {
    const verdict = billingFor({ PATH: '/usr/bin' })
    expect(verdict.account).toBe('subscription')
    expect(verdict.cause).toBeUndefined()
  })

  it('spots every variable that would redirect the bill', () => {
    for (const [name, account] of [
      ['ANTHROPIC_API_KEY', 'api-key'],
      ['ANTHROPIC_AUTH_TOKEN', 'api-key'],
      ['ANTHROPIC_BASE_URL', 'gateway'],
      ['CLAUDE_CODE_USE_BEDROCK', 'gateway'],
      ['CLAUDE_CODE_USE_VERTEX', 'gateway']
    ] as const) {
      const verdict = billingFor({ [name]: 'x' })
      expect(verdict.account, name).toBe(account)
      expect(verdict.cause, name).toBe(name)
      expect(verdict.detail, name).toContain(name)
    }
  })

  it('ignores a variable that is present but empty', () => {
    expect(billingFor({ ANTHROPIC_API_KEY: '' }).account).toBe('subscription')
  })

  it('names the most significant cause when several are set', () => {
    // Cloud routing wins over a plain key, as the CLI reads them.
    const verdict = billingFor({ ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_USE_BEDROCK: '1' })
    expect(verdict.cause).toBe('CLAUDE_CODE_USE_BEDROCK')
  })
})

describe('the environment a run is given', () => {
  const shell = {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    ANTHROPIC_API_KEY: 'sk-ant-from-the-shell',
    ANTHROPIC_AUTH_TOKEN: 'bearer',
    CLAUDE_CODE_USE_BEDROCK: '1'
  }

  it('keeps every redirecting variable out when the plan should pay', () => {
    const env = environmentFor('subscription', shell, 'sk-ant-stored')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    // ...and the resulting environment genuinely reads as the subscription.
    expect(billingFor(env).account).toBe('subscription')
  })

  it('leaves everything else in place', () => {
    const env = environmentFor('subscription', shell, null)
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/Users/someone')
  })

  it('does not mutate the environment it was handed', () => {
    environmentFor('subscription', shell, null)
    expect(shell.ANTHROPIC_API_KEY).toBe('sk-ant-from-the-shell')
  })

  it('supplies the stored key when API billing was chosen and the shell has none', () => {
    const env = environmentFor('api-key', { PATH: '/usr/bin' }, 'sk-ant-stored')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-stored')
    expect(billingFor(env).account).toBe('api-key')
  })

  it('does not override a key the shell already set', () => {
    const env = environmentFor('api-key', shell, 'sk-ant-stored')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-from-the-shell')
  })

  it('chooses API billing with no key stored without inventing one', () => {
    const env = environmentFor('api-key', { PATH: '/usr/bin' }, null)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})

describe('explaining a billing failure', () => {
  it('recognises the failures worth explaining', () => {
    expect(isBillingFailure('Credit balance is too low')).toBe(true)
    expect(isBillingFailure('insufficient credit for this request')).toBe(true)
    expect(isBillingFailure('quota exceeded')).toBe(true)
    expect(isBillingFailure('ECONNREFUSED')).toBe(false)
    expect(isBillingFailure('the file was not found')).toBe(false)
  })

  it('names the credential that paid, and how to change it', () => {
    const message = explainBillingFailure('Credit balance is too low', {
      account: 'api-key',
      cause: 'ANTHROPIC_API_KEY',
      detail: ''
    })
    expect(message).toContain('Credit balance is too low')
    expect(message).toContain('ANTHROPIC_API_KEY')
    expect(message).toContain('not to your Claude subscription')
  })

  it('does not blame an API key when the plan itself was the limit', () => {
    const message = explainBillingFailure('Usage limit reached', {
      account: 'subscription',
      detail: ''
    })
    expect(message).toContain('subscription')
    expect(message).not.toContain('ANTHROPIC_API_KEY')
  })
})

describe('local model endpoints', () => {
  it('adds the version segment these servers all expose', () => {
    expect(normaliseBaseUrl('http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234/v1')
    expect(normaliseBaseUrl('http://127.0.0.1:1234/')).toBe('http://127.0.0.1:1234/v1')
  })

  it('leaves one that is already versioned alone', () => {
    expect(normaliseBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
    expect(normaliseBaseUrl('https://example.test/openai/v2')).toBe('https://example.test/openai/v2')
  })

  it('treats an empty address as unconfigured rather than as a host', () => {
    expect(normaliseBaseUrl('   ')).toBe('')
  })
})
