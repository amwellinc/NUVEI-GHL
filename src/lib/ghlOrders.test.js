jest.mock('../services/ghlClient');

let GHLClient;
let createOrderOpportunity;
let createAbandonedCartOpportunity;

const ENV_KEYS = [
  'GHL_API_TOKEN',
  'GHL_LOCATION_ID',
  'GHL_ORDERS_PIPELINE_ID',
  'GHL_ORDERS_NEW_STAGE_ID',
  'GHL_ABANDONED_CART_PIPELINE_ID',
  'GHL_ABANDONED_CART_STAGE_ID'
];
let savedEnv;
let createOpportunity;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.GHL_API_TOKEN = 'pit-test-token';
  process.env.GHL_LOCATION_ID = 'loc-ghl-1';
  process.env.GHL_ORDERS_PIPELINE_ID = 'orders-pipeline-1';
  process.env.GHL_ORDERS_NEW_STAGE_ID = 'orders-stage-new';
  process.env.GHL_ABANDONED_CART_PIPELINE_ID = 'cart-pipeline-1';
  process.env.GHL_ABANDONED_CART_STAGE_ID = 'cart-stage-new';

  jest.resetModules();
  GHLClient = require('../services/ghlClient');
  createOpportunity = jest.fn().mockResolvedValue({ id: 'opp-1' });
  GHLClient.mockImplementation(() => ({ createOpportunity }));

  ({ createOrderOpportunity, createAbandonedCartOpportunity } = require('./ghlOrders'));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('createOrderOpportunity', () => {
  test('creates an opportunity in the configured orders pipeline/stage', async () => {
    await createOrderOpportunity({ contactId: 'contact-1', description: 'Cart total', amount: 49.99, transactionId: 'txn-1' });

    expect(createOpportunity).toHaveBeenCalledWith({
      pipelineId: 'orders-pipeline-1',
      pipelineStageId: 'orders-stage-new',
      contactId: 'contact-1',
      name: 'Order: Cart total',
      monetaryValue: 49.99,
      source: 'wellness111.com checkout'
    });
  });

  test('falls back to the transaction id in the name when there is no description', async () => {
    await createOrderOpportunity({ contactId: 'contact-1', amount: 10, transactionId: 'txn-2' });

    expect(createOpportunity).toHaveBeenCalledWith(expect.objectContaining({ name: 'Order txn-2' }));
  });

  test('does nothing when there is no contactId', async () => {
    await createOrderOpportunity({ contactId: '', description: 'x', amount: 10, transactionId: 'txn-3' });
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  test('does nothing when the orders pipeline is not configured', async () => {
    delete process.env.GHL_ORDERS_PIPELINE_ID;
    jest.resetModules();
    GHLClient = require('../services/ghlClient');
    createOpportunity = jest.fn().mockResolvedValue({ id: 'opp-1' });
    GHLClient.mockImplementation(() => ({ createOpportunity }));
    ({ createOrderOpportunity } = require('./ghlOrders'));

    await createOrderOpportunity({ contactId: 'contact-1', amount: 10, transactionId: 'txn-4' });
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  test('never throws when the GHL request fails — the payment already succeeded', async () => {
    createOpportunity.mockRejectedValueOnce(new Error('GHL down'));
    await expect(
      createOrderOpportunity({ contactId: 'contact-1', amount: 10, transactionId: 'txn-5' })
    ).resolves.toBeUndefined();
  });
});

describe('createAbandonedCartOpportunity', () => {
  test('creates an opportunity in the configured abandoned-cart pipeline/stage', async () => {
    await createAbandonedCartOpportunity({ contactId: 'contact-1', description: 'Cart total', amount: 49.99 });

    expect(createOpportunity).toHaveBeenCalledWith({
      pipelineId: 'cart-pipeline-1',
      pipelineStageId: 'cart-stage-new',
      contactId: 'contact-1',
      name: 'Abandoned Cart: Cart total',
      monetaryValue: 49.99,
      source: 'wellness111.com checkout'
    });
  });

  test('does nothing when there is no contactId', async () => {
    await createAbandonedCartOpportunity({ contactId: '', amount: 10 });
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  test('never throws when the GHL request fails', async () => {
    createOpportunity.mockRejectedValueOnce(new Error('GHL down'));
    await expect(createAbandonedCartOpportunity({ contactId: 'contact-1', amount: 10 })).resolves.toBeUndefined();
  });
});
