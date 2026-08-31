jest.mock('../services/ghlClient');

let GHLClient;
let resolveContactId;
let upsertContact;

const ENV_KEYS = ['GHL_API_TOKEN', 'GHL_LOCATION_ID'];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.GHL_API_TOKEN = 'pit-test-token';
  process.env.GHL_LOCATION_ID = 'loc-ghl-1';

  jest.resetModules();
  GHLClient = require('../services/ghlClient');
  // GHLClient.mockImplementation must be set BEFORE requiring ./ghlContact —
  // that module constructs its GHLClient singleton once at load time, so a
  // mock configured afterward never reaches it (see pay.test.js for the
  // same pattern).
  upsertContact = jest.fn().mockResolvedValue({ contact: { id: 'contact-1' }, new: true });
  GHLClient.mockImplementation(() => ({ upsertContact }));
  resolveContactId = require('./ghlContact').resolveContactId;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('resolveContactId', () => {
  test('returns the contact id from a successful upsert', async () => {
    const contactId = await resolveContactId('a@b.com', 'Ada', 'Lovelace');

    expect(contactId).toBe('contact-1');
    expect(upsertContact).toHaveBeenCalledWith({ email: 'a@b.com', firstName: 'Ada', lastName: 'Lovelace' });
  });

  test('falls back to a top-level id if the response has no nested contact object', async () => {
    upsertContact.mockResolvedValueOnce({ id: 'contact-2' });

    expect(await resolveContactId('a@b.com')).toBe('contact-2');
  });

  test('returns an empty string, never throws, when the GHL request fails', async () => {
    upsertContact.mockRejectedValueOnce(new Error('GHL down'));

    await expect(resolveContactId('a@b.com')).resolves.toBe('');
  });

  test('returns an empty string without calling GHL when no email is given', async () => {
    expect(await resolveContactId('')).toBe('');
    expect(await resolveContactId(undefined)).toBe('');
    expect(upsertContact).not.toHaveBeenCalled();
  });

  test('returns an empty string without calling GHL when the token/location is not configured', async () => {
    delete process.env.GHL_API_TOKEN;
    jest.resetModules();
    GHLClient = require('../services/ghlClient');
    upsertContact = jest.fn().mockResolvedValue({ contact: { id: 'contact-1' } });
    GHLClient.mockImplementation(() => ({ upsertContact }));
    resolveContactId = require('./ghlContact').resolveContactId;

    expect(await resolveContactId('a@b.com')).toBe('');
    expect(upsertContact).not.toHaveBeenCalled();
  });
});
