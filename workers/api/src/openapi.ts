export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'SaaS Maker Feedback API',
    version: '1.0.0',
    description:
      'Submit customer feedback with a publishable project key and review it through the same authenticated JSON contract used by the private inbox and agents.',
  },
  servers: [{ url: 'https://api.sassmaker.com' }],
  paths: {
    '/health': {
      get: {
        summary: 'Liveness',
        security: [],
        responses: { '200': { description: 'Service is up' } },
      },
    },
    '/openapi.json': {
      get: {
        summary: 'This OpenAPI document',
        security: [],
        responses: { '200': { description: 'OpenAPI 3.1 JSON' } },
      },
    },
    '/v1/feedback': {
      post: {
        summary: 'Submit feedback',
        security: [{ projectKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SubmitFeedback' },
            },
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['feedback'],
                properties: {
                  feedback: {
                    type: 'string',
                    description: 'JSON string matching SubmitFeedback',
                  },
                  screenshot: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Feedback created' },
          '400': { description: 'Invalid payload' },
          '401': { description: 'Missing or invalid project key' },
          '429': { description: 'Rate limited' },
        },
      },
      get: {
        summary: 'List feedback the caller is authorized to read',
        security: [{ bearerSession: [] }, { agentToken: [] }],
        parameters: [
          { name: 'project', in: 'query', schema: { type: 'string' } },
          {
            name: 'type',
            in: 'query',
            schema: { type: 'string', enum: ['bug', 'feature', 'feedback'] },
          },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'until', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        ],
        responses: { '200': { description: 'Newest-first feedback page' } },
      },
    },
    '/v1/feedback/inbox': {
      get: {
        summary: 'Alias of GET /v1/feedback for the owner inbox',
        security: [{ bearerSession: [] }, { agentToken: [] }],
        responses: { '200': { description: 'Newest-first feedback page' } },
      },
    },
    '/v1/feedback/{id}': {
      get: {
        summary: 'Read one feedback item',
        security: [{ bearerSession: [] }, { agentToken: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Feedback record with status events' } },
      },
      patch: {
        summary: 'Update feedback status',
        security: [{ bearerSession: [] }, { agentToken: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated feedback record' },
          '403': { description: 'Read-only agent token' },
        },
      },
    },
    '/v1/upload': {
      post: {
        summary: 'Upload a screenshot for hosted JSON clients',
        security: [{ projectKey: [] }],
        responses: { '201': { description: 'Object URL' } },
      },
    },
    '/v1/projects': {
      get: {
        summary: 'List owned projects',
        security: [{ bearerSession: [] }],
        responses: { '200': { description: 'Project keys' } },
      },
      post: {
        summary: 'Create a project and publishable submission key',
        security: [{ bearerSession: [] }],
        responses: { '201': { description: 'Created project' } },
      },
    },
    '/v1/projects/{id}/agent-tokens': {
      get: {
        summary: 'List agent tokens for a project',
        security: [{ bearerSession: [] }],
        responses: { '200': { description: 'Token metadata; plaintext is never returned again' } },
      },
      post: {
        summary: 'Create a project-scoped agent token',
        description: 'Tokens default to read-only. Set can_write=true for lifecycle mutations.',
        security: [{ bearerSession: [] }],
        responses: { '201': { description: 'Token metadata plus one-time plaintext token' } },
      },
    },
  },
  components: {
    securitySchemes: {
      projectKey: { type: 'apiKey', in: 'header', name: 'X-Project-Key' },
      bearerSession: { type: 'http', scheme: 'bearer' },
      agentToken: {
        type: 'http',
        scheme: 'bearer',
        description: 'Project-scoped smk_ token. Defaults to read-only.',
      },
    },
    schemas: {
      SubmitFeedback: {
        type: 'object',
        required: ['type', 'title', 'description'],
        properties: {
          type: { type: 'string', enum: ['bug', 'feature', 'feedback'] },
          title: { type: 'string' },
          description: { type: 'string' },
          submitter_email: { type: 'string' },
          submitter_name: { type: 'string' },
          image_url: { type: 'string' },
          page: {
            type: 'object',
            properties: { url: { type: 'string' }, title: { type: 'string' } },
          },
          anchor: { type: 'object' },
          client_version: { type: 'string' },
          source: { type: 'string' },
        },
      },
    },
  },
} as const;
