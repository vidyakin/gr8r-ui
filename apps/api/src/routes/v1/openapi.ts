/* Спецификация OpenAPI 3.0.3 для публичного REST API v1 (задача 1392). */

const uuidParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const pagingParams = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
  { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
];
const searchParam = { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search query' };
const updatedSinceParam = { name: 'updatedSince', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'ISO-8601 timestamp or YYYY-MM-DD' };
const errResponses = {
  '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '401': { description: 'Missing, invalid or expired Bearer token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '403': { description: 'Insufficient token permissions (read-only, section, or can_post)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '429': { description: 'Rate limit exceeded (120 requests/minute per token)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
};

const listResp = (ref: string) => ({
  '200': {
    description: 'Paginated list',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['items', 'total', 'limit', 'offset'],
          properties: {
            items: { type: 'array', items: { $ref: ref } },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
        },
      },
    },
  },
  ...errResponses,
});

const itemResp = (ref: string, status = '200') => ({
  [status]: { description: 'Resource', content: { 'application/json': { schema: { $ref: ref } } } },
  '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  ...errResponses,
});

export function buildOpenApiSpec(serverUrl = '/api') {
  return {
    openapi: '3.0.3',
    info: {
      title: 'FutureERP Public REST API',
      version: '1.0.0',
      description: 'Public REST API v1 for products, stock balances, prices, counterparties, warehouses, and trade documents. Authenticate with an API token via Authorization: Bearer <token>.',
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/v1/products': {
        get: {
          summary: 'List products',
          tags: ['Catalog'],
          parameters: [
            ...pagingParams,
            searchParam,
            updatedSinceParam,
            { name: 'sku', in: 'query', schema: { type: 'string' } },
            { name: 'categoryId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'kind', in: 'query', schema: { type: 'string', enum: ['goods', 'service'] } },
            { name: 'active', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: listResp('#/components/schemas/Product'),
        },
      },
      '/v1/products/{id}': {
        get: { summary: 'Get product by ID', tags: ['Catalog'], parameters: [uuidParam], responses: itemResp('#/components/schemas/Product') },
      },
      '/v1/stock': {
        get: {
          summary: 'List stock balances',
          tags: ['Stock'],
          parameters: [
            ...pagingParams,
            searchParam,
            { name: 'warehouseId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'productId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'nonZero', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: listResp('#/components/schemas/StockBalance'),
        },
      },
      '/v1/prices': {
        get: {
          summary: 'List price list rows',
          tags: ['Pricing'],
          parameters: [
            ...pagingParams,
            searchParam,
            { name: 'kindId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'categoryId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'inStock', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: listResp('#/components/schemas/PriceRow'),
        },
      },
      '/v1/companies': {
        get: {
          summary: 'List counterparties (companies)',
          tags: ['CRM'],
          parameters: [
            ...pagingParams,
            searchParam,
            updatedSinceParam,
            { name: 'role', in: 'query', schema: { type: 'string', enum: ['customer', 'supplier'] } },
            { name: 'inn', in: 'query', schema: { type: 'string' } },
          ],
          responses: listResp('#/components/schemas/Company'),
        },
      },
      '/v1/companies/{id}': {
        get: { summary: 'Get counterparty by ID', tags: ['CRM'], parameters: [uuidParam], responses: itemResp('#/components/schemas/Company') },
      },
      '/v1/warehouses': {
        get: {
          summary: 'List warehouses',
          tags: ['Catalog'],
          parameters: [...pagingParams, searchParam, updatedSinceParam],
          responses: listResp('#/components/schemas/Warehouse'),
        },
      },
      '/v1/documents': {
        get: {
          summary: 'List trade documents',
          tags: ['Documents'],
          parameters: [
            ...pagingParams,
            searchParam,
            updatedSinceParam,
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'posted', 'cancelled'] } },
            { name: 'counterpartyId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'warehouseId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: listResp('#/components/schemas/Document'),
        },
        post: {
          summary: 'Create a draft document',
          tags: ['Documents'],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/DocumentWrite' } } } },
          responses: itemResp('#/components/schemas/Document', '201'),
        },
      },
      '/v1/documents/{id}': {
        get: { summary: 'Get document by ID', tags: ['Documents'], parameters: [uuidParam], responses: itemResp('#/components/schemas/Document') },
        patch: {
          summary: 'Update a draft document',
          tags: ['Documents'],
          parameters: [uuidParam],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/DocumentWrite' } } } },
          responses: itemResp('#/components/schemas/Document'),
        },
      },
      '/v1/documents/{id}/post': {
        post: {
          summary: 'Post a draft document (requires can_post token permission)',
          tags: ['Documents'],
          parameters: [uuidParam],
          responses: itemResp('#/components/schemas/Document'),
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'erp_*', description: 'Workspace API token (Settings -> API tokens)' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object' } } } },
        },
        Product: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sku: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string' }, unitCode: { type: 'string' }, price: { type: 'string' }, updatedAt: { type: 'string', format: 'date-time' } } },
        StockBalance: { type: 'object', properties: { warehouseId: { type: 'string', format: 'uuid' }, warehouseName: { type: 'string' }, productId: { type: 'string', format: 'uuid' }, sku: { type: 'string' }, name: { type: 'string' }, qty: { type: 'string' }, reserved: { type: 'string' }, available: { type: 'string' } } },
        PriceRow: { type: 'object', properties: { productId: { type: 'string', format: 'uuid' }, sku: { type: 'string' }, name: { type: 'string' }, unit: { type: 'string' }, prices: { type: 'object', additionalProperties: { type: 'string', nullable: true } } } },
        Company: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, inn: { type: 'string', nullable: true }, isCustomer: { type: 'boolean' }, isSupplier: { type: 'boolean' }, updatedAt: { type: 'string', format: 'date-time' } } },
        Warehouse: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, code: { type: 'string', nullable: true }, name: { type: 'string' }, updatedAt: { type: 'string', format: 'date-time' } } },
        Document: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, type: { type: 'string' }, number: { type: 'string' }, date: { type: 'string', format: 'date' }, status: { type: 'string', enum: ['draft', 'posted', 'cancelled'] }, total: { type: 'string' }, updatedAt: { type: 'string', format: 'date-time' } } },
        DocumentWrite: { type: 'object', properties: { type: { type: 'string' }, date: { type: 'string', format: 'date' }, organizationId: { type: 'string', format: 'uuid' }, counterpartyId: { type: 'string', format: 'uuid', nullable: true }, warehouseId: { type: 'string', format: 'uuid', nullable: true }, comment: { type: 'string' }, lines: { type: 'array', items: { type: 'object' } } } },
      },
    },
  };
}
