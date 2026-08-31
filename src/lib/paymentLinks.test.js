const { createSignedLink, verifyLink } = require('./paymentLinks');

describe('createSignedLink + verifyLink', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, PAYMENT_LINK_SECRET: 'test-secret-abc' };
  });
  afterEach(() => { process.env = OLD_ENV; });

  test('a link created by createSignedLink verifies successfully with the same params', () => {
    const url = createSignedLink('https://example.com/pay', {
      amount: 99.5,
      currency: 'USD',
      description: 'Consultation',
      successUrl: 'https://amwellinc.com/thanks',
      failureUrl: 'https://amwellinc.com/failed'
    });

    const query = Object.fromEntries(new URL(url).searchParams);
    const result = verifyLink(query);

    expect(result.valid).toBe(true);
    expect(result.params.amount).toBe('99.50');
    expect(result.params.currency).toBe('USD');
    expect(result.params.description).toBe('Consultation');
  });

  test('rejects a link with a tampered amount, even though the rest of the signature matches', () => {
    const url = createSignedLink('https://example.com/pay', { amount: 10 });
    const query = Object.fromEntries(new URL(url).searchParams);

    query.amount = '0.01'; // attacker edits the query string

    const result = verifyLink(query);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Invalid signature');
  });

  test('rejects a link with no signature at all', () => {
    const result = verifyLink({ amount: '10.00', currency: 'USD' });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Missing signature');
  });

  test('rejects an expired link', () => {
    const url = createSignedLink('https://example.com/pay', { amount: 10, ttlSeconds: -1 });
    const query = Object.fromEntries(new URL(url).searchParams);

    const result = verifyLink(query);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Link has expired');
  });

  test('createSignedLink rejects a non-positive or non-numeric amount', () => {
    expect(() => createSignedLink('https://example.com/pay', { amount: 0 })).toThrow(/positive number/);
    expect(() => createSignedLink('https://example.com/pay', { amount: -5 })).toThrow(/positive number/);
    expect(() => createSignedLink('https://example.com/pay', { amount: 'abc' })).toThrow(/positive number/);
  });

  test('createSignedLink throws a clean error when PAYMENT_LINK_SECRET is not configured', () => {
    delete process.env.PAYMENT_LINK_SECRET;
    expect(() => createSignedLink('https://example.com/pay', { amount: 10 })).toThrow(/PAYMENT_LINK_SECRET/);
  });

  test('a description containing delimiter-like characters cannot shift field boundaries into a different signed successUrl', () => {
    // If canonicalization ever regresses to naive "key=value&key=value"
    // concatenation, a description like this could make the signed string
    // for {description: X, successUrl: "https://real.com"} collide with
    // some other, attacker-chosen (description, successUrl) pair.
    const url = createSignedLink('https://example.com/pay', {
      amount: 10,
      description: 'Order&successUrl=https://evil.example.com/steal&x=',
      successUrl: 'https://real.example.com/thanks'
    });
    const query = Object.fromEntries(new URL(url).searchParams);
    const result = verifyLink(query);

    expect(result.valid).toBe(true);
    expect(result.params.description).toBe('Order&successUrl=https://evil.example.com/steal&x=');
    expect(result.params.successUrl).toBe('https://real.example.com/thanks');

    // Now attempt the actual attack: move the successUrl-looking suffix of
    // description into a real successUrl field, expecting the same
    // signature to still validate if canonicalization were ambiguous.
    const forged = {
      ...query,
      description: 'Order',
      successUrl: 'https://evil.example.com/steal'
    };
    expect(verifyLink(forged).valid).toBe(false);
  });

  test('a link signed under one secret does not verify under a different secret', () => {
    const url = createSignedLink('https://example.com/pay', { amount: 10 });
    const query = Object.fromEntries(new URL(url).searchParams);

    process.env.PAYMENT_LINK_SECRET = 'a-completely-different-secret';
    const result = verifyLink(query);
    expect(result.valid).toBe(false);
  });
});
