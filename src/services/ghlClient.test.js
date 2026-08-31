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
