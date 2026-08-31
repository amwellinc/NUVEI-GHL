jest.mock('axios');
const axios = require('axios');
const GHLClient = require('./ghlClient');

describe('GHLClient#addTags', () => {
  afterEach(() => jest.clearAllMocks());

  test('POSTs the tags array to /contacts/:id/tags with auth headers', async () => {
    axios.mockResolvedValueOnce({ data: { tags: ['payment-completed'] } });
    const client = new GHLClient({ locationId: 'loc-1', apiToken: 'tok-123' });

    const result = await client.addTags('contact-1', ['payment-completed']);

    expect(axios).toHaveBeenCalledTimes(1);
    const [config] = axios.mock.calls[0];
    expect(config.method).toBe('POST');
    expect(config.url).toBe('https://services.leadconnectorhq.com/contacts/contact-1/tags');
    expect(config.data).toEqual({ tags: ['payment-completed'] });
    expect(config.headers.Authorization).toBe('Bearer tok-123');
    expect(result).toEqual({ tags: ['payment-completed'] });
  });

  test('propagates a clean error shape when the GHL request fails', async () => {
    axios.mockRejectedValueOnce({ response: { status: 404, data: { message: 'Contact not found' } } });
    const client = new GHLClient({ locationId: 'loc-1', apiToken: 'tok-123' });

    await expect(client.addTags('missing-contact', ['x'])).rejects.toMatchObject({
      statusCode: 404,
      message: 'Contact not found'
    });
  });
});

describe('GHLClient#upsertContact', () => {
  afterEach(() => jest.clearAllMocks());

  test('POSTs email/phone/name plus the client locationId to /contacts/upsert', async () => {
    axios.mockResolvedValueOnce({ data: { contact: { id: 'contact-99' }, new: true } });
    const client = new GHLClient({ locationId: 'loc-1', apiToken: 'tok-123' });

    const result = await client.upsertContact({ email: 'a@b.com', firstName: 'Ada', lastName: 'Lovelace' });

    expect(axios).toHaveBeenCalledTimes(1);
    const [config] = axios.mock.calls[0];
    expect(config.method).toBe('POST');
    expect(config.url).toBe('https://services.leadconnectorhq.com/contacts/upsert');
    expect(config.data).toEqual({ locationId: 'loc-1', email: 'a@b.com', phone: undefined, firstName: 'Ada', lastName: 'Lovelace' });
    expect(result).toEqual({ contact: { id: 'contact-99' }, new: true });
  });

  test('propagates a clean error shape when the GHL request fails', async () => {
    axios.mockRejectedValueOnce({ response: { status: 422, data: { message: 'Invalid email' } } });
    const client = new GHLClient({ locationId: 'loc-1', apiToken: 'tok-123' });

    await expect(client.upsertContact({ email: 'not-an-email' })).rejects.toMatchObject({
      statusCode: 422,
      message: 'Invalid email'
    });
  });
});

describe('GHLClient#createOpportunity', () => {
  afterEach(() => jest.clearAllMocks());

  test('POSTs pipeline/stage/contact/name/value plus the client locationId to /opportunities/', async () => {
    axios.mockResolvedValueOnce({ data: { id: 'opp-1', name: 'Order: Cart total' } });
    const client = new GHLClient({ locationId: 'loc-1', apiToken: 'tok-123' });

    const result = await client.createOpportunity({
      pipelineId: 'pipe-1',
      pipelineStageId: 'stage-1',
      contactId: 'contact-1',
      name: 'Order: Cart total',
      monetaryValue: 49.99,
      source: 'wellness111.com checkout'
    });

    expect(axios).toHaveBeenCalledTimes(1);
    const [config] = axios.mock.calls[0];
    expect(config.method).toBe('POST');
    expect(config.url).toBe('https://services.leadconnectorhq.com/opportunities/');
    expect(config.data).toEqual({
      locationId: 'loc-1',
      pipelineId: 'pipe-1',
      pipelineStageId: 'stage-1',
      contactId: 'contact-1',
      name: 'Order: Cart total',
      monetaryValue: 49.99,
      status: 'open',
      source: 'wellness111.com checkout',
      customFields: []
    });
    expect(result).toEqual({ id: 'opp-1', name: 'Order: Cart total' });
  });

  test('propagates a clean error shape when the GHL request fails', async () => {
    axios.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Invalid pipelineStageId' } } });
    const client = new GHLClient({ locationId: 'loc-1', apiToken: 'tok-123' });

    await expect(
      client.createOpportunity({ pipelineId: 'pipe-1', pipelineStageId: 'bad-stage', contactId: 'contact-1', name: 'Order' })
    ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid pipelineStageId' });
  });
});
